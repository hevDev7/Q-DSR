import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VerdictPendingError, type AnchorReceipt, type ChainClient } from '@workspace/og-chain';
import { LocalEvidenceStorage } from '@workspace/og-storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnchorService } from '../src/services/anchor.js';
import { MemoryStore } from '../src/store/memory.js';

let dataDir: string;
let store: MemoryStore;
let storage: LocalEvidenceStorage;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'qdsr-anchor-'));
  store = new MemoryStore(dataDir);
  storage = new LocalEvidenceStorage(join(dataDir, 'storage'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const RECEIPT: AnchorReceipt = {
  chainId: 16602,
  registryAddress: '0xregistry',
  txHash: '0xabc',
  blockNumber: 100,
  explorerUrl: 'https://example/tx/0xabc',
};

/** A chain that behaves however a given test needs it to. */
function chainThat(overrides: Partial<ChainClient>): ChainClient {
  return {
    status: () => ({ configured: true, chainId: 16602, networkName: 'test' }) as never,
    submitVerdict: async () => RECEIPT,
    isCertified: async () => true,
    tokenIdOf: async () => undefined,
    findVerdict: async () => undefined,
    ...overrides,
  } as ChainClient;
}

const AGENT = {
  id: 'agt_1',
  agentId: `0x${'11'.repeat(32)}`,
  name: 'Subject',
  family: 'test',
  owner: 'lab@qdsr',
  periodsPerYear: 252,
  status: 'certified',
  accent: 'cyan',
  createdAt: new Date(0).toISOString(),
} as never;

async function completedRun(evidenceRoot: string) {
  const run = {
    id: 'run_1',
    agentId: 'agt_1',
    status: 'completed',
    progress: 100,
    step: 'Complete',
    seed: 1,
    bootstrapIterations: 10,
    cscvSplits: 16,
    evidence: { returnsCsv: 'a', trialsCsv: 'b', evidenceRoot },
    result: {
      engineVersion: 'qdsr-core/1.0.0',
      digest: 'ff'.repeat(32),
      verdict: 'certified',
      dsr: 0.99,
      pbo: 0.01,
      trials: 60,
      observations: 756,
    },
    createdAt: new Date(0).toISOString(),
  } as never;
  await store.createAgent(AGENT);
  await store.createRun(run);
  return run as unknown as { id: string };
}

describe('anchoring a verdict', () => {
  it('submits once and records the receipt', async () => {
    let calls = 0;
    const service = new AnchorService(
      store,
      storage,
      chainThat({ submitVerdict: async () => { calls++; return RECEIPT; } }),
      async () => undefined,
    );
    const run = await completedRun(`0x${'aa'.repeat(32)}`);

    const anchor = await service.anchor(AGENT, (await store.getRun(run.id))!);
    expect(anchor.status).toBe('anchored');
    expect(calls).toBe(1);
  });

  it('does not resubmit a run that is already anchored', async () => {
    // The registry is append-only. A second submission would not fail — it would
    // write an identical duplicate verdict, and overwrite the successful record
    // on the way there. That is how a healthy anchor became `failed` with the
    // chain completely unchanged.
    let calls = 0;
    const service = new AnchorService(
      store,
      storage,
      chainThat({ submitVerdict: async () => { calls++; return RECEIPT; } }),
      async () => undefined,
    );
    const run = await completedRun(`0x${'aa'.repeat(32)}`);

    const first = await service.anchor(AGENT, (await store.getRun(run.id))!);
    const second = await service.anchor(AGENT, (await store.getRun(run.id))!);

    expect(calls).toBe(1);
    expect(second).toEqual(first);
    expect(second.status).toBe('anchored');
  });

  it('records a timeout as pending, not as a failure', async () => {
    // A timeout means we stopped waiting, not that the chain refused. Calling it
    // failed asserts something nobody checked.
    const service = new AnchorService(
      store,
      storage,
      chainThat({
        submitVerdict: async () => {
          throw new VerdictPendingError('0xbroadcast');
        },
      }),
      async () => undefined,
    );
    const run = await completedRun(`0x${'aa'.repeat(32)}`);

    const anchor = await service.anchor(AGENT, (await store.getRun(run.id))!);
    expect(anchor.status).toBe('pending');
    expect(anchor.chainTxHash).toBe('0xbroadcast');
    expect(anchor.error).toMatch(/awaiting confirmation/);
  });

  it('reconciles a record that says failed when the chain says otherwise', async () => {
    // Exactly what a transient RPC timeout produced: a `failed` anchor beside a
    // verdict sitting on chain, certified. Retrying must repair the record
    // rather than append a duplicate verdict to prove it.
    const failing = new AnchorService(
      store,
      storage,
      chainThat({
        submitVerdict: async () => {
          throw new Error('request timeout (code=TIMEOUT, version=6.17.0)');
        },
      }),
      async () => undefined,
    );
    const run = await completedRun(`0x${'aa'.repeat(32)}`);
    expect((await failing.anchor(AGENT, (await store.getRun(run.id))!)).status).toBe('failed');

    let submits = 0;
    const repairing = new AnchorService(
      store,
      storage,
      chainThat({
        findVerdict: async () => RECEIPT,
        submitVerdict: async () => { submits++; return RECEIPT; },
      }),
      async () => undefined,
    );

    const anchor = await repairing.anchor(AGENT, (await store.getRun(run.id))!);
    expect(anchor.status).toBe('anchored');
    expect(anchor.error).toBeUndefined();
    expect(submits).toBe(0);
  });

  it('reconciles a pending anchor whose transaction landed after we stopped waiting', async () => {
    let submits = 0;
    const service = new AnchorService(
      store,
      storage,
      chainThat({
        submitVerdict: async () => {
          submits++;
          throw new VerdictPendingError('0xbroadcast');
        },
      }),
      async () => undefined,
    );
    const run = await completedRun(`0x${'aa'.repeat(32)}`);
    await service.anchor(AGENT, (await store.getRun(run.id))!);

    // Retrying now finds the verdict on chain and must not spend a second one.
    const reconciling = new AnchorService(
      store,
      storage,
      chainThat({
        findVerdict: async () => RECEIPT,
        submitVerdict: async () => { submits++; return RECEIPT; },
      }),
      async () => undefined,
    );

    const anchor = await reconciling.anchor(AGENT, (await store.getRun(run.id))!);
    expect(anchor.status).toBe('anchored');
    expect(anchor.chainTxHash).toBe(RECEIPT.txHash);
    expect(submits).toBe(1);
  });

  it('still reports a genuine submission failure as failed', async () => {
    const service = new AnchorService(
      store,
      storage,
      chainThat({
        submitVerdict: async () => {
          throw new Error('execution reverted: NotAttestor');
        },
      }),
      async () => undefined,
    );
    const run = await completedRun(`0x${'aa'.repeat(32)}`);

    const anchor = await service.anchor(AGENT, (await store.getRun(run.id))!);
    expect(anchor.status).toBe('failed');
    expect(anchor.error).toMatch(/NotAttestor/);
  });

  it('refuses a run with no published evidence root', async () => {
    const service = new AnchorService(store, storage, chainThat({}), async () => undefined);
    const run = await completedRun('');
    await store.updateRun(run.id, { evidence: { returnsCsv: 'a', trialsCsv: 'b' } });

    await expect(service.anchor(AGENT, (await store.getRun(run.id))!)).rejects.toThrow(
      /no published evidence root/,
    );
  });
});
