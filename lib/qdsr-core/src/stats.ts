/**
 * Descriptive statistics used by the Q-DSR engine.
 *
 * Estimator conventions follow López de Prado's reference Python implementations,
 * because the published worked examples we validate against were produced with them:
 *
 *   - Sharpe ratio uses the *sample* standard deviation (ddof = 1)
 *   - Skewness and kurtosis use *population* (biased, ÷n) moments
 *   - Kurtosis is non-excess, so a normal distribution gives 3
 *
 * Mixing these conventions silently would shift DSR by enough to flip a verdict,
 * so they are stated here rather than left implicit.
 */

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new RangeError('mean: empty series');
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return s / xs.length;
}

/** Sample variance (ddof = 1). */
export function variance(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) throw new RangeError('variance: need at least 2 observations');
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i]! - m;
    s += d * d;
  }
  return s / (n - 1);
}

/** Sample standard deviation (ddof = 1). */
export function stdev(xs: readonly number[]): number {
  return Math.sqrt(variance(xs));
}

/** Population standard deviation (ddof = 0) — used to normalise higher moments. */
function stdevPopulation(xs: readonly number[]): number {
  const n = xs.length;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i]! - m;
    s += d * d;
  }
  return Math.sqrt(s / n);
}

/** Population skewness γ₃. */
export function skewness(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 3) throw new RangeError('skewness: need at least 3 observations');
  const m = mean(xs);
  const sd = stdevPopulation(xs);
  if (sd === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = (xs[i]! - m) / sd;
    s += d * d * d;
  }
  return s / n;
}

/** Population kurtosis γ₄, non-excess (normal = 3). */
export function kurtosis(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 4) throw new RangeError('kurtosis: need at least 4 observations');
  const m = mean(xs);
  const sd = stdevPopulation(xs);
  if (sd === 0) return 3;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = (xs[i]! - m) / sd;
    s += d * d * d * d;
  }
  return s / n;
}

/**
 * Per-period Sharpe ratio: mean / sample standard deviation.
 * Returns 0 for a degenerate (zero-variance) series rather than ±Infinity, so a
 * constant-return trial cannot win an argmax by accident.
 */
export function sharpeRatio(xs: readonly number[], riskFreeRate = 0): number {
  const sd = stdev(xs);
  if (!Number.isFinite(sd) || sd === 0) return 0;
  return (mean(xs) - riskFreeRate) / sd;
}

/** Annualises a per-period Sharpe ratio. */
export function annualise(sharpe: number, periodsPerYear: number): number {
  return sharpe * Math.sqrt(periodsPerYear);
}

/**
 * Sharpe ratio reconstructed from sufficient statistics.
 *
 * Sharpe depends on the series only through (Σx, Σx², n), and those are additive
 * across disjoint blocks. That algebraic fact is what makes CSCV tractable: it
 * turns each of the 12,870 splits from an O(T·N) pass into an O(S·N) aggregation.
 */
export function sharpeFromMoments(sum: number, sumSq: number, n: number): number {
  if (n < 2) return 0;
  const m = sum / n;
  const varianceNumerator = sumSq - n * m * m;
  if (varianceNumerator <= 0) return 0;
  const sd = Math.sqrt(varianceNumerator / (n - 1));
  if (!Number.isFinite(sd) || sd === 0) return 0;
  return m / sd;
}

/** Sorted copy — small helper so quantile callers cannot mutate their input. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) throw new RangeError('quantile: empty series');
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}
