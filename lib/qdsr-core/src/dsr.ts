/**
 * Deflated Sharpe Ratio.
 *
 * Bailey, D. H. & López de Prado, M. (2014),
 * "The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting
 *  and Non-Normality", Journal of Portfolio Management 40(5).
 *
 * The DSR answers: given that this strategy was selected as the best of N trials,
 * and given that its returns are skewed and fat-tailed, what is the probability
 * that its true Sharpe ratio is greater than zero?
 *
 * It is a PROBABILITY in [0,1], not a ratio. A significant strategy has a HIGH
 * DSR — the certification threshold is DSR ≥ 0.95, equivalent to p ≤ 0.05.
 */

import { normalCdf, normalInv } from './normal.js';
import { variance } from './stats.js';

/** Euler–Mascheroni constant γ. */
export const EULER_MASCHERONI = 0.5772156649015329;

/**
 * Expected maximum Sharpe ratio under the null hypothesis that every trial has a
 * true Sharpe of zero.
 *
 *   SR₀ = √V[SRₙ] · [ (1−γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]
 *
 * This is the selection-bias correction: the more configurations you tried, the
 * higher a Sharpe ratio you should expect from luck alone, and the higher the bar
 * your strategy must clear.
 *
 * @param trialSharpeVariance V[SRₙ] — variance of per-period Sharpe ratios across trials
 * @param trials N — number of independent configurations tested
 */
export function expectedMaxSharpe(trialSharpeVariance: number, trials: number): number {
  if (trials < 2) {
    throw new RangeError('expectedMaxSharpe: need at least 2 trials — DSR is undefined for a single trial');
  }
  if (trialSharpeVariance < 0) {
    throw new RangeError('expectedMaxSharpe: variance must be non-negative');
  }

  const g = EULER_MASCHERONI;
  const term1 = (1 - g) * normalInv(1 - 1 / trials);
  const term2 = g * normalInv(1 - 1 / (trials * Math.E));
  return Math.sqrt(trialSharpeVariance) * (term1 + term2);
}

/** Convenience wrapper: derive V[SRₙ] from the observed trial Sharpe ratios. */
export function expectedMaxSharpeFromTrials(trialSharpes: readonly number[]): number {
  return expectedMaxSharpe(variance(trialSharpes), trialSharpes.length);
}

export interface DeflatedSharpeInput {
  /** Observed per-period Sharpe ratio of the selected strategy. */
  sharpe: number;
  /** Benchmark SR₀ — the expected maximum under the null. */
  expectedMaxSharpe: number;
  /** Number of return observations T. */
  observations: number;
  /** Skewness γ₃ of the selected strategy's returns. */
  skewness: number;
  /** Kurtosis γ₄ (non-excess, normal = 3). */
  kurtosis: number;
}

/**
 * Deflated Sharpe Ratio.
 *
 *   DSR = Z[ (SR̂ − SR₀)·√(T−1) / √(1 − γ₃·SR̂ + ((γ₄−1)/4)·SR̂²) ]
 *
 * `sharpe` and `expectedMaxSharpe` must both be per-period. Feeding one annualised
 * and one not is the most likely way to get a wrong verdict, so both are validated
 * as finite and the denominator is checked for positivity.
 */
export function deflatedSharpeRatio(input: DeflatedSharpeInput): number {
  const { sharpe, expectedMaxSharpe: sr0, observations: T, skewness: g3, kurtosis: g4 } = input;

  if (!Number.isFinite(sharpe) || !Number.isFinite(sr0)) {
    throw new RangeError('deflatedSharpeRatio: sharpe and expectedMaxSharpe must be finite');
  }
  if (T < 2) {
    throw new RangeError('deflatedSharpeRatio: need at least 2 observations');
  }

  const denominatorSquared = 1 - g3 * sharpe + ((g4 - 1) / 4) * sharpe * sharpe;
  if (!(denominatorSquared > 0)) {
    // Extreme skew/kurtosis can push the variance estimate non-positive. The
    // honest answer is "not significant" rather than a NaN that reads as a pass.
    return 0;
  }

  const z = ((sharpe - sr0) * Math.sqrt(T - 1)) / Math.sqrt(denominatorSquared);
  return normalCdf(z);
}

/**
 * Minimum Track Record Length — how many observations would be needed for the
 * observed Sharpe to reach the target confidence. Reported alongside the verdict so
 * a rejected agent knows what it would take to pass, rather than only that it failed.
 */
export function minimumTrackRecordLength(
  input: Omit<DeflatedSharpeInput, 'observations'>,
  confidence = 0.95,
): number {
  const { sharpe, expectedMaxSharpe: sr0, skewness: g3, kurtosis: g4 } = input;
  if (sharpe <= sr0) return Infinity;
  const denominatorSquared = 1 - g3 * sharpe + ((g4 - 1) / 4) * sharpe * sharpe;
  if (!(denominatorSquared > 0)) return Infinity;
  const z = normalInv(confidence);
  return 1 + (denominatorSquared * z * z) / ((sharpe - sr0) * (sharpe - sr0));
}
