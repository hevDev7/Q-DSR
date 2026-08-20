import { LocalEvidenceStorage } from './local.js';
import { OgEvidenceStorage, ensureCacheDir } from './live.js';
import type { EvidenceStorage, StorageConfig } from './types.js';

export { LocalEvidenceStorage } from './local.js';
export { OgEvidenceStorage } from './live.js';
export { computeMerkleRoot } from './merkle.js';
export type { EvidenceStorage, StorageConfig, StorageMode, UploadResult } from './types.js';

/**
 * Chooses a storage backend from configuration.
 *
 * Live mode needs all three of an indexer, an EVM RPC and a funded key. Anything
 * less falls back to local rather than half-configuring itself — a storage client
 * that silently cannot publish is worse than one that says so.
 */
export async function createEvidenceStorage(config: StorageConfig): Promise<EvidenceStorage> {
  await ensureCacheDir(config.cacheDir);

  const canGoLive = Boolean(config.indexerRpc && config.evmRpc && config.privateKey);
  if (!canGoLive) {
    return new LocalEvidenceStorage(config.cacheDir);
  }

  return new OgEvidenceStorage({
    indexerRpc: config.indexerRpc!,
    evmRpc: config.evmRpc!,
    privateKey: config.privateKey!,
    cacheDir: config.cacheDir,
    expectedReplica: config.expectedReplica,
  });
}
