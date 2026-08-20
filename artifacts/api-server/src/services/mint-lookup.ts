import type { ChainClient } from '@workspace/og-chain';

/**
 * Caches "has this agent been minted" lookups.
 *
 * Minting happens in the developer's wallet, so this server only learns about it
 * by asking the chain — and the agent list would otherwise make one RPC call per
 * row on every request.
 *
 * A token id is cached permanently once seen, because `tokenIdOfAgent` never goes
 * back to zero: an Agentic ID cannot be unminted. Only the absence of a token is
 * given an expiry, since that is the answer which can change.
 *
 * A failing RPC is not cached at all. Recording "no token" because the network
 * blinked would hide a real Agentic ID until the process restarted.
 */
export class MintLookup {
  private readonly minted = new Map<string, string>();
  private readonly absent = new Map<string, number>();

  constructor(
    private readonly chain: ChainClient,
    private readonly absenceTtlMs = 15_000,
  ) {}

  async tokenIdOf(agentId: string): Promise<string | undefined> {
    const known = this.minted.get(agentId);
    if (known) return known;

    const checkedAt = this.absent.get(agentId);
    if (checkedAt !== undefined && Date.now() - checkedAt < this.absenceTtlMs) {
      return undefined;
    }

    try {
      const tokenId = await this.chain.tokenIdOf(agentId);
      if (tokenId) {
        this.minted.set(agentId, tokenId);
        this.absent.delete(agentId);
        return tokenId;
      }
      this.absent.set(agentId, Date.now());
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Resolves many agents concurrently; the cache keeps this cheap after the first pass. */
  async tokenIdsOf(agentIds: readonly string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    await Promise.all(
      agentIds.map(async (agentId) => {
        const tokenId = await this.tokenIdOf(agentId);
        if (tokenId) found.set(agentId, tokenId);
      }),
    );
    return found;
  }

  /** Called after a mint is observed, so the next read is not served a stale absence. */
  forget(agentId: string): void {
    this.absent.delete(agentId);
  }
}
