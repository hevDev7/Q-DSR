/** Where the evidence bytes actually live. Surfaced in the API so nothing is implied. */
export type StorageMode = 'live' | 'local';

export interface UploadResult {
  /** 0G Storage merkle root — the content address. */
  rootHash: string;
  /** Storage submission transaction, present only in live mode. */
  txHash?: string;
  mode: StorageMode;
  bytes: number;
}

export interface EvidenceStorage {
  readonly mode: StorageMode;
  /**
   * The 0G merkle root of a payload, computed without touching the network.
   * The value is identical to what a live upload would return, so a verdict
   * anchored from local mode still carries a genuine 0G content address.
   */
  computeRoot(data: Uint8Array): Promise<string>;
  upload(data: Uint8Array, name: string): Promise<UploadResult>;
  download(rootHash: string): Promise<Uint8Array>;
  has(rootHash: string): Promise<boolean>;
  /**
   * A URL a browser can fetch this payload from, or undefined when nothing has
   * been published.
   *
   * The indexer doubles as an HTTP gateway. It sends
   * `Content-Disposition: attachment`, which stops a top-level navigation from
   * rendering inline but does not affect subresource loads — an `<img>` pointing
   * here displays normally, which is what makes it usable as NFT artwork.
   */
  gatewayUrl(rootHash: string, name?: string): string | undefined;
}

export interface StorageConfig {
  /** 0G Storage indexer RPC. Live mode requires it. */
  indexerRpc?: string;
  /** 0G Chain EVM RPC used to pay for the storage submission. */
  evmRpc?: string;
  /** Private key funding the storage submission. */
  privateKey?: string;
  /** Directory for the local cache and for local-mode payloads. */
  cacheDir: string;
  /** Replicas requested from the indexer. */
  expectedReplica?: number;
}
