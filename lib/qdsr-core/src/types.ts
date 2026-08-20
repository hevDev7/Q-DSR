/** Public types for the Q-DSR verification engine. */

export interface EvidenceManifest {
  agentName: string;
  strategyFamily: string;
  owner: string;
  /** Trading periods per year — 252 for daily, 52 weekly, 12 monthly. */
  periodsPerYear: number;
  /** Free-form record of the parameter search space that was explored. */
  searchSpace?: Record<string, unknown>;
}

export interface EvidenceBundle {
  manifest: EvidenceManifest;
  /** ISO timestamps aligned with `returns`. */
  timestamps: string[];
  /** Net-of-fees returns of the selected strategy, length T. */
  returns: number[];
  /** T × N matrix of every configuration explored during optimisation. */
  trials: number[][];
}

export interface Thresholds {
  /** Certify only at or above this Deflated Sharpe Ratio. */
  minDsr: number;
  /** Reject above this Probability of Backtest Overfitting. */
  maxPbo: number;
  /** Minimum return observations T. */
  minObservations: number;
  /** Minimum declared trials N. */
  minTrials: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minDsr: 0.95,
  maxPbo: 0.1,
  minObservations: 252,
  minTrials: 2,
};

export type VerifyPhase =
  | 'validating'
  | 'fingerprinting'
  | 'cscv'
  | 'bootstrap'
  | 'sealing';

export interface PhaseTiming {
  phase: VerifyPhase;
  label: string;
  elapsedMs: number;
}

export interface VerifyOptions {
  seed?: number;
  /**
   * Called as each stage completes. Reports real elapsed time per phase — the UI
   * shows measured durations rather than an animation pretending to be progress.
   */
  onPhase?: (timing: PhaseTiming) => void;
  bootstrapIterations?: number;
  blockSize?: number;
  /** S for CSCV. Must be even. */
  cscvSplits?: number;
  thresholds?: Partial<Thresholds>;
}

export type Verdict = 'certified' | 'insignificant';

export interface GateOutcome {
  gate: string;
  passed: boolean;
  observed: number;
  required: number;
  comparison: 'gte' | 'lte';
}

export interface VerificationResult {
  engineVersion: string;
  seed: number;
  verdict: Verdict;
  gates: GateOutcome[];

  /** T */
  observations: number;
  /** N */
  trials: number;

  /** Per-period Sharpe ratio of the selected strategy. */
  sharpe: number;
  sharpeAnnualised: number;
  skewness: number;
  kurtosis: number;

  /** SR₀ — expected maximum Sharpe under the null, per-period. */
  expectedMaxSharpe: number;
  /** Deflated Sharpe Ratio — a probability in [0,1]. */
  dsr: number;
  /** Probability of Backtest Overfitting — a probability in [0,1]. */
  pbo: number;
  /** Observations needed to reach the DSR threshold; Infinity if unreachable. */
  minimumTrackRecordLength: number;

  bootstrap: {
    iterations: number;
    blockSize: number;
    meanSharpe: number;
    stdSharpe: number;
    ci95: [number, number];
    probabilityPositive: number;
  };

  cscv: {
    splits: number;
    combinations: number;
    droppedRows: number;
  };

  /** Measured duration of each stage. */
  timings: PhaseTiming[];
  /** Total wall-clock time of the run. */
  elapsedMs: number;

  /** SHA-256 over the canonical numeric result — the reproducibility fingerprint. */
  digest: string;
}

export interface VerificationArtifacts {
  /** Sharpe ratio of every bootstrap resample. Pushed to 0G Storage. */
  bootstrapSamples: number[];
  /** CSCV logits, one per split. Pushed to 0G Storage. */
  cscvLogits: number[];
}

export interface VerificationRun {
  result: VerificationResult;
  artifacts: VerificationArtifacts;
}
