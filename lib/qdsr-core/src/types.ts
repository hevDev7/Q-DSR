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
  /**
   * Overrides for the intake plausibility layer. The defaults are tuned so a
   * genuine daily trading record (Sharpe ~0.5–4, some losing periods, low serial
   * correlation) passes untouched; see `PLAUSIBILITY_DEFAULTS`. Set individual
   * fields to widen or tighten a check without disabling the rest.
   */
  plausibility?: Partial<PlausibilityThresholds>;
}

/**
 * A non-fatal caution surfaced beside a verdict.
 *
 * The upload was accepted and measured, but a property of it is unusual enough
 * that a human should see it — an extreme Sharpe just under the reject wall,
 * heavy tails, an implausibly high hit-rate. Warnings never change the verdict
 * and never feed the reproducibility digest; they are advisory metadata.
 */
export interface PlausibilityWarning {
  /** Stable machine code, e.g. 'sharpe-high', 'serial-correlation', 'fat-tails'. */
  code: string;
  /** Human-readable explanation, safe to show on a certificate. */
  message: string;
  /** The observed value that triggered the warning. */
  value: number;
}

/**
 * Thresholds for the intake plausibility layer.
 *
 * Every bound is chosen to sit outside the documented range of genuine daily
 * trading records, so an honest strategy never trips a hard reject. See
 * `PLAUSIBILITY_DEFAULTS` for the values and the reasoning behind each.
 */
export interface PlausibilityThresholds {
  /** Hard-reject an annualised Sharpe above this — physically implausible for a daily record. */
  maxAnnualisedSharpe: number;
  /** Warn (do not reject) an annualised Sharpe above this. */
  warnAnnualisedSharpe: number;
  /** Hard-reject when the mean per-period return exceeds this in magnitude (levels, not returns). */
  maxAbsMeanReturn: number;
  /** Hard-reject when the 95th percentile of |return| exceeds this (percent/bps/level scale). */
  maxP95AbsReturn: number;
  /** Hard-reject a per-period standard deviation below this — a flat series is not a record. */
  minStdReturn: number;
  /** Hard-reject lag-1 autocorrelation above this — a running level, not period returns. */
  maxLag1Autocorr: number;
  /** Warn on |lag-1 autocorrelation| above this. */
  warnLag1Autocorr: number;
  /** Hard-reject when fewer than this many periods are active (non-zero). */
  minActivePeriods: number;
  /** Warn when the fraction of exactly-zero periods exceeds this. */
  warnZeroFraction: number;
  /** Hard-reject when the series takes this many or fewer distinct values (at full length). */
  maxRejectDistinctValues: number;
  /** Two standardised trials columns correlated above this are the same configuration. */
  duplicateColumnCorrelation: number;
  /** Hard-reject when more than this fraction of declared columns duplicate another. */
  maxDuplicateColumnFraction: number;
  /** Warn on absolute skewness above this. */
  warnAbsSkewness: number;
  /** Warn on (non-excess) kurtosis above this. */
  warnKurtosis: number;
  /** Warn on a positive-period hit-rate above this. */
  warnHitRate: number;
  /** Warn when the fraction of losing periods is below this (implausibly consistent). */
  warnMinNegativeFraction: number;
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

  /**
   * Non-fatal cautions from the intake plausibility layer. Empty for a clean
   * bundle. Advisory only — they do not affect the verdict or the digest.
   */
  warnings: PlausibilityWarning[];

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
