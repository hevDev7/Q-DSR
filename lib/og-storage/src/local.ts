import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

import { computeMerkleRoot } from './merkle.js';
import type { EvidenceStorage, StorageMode, UploadResult } from './types.js';

/**
 * Content-addressed storage on the local filesystem.
 *
 * The default when no 0G Storage credentials are configured. It keeps the entire
 * verification workflow runnable — and reproducible — with zero setup, which is
 * what lets a reviewer clone the repo and see the whole flow immediately.
 *
 * It reports `mode: 'local'` everywhere so a local root is never mistaken for a
 * published one.
 */
export class LocalEvidenceStorage implements EvidenceStorage {
  readonly mode: StorageMode = 'local';
  private readonly dir: string;

  constructor(cacheDir: string) {
    this.dir = cacheDir;
  }

  async computeRoot(data: Uint8Array): Promise<string> {
    return computeMerkleRoot(data);
  }

  async upload(data: Uint8Array, _name: string): Promise<UploadResult> {
    const rootHash = await computeMerkleRoot(data);
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.pathFor(rootHash), data);
    return { rootHash, mode: this.mode, bytes: data.byteLength };
  }

  async download(rootHash: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(rootHash)));
  }

  async has(rootHash: string): Promise<boolean> {
    try {
      await access(this.pathFor(rootHash));
      return true;
    } catch {
      return false;
    }
  }

  /** Nothing is published in local mode, so there is no URL to hand out. */
  gatewayUrl(): undefined {
    return undefined;
  }

  private pathFor(rootHash: string): string {
    // Root hashes are hex from the SDK; strip the prefix so the name is a plain file.
    return join(this.dir, `${rootHash.replace(/^0x/, '')}.bin`);
  }
}
