import type { VerificationResult } from '@workspace/qdsr-core';

export type AgentStatus = 'unverified' | 'verifying' | 'certified' | 'insignificant' | 'failed';
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';
export type AnchorStatus = 'none' | 'pending' | 'anchored' | 'failed';

export interface AgentRecord {
  id: string;
  /** keccak256(owner, name) — the on-chain identity key. */
  agentId: string;
  name: string;
  family: string;
  owner: string;
  periodsPerYear: number;
  status: AgentStatus;
  accent: string;
  latestRunId?: string;
  createdAt: string;
  updatedAt: string;
}

/** The submitted bundle, kept so a run can be replicated later. */
export interface EvidenceRecord {
  returnsCsv: string;
  trialsCsv: string;
  selectedColumn?: string;
  evidenceRoot?: string;
}

export interface RunRecord {
  id: string;
  agentId: string;
  status: RunStatus;
  progress: number;
  step: string;
  seed: number;
  /** Engine parameters, recorded so a replication can reproduce the digest exactly. */
  bootstrapIterations: number;
  cscvSplits: number;
  error?: string;
  result?: VerificationResult;
  evidence?: EvidenceRecord;
  bootstrapSamples?: number[];
  cscvLogits?: number[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  elapsedMs?: number;
}

export interface AnchorRecord {
  runId: string;
  status: AnchorStatus;
  storageMode?: 'live' | 'local';
  evidenceRoot?: string;
  storageTxHash?: string;
  chainId?: number;
  registryAddress?: string;
  chainTxHash?: string;
  blockNumber?: number;
  explorerUrl?: string;
  error?: string;
  anchoredAt?: string;
}

export interface AuditEventRecord {
  id: string;
  actor: string;
  action: string;
  detail: string;
  tone: 'good' | 'bad' | 'warn' | 'cyan' | 'neutral';
  createdAt: string;
}

/**
 * Persistence boundary.
 *
 * Everything above this interface is domain logic and everything below is storage,
 * which is what allows the same verification workflow to run against Postgres on a
 * deployment and against an on-disk JSON file on a reviewer's laptop.
 */
export interface Store {
  createAgent(agent: AgentRecord): Promise<AgentRecord>;
  getAgent(id: string): Promise<AgentRecord | undefined>;
  getAgentByAgentId(agentId: string): Promise<AgentRecord | undefined>;
  listAgents(): Promise<AgentRecord[]>;
  updateAgent(id: string, patch: Partial<AgentRecord>): Promise<AgentRecord | undefined>;

  createRun(run: RunRecord): Promise<RunRecord>;
  getRun(id: string): Promise<RunRecord | undefined>;
  listRuns(agentId?: string): Promise<RunRecord[]>;
  updateRun(id: string, patch: Partial<RunRecord>): Promise<RunRecord | undefined>;

  upsertAnchor(anchor: AnchorRecord): Promise<AnchorRecord>;
  getAnchor(runId: string): Promise<AnchorRecord | undefined>;

  appendAuditEvent(event: AuditEventRecord): Promise<AuditEventRecord>;
  listAuditEvents(limit?: number): Promise<AuditEventRecord[]>;
}
