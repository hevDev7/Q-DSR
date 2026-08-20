import {
  computeMerkleRootInBrowser,
  serialiseEvidenceBundle,
  uploadFromBrowser,
  type EvidenceBundleDocument,
  type StorageSigner,
} from '@workspace/og-storage/browser';
import { formatEther, JsonRpcProvider, type JsonRpcSigner } from 'ethers';

/**
 * Publishing evidence from the claimant's wallet.
 *
 * The party asserting a track record pays to publish the bundle behind it. The
 * attestor still measures — it downloads these exact bytes, re-derives the root,
 * and refuses if they disagree — but it no longer funds every claim made against
 * it, which also means a junk submission costs whoever submitted it.
 *
 * There is no operator-funded fallback here on purpose. One would make the
 * guarantee conditional, and the failure it papers over — an unfunded wallet —
 * is better caught before a signature is requested than after.
 */

export type UploadPhase =
  | 'idle'
  | 'packing'
  | 'checking-balance'
  | 'awaiting-signature'
  | 'publishing'
  | 'done'
  | 'failed';

export interface UploadProgress {
  phase: UploadPhase;
  /** Human-readable detail for the current phase. */
  detail?: string;
  rootHash?: string;
  txHash?: string;
  bytes?: number;
}

export interface PublishEvidenceOptions {
  document: EvidenceBundleDocument;
  signer: JsonRpcSigner;
  evmRpc: string;
  indexerRpc: string;
  onProgress?: (progress: UploadProgress) => void;
}

export class EvidenceUploadError extends Error {
  constructor(
    message: string,
    readonly phase: UploadPhase,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EvidenceUploadError';
  }
}

/**
 * A rough floor for one storage submission plus its fee.
 *
 * Deliberately an estimate rather than a quote: the point is to catch an empty
 * wallet before the signature prompt, not to predict the cost to the wei. A
 * wallet under this will almost certainly fail; one above it still might.
 */
const MINIMUM_BALANCE_WEI = 10_000_000_000_000_000n; // 0.01 0G

export async function publishEvidence(options: PublishEvidenceOptions): Promise<{
  rootHash: string;
  txHash?: string;
  bytes: number;
}> {
  const report = (progress: UploadProgress): void => options.onProgress?.(progress);

  report({ phase: 'packing' });
  const bytes = serialiseEvidenceBundle(options.document);
  const expectedRoot = await computeMerkleRootInBrowser(bytes);

  report({
    phase: 'checking-balance',
    detail: `${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB · ${expectedRoot.slice(0, 12)}…`,
    rootHash: expectedRoot,
    bytes: bytes.byteLength,
  });

  // Ask before signing. A wallet that cannot pay produces a rejected transaction
  // several seconds later with a message from deep inside the SDK; this turns
  // that into something the person reading it can act on.
  const address = await options.signer.getAddress();
  let balance: bigint;
  try {
    balance = await new JsonRpcProvider(options.evmRpc).getBalance(address);
  } catch (error) {
    throw new EvidenceUploadError(
      'could not read the wallet balance from the 0G RPC',
      'checking-balance',
      error,
    );
  }

  if (balance < MINIMUM_BALANCE_WEI) {
    throw new EvidenceUploadError(
      `this wallet holds ${formatEther(balance)} 0G, which will not cover publishing ` +
        `${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB to 0G Storage. Evidence is ` +
        'published by the wallet making the claim, so it needs funding before verification.',
      'checking-balance',
    );
  }

  report({ phase: 'awaiting-signature', rootHash: expectedRoot, bytes: bytes.byteLength });

  let result;
  try {
    result = await uploadFromBrowser(bytes, 'evidence.json', options.signer as unknown as StorageSigner, {
      evmRpc: options.evmRpc,
      indexerRpc: options.indexerRpc,
    });
  } catch (error) {
    throw new EvidenceUploadError(describeUploadError(error), 'publishing', error);
  }

  // The root the network reports must be the root we computed locally. A
  // mismatch means the bytes that went up are not the bytes we packed, and the
  // attestor would reject them anyway — better to say so here.
  if (result.rootHash.toLowerCase() !== expectedRoot.toLowerCase()) {
    throw new EvidenceUploadError(
      `0G Storage returned root ${result.rootHash} for a bundle whose root is ${expectedRoot}`,
      'publishing',
    );
  }

  report({
    phase: 'done',
    rootHash: result.rootHash,
    txHash: result.txHash,
    bytes: result.bytes,
  });

  return result;
}

function describeUploadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/user rejected|denied|ACTION_REJECTED/i.test(message)) {
    return 'the wallet declined to sign the storage submission';
  }
  if (/insufficient funds/i.test(message)) {
    return 'the wallet does not hold enough 0G to publish this bundle';
  }
  if (/network|fetch|timeout|ECONN/i.test(message)) {
    return `the 0G Storage indexer could not be reached — ${message}`;
  }
  return message;
}

/**
 * Dev-only probe: does the browser build of the storage SDK produce the same
 * merkle root as the server's Node build?
 *
 * The two are different bundles of the same algorithm, and the whole design
 * depends on them agreeing — the attestor rejects a bundle whose bytes do not
 * hash to the root it was handed. Exposed on `window` so it can be checked in a
 * real browser rather than assumed.
 */
export async function __probeMerkleRoot(text: string): Promise<string> {
  return computeMerkleRootInBrowser(new TextEncoder().encode(text));
}
