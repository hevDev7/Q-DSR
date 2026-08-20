import type { EvidenceStorage } from '@workspace/og-storage';

/**
 * Reading an evidence bundle the claimant published, not one they handed us.
 *
 * The claimant funds and publishes their own evidence; the attestor measures it.
 * That division only means anything if the attestor reads the *published* bytes
 * rather than a copy supplied alongside the root — otherwise a submission could
 * name one bundle on chain and be measured against another.
 *
 * So the root is re-derived from the downloaded bytes and compared. If 0G
 * Storage, an intermediary, or the claimant serves anything else, the roots
 * disagree and nothing is measured.
 */

export interface PublishedEvidence {
  returnsCsv: string;
  trialsCsv: string;
  selectedColumn?: string;
  evidenceRoot: string;
  bytes: number;
}

export class PublishedEvidenceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'PublishedEvidenceError';
  }
}

const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;

export async function fetchPublishedEvidence(
  storage: EvidenceStorage,
  evidenceRoot: string,
): Promise<PublishedEvidence> {
  if (typeof evidenceRoot !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(evidenceRoot)) {
    throw new PublishedEvidenceError(
      'evidenceRoot must be a 0x-prefixed 32-byte 0G Storage root',
      422,
      'evidenceRoot',
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await storage.download(evidenceRoot);
  } catch (error) {
    throw new PublishedEvidenceError(
      `nothing readable at 0G Storage root ${evidenceRoot} — ` +
        `${error instanceof Error ? error.message : String(error)}`,
      424,
      'evidenceRoot',
    );
  }

  if (bytes.byteLength === 0) {
    throw new PublishedEvidenceError(`0G Storage returned no bytes for ${evidenceRoot}`, 424, 'evidenceRoot');
  }
  if (bytes.byteLength > MAX_BUNDLE_BYTES) {
    throw new PublishedEvidenceError(
      `the published bundle is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is 32 MB`,
      413,
      'evidenceRoot',
    );
  }

  // The check the whole arrangement rests on.
  const derived = await storage.computeRoot(bytes);
  if (derived.toLowerCase() !== evidenceRoot.toLowerCase()) {
    throw new PublishedEvidenceError(
      `the bytes at ${evidenceRoot} hash to ${derived}. The submitted root does not name ` +
        'the bundle that was served, so there is nothing here this verdict could honestly describe.',
      422,
      'evidenceRoot',
    );
  }

  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PublishedEvidenceError(
      'the published bundle is not valid JSON',
      422,
      'evidenceRoot',
    );
  }

  const evidence = (document as { evidence?: Record<string, unknown> })?.evidence;
  if (!evidence || typeof evidence !== 'object') {
    throw new PublishedEvidenceError(
      'the published bundle has no `evidence` object',
      422,
      'evidenceRoot',
    );
  }

  const { returnsCsv, trialsCsv, selectedColumn } = evidence as Record<string, unknown>;

  if (typeof returnsCsv !== 'string' || returnsCsv.trim().length === 0) {
    throw new PublishedEvidenceError(
      'the published bundle has no returns.csv',
      422,
      'evidenceRoot',
    );
  }
  if (typeof trialsCsv !== 'string' || trialsCsv.trim().length === 0) {
    throw new PublishedEvidenceError(
      'the published bundle has no trials.csv — the Probability of Backtest Overfitting ' +
        'cannot be computed without every configuration that was explored',
      422,
      'evidenceRoot',
    );
  }

  return {
    returnsCsv,
    trialsCsv,
    selectedColumn: typeof selectedColumn === 'string' ? selectedColumn : undefined,
    evidenceRoot,
    bytes: bytes.byteLength,
  };
}
