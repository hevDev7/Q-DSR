/**
 * Intake plausibility: does this upload look like a real trading return record?
 *
 * The structural validator already rejects non-CSV, non-numeric, too-short, and
 * ragged inputs. This layer sits on top and asks a harder question — the numbers
 * parse, but do they *behave* like daily trading returns, or is this a price
 * series, an equity curve, a spreadsheet of counts, or a series fabricated to
 * clear the gate?
 *
 * It was designed against a 49-attack adversarial sweep in which 25 wrong or
 * fabricated uploads were certified by the bare engine. Every threshold here is
 * placed outside the documented range of a genuine daily record, so an honest
 * strategy (Sharpe ~0.5–4, some losing periods, low serial correlation) passes
 * a hard check untouched. The softer signals warn rather than reject.
 *
 * What it proves and what it does not: it proves the upload is *shaped* like a
 * trading journal. It does not prove the trades happened — a determined forger
 * can still synthesise a series with realistic moments and a plausible Sharpe.
 * Closing that gap needs provenance from outside the CSV (broker attestation,
 * signed fills), not statistics.
 */

import { EvidenceValidationError } from './errors.js';
import { annualise, kurtosis, mean, quantile, skewness, stdev } from './stats.js';
import type { PlausibilityThresholds, PlausibilityWarning } from './types.js';

export type { PlausibilityThresholds } from './types.js';

/**
 * Defaults, each bounded against genuine trading data — the number in parentheses
 * is the worst legitimate case the bound was set to clear.
 */
export const PLAUSIBILITY_DEFAULTS: PlausibilityThresholds = {
  // Elite HFT sustains annualised Sharpe 8–12; nothing a CSV-journal user in this
  // product's audience can honestly produce reaches 10. Every certified attack in
  // this class measured 12.5 or above.
  maxAnnualisedSharpe: 10,
  warnAnnualisedSharpe: 5,
  // A 2%/day mean compounds to ~150x/yr. Real daily strategies sit under 0.5%.
  maxAbsMeanReturn: 0.02,
  // p95 of |return|, not max, so up to 5% of days may exceed 0.5 (leveraged crypto
  // perp records have p95 ~ 0.05–0.15). Prices/levels/sales all blow past this.
  maxP95AbsReturn: 0.5,
  // Three-plus orders below any tradable-instrument daily vol (sd ~ 1e-3 upward).
  minStdReturn: 1e-6,
  // Liquid daily strategy |rho1| < ~0.25; smoothed illiquid NAV reaches ~0.7. A
  // running level (prices, equity, cumulative) sits at ~0.99.
  maxLag1Autocorr: 0.9,
  warnLag1Autocorr: 0.4,
  // Half the 252-observation floor must be real activity, not zero-padding.
  minActivePeriods: 126,
  warnZeroFraction: 0.3,
  // Real P&L varies continuously; square waves and Likert scales take a handful.
  maxRejectDistinctValues: 5,
  // Standardised correlation. Distinct configs of one strategy land at 0.7–0.99;
  // only true copies and pure scalings reach 0.9999.
  duplicateColumnCorrelation: 0.9999,
  maxDuplicateColumnFraction: 0.2,
  // Warn-only band, set above the genuine range: short-vol books run skew to ~-5,
  // kurtosis 20–50, hit-rates 85–95%. Rejecting those would burn real users.
  warnAbsSkewness: 4,
  warnKurtosis: 30,
  warnHitRate: 0.9,
  warnMinNegativeFraction: 0.1,
};

function resolve(overrides?: Partial<PlausibilityThresholds>): PlausibilityThresholds {
  return { ...PLAUSIBILITY_DEFAULTS, ...overrides };
}

/** Lag-1 autocorrelation of a series. Betrays a running level fed as returns. */
function lag1Autocorrelation(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i]! - m;
    den += d * d;
    if (i > 0) num += (xs[i - 1]! - m) * d;
  }
  if (den === 0) return 0;
  return num / den;
}

/** A unit hint for a series whose magnitudes are too large to be returns. */
function scaleHint(p95Abs: number): string {
  if (p95Abs <= 50) return 'values look like PERCENT — divide by 100 (use 0.025, not 2.5) and re-upload';
  if (p95Abs <= 5000) return 'values look like BASIS POINTS — divide by 10000 and re-upload';
  return 'values are levels (prices or account balances), not returns — submit period-over-period changes';
}

/**
 * Checks the selected return series and returns any warnings; throws
 * `EvidenceValidationError` on a hard reject.
 *
 * Ordered so the most actionable message wins: a mis-scaled or wrong-file upload
 * is told exactly what to fix before the generic Sharpe-ceiling backstop fires.
 *
 * `sharpeAnnualised`, `skew` and `kurt` are passed in because the engine has
 * already computed them; recomputing would be wasteful and could drift.
 */
export function checkReturnsPlausibility(
  returns: readonly number[],
  sharpeAnnualised: number,
  skew: number,
  kurt: number,
  overrides?: Partial<PlausibilityThresholds>,
): PlausibilityWarning[] {
  const t = resolve(overrides);
  const T = returns.length;
  const warnings: PlausibilityWarning[] = [];

  const m = mean(returns);
  const sd = stdev(returns);
  const absReturns = returns.map((r) => Math.abs(r));
  const p95Abs = quantile(absReturns, 0.95);
  const negFraction = returns.filter((r) => r < 0).length / T;
  const nonZero = returns.filter((r) => r !== 0).length;
  const distinct = new Set(returns).size;

  // 1. Flat series — degenerate, and the source of the astronomical-Sharpe blow-up.
  if (sd < t.minStdReturn) {
    throw new EvidenceValidationError(
      'returns',
      `the return series is flat (standard deviation ${sd.toExponential(2)} per period) — ` +
        'a real trading record varies from period to period',
    );
  }

  // 2. Wrong scale / not returns: mean far from zero (a drift no return sustains).
  if (Math.abs(m) > t.maxAbsMeanReturn) {
    throw new EvidenceValidationError(
      'returns',
      `mean per-period value ${m.toPrecision(4)} is far too large for a return ` +
        `(a real daily strategy averages under ${t.maxAbsMeanReturn}) — ${scaleHint(p95Abs)}`,
    );
  }

  // 3. Wrong scale by tail magnitude: 95% of |returns| should be modest fractions.
  if (p95Abs > t.maxP95AbsReturn) {
    throw new EvidenceValidationError(
      'returns',
      `95% of |returns| reach ${p95Abs.toPrecision(4)}, beyond what per-period ` +
        `returns can be — ${scaleHint(p95Abs)}`,
    );
  }

  // 4. No losing periods across a full year — not a return series.
  if (negFraction === 0 && T >= 252) {
    throw new EvidenceValidationError(
      'returns',
      `not one of ${T} periods is negative — a year of trading without a single ` +
        'losing period is a level series (prices or equity), not returns',
    );
  }

  // 5. A running level: successive values move together.
  const rho1 = lag1Autocorrelation(returns);
  if (rho1 > t.maxLag1Autocorr) {
    throw new EvidenceValidationError(
      'returns',
      `lag-1 autocorrelation ${rho1.toPrecision(3)} means each value tracks the ` +
        'previous one — this is a running level (prices, equity, or cumulative ' +
        'returns), not period returns; submit the period-over-period changes',
    );
  }

  // 6. Padding: the observation floor must be real activity, not zeros.
  if (nonZero < t.minActivePeriods) {
    throw new EvidenceValidationError(
      'returns',
      `only ${nonZero} of ${T} periods are active (non-zero) — the ` +
        'observation minimum must be met by real observations; aggregate to the ' +
        'frequency you actually trade and resubmit',
    );
  }

  // 7. Degenerate cardinality: continuous P&L does not take a handful of values.
  if (distinct <= t.maxRejectDistinctValues && T >= 252) {
    throw new EvidenceValidationError(
      'returns',
      `the series takes only ${distinct} distinct values across ${T} periods — ` +
        'real trading P&L varies continuously',
    );
  }

  // 8. Backstop: an annualised Sharpe no daily record reaches.
  if (sharpeAnnualised > t.maxAnnualisedSharpe) {
    throw new EvidenceValidationError(
      'returns',
      `annualised Sharpe ${sharpeAnnualised.toPrecision(4)} is outside physical ` +
        'plausibility for a daily trading record — this usually means the file ' +
        'holds prices or levels rather than returns',
    );
  }

  // --- Warnings: accepted, but a human should see these -----------------------
  if (sharpeAnnualised > t.warnAnnualisedSharpe) {
    warnings.push({
      code: 'sharpe-high',
      message: `annualised Sharpe ${sharpeAnnualised.toPrecision(3)} is very high — verify the record`,
      value: sharpeAnnualised,
    });
  }
  if (Math.abs(rho1) > t.warnLag1Autocorr) {
    warnings.push({
      code: 'serial-correlation',
      message: `serial correlation ${rho1.toPrecision(3)} is unusual for liquid daily returns; Sharpe may be overstated`,
      value: rho1,
    });
  }
  if (negFraction < t.warnMinNegativeFraction) {
    warnings.push({
      code: 'few-losses',
      message: `only ${(negFraction * 100).toFixed(1)}% of periods are losses — implausibly consistent`,
      value: negFraction,
    });
  }
  const zeroFraction = 1 - nonZero / T;
  if (zeroFraction > t.warnZeroFraction) {
    warnings.push({
      code: 'sparse',
      message: `${(zeroFraction * 100).toFixed(0)}% of periods are exactly zero — consider a coarser frequency`,
      value: zeroFraction,
    });
  }
  if (Math.abs(skew) > t.warnAbsSkewness) {
    warnings.push({
      code: 'skewed',
      message: `skewness ${skew.toPrecision(3)} indicates a heavily asymmetric payoff`,
      value: skew,
    });
  }
  if (kurt > t.warnKurtosis) {
    warnings.push({
      code: 'fat-tails',
      message: `kurtosis ${kurt.toPrecision(3)} indicates extreme tail risk`,
      value: kurt,
    });
  }
  const hitRate = nonZero > 0 ? returns.filter((r) => r > 0).length / nonZero : 0;
  if (hitRate > t.warnHitRate && T >= 252) {
    warnings.push({
      code: 'high-hit-rate',
      message: `${(hitRate * 100).toFixed(0)}% of active periods are positive — unusually consistent`,
      value: hitRate,
    });
  }

  return warnings;
}

interface TrialColumnReport {
  /** Configurations that carry genuinely distinct information. */
  distinctCount: number;
  /** Indices of columns that are constant (zero variance) — pure filler. */
  constantColumns: number[];
  /** Fraction of declared columns that duplicate an earlier one. */
  duplicateFraction: number;
}

/**
 * Analyses the declared search space for forgery by duplication.
 *
 * PBO and the DSR selection penalty both depend on there being a *spread* of
 * outcomes across the configurations that were tried. Declaring N copies of one
 * survivor collapses that spread to zero: `expectedMaxSharpe` falls to ~0 so the
 * DSR is never deflated, and every CSCV split ties so PBO is 0. The result is a
 * certified verdict for a series that proved no edge — the single most damaging
 * hole the sweep found.
 *
 * Columns are standardised (so pure scalings, which Sharpe ignores, are caught
 * too) and compared pairwise; a correlation at or above the threshold means the
 * same configuration.
 */
export function distinctTrialColumns(
  trials: readonly (readonly number[])[],
  overrides?: Partial<PlausibilityThresholds>,
): TrialColumnReport {
  const t = resolve(overrides);
  const T = trials.length;
  const N = trials[0]!.length;

  // Standardise each column; a constant column cannot be standardised and is filler.
  const standardised: (Float64Array | null)[] = [];
  const constantColumns: number[] = [];
  for (let n = 0; n < N; n++) {
    let sum = 0;
    for (let i = 0; i < T; i++) sum += trials[i]![n]!;
    const mu = sum / T;
    let ss = 0;
    for (let i = 0; i < T; i++) {
      const d = trials[i]![n]! - mu;
      ss += d * d;
    }
    const sdPop = Math.sqrt(ss / T);
    if (sdPop <= 1e-12 * Math.abs(mu) + 1e-15) {
      constantColumns.push(n);
      standardised.push(null);
      continue;
    }
    const z = new Float64Array(T);
    for (let i = 0; i < T; i++) z[i] = (trials[i]![n]! - mu) / sdPop;
    standardised.push(z);
  }

  // Union–Find over non-constant columns joined by |corr| >= threshold.
  const parent = Array.from({ length: N }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let a = 0; a < N; a++) {
    const za = standardised[a];
    if (!za) continue;
    for (let b = a + 1; b < N; b++) {
      const zb = standardised[b];
      if (!zb) continue;
      let dot = 0;
      for (let i = 0; i < T; i++) dot += za[i]! * zb[i]!;
      if (Math.abs(dot / T) >= t.duplicateColumnCorrelation) union(a, b);
    }
  }

  const roots = new Set<number>();
  for (let n = 0; n < N; n++) {
    if (standardised[n]) roots.add(find(n));
  }
  const distinctCount = roots.size;
  const duplicateFraction = N > 0 ? (N - constantColumns.length - distinctCount) / N : 0;

  return { distinctCount, constantColumns, duplicateFraction };
}

/**
 * Hard-rejects a forged or degenerate search space. Called from the structural
 * validator, before any statistic is computed.
 */
export function assertHonestSearchSpace(
  trials: readonly (readonly number[])[],
  minTrials: number,
  overrides?: Partial<PlausibilityThresholds>,
): void {
  const t = resolve(overrides);
  const N = trials[0]!.length;
  const report = distinctTrialColumns(trials, overrides);

  if (report.constantColumns.length > 0) {
    const shown = report.constantColumns.slice(0, 5).join(', ');
    throw new EvidenceValidationError(
      'trials',
      `trials columns [${shown}] are constant — a configuration that never varies ` +
        'carries no information and cannot be part of a real search space',
    );
  }

  if (report.distinctCount < minTrials) {
    throw new EvidenceValidationError(
      'trials',
      `trials.csv declares ${N} configurations but only ${report.distinctCount} ` +
        `is genuinely distinct — the rest are duplicates or scalings. PBO and the ` +
        'selection penalty need configurations that actually differ; declare the ' +
        'real search space (change the signal, not just the position size)',
    );
  }

  if (report.duplicateFraction > t.maxDuplicateColumnFraction) {
    throw new EvidenceValidationError(
      'trials',
      `${(report.duplicateFraction * 100).toFixed(0)}% of the ${N} declared ` +
        'configurations duplicate another — a search space padded with copies ' +
        'defeats the overfitting test; declare only genuinely distinct configurations',
    );
  }
}
