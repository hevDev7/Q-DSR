import { Contract, JsonRpcProvider, Wallet } from 'ethers';

import { AGENTIC_ID_ABI, QDSR_REGISTRY_ABI } from './abi.js';
import { networkForChainId, OG_MAINNET } from './networks.js';
import {
  ChainNotConfiguredError,
  type AnchorReceipt,
  type ChainClient,
  type ChainConfig,
  type ChainStatus,
  type VerdictSubmission,
  VerdictPendingError,
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

  async tokenIdOf(): Promise<string | undefined> {
    return undefined;
  }

  async findVerdict(): Promise<undefined> {
    return undefined;
  }
}

export class OgChainClient implements ChainClient {
  private readonly provider: JsonRpcProvider;
  private readonly wallet: Wallet;
  private readonly registry: Contract;
  private readonly agenticId?: Contract;
  private readonly chainId: number;
  private readonly rpcUrl: string;
  private readonly registryAddress: string;
  private readonly agenticIdAddress?: string;

  constructor(config: Required<Pick<ChainConfig, 'rpcUrl' | 'privateKey' | 'registryAddress'>> & ChainConfig) {
    this.chainId = config.chainId ?? OG_MAINNET.chainId;
    this.rpcUrl = config.rpcUrl;
    this.registryAddress = config.registryAddress;
    this.agenticIdAddress = config.agenticIdAddress;

    this.provider = new JsonRpcProvider(config.rpcUrl, this.chainId, { staticNetwork: true });
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.registry = new Contract(config.registryAddress, QDSR_REGISTRY_ABI, this.wallet);
    this.agenticId = config.agenticIdAddress
      ? new Contract(config.agenticIdAddress, AGENTIC_ID_ABI, this.provider)
      : undefined;
  }

  status(): ChainStatus {
    const network = networkForChainId(this.chainId);
    return {
      configured: true,
      chainId: this.chainId,
      rpcUrl: this.rpcUrl,
      networkName: network?.name ?? `chain ${this.chainId}`,
      explorerBaseUrl: network?.explorerBaseUrl,
      registryAddress: this.registryAddress,
      agenticIdAddress: this.agenticIdAddress,
      attestorAddress: this.wallet.address,
    };
  }

  /** How long to wait for a verdict transaction before calling the outcome unknown. */
  private static readonly CONFIRMATION_TIMEOUT_MS = 120_000;

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

    let receipt;
    try {
      receipt = await tx.wait(1, OgChainClient.CONFIRMATION_TIMEOUT_MS);
    } catch (error) {
      // Waiting stopped; the transaction did not. Reporting this as a failure
      // would be a claim about the chain we have not checked, and would invite a
      // retry that submits a second identical verdict into an append-only log.
      throw new VerdictPendingError(tx.hash, error);
    }
    if (!receipt) throw new VerdictPendingError(tx.hash);

    return this.receiptToAnchor(receipt.hash, receipt.blockNumber);
  }

  /**
   * Looks for a verdict already on chain matching this submission.
   *
   * Compares the evidence root and result digest rather than the metrics: those
   * two together name the exact bundle and the exact computed answer, so a match
   * is the same verdict rather than merely a similar one.
   */
  async findVerdict(submission: VerdictSubmission): Promise<AnchorReceipt | undefined> {
    const count = (await this.registry.verdictCount!(submission.agentId)) as bigint;
    if (count === 0n) return undefined;

    for (let index = count - 1n; index >= 0n; index--) {
      const verdict = await this.registry.verdictAt!(submission.agentId, index);
      if (
        String(verdict.evidenceRoot).toLowerCase() === submission.evidenceRoot.toLowerCase() &&
        String(verdict.resultDigest).toLowerCase() === submission.resultDigest.toLowerCase()
      ) {
        const logs = await this.registry.queryFilter!(
          this.registry.filters!.VerdictSubmitted!(submission.agentId, index),
        );
        const log = logs[0];
        return this.receiptToAnchor(log?.transactionHash ?? '', log?.blockNumber);
      }
      if (index === 0n) break;
    }
    return undefined;
  }

  private receiptToAnchor(txHash: string, blockNumber?: number): AnchorReceipt {
    const explorerBase = networkForChainId(this.chainId)?.explorerBaseUrl ?? '';
    return {
      chainId: this.chainId,
      registryAddress: this.registryAddress,
      txHash,
      blockNumber,
      explorerUrl: explorerBase && txHash ? `${explorerBase}/tx/${txHash}` : txHash,
    };
  }

  async isCertified(agentId: string): Promise<boolean> {
    return Boolean(await this.registry.isCertified!(agentId));
  }

  async tokenIdOf(agentId: string): Promise<string | undefined> {
    if (!this.agenticId) return undefined;
    const tokenId = (await this.agenticId.tokenIdOfAgent!(agentId)) as bigint;
    return tokenId === 0n ? undefined : tokenId.toString();
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
