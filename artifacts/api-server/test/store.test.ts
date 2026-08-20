import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryStore } from '../src/store/memory.js';
import { PostgresStore } from '../src/store/postgres.js';
import type { AgentRecord, RunRecord, Store } from '../src/store/types.js';

/**
 * One contract, two backends.
 *
 * The whole point of the Store interface is that the verification workflow does
 * not care which one it is talking to. Asserting that only against the in-memory
 * implementation would leave the claim untested exactly where it matters.
 *
 * The Postgres pass is skipped unless QDSR_TEST_DATABASE_URL is set, so the suite
 * stays runnable on a machine with no database.
 */
const postgresUrl = process.env.QDSR_TEST_DATABASE_URL;

/**
 * Fixture ids are namespaced per execution.
 *
 * Postgres persists between runs, so fixed ids made this suite pass exactly once
 * and then fail on a duplicate key forever after. A test that only works against
 * a fresh database is not testing the thing it claims to.
 */
const RUN_NS = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

function agentFixture(suffix: string): AgentRecord {
  const now = new Date().toISOString();
  const unique = `${RUN_NS}${suffix}`;
  return {
    id: `agt_${unique}`,
    agentId: `0x${unique.padEnd(64, '0').slice(0, 64)}`,
    name: `Agent ${suffix}`,
    family: 'contract-test',
    owner: 'lab@qdsr',
    periodsPerYear: 252,
    status: 'unverified',
    accent: '#c8f169',
    createdAt: now,
    updatedAt: now,
  };
}

function runFixture(suffix: string, agentId: string): RunRecord {
  return {
    id: `run_${RUN_NS}${suffix}`,
    agentId,
    status: 'queued',
    progress: 0,
    step: 'Queued',
    seed: 4242,
    bootstrapIterations: 500,
    cscvSplits: 16,
    evidence: { returnsCsv: 'timestamp,r\n2024-01-01,0.01\n', trialsCsv: 'timestamp,a,b\n2024-01-01,0.01,0.02\n' },
    createdAt: new Date().toISOString(),
  };
}

function contractSuite(label: string, create: () => Promise<Store>, cleanup?: () => Promise<void>) {
  describe(`Store contract — ${label}`, () => {
    let store: Store;
    const tag = label === 'memory' ? 'mem' : 'pg';

    beforeAll(async () => {
      store = await create();
    });

    afterAll(async () => {
      await cleanup?.();
    });

    it('round-trips an agent', async () => {
      const agent = agentFixture(`${tag}1`);
      await store.createAgent(agent);

      expect(await store.getAgent(agent.id)).toMatchObject({ id: agent.id, name: agent.name });
      expect(await store.getAgentByAgentId(agent.agentId)).toMatchObject({ id: agent.id });
      expect((await store.listAgents()).some((a) => a.id === agent.id)).toBe(true);
    });

    it('patches an agent without losing untouched fields', async () => {
      const agent = agentFixture(`${tag}2`);
      await store.createAgent(agent);

      const updated = await store.updateAgent(agent.id, { status: 'certified', latestRunId: 'run_x' });
      expect(updated?.status).toBe('certified');
      expect(updated?.latestRunId).toBe('run_x');
      expect(updated?.family).toBe(agent.family);
      expect(updated?.owner).toBe(agent.owner);
    });

    it('returns undefined for an agent that does not exist', async () => {
      expect(await store.getAgent('agt_nope')).toBeUndefined();
      expect(await store.updateAgent('agt_nope', { status: 'failed' })).toBeUndefined();
    });

    it('round-trips a run, including the engine parameters a replication needs', async () => {
      const agent = agentFixture(`${tag}3`);
      await store.createAgent(agent);
      const run = runFixture(`${tag}3`, agent.id);
      await store.createRun(run);

      const loaded = await store.getRun(run.id);
      expect(loaded?.seed).toBe(4242);
      expect(loaded?.bootstrapIterations).toBe(500);
      expect(loaded?.cscvSplits).toBe(16);
      expect(loaded?.evidence?.returnsCsv).toBe(run.evidence!.returnsCsv);
    });

    it('preserves artifact arrays across a write and a read', async () => {
      const agent = agentFixture(`${tag}4`);
      await store.createAgent(agent);
      const run = runFixture(`${tag}4`, agent.id);
      await store.createRun(run);

      await store.updateRun(run.id, {
        status: 'completed',
        progress: 100,
        step: 'Complete',
        bootstrapSamples: [0.1, 0.2, 0.3],
        cscvLogits: [-1, 0, 1],
        finishedAt: new Date().toISOString(),
      });

      const loaded = await store.getRun(run.id);
      expect(loaded?.status).toBe('completed');
      expect(loaded?.bootstrapSamples).toEqual([0.1, 0.2, 0.3]);
      expect(loaded?.cscvLogits).toEqual([-1, 0, 1]);
    });

    it('filters runs by agent', async () => {
      const agent = agentFixture(`${tag}5`);
      await store.createAgent(agent);
      await store.createRun(runFixture(`${tag}5`, agent.id));

      const runs = await store.listRuns(agent.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.agentId).toBe(agent.id);
    });

    it('upserts an anchor rather than duplicating it', async () => {
      const agent = agentFixture(`${tag}6`);
      await store.createAgent(agent);
      const run = runFixture(`${tag}6`, agent.id);
      await store.createRun(run);

      await store.upsertAnchor({ runId: run.id, status: 'pending', storageMode: 'local' });
      await store.upsertAnchor({
        runId: run.id,
        status: 'anchored',
        storageMode: 'local',
        evidenceRoot: `0x${'ab'.repeat(32)}`,
        chainTxHash: `0x${'cd'.repeat(32)}`,
        blockNumber: 1_842_907,
      });

      const anchor = await store.getAnchor(run.id);
      expect(anchor?.status).toBe('anchored');
      expect(anchor?.blockNumber).toBe(1_842_907);
      expect(anchor?.evidenceRoot).toBe(`0x${'ab'.repeat(32)}`);
    });

    it('returns audit events newest first', async () => {
      const base = Date.now();
      for (let i = 0; i < 3; i++) {
        await store.appendAuditEvent({
          id: `evt_${RUN_NS}_${tag}_${i}`,
          actor: 'engine',
          action: `Action ${i}`,
          detail: 'detail',
          tone: 'neutral',
          createdAt: new Date(base + i * 1000).toISOString(),
        });
      }

      const events = await store.listAuditEvents(3);
      expect(events).toHaveLength(3);
      expect(events[0]!.action).toBe('Action 2');
      expect(events[2]!.action).toBe('Action 0');
    });

    it('honours the audit limit', async () => {
      expect((await store.listAuditEvents(2)).length).toBeLessThanOrEqual(2);
    });
  });
}

let memoryDir: string;
contractSuite(
  'memory',
  async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'qdsr-store-'));
    const store = new MemoryStore(memoryDir);
    await store.load();
    return store;
  },
  async () => {
    await rm(memoryDir, { recursive: true, force: true });
  },
);

if (postgresUrl) {
  let store: PostgresStore;
  contractSuite(
    'postgres',
    async () => {
      store = new PostgresStore(postgresUrl);
      return store;
    },
    async () => {
      await store.close();
    },
  );
} else {
  describe.skip('Store contract — postgres', () => {
    it('needs QDSR_TEST_DATABASE_URL', () => undefined);
  });
}
