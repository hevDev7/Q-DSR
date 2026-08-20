import type { EvidenceStorage } from '@workspace/og-storage';
import { describe, expect, it } from 'vitest';

import {
  PublishedEvidenceError,
  fetchPublishedEvidence,
} from '../src/services/published-evidence.js';

const VALID_ROOT = `0x${'1'.repeat(64)}`;
const OTHER_ROOT = `0x${'2'.repeat(64)}`;

/**
 * A storage that can be told to lie.
 *
 * The guard being tested is what happens when the bytes served under a root do
 * not hash to it — a dishonest indexer, a substituted bundle, corruption in
 * transit. Real storage cannot produce that situation on demand, which is
 * exactly why it needs a stub.
 */
function storageServing(bytes: Uint8Array, derivedRoot: string): EvidenceStorage {
  return {
    mode: 'local',
    computeRoot: async () => derivedRoot,
    upload: async () => {
      throw new Error('the attestor must never upload evidence');
    },
    download: async () => bytes,
    has: async () => true,
    gatewayUrl: () => undefined,
  };
}

function bundle(evidence: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ evidence }));
}

const GOOD = { returnsCsv: 'timestamp,cfg_001\n2023-01-02,0.01\n', trialsCsv: 'timestamp,cfg_001\n2023-01-02,0.01\n' };

describe('reading evidence the claimant published', () => {
  it('accepts bytes that hash to the submitted root', async () => {
    const bytes = bundle(GOOD);
    const result = await fetchPublishedEvidence(storageServing(bytes, VALID_ROOT), VALID_ROOT);

    expect(result.evidenceRoot).toBe(VALID_ROOT);
    expect(result.trialsCsv).toBe(GOOD.trialsCsv);
    expect(result.bytes).toBe(bytes.byteLength);
  });

  it('refuses bytes that hash to something else', async () => {
    // The whole arrangement rests on this. Without it a submission could name
    // one bundle on chain and be measured against another.
    const storage = storageServing(bundle(GOOD), OTHER_ROOT);

    await expect(fetchPublishedEvidence(storage, VALID_ROOT)).rejects.toThrow(
      /does not name the bundle that was served/,
    );
  });

  it('reports the mismatch with both roots, so the discrepancy is legible', async () => {
    const storage = storageServing(bundle(GOOD), OTHER_ROOT);

    const error = await fetchPublishedEvidence(storage, VALID_ROOT).catch((e) => e);
    expect(error).toBeInstanceOf(PublishedEvidenceError);
    expect(error.message).toContain(VALID_ROOT);
    expect(error.message).toContain(OTHER_ROOT);
    expect(error.status).toBe(422);
  });

  it('rejects a root that is not a 32-byte content address', async () => {
    for (const bad of ['', 'not-a-root', '0x1234', `0x${'1'.repeat(63)}`, `${'1'.repeat(64)}`]) {
      const error = await fetchPublishedEvidence(
        storageServing(bundle(GOOD), VALID_ROOT),
        bad,
      ).catch((e) => e);
      expect(error, `expected ${bad} to be refused`).toBeInstanceOf(PublishedEvidenceError);
      expect(error.status).toBe(422);
    }
  });

  it('reports unreachable storage separately from a bad bundle', async () => {
    const storage: EvidenceStorage = {
      ...storageServing(bundle(GOOD), VALID_ROOT),
      download: async () => {
        throw new Error('indexer unreachable');
      },
    };

    const error = await fetchPublishedEvidence(storage, VALID_ROOT).catch((e) => e);
    // 424 rather than 422: the submission may be perfectly good and simply
    // unreadable right now, which is worth retrying. A malformed bundle is not.
    expect(error.status).toBe(424);
  });

  it('refuses a bundle with no trials matrix', async () => {
    const storage = storageServing(bundle({ returnsCsv: GOOD.returnsCsv }), VALID_ROOT);

    await expect(fetchPublishedEvidence(storage, VALID_ROOT)).rejects.toThrow(
      /Probability of Backtest Overfitting/,
    );
  });

  it('refuses bytes that are not JSON at all', async () => {
    const storage = storageServing(new TextEncoder().encode('not json'), VALID_ROOT);

    await expect(fetchPublishedEvidence(storage, VALID_ROOT)).rejects.toThrow(/not valid JSON/);
  });

  it('refuses an empty payload', async () => {
    const storage = storageServing(new Uint8Array(), VALID_ROOT);

    await expect(fetchPublishedEvidence(storage, VALID_ROOT)).rejects.toThrow(/no bytes/);
  });
});
