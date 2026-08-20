import { describe, expect, it, vi } from 'vitest';

import type { ChainClient } from '@workspace/og-chain';

import { MintLookup } from '../src/services/mint-lookup.js';

function chainStub(impl: (agentId: string) => Promise<string | undefined>): ChainClient {
  return {
    status: () => ({ configured: true, networkName: 'test' }),
    submitVerdict: async () => {
      throw new Error('not used');
    },
    isCertified: async () => true,
    tokenIdOf: impl,
  };
}

const AGENT = `0x${'ab'.repeat(32)}`;

describe('MintLookup', () => {
  it('returns the token id the chain reports', async () => {
    const lookup = new MintLookup(chainStub(async () => '7'));
    expect(await lookup.tokenIdOf(AGENT)).toBe('7');
  });

  it('caches a token id permanently — an Agentic ID cannot be unminted', async () => {
    const tokenIdOf = vi.fn(async () => '7');
    const lookup = new MintLookup(chainStub(tokenIdOf), 0);

    await lookup.tokenIdOf(AGENT);
    await lookup.tokenIdOf(AGENT);
    await lookup.tokenIdOf(AGENT);

    expect(tokenIdOf).toHaveBeenCalledTimes(1);
  });

  it('re-checks an absence once its window expires', async () => {
    const tokenIdOf = vi.fn(async () => undefined);
    const lookup = new MintLookup(chainStub(tokenIdOf), 20);

    expect(await lookup.tokenIdOf(AGENT)).toBeUndefined();
    expect(await lookup.tokenIdOf(AGENT)).toBeUndefined();
    expect(tokenIdOf).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await lookup.tokenIdOf(AGENT)).toBeUndefined();
    expect(tokenIdOf).toHaveBeenCalledTimes(2);
  });

  it('does not cache an RPC failure as "not minted"', async () => {
    // Recording an absence because the network blinked would hide a real Agentic
    // ID until the process restarted.
    let attempt = 0;
    const tokenIdOf = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('RPC unreachable');
      return '9';
    });
    const lookup = new MintLookup(chainStub(tokenIdOf), 60_000);

    expect(await lookup.tokenIdOf(AGENT)).toBeUndefined();
    expect(await lookup.tokenIdOf(AGENT)).toBe('9');
  });

  it('forgets an absence on request, so a fresh mint shows up immediately', async () => {
    const tokenIdOf = vi.fn(async () => undefined);
    const lookup = new MintLookup(chainStub(tokenIdOf), 60_000);

    await lookup.tokenIdOf(AGENT);
    lookup.forget(AGENT);
    await lookup.tokenIdOf(AGENT);

    expect(tokenIdOf).toHaveBeenCalledTimes(2);
  });

  it('resolves a page of agents concurrently and reports only the minted ones', async () => {
    const minted = new Map([['a', '1'], ['c', '3']]);
    const lookup = new MintLookup(chainStub(async (id) => minted.get(id)));

    const found = await lookup.tokenIdsOf(['a', 'b', 'c']);
    expect([...found.entries()]).toEqual([['a', '1'], ['c', '3']]);
  });
});
