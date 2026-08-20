import type { ChainStatus } from '@workspace/og-chain';

import type { AgentRecord, AnchorRecord, RunRecord } from '../store/index.js';

export interface MintIntent {
  ready: boolean;
  blockedReason?: string;
  verdict?: 'certified' | 'insignificant';
  agentIdHash: string;
  metadataURI?: string;
  metadataHash?: string;
  evidenceRoot?: string;
  chainId?: number;
  rpcUrl?: string;
  networkName: string;
  agenticIdAddress?: string;
  registryAddress?: string;
  explorerBaseUrl?: string;
}

/**
 * Assembles everything a wallet needs to mint, and states plainly why it cannot.
 *
 * The server does not mint. The agent owner signs and pays for the transaction
 * from their own wallet, so this endpoint exists to hand over exact arguments
 * rather than to grant permission — the permission lives in the contract.
 *
 * The ordering of the checks below is the dependency order, so the reason a
 * caller gets back is the first thing they actually have to fix rather than the
 * last thing that happened to fail.
 */
export function buildMintIntent(input: {
  agent: AgentRecord;
  run?: RunRecord;
  anchor?: AnchorRecord;
  chain: ChainStatus;
}): MintIntent {
  const { agent, run, anchor, chain } = input;

  // The mint arguments are derived data, so they are filled in whenever they can
  // be — independent of whether the mint would succeed. A caller probing the gate
  // needs real arguments; sending a zero metadataHash would trip the contract's
  // EmptyMetadata guard first and report the wrong reason for the refusal.
  const base: MintIntent = {
    ready: false,
    agentIdHash: agent.agentId,
    chainId: chain.chainId,
    rpcUrl: chain.rpcUrl,
    networkName: chain.networkName,
    agenticIdAddress: chain.agenticIdAddress,
    registryAddress: chain.registryAddress,
    explorerBaseUrl: chain.explorerBaseUrl,
    verdict: run?.result?.verdict,
    evidenceRoot: anchor?.evidenceRoot,
    metadataURI: anchor?.evidenceRoot ? `0g://storage/${anchor.evidenceRoot}` : undefined,
    metadataHash: run?.result ? `0x${run.result.digest}` : undefined,
  };

  if (!chain.configured || !chain.agenticIdAddress) {
    return {
      ...base,
      blockedReason:
        'This deployment has no Agentic ID contract configured. Set OG_RPC_URL and ' +
        'AGENTIC_ID_ADDRESS to enable minting.',
    };
  }

  if (!run?.result) {
    return { ...base, blockedReason: 'This agent has no completed verification yet.' };
  }

  if (run.result.verdict !== 'certified') {
    return {
      ...base,
      blockedReason:
        `The verdict is "${run.result.verdict}" — DSR ${run.result.dsr.toFixed(4)}, ` +
        `PBO ${run.result.pbo.toFixed(4)}. The contract will refuse this mint.`,
    };
  }

  if (!anchor?.evidenceRoot) {
    return {
      ...base,
      blockedReason: 'The evidence has not been sealed yet. Anchor the run first.',
    };
  }

  // The contract reads isCertified() from the registry, so a verdict that exists
  // only in this database is invisible to it and the mint would revert.
  if (anchor.status !== 'anchored') {
    return {
      ...base,
      blockedReason:
        'The verdict has not been published to the on-chain registry yet. The Agentic ID ' +
        'contract reads the verdict from there, so a mint would revert until it is anchored.',
    };
  }

  return { ...base, ready: true };
}
