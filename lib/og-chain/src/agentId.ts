import { AbiCoder, keccak256 } from 'ethers';

/**
 * Canonical agent identity.
 *
 * Must stay byte-identical to `QDSRRegistry.deriveAgentId`. The contract exposes
 * the same derivation as a pure function specifically so this can be checked
 * rather than assumed — see the og-chain tests.
 */
export function deriveAgentId(owner: string, name: string): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'string'], [owner, name]));
}

/** Encodes an agentId as the `bytes` proof the IOracle interface expects. */
export function encodeOracleProof(agentId: string): string {
  return AbiCoder.defaultAbiCoder().encode(['bytes32'], [agentId]);
}

/** Converts a probability in [0,1] to basis points, clamped and rounded. */
export function toBasisPoints(probability: number): number {
  if (!Number.isFinite(probability)) return 0;
  return Math.max(0, Math.min(10_000, Math.round(probability * 10_000)));
}
