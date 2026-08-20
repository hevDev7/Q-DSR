import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryStore } from '../src/store/memory.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'qdsr-store-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const agent = (id: string) =>
  ({
    id,
    agentId: `0x${id.padEnd(64, '0')}`,
    name: id,
    family: 'test',
    owner: 'lab@qdsr',
    periodsPerYear: 252,
    status: 'unverified',
    accent: 'cyan',
    createdAt: new Date(0).toISOString(),
  }) as never;

describe('the snapshot behind the in-memory store', () => {
  it('writes what it holds', async () => {
    const store = new MemoryStore(dataDir);
    await store.createAgent(agent('first'));
    await store.flush();

    const snapshot = JSON.parse(await readFile(join(dataDir, 'store.json'), 'utf8'));
    expect(snapshot.agents).toHaveLength(1);
  });

  /**
   * A path that genuinely cannot be written to.
   *
   * Not a missing directory — `mkdir` is recursive, so those succeed. A regular
   * file standing where a directory is expected produces ENOTDIR, which is a real
   * write failure rather than a simulated one.
   */
  async function unwritableDir(): Promise<string> {
    const blocker = join(dataDir, 'blocker');
    await writeFile(blocker, 'not a directory', 'utf8');
    return join(blocker, 'store');
  }

  it('keeps writing after one write fails', async () => {
    // The chain used to be `flushing.then(...)`, so a single rejection left it
    // rejected and every later write chained off a rejected promise. Snapshots
    // stopped for the life of the process, with no error after the first — the
    // worst way for persistence to fail.
    const store = new MemoryStore(dataDir);
    const internals = store as unknown as { flushing: Promise<void> };
    internals.flushing = Promise.reject(new Error('a previous write failed'));

    await store.createAgent(agent('after-failure'));
    await store.flush();

    const snapshot = JSON.parse(await readFile(join(dataDir, 'store.json'), 'utf8'));
    expect(snapshot.agents.map((a: { id: string }) => a.id)).toContain('after-failure');
  });

  it('surfaces a real write failure to the caller of flush', async () => {
    const errors: unknown[] = [];
    const store = new MemoryStore(await unwritableDir(), (error) => errors.push(error));

    await store.createAgent(agent('doomed'));
    await expect(store.flush()).rejects.toThrow();
  });

  it('reports a background failure instead of rejecting into nothing', async () => {
    const errors: unknown[] = [];
    const store = new MemoryStore(await unwritableDir(), (error) => errors.push(error));

    // createAgent schedules a debounced write with nobody awaiting it. Before the
    // fix that rejection was unhandled, which newer Node treats as fatal.
    await store.createAgent(agent('background'));
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(errors.length).toBeGreaterThan(0);
    expect(store.lastSnapshotError).toBeDefined();
  });

  it('survives its data directory disappearing underneath it', async () => {
    const errors: unknown[] = [];
    const store = new MemoryStore(dataDir, (error) => errors.push(error));
    await store.createAgent(agent('doomed'));
    await store.flush();

    await rm(dataDir, { recursive: true, force: true });

    // mkdir recreates the tree, so this actually succeeds — the point is that it
    // neither throws into the void nor wedges the chain.
    await store.createAgent(agent('after-rm'));
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
