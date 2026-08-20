import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  AgentRecord,
  AnchorRecord,
  AuditEventRecord,
  RunRecord,
  Store,
} from './types.js';

interface Snapshot {
  agents: AgentRecord[];
  runs: RunRecord[];
  anchors: AnchorRecord[];
  audit: AuditEventRecord[];
}

/**
 * In-process store with a JSON snapshot on disk.
 *
 * The default backend. It needs no database, no migration step and no credentials,
 * so `pnpm dev` produces a working system on a clean machine — which matters more
 * for a project meant to be reproduced by a stranger than durability guarantees do.
 *
 * Writes are debounced and go through a temp file plus rename, so a crash mid-write
 * cannot leave a truncated snapshot behind.
 */
export class MemoryStore implements Store {
  private agents = new Map<string, AgentRecord>();
  private runs = new Map<string, RunRecord>();
  private anchors = new Map<string, AnchorRecord>();
  private audit: AuditEventRecord[] = [];

  private readonly snapshotPath: string;
  private flushTimer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> = Promise.resolve();

  /** The most recent snapshot failure, kept so a caller can ask rather than guess. */
  lastSnapshotError: unknown;

  constructor(
    dataDir: string,
    private readonly onSnapshotError: (error: unknown) => void = (error) => {
      console.error('[store] snapshot write failed; in-memory state is unaffected', error);
    },
  ) {
    this.snapshotPath = join(dataDir, 'store.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.snapshotPath, 'utf8');
      const snapshot = JSON.parse(raw) as Partial<Snapshot>;
      for (const agent of snapshot.agents ?? []) this.agents.set(agent.id, agent);
      for (const run of snapshot.runs ?? []) this.runs.set(run.id, run);
      for (const anchor of snapshot.anchors ?? []) this.anchors.set(anchor.runId, anchor);
      this.audit = snapshot.audit ?? [];
    } catch {
      // A missing or unreadable snapshot is a first run, not a failure.
    }
  }

  /** Waits for any pending write. Tests and shutdown use this. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.write();
  }

  private schedule(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      // A debounced write has no caller waiting on it, so a rejection here would
      // be unhandled. The snapshot is a convenience; the authoritative state is
      // in memory and still correct, so this is worth reporting, not crashing on.
      void this.write().catch((error) => {
        this.lastSnapshotError = error;
        this.onSnapshotError(error);
      });
    }, 250);
    this.flushTimer.unref?.();
  }

  private write(): Promise<void> {
    // `.catch` before `.then`, so a failed write does not poison the chain. Without
    // it one transient error leaves `flushing` rejected and every later write is
    // skipped for the life of the process — snapshots stop silently, which is the
    // worst way for persistence to fail.
    this.flushing = this.flushing.catch(() => undefined).then(async () => {
      const snapshot: Snapshot = {
        agents: [...this.agents.values()],
        runs: [...this.runs.values()],
        anchors: [...this.anchors.values()],
        audit: this.audit,
      };
      await mkdir(dirname(this.snapshotPath), { recursive: true });
      const temp = `${this.snapshotPath}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot), 'utf8');
      await rename(temp, this.snapshotPath);
    });
    return this.flushing;
  }

  async createAgent(agent: AgentRecord): Promise<AgentRecord> {
    this.agents.set(agent.id, agent);
    this.schedule();
    return agent;
  }

  async getAgent(id: string): Promise<AgentRecord | undefined> {
    return this.agents.get(id);
  }

  async getAgentByAgentId(agentId: string): Promise<AgentRecord | undefined> {
    for (const agent of this.agents.values()) {
      if (agent.agentId === agentId) return agent;
    }
    return undefined;
  }

  async listAgents(): Promise<AgentRecord[]> {
    return [...this.agents.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateAgent(id: string, patch: Partial<AgentRecord>): Promise<AgentRecord | undefined> {
    const existing = this.agents.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.agents.set(id, updated);
    this.schedule();
    return updated;
  }

  async createRun(run: RunRecord): Promise<RunRecord> {
    this.runs.set(run.id, run);
    this.schedule();
    return run;
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    return this.runs.get(id);
  }

  async listRuns(agentId?: string): Promise<RunRecord[]> {
    const all = [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return agentId ? all.filter((run) => run.agentId === agentId) : all;
  }

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<RunRecord | undefined> {
    const existing = this.runs.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.runs.set(id, updated);
    this.schedule();
    return updated;
  }

  async upsertAnchor(anchor: AnchorRecord): Promise<AnchorRecord> {
    const merged = { ...this.anchors.get(anchor.runId), ...anchor };
    this.anchors.set(anchor.runId, merged);
    this.schedule();
    return merged;
  }

  async getAnchor(runId: string): Promise<AnchorRecord | undefined> {
    return this.anchors.get(runId);
  }

  async appendAuditEvent(event: AuditEventRecord): Promise<AuditEventRecord> {
    this.audit.unshift(event);
    // The audit trail is a demo surface, not an archive; keeping it bounded stops
    // the snapshot from growing without limit during a long session.
    if (this.audit.length > 500) this.audit.length = 500;
    this.schedule();
    return event;
  }

  async listAuditEvents(limit = 50): Promise<AuditEventRecord[]> {
    return this.audit.slice(0, limit);
  }
}
