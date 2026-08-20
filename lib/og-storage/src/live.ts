import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers } from 'ethers';

import { LocalEvidenceStorage } from './local.js';
import { computeMerkleRoot } from './merkle.js';
import type { EvidenceStorage, StorageConfig, StorageMode, UploadResult } from './types.js';

/**
 * 0G Storage backed evidence store.
 *
 * Every upload is also written to the local cache. Two reasons: a download can be
 * served without a network round trip during a demo, and — more importantly — the
 * replication check has something to compare against if the indexer is briefly
 * unreachable. The published copy remains the source of truth.
 */
export class OgEvidenceStorage implements EvidenceStorage {
  readonly mode: StorageMode = 'live';

  private readonly indexer: Indexer;
  private readonly indexerRpc: string;
  private readonly signer: ethers.Wallet;
  private readonly evmRpc: string;
  private readonly expectedReplica: number;
  private readonly cache: LocalEvidenceStorage;

  constructor(config: Required<Pick<StorageConfig, 'indexerRpc' | 'evmRpc' | 'privateKey' | 'cacheDir'>> & Pick<StorageConfig, 'expectedReplica'>) {
    this.indexer = new Indexer(config.indexerRpc);
    this.indexerRpc = config.indexerRpc.replace(/\/+$/, '');
    this.evmRpc = config.evmRpc;
    this.signer = new ethers.Wallet(config.privateKey, new ethers.JsonRpcProvider(config.evmRpc));
    this.expectedReplica = config.expectedReplica ?? 1;
    this.cache = new LocalEvidenceStorage(config.cacheDir);
  }

  async computeRoot(data: Uint8Array): Promise<string> {
    return computeMerkleRoot(data);
  }

  async upload(data: Uint8Array, name: string): Promise<UploadResult> {
    // Cache first: if the submission succeeds but the process dies before we
    // record the root, the bytes are still recoverable locally.
    await this.cache.upload(data, name);

    const file = new MemData(data);
    const [result, error] = await this.indexer.upload(file, this.evmRpc, this.signer, {
      expectedReplica: this.expectedReplica,
      finalityRequired: true,
      tags: ethers.hexlify(ethers.toUtf8Bytes(name)),
    });

    if (error) throw error;

    // Files under 4GB return a single root; the array shape is for larger payloads.
    const rootHash = 'rootHash' in result ? result.rootHash : result.rootHashes[0]!;
    const txHash = 'txHash' in result ? result.txHash : result.txHashes[0]!;

    return { rootHash, txHash, mode: this.mode, bytes: data.byteLength };
  }

  async download(rootHash: string): Promise<Uint8Array> {
    if (await this.cache.has(rootHash)) {
      return this.cache.download(rootHash);
    }

    const scratch = join(tmpdir(), `qdsr-${rootHash.replace(/^0x/, '').slice(0, 16)}.bin`);
    try {
      // `proof: true` makes the storage node prove the bytes belong to this root —
      // without it a download is just trusting whichever node answered.
      const error = await this.indexer.download(rootHash, scratch, true);
      if (error) throw error;
      const data = new Uint8Array(await readFile(scratch));
      await mkdir(join(scratch, '..'), { recursive: true });
      await this.cache.upload(data, rootHash);
      return data;
    } finally {
      await rm(scratch, { force: true });
    }
  }

  gatewayUrl(rootHash: string, name?: string): string {
    const suffix = name ? `&name=${encodeURIComponent(name)}` : '';
    return `${this.indexerRpc}/file?root=${rootHash}${suffix}`;
  }

  async has(rootHash: string): Promise<boolean> {
    if (await this.cache.has(rootHash)) return true;
    try {
      const locations = await this.indexer.getFileLocations(rootHash);
      return locations.length > 0;
    } catch {
      return false;
    }
  }
}

/** Kept out of the class so the constructor stays free of side effects. */
export async function ensureCacheDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '.gitignore'), '*\n', 'utf8').catch(() => undefined);
}
