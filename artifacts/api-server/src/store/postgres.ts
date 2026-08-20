import { createDb, type Database, type DatabaseHandle } from '@workspace/db';
import { agentsTable, anchorsTable, auditEventsTable, runsTable } from '@workspace/db/schema';
import { desc, eq } from 'drizzle-orm';
import type { VerificationResult } from '@workspace/qdsr-core';

import type {
  AgentRecord,
  AgentStatus,
  AnchorRecord,
  AnchorStatus,
  AuditEventRecord,
  EvidenceRecord,
  RunRecord,
  RunStatus,
  Store,
} from './types.js';

const iso = (value: Date | null | undefined): string | undefined =>
  value ? value.toISOString() : undefined;

const date = (value: string | undefined): Date | null => (value ? new Date(value) : null);

/**
 * Postgres persistence via Drizzle.
 *
 * Used automatically when DATABASE_URL is present. The mapping functions below are deliberately explicit rather than
 * spread-based: the database row and the domain record are allowed to drift, and
 * writing the translation out is what makes that drift visible.
 */
export class PostgresStore implements Store {
  private readonly handle: DatabaseHandle;
  private readonly db: Database;

  constructor(connectionString: string) {
    this.handle = createDb(connectionString);
    this.db = this.handle.db;
  }

  close(): Promise<void> {
    return this.handle.close();
  }

  // ------------------------------------------------------------------ agents

  private toAgent(row: typeof agentsTable.$inferSelect): AgentRecord {
    return {
      id: row.id,
      agentId: row.agentId,
      name: row.name,
      family: row.family,
      owner: row.owner,
      periodsPerYear: row.periodsPerYear,
      status: row.status as AgentStatus,
      accent: row.accent,
      description: row.description ?? undefined,
      imageRoot: row.imageRoot ?? undefined,
      imageUrl: row.imageUrl ?? undefined,
      latestRunId: row.latestRunId ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async createAgent(agent: AgentRecord): Promise<AgentRecord> {
    await this.db.insert(agentsTable).values({
      id: agent.id,
      agentId: agent.agentId,
      name: agent.name,
      family: agent.family,
      owner: agent.owner,
      periodsPerYear: agent.periodsPerYear,
      status: agent.status,
      accent: agent.accent,
      description: agent.description ?? null,
      imageRoot: agent.imageRoot ?? null,
      imageUrl: agent.imageUrl ?? null,
      latestRunId: agent.latestRunId ?? null,
      createdAt: new Date(agent.createdAt),
      updatedAt: new Date(agent.updatedAt),
    });
    return agent;
  }

  async getAgent(id: string): Promise<AgentRecord | undefined> {
    const [row] = await this.db.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1);
    return row ? this.toAgent(row) : undefined;
  }

  async getAgentByAgentId(agentId: string): Promise<AgentRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.agentId, agentId))
      .limit(1);
    return row ? this.toAgent(row) : undefined;
  }

  async listAgents(): Promise<AgentRecord[]> {
    const rows = await this.db.select().from(agentsTable).orderBy(desc(agentsTable.updatedAt));
    return rows.map((row) => this.toAgent(row));
  }

  async updateAgent(id: string, patch: Partial<AgentRecord>): Promise<AgentRecord | undefined> {
    await this.db
      .update(agentsTable)
      .set({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.latestRunId !== undefined ? { latestRunId: patch.latestRunId ?? null } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
        ...(patch.imageRoot !== undefined ? { imageRoot: patch.imageRoot ?? null } : {}),
        ...(patch.imageUrl !== undefined ? { imageUrl: patch.imageUrl ?? null } : {}),
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.family ? { family: patch.family } : {}),
        updatedAt: new Date(),
      })
      .where(eq(agentsTable.id, id));
    return this.getAgent(id);
  }

  // -------------------------------------------------------------------- runs

  private toRun(row: typeof runsTable.$inferSelect): RunRecord {
    const evidence = (row.evidence ?? undefined) as
      | (EvidenceRecord & {
          bootstrapSamples?: number[];
          cscvLogits?: number[];
          bootstrapIterations?: number;
          cscvSplits?: number;
        })
      | undefined;
    const startedAt = iso(row.startedAt);
    const finishedAt = iso(row.finishedAt);

    return {
      id: row.id,
      agentId: row.agentId,
      status: row.status as RunStatus,
      progress: row.progress,
      step: row.step,
      seed: row.seed,
      bootstrapIterations: evidence?.bootstrapIterations ?? 10_000,
      cscvSplits: evidence?.cscvSplits ?? 16,
      error: row.error ?? undefined,
      result: (row.result ?? undefined) as VerificationResult | undefined,
      evidence: evidence
        ? {
            returnsCsv: evidence.returnsCsv,
            trialsCsv: evidence.trialsCsv,
            selectedColumn: evidence.selectedColumn,
            evidenceRoot: evidence.evidenceRoot,
          }
        : undefined,
      bootstrapSamples: evidence?.bootstrapSamples,
      cscvLogits: evidence?.cscvLogits,
      createdAt: row.createdAt.toISOString(),
      startedAt,
      finishedAt,
      elapsedMs:
        startedAt && finishedAt
          ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
          : undefined,
    };
  }

  /** Artifacts live inside the evidence document so a run round-trips in one row. */
  private packEvidence(run: Partial<RunRecord>): Record<string, unknown> | null {
    if (!run.evidence) return null;
    return {
      ...run.evidence,
      bootstrapIterations: run.bootstrapIterations,
      cscvSplits: run.cscvSplits,
      ...(run.bootstrapSamples ? { bootstrapSamples: run.bootstrapSamples } : {}),
      ...(run.cscvLogits ? { cscvLogits: run.cscvLogits } : {}),
    };
  }

  async createRun(run: RunRecord): Promise<RunRecord> {
    await this.db.insert(runsTable).values({
      id: run.id,
      agentId: run.agentId,
      status: run.status,
      progress: run.progress,
      step: run.step,
      seed: run.seed,
      error: run.error ?? null,
      result: (run.result ?? null) as never,
      evidence: this.packEvidence(run) as never,
      createdAt: new Date(run.createdAt),
      startedAt: date(run.startedAt),
      finishedAt: date(run.finishedAt),
    });
    return run;
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    const [row] = await this.db.select().from(runsTable).where(eq(runsTable.id, id)).limit(1);
    return row ? this.toRun(row) : undefined;
  }

  async listRuns(agentId?: string): Promise<RunRecord[]> {
    const query = this.db.select().from(runsTable).orderBy(desc(runsTable.createdAt));
    const rows = agentId ? await query.where(eq(runsTable.agentId, agentId)) : await query;
    return rows.map((row) => this.toRun(row));
  }

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<RunRecord | undefined> {
    const current = await this.getRun(id);
    if (!current) return undefined;
    const merged = { ...current, ...patch };

    await this.db
      .update(runsTable)
      .set({
        status: merged.status,
        progress: merged.progress,
        step: merged.step,
        error: merged.error ?? null,
        result: (merged.result ?? null) as never,
        evidence: this.packEvidence(merged) as never,
        startedAt: date(merged.startedAt),
        finishedAt: date(merged.finishedAt),
      })
      .where(eq(runsTable.id, id));

    return this.getRun(id);
  }

  // ----------------------------------------------------------------- anchors

  private toAnchor(row: typeof anchorsTable.$inferSelect): AnchorRecord {
    return {
      runId: row.runId,
      status: row.status as AnchorStatus,
      storageMode: (row.storageMode as 'live' | 'local') ?? undefined,
      evidenceRoot: row.evidenceRoot ?? undefined,
      storageTxHash: row.storageTxHash ?? undefined,
      chainId: row.chainId ?? undefined,
      registryAddress: row.registryAddress ?? undefined,
      chainTxHash: row.chainTxHash ?? undefined,
      blockNumber: row.blockNumber ?? undefined,
      explorerUrl: row.explorerUrl ?? undefined,
      error: row.error ?? undefined,
      anchoredAt: iso(row.anchoredAt),
    };
  }

  async upsertAnchor(anchor: AnchorRecord): Promise<AnchorRecord> {
    const values = {
      runId: anchor.runId,
      status: anchor.status,
      storageMode: anchor.storageMode ?? 'local',
      evidenceRoot: anchor.evidenceRoot ?? null,
      storageTxHash: anchor.storageTxHash ?? null,
      chainId: anchor.chainId ?? null,
      registryAddress: anchor.registryAddress ?? null,
      chainTxHash: anchor.chainTxHash ?? null,
      blockNumber: anchor.blockNumber ?? null,
      explorerUrl: anchor.explorerUrl ?? null,
      error: anchor.error ?? null,
      anchoredAt: date(anchor.anchoredAt),
    };

    await this.db
      .insert(anchorsTable)
      .values(values)
      .onConflictDoUpdate({ target: anchorsTable.runId, set: values });

    return (await this.getAnchor(anchor.runId)) ?? anchor;
  }

  async getAnchor(runId: string): Promise<AnchorRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(anchorsTable)
      .where(eq(anchorsTable.runId, runId))
      .limit(1);
    return row ? this.toAnchor(row) : undefined;
  }

  // ------------------------------------------------------------------- audit

  async appendAuditEvent(event: AuditEventRecord): Promise<AuditEventRecord> {
    await this.db.insert(auditEventsTable).values({
      id: event.id,
      actor: event.actor,
      action: event.action,
      detail: event.detail,
      tone: event.tone,
      createdAt: new Date(event.createdAt),
    });
    return event;
  }

  async listAuditEvents(limit = 50): Promise<AuditEventRecord[]> {
    const rows = await this.db
      .select()
      .from(auditEventsTable)
      .orderBy(desc(auditEventsTable.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      detail: row.detail,
      tone: row.tone as AuditEventRecord['tone'],
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
