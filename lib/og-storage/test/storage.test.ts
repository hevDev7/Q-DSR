import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalEvidenceStorage, computeMerkleRoot, createEvidenceStorage } from '../src/index.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qdsr-storage-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const payload = new TextEncoder().encode('timestamp,return\n2024-01-02,0.0012\n2024-01-03,-0.0004\n');

describe('computeMerkleRoot', () => {
  it('produces a 0G root hash without any network access', async () => {
    const root = await computeMerkleRoot(payload);
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is content addressed — identical bytes give an identical root', async () => {
    const a = await computeMerkleRoot(payload);
    const b = await computeMerkleRoot(new TextEncoder().encode(new TextDecoder().decode(payload)));
    expect(a).toBe(b);
  });

  it('changes when a single byte changes', async () => {
    const a = await computeMerkleRoot(payload);
    const mutated = new Uint8Array(payload);
    mutated[mutated.length - 2] = mutated[mutated.length - 2]! ^ 0x01;
    expect(await computeMerkleRoot(mutated)).not.toBe(a);
  });
});

describe('LocalEvidenceStorage', () => {
  it('round-trips a payload under its 0G root', async () => {
    const storage = new LocalEvidenceStorage(dir);
    const { rootHash, mode, bytes } = await storage.upload(payload, 'returns.csv');

    expect(mode).toBe('local');
    expect(bytes).toBe(payload.byteLength);
    expect(rootHash).toBe(await computeMerkleRoot(payload));

    expect(await storage.has(rootHash)).toBe(true);
    expect(new Uint8Array(await storage.download(rootHash))).toEqual(payload);
  });

  it('reports a root it has never seen as absent', async () => {
    const storage = new LocalEvidenceStorage(dir);
    expect(await storage.has('0x' + '11'.repeat(32))).toBe(false);
  });

  it('does not report a storage transaction, because there was none', async () => {
    const storage = new LocalEvidenceStorage(dir);
    const result = await storage.upload(payload, 'returns.csv');
    expect(result.txHash).toBeUndefined();
  });
});

describe('createEvidenceStorage', () => {
  it('falls back to local when 0G credentials are incomplete', async () => {
    const storage = await createEvidenceStorage({ cacheDir: dir, indexerRpc: 'https://x', evmRpc: 'https://y' });
    expect(storage.mode).toBe('local');
  });

  it('stays local when nothing is configured', async () => {
    const storage = await createEvidenceStorage({ cacheDir: dir });
    expect(storage.mode).toBe('local');
  });
});
