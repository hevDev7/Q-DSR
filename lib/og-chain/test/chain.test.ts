import { describe, expect, it } from 'vitest';

import { Interface } from 'ethers';

import {
  AGENTIC_ID_ABI,
  ChainNotConfiguredError,
  QDSR_REGISTRY_ABI,
  DisabledChainClient,
  createChainClient,
  deriveAgentId,
  encodeOracleProof,
  networkForChainId,
  toBasisPoints,
  OG_MAINNET,
  OG_TESTNET,
} from '../src/index.js';

const OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

describe('networks', () => {
  it('knows 0G mainnet', () => {
    expect(OG_MAINNET.chainId).toBe(16661);
    expect(OG_MAINNET.explorerBaseUrl).toBe('https://chainscan.0g.ai');
  });

  it('knows the Galileo testnet', () => {
    expect(OG_TESTNET.chainId).toBe(16602);
  });

  it('looks a network up by chain id', () => {
    expect(networkForChainId(16661)?.name).toBe('0G mainnet');
    expect(networkForChainId(1)).toBeUndefined();
  });
});

describe('deriveAgentId', () => {
  it('is stable for the same owner and name', () => {
    expect(deriveAgentId(OWNER, 'Cinder Delta')).toBe(deriveAgentId(OWNER, 'Cinder Delta'));
  });

  it('separates agents by name and by owner', () => {
    expect(deriveAgentId(OWNER, 'Cinder Delta')).not.toBe(deriveAgentId(OWNER, 'Vega Lantern'));
    expect(deriveAgentId(OWNER, 'Cinder Delta')).not.toBe(
      deriveAgentId('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 'Cinder Delta'),
    );
  });

  it('produces a bytes32', () => {
    expect(deriveAgentId(OWNER, 'Cinder Delta')).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('encodeOracleProof', () => {
  it('encodes an agentId as 32 bytes, which is what verifyProof requires', () => {
    const proof = encodeOracleProof(deriveAgentId(OWNER, 'Cinder Delta'));
    // 0x + 64 hex characters
    expect(proof).toHaveLength(66);
  });
});

describe('toBasisPoints', () => {
  it('converts a probability', () => {
    expect(toBasisPoints(0.95)).toBe(9_500);
    expect(toBasisPoints(0.0839)).toBe(839);
    expect(toBasisPoints(1)).toBe(10_000);
    expect(toBasisPoints(0)).toBe(0);
  });

  it('clamps rather than emitting a value the contract would reject', () => {
    expect(toBasisPoints(1.5)).toBe(10_000);
    expect(toBasisPoints(-0.2)).toBe(0);
    expect(toBasisPoints(NaN)).toBe(0);
  });
});

describe('QDSR_REGISTRY_ABI', () => {
  it('can read back the append-only verdict history', () => {
    // A client that can write a verdict but not read the history cannot audit,
    // which is the only reason the history is append-only in the first place.
    const surface = QDSR_REGISTRY_ABI.join('\n');
    for (const fragment of ['latestVerdict', 'verdictAt', 'verdictCount', 'hasFailedVerdict']) {
      expect(surface).toContain(fragment);
    }
  });

  it('decodes a verdict into named fields rather than a positional tuple', () => {
    const iface = new Interface(QDSR_REGISTRY_ABI as unknown as string[]);
    const fn = iface.getFunction('latestVerdict');
    const [output] = fn!.outputs;
    expect(output!.components?.map((c) => c.name)).toEqual([
      'evidenceRoot', 'resultDigest', 'engineVersionHash', 'dsrBps', 'pboBps',
      'trials', 'observations', 'submittedAt', 'attestor', 'certified',
    ]);
  });
});

describe('AGENTIC_ID_ABI', () => {
  it('can read what a minted token stands for', () => {
    const surface = AGENTIC_ID_ABI.join('\n');
    for (const fragment of ['recordOf', 'ownerOf', 'encryptedURI', 'isStillCertified']) {
      expect(surface).toContain(fragment);
    }
  });

  it('names the fields of a token record', () => {
    const iface = new Interface(AGENTIC_ID_ABI as unknown as string[]);
    const [output] = iface.getFunction('recordOf')!.outputs;
    expect(output!.components?.map((c) => c.name)).toEqual([
      'agentId', 'metadataHash', 'verdictIndex', 'mintedAt',
    ]);
  });

  it('declares the custom errors so a blocked mint decodes into a name', () => {
    const iface = new Interface(AGENTIC_ID_ABI as unknown as string[]);
    expect(iface.getError('AgentNotCertified')).toBeTruthy();
    expect(iface.getError('AgentAlreadyMinted')).toBeTruthy();
  });
});

describe('createChainClient', () => {
  it('is disabled when nothing is configured', () => {
    const client = createChainClient({});
    expect(client.status().configured).toBe(false);
    expect(client.status().networkName).toBe('not connected');
  });

  it('is disabled when the configuration is only partial', () => {
    const client = createChainClient({ rpcUrl: 'https://evmrpc.0g.ai', chainId: 16661 });
    expect(client.status().configured).toBe(false);
  });

  it('builds a live client once rpc, key and registry are all present', () => {
    const client = createChainClient({
      rpcUrl: 'https://evmrpc.0g.ai',
      chainId: 16661,
      privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      registryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    });
    const status = client.status();
    expect(status.configured).toBe(true);
    expect(status.chainId).toBe(16661);
    expect(status.explorerBaseUrl).toBe('https://chainscan.0g.ai');
    expect(status.attestorAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe('DisabledChainClient', () => {
  it('reports nothing as certified rather than guessing', async () => {
    expect(await new DisabledChainClient().isCertified()).toBe(false);
  });

  it('refuses to pretend an anchor happened', async () => {
    await expect(new DisabledChainClient().submitVerdict()).rejects.toBeInstanceOf(
      ChainNotConfiguredError,
    );
  });

  it('reports no minted token rather than guessing at one', async () => {
    expect(await new DisabledChainClient().tokenIdOf()).toBeUndefined();
  });
});
