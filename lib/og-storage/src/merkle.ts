import { MemData } from '@0gfoundation/0g-storage-ts-sdk';

/**
 * Computes the 0G Storage merkle root of a payload locally.
 *
 * Content addressing is the same computation whether or not the bytes are
 * published, so we can anchor a real root on chain before — or without — an
 * upload, and a later upload will produce exactly the same value.
 */
export async function computeMerkleRoot(data: Uint8Array): Promise<string> {
  const file = new MemData(data);
  const [tree, error] = await file.merkleTree();
  if (error) throw error;
  const root = tree?.rootHash();
  if (!root) throw new Error('0G merkle root computation returned nothing');
  return root;
}
