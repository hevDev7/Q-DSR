import { describe, expect, it } from 'vitest';

import { createRng, seedFromString } from '../src/prng.js';

describe('createRng', () => {
  it('produces an identical stream for an identical seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const left = Array.from({ length: 1000 }, () => a.next());
    const right = Array.from({ length: 1000 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces a different stream for a different seed', () => {
    const a = createRng(42);
    const b = createRng(43);
    expect(a.next()).not.toBe(b.next());
  });

  it('stays inside [0,1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 100_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const rng = createRng(11);
    const buckets = new Array(10).fill(0);
    const draws = 200_000;
    for (let i = 0; i < draws; i++) buckets[Math.floor(rng.next() * 10)]!++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(draws / 10 - 2000);
      expect(count).toBeLessThan(draws / 10 + 2000);
    }
  });

  it('keeps nextInt inside [0,n)', () => {
    const rng = createRng(3);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.nextInt(17);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(17);
    }
  });
});

describe('seedFromString', () => {
  it('is stable and non-negative', () => {
    expect(seedFromString('cinder-delta')).toBe(seedFromString('cinder-delta'));
    expect(seedFromString('cinder-delta')).toBeGreaterThanOrEqual(0);
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });
});
