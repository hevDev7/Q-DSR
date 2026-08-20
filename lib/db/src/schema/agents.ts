import { index, jsonb, pgTable, real, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';

/**
 * The agent registry.
 *
 * `agentId` is the on-chain identity — keccak256(owner, name) — and is what the
 * QDSRRegistry holds verdicts under. Keeping it here rather than deriving it per
 * request means the database and the chain can never disagree about who an agent is.
 */
export const agentsTable = pgTable(
  'agents',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    agentId: varchar('agent_id', { length: 66 }).notNull().unique(),
    name: text('name').notNull(),
    family: text('family').notNull(),
    owner: text('owner').notNull(),
    periodsPerYear: real('periods_per_year').notNull().default(252),
    status: varchar('status', { length: 24 }).notNull().default('unverified'),
    accent: varchar('accent', { length: 16 }).notNull(),
    latestRunId: varchar('latest_run_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('agents_status_idx').on(table.status)],
);

export const insertAgentSchema = createInsertSchema(agentsTable);
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;

/**
 * Verification runs.
 *
 * The numeric result is stored as a single jsonb document rather than exploded into
 * columns. It is written once, read whole, and its shape is owned by the engine —
 * splitting it across twenty columns would create a second schema to keep in sync
 * with `@workspace/qdsr-core` for no query benefit.
 */
export const runsTable = pgTable(
  'runs',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    agentId: varchar('agent_id', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('queued'),
    progress: real('progress').notNull().default(0),
    step: text('step').notNull().default(''),
    seed: real('seed').notNull(),
    error: text('error'),
    result: jsonb('result'),
    evidence: jsonb('evidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [index('runs_agent_idx').on(table.agentId), index('runs_status_idx').on(table.status)],
);

export const insertRunSchema = createInsertSchema(runsTable);
export type InsertRun = z.infer<typeof insertRunSchema>;
export type Run = typeof runsTable.$inferSelect;

/** 0G Storage upload and 0G Chain anchoring for a completed run. */
export const anchorsTable = pgTable('anchors', {
  runId: varchar('run_id', { length: 64 }).primaryKey(),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  storageMode: varchar('storage_mode', { length: 8 }).notNull().default('local'),
  evidenceRoot: varchar('evidence_root', { length: 66 }),
  storageTxHash: varchar('storage_tx_hash', { length: 66 }),
  chainId: real('chain_id'),
  registryAddress: varchar('registry_address', { length: 42 }),
  chainTxHash: varchar('chain_tx_hash', { length: 66 }),
  blockNumber: real('block_number'),
  explorerUrl: text('explorer_url'),
  error: text('error'),
  anchoredAt: timestamp('anchored_at', { withTimezone: true }),
});

export const insertAnchorSchema = createInsertSchema(anchorsTable);
export type InsertAnchor = z.infer<typeof insertAnchorSchema>;
export type Anchor = typeof anchorsTable.$inferSelect;

/** Append-only operator and engine activity log. */
export const auditEventsTable = pgTable(
  'audit_events',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    detail: text('detail').notNull(),
    tone: varchar('tone', { length: 12 }).notNull().default('neutral'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_created_idx').on(table.createdAt)],
);

export const insertAuditEventSchema = createInsertSchema(auditEventsTable);
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEventsTable.$inferSelect;
