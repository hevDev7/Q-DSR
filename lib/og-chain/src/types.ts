/** The metadata struct AgenticID.mint expects. */
export interface AgentMetadata {
  name: string;
  description: string;
  /** http(s) URL. Empty makes the contract generate an SVG from the agent's metrics. */
  image: string;
  evidenceURI: string;
}

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
  /** Absent when the transaction is known only by hash — a lookup rather than a receipt. */
  blockNumber?: number;
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
  /**
   * An already-recorded verdict matching this submission, if one exists.
   *
   * Checked before submitting. The registry is append-only, so re-anchoring a
   * verdict that already landed would write an identical duplicate rather than
   * fail — which is exactly what a retry after an ambiguous timeout would do.
   */
  findVerdict(submission: VerdictSubmission): Promise<AnchorReceipt | undefined>;
}

/**
 * The transaction was broadcast but its outcome is not known yet.
 *
 * Distinct from a failure on purpose: a timeout means we stopped waiting, not
 * that the chain rejected anything. Recording it as failed invites a retry that
 * double-submits, and tells the operator something that may well be false.
 */
export class VerdictPendingError extends Error {
  constructor(
    readonly txHash: string,
    override readonly cause?: unknown,
  ) {
    super(`Verdict transaction ${txHash} was broadcast but has not been confirmed yet`);
    this.name = 'VerdictPendingError';
  }
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
