import { describe, expect, it } from 'vitest';

import { erf, normalCdf, normalInv, normalPdf } from '../src/normal.js';

describe('normalCdf', () => {
  // Reference values from the standard normal table, full double precision.
  const known: [number, number][] = [
    [0, 0.5],
    [1, 0.8413447460685429],
    [-1, 0.15865525393145705],
    [1.6448536269514722, 0.95],
    [1.959963984540054, 0.975],
    [2, 0.9772498680518208],
    [3, 0.9986501019683699],
    [-3, 0.0013498980316301035],
  ];

  it.each(known)('Φ(%f) = %f', (x, expected) => {
    expect(normalCdf(x)).toBeCloseTo(expected, 12);
  });

  it('stays accurate deep in the tail where a naive 1-erf would collapse', () => {
    // Φ(-8) ≈ 6.22e-16. Computing it as 1 - Φ(8) would round to exactly 0.
    expect(normalCdf(-8)).toBeGreaterThan(0);
    expect(normalCdf(-8)).toBeLessThan(1e-14);
  });

  it('handles infinities', () => {
    expect(normalCdf(Infinity)).toBe(1);
    expect(normalCdf(-Infinity)).toBe(0);
  });
});

describe('erf', () => {
  it('matches published values', () => {
    expect(erf(1)).toBeCloseTo(0.8427007929497149, 12);
    expect(erf(0.5)).toBeCloseTo(0.5204998778130465, 12);
    expect(erf(-1)).toBeCloseTo(-0.8427007929497149, 12);
    expect(erf(0)).toBe(0);
  });
});

describe('normalInv', () => {
  it.each([
    [0.5, 0],
    [0.95, 1.6448536269514722],
    [0.975, 1.959963984540054],
    [0.99, 2.3263478740408408],
    [0.025, -1.959963984540054],
  ])('Φ⁻¹(%f) = %f', (p, expected) => {
    expect(normalInv(p)).toBeCloseTo(expected, 10);
  });

  it('round-trips against normalCdf', () => {
    for (const p of [0.001, 0.01, 0.25, 0.5, 0.75, 0.99, 0.999]) {
      expect(normalCdf(normalInv(p))).toBeCloseTo(p, 12);
    }
  });

  it('rejects probabilities outside (0,1)', () => {
    expect(() => normalInv(-0.1)).toThrow(RangeError);
    expect(() => normalInv(1.1)).toThrow(RangeError);
  });
});

describe('normalPdf', () => {
  it('peaks at zero with the expected height', () => {
    expect(normalPdf(0)).toBeCloseTo(0.3989422804014327, 12);
  });
});
