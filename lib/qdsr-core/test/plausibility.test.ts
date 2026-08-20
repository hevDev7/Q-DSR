import { describe, expect, it } from 'vitest';

import { verify } from '../src/engine.js';
import { EvidenceValidationError } from '../src/errors.js';
import {
  assertHonestSearchSpace,
  checkReturnsPlausibility,
  distinctTrialColumns,
} from '../src/plausibility.js';
import { createRng } from '../src/prng.js';
import { bundleFromTrials, gaussian, signalTrials } from './fixtures.js';

/** A realistic daily return series: modest edge, ~1% vol, both signs. */
function realReturns(seed: number, n: number, drift = 0.0006): number[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => drift + 0.01 * gaussian(rng));
}

describe('intake plausibility — the genuine case passes untouched', () => {
  it('accepts a realistic strategy with no warnings', () => {
    const warnings = checkReturnsPlausibility(realReturns(1, 1000), 3.2, -0.1, 4.0);
    expect(warnings).toEqual([]);
  });

  it('certifies the signal fixture without tripping any hard check', () => {
    const { result } = verify(bundleFromTrials(signalTrials(2024, 512, 20), 0), {
      bootstrapIterations: 300,
    });
    expect(result.verdict).toBe('certified');
    expect(result.warnings).toEqual([]);
  });

  it('exposes a warnings array on every result', () => {
    const { result } = verify(bundleFromTrials(signalTrials(2024, 512, 20), 0), {
      bootstrapIterations: 300,
    });
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

describe('intake plausibility — not a return series', () => {
  const T = 300;

  it('rejects a flat series', () => {
    const flat = new Array<number>(T).fill(0.001);
    expect(() => checkReturnsPlausibility(flat, 0, 0, 3)).toThrow(/flat/);
  });

  it('rejects an equity/price level (mean far from zero)', () => {
    const levels = Array.from({ length: T }, (_, i) => 100 + i * 0.5);
    expect(() => checkReturnsPlausibility(levels, 50, 0, 3)).toThrow(EvidenceValidationError);
  });

  it('rejects percent-scaled returns with a unit hint', () => {
    // 2.5 instead of 0.025 — a real edge exported in percent.
    const pct = realReturns(2, T, 0.06).map((r) => r * 100);
    try {
      checkReturnsPlausibility(pct, 3.2, 0, 3);
      expect.unreachable('should reject');
    } catch (e) {
      expect((e as Error).message).toMatch(/PERCENT|divide by 100/);
    }
  });

  it('rejects basis-point-scaled returns with a unit hint', () => {
    const bps = realReturns(3, T, 0.06).map((r) => r * 10000);
    expect(() => checkReturnsPlausibility(bps, 3.2, 0, 3)).toThrow(/BASIS POINTS|divide by 10000/);
  });

  it('rejects a series with no losing periods over a year', () => {
    const winners = Array.from({ length: T }, (_, i) => 0.001 + 0.0001 * (i % 3));
    expect(() => checkReturnsPlausibility(winners, 4, 0, 3)).toThrow(/negative|losing period/);
  });

  it('rejects a running level by its serial correlation', () => {
    // An AR(1) with phi 0.95: near-zero mean, both signs, modest scale — it clears
    // the mean/scale/sign checks and is caught only by the autocorrelation test,
    // which is the point. (A naive cumulative sum has a large mean and is caught
    // earlier by the scale check; this isolates the serial-correlation path.)
    const rng = createRng(4);
    const ar: number[] = [];
    let x = 0;
    for (let i = 0; i < T; i++) {
      x = 0.95 * x + 0.003 * gaussian(rng);
      ar.push(x);
    }
    expect(() => checkReturnsPlausibility(ar, 2, 0, 3)).toThrow(/autocorrelation|running level/);
  });

  it('rejects a padded series with too few active periods', () => {
    const real = realReturns(5, 100, 0.002);
    const padded = [...real, ...new Array<number>(200).fill(0)];
    expect(() => checkReturnsPlausibility(padded, 3, 0, 3)).toThrow(/active/);
  });

  it('rejects a degenerate low-cardinality series', () => {
    const square = Array.from({ length: T }, (_, i) => (i % 2 === 0 ? 0.01 : -0.008));
    expect(() => checkReturnsPlausibility(square, 4, 0, 1)).toThrow(/distinct values/);
  });

  it('rejects an implausibly high Sharpe as a backstop', () => {
    // Passes scale and sign checks but the Sharpe is beyond reality.
    const smooth = realReturns(6, T, 0.008).map((r) => r); // drift 0.008, vol 0.01 => Sharpe ~12
    expect(() => checkReturnsPlausibility(smooth, 12.5, 0, 3)).toThrow(/physical plausibility|Sharpe/);
  });
});

describe('intake plausibility — advisory warnings, never rejection', () => {
  it('warns on a high but sub-wall Sharpe', () => {
    const w = checkReturnsPlausibility(realReturns(7, 1000), 7, 0, 3);
    expect(w.some((x) => x.code === 'sharpe-high')).toBe(true);
  });

  it('warns on heavy tails without rejecting (short-vol strategies are real)', () => {
    const w = checkReturnsPlausibility(realReturns(8, 1000), 3, -5, 45);
    expect(w.some((x) => x.code === 'skewed')).toBe(true);
    expect(w.some((x) => x.code === 'fat-tails')).toBe(true);
  });
});

describe('search-space forgery — the live hole', () => {
  it('rejects a winner copied across every column', () => {
    const winner = realReturns(9, 300, 0.002);
    const trials = winner.map((v) => new Array<number>(60).fill(v));
    expect(() => assertHonestSearchSpace(trials, 2)).toThrow(/distinct|duplicate/i);
  });

  it('rejects two identical columns at the minimum width', () => {
    const winner = realReturns(10, 300, 0.002);
    const trials = winner.map((v) => [v, v]);
    expect(() => assertHonestSearchSpace(trials, 2)).toThrow(EvidenceValidationError);
  });

  it('rejects positive scalings of one column (Sharpe is scale-invariant)', () => {
    const winner = realReturns(11, 300, 0.002);
    const trials = winner.map((v) => [v, v * 2, v * 0.5, v * 10]);
    expect(() => assertHonestSearchSpace(trials, 2)).toThrow(/distinct|duplicate/i);
  });

  it('rejects a constant filler column', () => {
    const winner = realReturns(12, 300, 0.002);
    const noise = realReturns(13, 300);
    const trials = winner.map((v, i) => [v, noise[i]!, 0.001]);
    expect(() => assertHonestSearchSpace(trials, 2)).toThrow(/constant/);
  });

  it('accepts a genuinely distinct search space', () => {
    const trials = signalTrials(2024, 300, 20);
    expect(() => assertHonestSearchSpace(trials, 2)).not.toThrow();
    const report = distinctTrialColumns(trials);
    expect(report.distinctCount).toBe(20);
    expect(report.constantColumns).toEqual([]);
  });

  it('certifies through the full engine only for a real search space, and rejects the forgery end to end', () => {
    const winner = realReturns(14, 300, 0.002);
    const forged = bundleFromTrials(winner.map((v) => new Array<number>(30).fill(v)), 0);
    expect(() => verify(forged, { bootstrapIterations: 300 })).toThrow(/distinct|duplicate/i);
  });
});
