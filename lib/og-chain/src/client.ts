import { Contract, JsonRpcProvider, Wallet } from 'ethers';

import { QDSR_REGISTRY_ABI } from './abi.js';
import { networkForChainId, OG_MAINNET } from './networks.js';
import {
  ChainNotConfiguredError,
  type AnchorReceipt,
  type ChainClient,
  type ChainConfig,
  type ChainStatus,
  type VerdictSubmission,
} from './types.js';

/**
 * Stands in when no chain credentials are present.
 *
 * Reads answer honestly (nothing is certified on a chain we cannot see) and writes
 * fail loudly. The alternative — quietly pretending to anchor — would let a demo
 * look successful while publishing nothing.
 */
export class DisabledChainClient implements ChainClient {
  status(): ChainStatus {
    return { configured: false, networkName: 'not connected' };
  }

  async submitVerdict(): Promise<AnchorReceipt> {
    throw new ChainNotConfiguredError();
  }

  async isCertified(): Promise<boolean> {
    return false;
  }
}

export class OgChainClient implements ChainClient {
  private readonly provider: JsonRpcProvider;
  private readonly wallet: Wallet;
  private readonly registry: Contract;
  private readonly chainId: number;
  private readonly registryAddress: string;
  private readonly agenticIdAddress?: string;

  constructor(config: Required<Pick<ChainConfig, 'rpcUrl' | 'privateKey' | 'registryAddress'>> & ChainConfig) {
    this.chainId = config.chainId ?? OG_MAINNET.chainId;
    this.registryAddress = config.registryAddress;
    this.agenticIdAddress = config.agenticIdAddress;

    this.provider = new JsonRpcProvider(config.rpcUrl, this.chainId, { staticNetwork: true });
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.registry = new Contract(config.registryAddress, QDSR_REGISTRY_ABI, this.wallet);
  }

  status(): ChainStatus {
    const network = networkForChainId(this.chainId);
    return {
      configured: true,
      chainId: this.chainId,
      networkName: network?.name ?? `chain ${this.chainId}`,
      explorerBaseUrl: network?.explorerBaseUrl,
      registryAddress: this.registryAddress,
      agenticIdAddress: this.agenticIdAddress,
      attestorAddress: this.wallet.address,
    };
  }

  async submitVerdict(submission: VerdictSubmission): Promise<AnchorReceipt> {
    const tx = await this.registry.submitVerdict!(
      submission.agentId,
      submission.evidenceRoot,
      submission.resultDigest,
      submission.engineVersion,
      submission.dsrBps,
      submission.pboBps,
      submission.trials,
      submission.observations,
    );
    const receipt = await tx.wait();
    if (!receipt) throw new Error(`Transaction ${tx.hash} produced no receipt`);

    const explorerBase = networkForChainId(this.chainId)?.explorerBaseUrl ?? '';
    return {
      chainId: this.chainId,
      registryAddress: this.registryAddress,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      explorerUrl: explorerBase ? `${explorerBase}/tx/${receipt.hash}` : receipt.hash,
    };
  }

  async isCertified(agentId: string): Promise<boolean> {
    return Boolean(await this.registry.isCertified!(agentId));
  }
}

/**
 * Builds a chain client from configuration.
 *
 * All three of an RPC, a key and a registry address are required. A partially
 * configured client is treated as no client at all.
 */
export function createChainClient(config: ChainConfig): ChainClient {
  if (!config.rpcUrl || !config.privateKey || !config.registryAddress) {
    return new DisabledChainClient();
  }
  return new OgChainClient({
    rpcUrl: config.rpcUrl,
    privateKey: config.privateKey,
    registryAddress: config.registryAddress,
    chainId: config.chainId,
    agenticIdAddress: config.agenticIdAddress,
  });
}
