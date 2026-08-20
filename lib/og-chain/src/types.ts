export interface VerdictSubmission {
  agentId: string;
  evidenceRoot: string;
  resultDigest: string;
  engineVersion: string;
  /** Deflated Sharpe Ratio in basis points, 0..10000. */
  dsrBps: number;
  /** Probability of Backtest Overfitting in basis points, 0..10000. */
  pboBps: number;
  trials: number;
  observations: number;
}

export interface AnchorReceipt {
  chainId: number;
  registryAddress: string;
  txHash: string;
  blockNumber: number;
  explorerUrl: string;
}

export interface ChainStatus {
  configured: boolean;
  chainId?: number;
  /** Public RPC endpoint. Exposed so a browser can read contract state without a wallet. */
  rpcUrl?: string;
  networkName: string;
  explorerBaseUrl?: string;
  registryAddress?: string;
  agenticIdAddress?: string;
  attestorAddress?: string;
}

export interface ChainClient {
  status(): ChainStatus;
  submitVerdict(submission: VerdictSubmission): Promise<AnchorReceipt>;
  isCertified(agentId: string): Promise<boolean>;
  /**
   * The Agentic ID minted for an agent, or undefined if none exists.
   *
   * Read from the chain rather than tracked here, because minting happens in the
   * developer's wallet — this server never sees the transaction and could not
   * know about it otherwise.
   */
  tokenIdOf(agentId: string): Promise<string | undefined>;
}

export interface ChainConfig {
  rpcUrl?: string;
  chainId?: number;
  privateKey?: string;
  registryAddress?: string;
  agenticIdAddress?: string;
}

export class ChainNotConfiguredError extends Error {
  constructor() {
    super(
      'On-chain anchoring is not configured. Set OG_RPC_URL, OG_PRIVATE_KEY and ' +
        'QDSR_REGISTRY_ADDRESS to publish verdicts to 0G Chain.',
    );
    this.name = 'ChainNotConfiguredError';
  }
}
