import { describe, expect, it } from 'vitest';

import {
  annualise,
  kurtosis,
  mean,
  quantile,
  sharpeFromMoments,
  sharpeRatio,
  skewness,
  stdev,
  variance,
} from '../src/stats.js';

const sample = [2, 4, 4, 4, 5, 5, 7, 9];

describe('basic moments', () => {
  it('computes the mean', () => {
    expect(mean(sample)).toBe(5);
  });

  it('uses the sample variance (ddof = 1)', () => {
    // Population variance is 4; sample variance is 32/7.
    expect(variance(sample)).toBeCloseTo(32 / 7, 12);
    expect(stdev(sample)).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });

  it('reports zero skewness for a symmetric series', () => {
    expect(skewness([-2, -1, 0, 1, 2])).toBeCloseTo(0, 12);
  });

  it('reports non-excess kurtosis, so a flat symmetric series is below 3', () => {
    // Uniform-ish series has kurtosis < 3; the value is the population moment.
    expect(kurtosis([-2, -1, 0, 1, 2])).toBeCloseTo(1.7, 12);
  });

  it('rejects series too short for the moment being requested', () => {
    expect(() => variance([1])).toThrow(RangeError);
    expect(() => skewness([1, 2])).toThrow(RangeError);
    expect(() => kurtosis([1, 2, 3])).toThrow(RangeError);
  });
});

describe('sharpeRatio', () => {
  it('is mean over sample standard deviation', () => {
    expect(sharpeRatio(sample)).toBeCloseTo(5 / Math.sqrt(32 / 7), 12);
  });

  it('returns 0 for a zero-variance series rather than Infinity', () => {
    // A constant series must never win an argmax by producing Infinity.
    expect(sharpeRatio([3, 3, 3, 3])).toBe(0);
  });

  it('annualises by the square root of periods per year', () => {
    expect(annualise(0.1, 252)).toBeCloseTo(0.1 * Math.sqrt(252), 12);
  });
});

describe('sharpeFromMoments', () => {
  it('reproduces sharpeRatio exactly from sufficient statistics', () => {
    // This equivalence is what makes the CSCV optimisation valid.
    const xs = [0.01, -0.004, 0.021, 0.007, -0.011, 0.003, 0.014, -0.002];
    let sum = 0;
    let sumSq = 0;
    for (const x of xs) {
      sum += x;
      sumSq += x * x;
    }
    expect(sharpeFromMoments(sum, sumSq, xs.length)).toBeCloseTo(sharpeRatio(xs), 12);
  });

  it('returns 0 for degenerate input', () => {
    expect(sharpeFromMoments(0, 0, 1)).toBe(0);
    expect(sharpeFromMoments(12, 36, 4)).toBe(0); // all values identical → zero variance
  });
});

describe('quantile', () => {
  it('interpolates linearly between order statistics', () => {
    const xs = [1, 2, 3, 4, 5];
    expect(quantile(xs, 0)).toBe(1);
    expect(quantile(xs, 1)).toBe(5);
    expect(quantile(xs, 0.5)).toBe(3);
    expect(quantile(xs, 0.25)).toBe(2);
  });

  it('does not mutate its input', () => {
    const xs = [3, 1, 2];
    quantile(xs, 0.5);
    expect(xs).toEqual([3, 1, 2]);
  });
});
