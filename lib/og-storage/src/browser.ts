import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk/browser';

/**
 * 0G Storage from the browser, signed by the claimant's own wallet.
 *
 * Deliberately separate from `index.ts`. That module reaches `local.ts` and
 * `live.ts`, both of which import `node:fs` — pulling it into a bundle would
 * fail at build time or, worse, ship a polyfill that silently does nothing.
 * Nothing here touches Node.
 *
 * The point of the split is who pays. An evidence bundle is a claim about a
 * track record, and the party making the claim funds its publication. That also
 * means a bogus submission costs the person submitting it rather than the
 * operator, which is what stops evidence storage from being a free DoS surface.
 */

export interface BrowserUploadResult {
  /** 0G Storage merkle root — the content address that lands in the verdict. */
  rootHash: string;
  /** The storage submission transaction the wallet signed. */
  txHash?: string;
  bytes: number;
}

/**
 * What the SDK actually needs from a signer.
 *
 * Not `ethers.Signer`. The storage SDK declares an exact peer dependency on
 * ethers 6.13.1 while the app runs 6.17, and those two `Signer` types are
 * nominally incompatible over a private field even though they are the same
 * shape. Importing either one here would force the whole workspace onto one
 * version to satisfy a type that is never checked at runtime.
 *
 * Structural typing states the real requirement instead, and leaves the version
 * choice to whoever is calling.
 */
export interface StorageSigner {
  getAddress(): Promise<string>;
  sendTransaction(transaction: never): Promise<never>;
  readonly provider: unknown;
}

export interface BrowserUploadOptions {
  /** 0G Chain RPC the storage submission is sent through. */
  evmRpc: string;
  indexerRpc: string;
  expectedReplica?: number;
}

/**
 * The merkle root of a payload, computed without any network access.
 *
 * Same value the upload will return, so a caller can show the content address —
 * and check whether it is already published — before asking for a signature.
 */
export async function computeMerkleRootInBrowser(data: Uint8Array): Promise<string> {
  const [tree, error] = await new MemData(data).merkleTree();
  if (error) throw error;
  const root = tree?.rootHash();
  if (!root) throw new Error('0G merkle root computation returned nothing');
  return root;
}

/**
 * Publishes bytes to 0G Storage, paid for by `signer`.
 *
 * Throws rather than falling back to any operator-funded path. A silent
 * fallback would make "the claimant funds their own evidence" conditional, and
 * a guarantee that holds only when convenient is not a guarantee.
 */
export async function uploadFromBrowser(
  data: Uint8Array,
  name: string,
  signer: StorageSigner,
  options: BrowserUploadOptions,
): Promise<BrowserUploadResult> {
  const indexer = new Indexer(options.indexerRpc);

  const [result, error] = await indexer.upload(
    new MemData(data),
    options.evmRpc,
    signer as never,
    {
      expectedReplica: options.expectedReplica ?? 1,
      finalityRequired: true,
      tags: '0x',
    },
  );

  if (error) throw error;

  // Files under 4GB return a single root; the array shape is for larger payloads.
  const rootHash = 'rootHash' in result ? result.rootHash : result.rootHashes[0]!;
  const txHash = 'txHash' in result ? result.txHash : result.txHashes[0]!;

  return { rootHash, txHash, bytes: data.byteLength };
}

/**
 * The canonical evidence bundle: exactly the inputs a verifier needs to
 * reproduce the verdict, and nothing the engine produced.
 *
 * Engine output is deterministic given these bytes plus the pinned seed and
 * version, so publishing it would pay to store something anyone can regenerate.
 * What pins the result is `resultDigest` on chain, not a copy in storage.
 */
export interface EvidenceBundleDocument {
  agent: { name: string; periodsPerYear: number };
  evidence: { returnsCsv: string; trialsCsv: string; selectedColumn: string };
}

/**
 * Serialises and compresses a bundle the way the attestor will re-read it.
 *
 * Key order is fixed and explicit. The merkle root is over the exact bytes this
 * returns, so any drift between what the browser writes and what the server
 * expects shows up as a root mismatch — the check working, but a confusing way
 * to learn about a formatting difference.
 *
 * The payload is gzipped because it is a trials matrix rendered as decimal text:
 * about three times more bytes than it needs, all of them paid for by the person
 * making the claim. Measured on a 1512 x 60 bundle, 1,097,517 bytes becomes
 * 384,359. Compression is also what keeps a full-size bundle inside what the
 * testnet indexer will actually accept — uploads around a megabyte were observed
 * stalling past four minutes while 400 KB completed in twelve seconds.
 *
 * Nothing about the trust model moves: the root addresses the compressed bytes,
 * the attestor inflates them, and a verifier does the same before re-running.
 */
export async function serialiseEvidenceBundle(
  document: EvidenceBundleDocument,
): Promise<Uint8Array<ArrayBuffer>> {
  const canonical = {
    agent: {
      name: document.agent.name,
      periodsPerYear: document.agent.periodsPerYear,
    },
    evidence: {
      returnsCsv: document.evidence.returnsCsv,
      trialsCsv: document.evidence.trialsCsv,
      selectedColumn: document.evidence.selectedColumn,
    },
  };
  return gzip(new TextEncoder().encode(JSON.stringify(canonical)));
}

/**
 * CompressionStream is available in every browser that can reach a wallet, and
 * in Node 18+, so the same function serves both sides of the check.
 *
 * Written against the stream directly rather than through Blob, which keeps this
 * module free of DOM type dependencies it would otherwise drag into a package
 * that also builds for Node.
 */
async function gzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const compressor = new CompressionStream('gzip');
  const writer = compressor.writable.getWriter();
  void writer.write(data);
  void writer.close();
  return new Uint8Array(await new Response(compressor.readable).arrayBuffer());
}
