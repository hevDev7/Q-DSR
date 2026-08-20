import { describe, expect, it } from 'vitest';

import {
  EULER_MASCHERONI,
  deflatedSharpeRatio,
  expectedMaxSharpe,
  expectedMaxSharpeFromTrials,
  minimumTrackRecordLength,
} from '../src/dsr.js';

const base = {
  sharpe: 0.1,
  expectedMaxSharpe: 0.05,
  observations: 504,
  skewness: 0,
  kurtosis: 3,
};

describe('EULER_MASCHERONI', () => {
  it('is the constant the correction depends on', () => {
    expect(EULER_MASCHERONI).toBeCloseTo(0.5772156649015329, 15);
  });
});

describe('expectedMaxSharpe', () => {
  it('grows with the number of trials — more searching, higher bar', () => {
    const few = expectedMaxSharpe(1, 5);
    const many = expectedMaxSharpe(1, 500);
    expect(many).toBeGreaterThan(few);
  });

  it('scales with the spread of trial Sharpe ratios', () => {
    expect(expectedMaxSharpe(4, 20)).toBeCloseTo(2 * expectedMaxSharpe(1, 20), 12);
  });

  it('is zero when every trial produced the same Sharpe ratio', () => {
    expect(expectedMaxSharpe(0, 20)).toBe(0);
  });

  it('refuses a single trial, where the correction is undefined', () => {
    expect(() => expectedMaxSharpe(1, 1)).toThrow(RangeError);
  });

  it('rejects a negative variance', () => {
    expect(() => expectedMaxSharpe(-1, 10)).toThrow(RangeError);
  });

  it('derives the variance from the trial Sharpe ratios', () => {
    const sharpes = [0.1, 0.2, 0.3, 0.15, 0.05];
    expect(expectedMaxSharpeFromTrials(sharpes)).toBeGreaterThan(0);
  });
});

describe('deflatedSharpeRatio', () => {
  it('is a probability', () => {
    const dsr = deflatedSharpeRatio(base);
    expect(dsr).toBeGreaterThanOrEqual(0);
    expect(dsr).toBeLessThanOrEqual(1);
  });

  it('is exactly 0.5 when the observed Sharpe equals the null benchmark', () => {
    expect(deflatedSharpeRatio({ ...base, sharpe: 0.05, expectedMaxSharpe: 0.05 })).toBeCloseTo(0.5, 12);
  });

  it('rises with the observed Sharpe ratio', () => {
    const low = deflatedSharpeRatio({ ...base, sharpe: 0.06 });
    const high = deflatedSharpeRatio({ ...base, sharpe: 0.14 });
    expect(high).toBeGreaterThan(low);
  });

  it('falls as the null benchmark rises — the selection-bias penalty', () => {
    const lenient = deflatedSharpeRatio({ ...base, expectedMaxSharpe: 0.02 });
    const strict = deflatedSharpeRatio({ ...base, expectedMaxSharpe: 0.09 });
    expect(strict).toBeLessThan(lenient);
  });

  it('penalises negative skew', () => {
    const symmetric = deflatedSharpeRatio(base);
    const leftTailed = deflatedSharpeRatio({ ...base, skewness: -1.5 });
    expect(leftTailed).toBeLessThan(symmetric);
  });

  it('penalises fat tails', () => {
    const normalTails = deflatedSharpeRatio(base);
    const fatTails = deflatedSharpeRatio({ ...base, kurtosis: 12 });
    expect(fatTails).toBeLessThan(normalTails);
  });

  it('rises with a longer track record', () => {
    const short = deflatedSharpeRatio({ ...base, observations: 260 });
    const long = deflatedSharpeRatio({ ...base, observations: 2600 });
    expect(long).toBeGreaterThan(short);
  });

  it('returns 0 rather than NaN when the variance estimate degenerates', () => {
    // Extreme skew can drive the denominator non-positive; "not significant" is
    // the honest answer, and a NaN would read as a pass downstream.
    const dsr = deflatedSharpeRatio({ ...base, sharpe: 3, skewness: 5, kurtosis: 1 });
    expect(dsr).toBe(0);
  });

  it('rejects non-finite inputs', () => {
    expect(() => deflatedSharpeRatio({ ...base, sharpe: NaN })).toThrow(RangeError);
    expect(() => deflatedSharpeRatio({ ...base, observations: 1 })).toThrow(RangeError);
  });
});

describe('minimumTrackRecordLength', () => {
  it('is finite and positive for a strategy that beats the benchmark', () => {
    const mtrl = minimumTrackRecordLength({
      sharpe: 0.1,
      expectedMaxSharpe: 0.05,
      skewness: 0,
      kurtosis: 3,
    });
    expect(Number.isFinite(mtrl)).toBe(true);
    expect(mtrl).toBeGreaterThan(1);
  });

  it('is infinite when the Sharpe ratio never clears the benchmark', () => {
    const mtrl = minimumTrackRecordLength({
      sharpe: 0.02,
      expectedMaxSharpe: 0.05,
      skewness: 0,
      kurtosis: 3,
    });
    expect(mtrl).toBe(Infinity);
  });

  it('shortens as the edge widens', () => {
    const narrow = minimumTrackRecordLength({ sharpe: 0.06, expectedMaxSharpe: 0.05, skewness: 0, kurtosis: 3 });
    const wide = minimumTrackRecordLength({ sharpe: 0.2, expectedMaxSharpe: 0.05, skewness: 0, kurtosis: 3 });
    expect(wide).toBeLessThan(narrow);
  });
});
