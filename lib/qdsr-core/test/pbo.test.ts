import { describe, expect, it } from 'vitest';

import { combinations, probabilityOfBacktestOverfitting } from '../src/pbo.js';
import { noiseTrials, signalTrials } from './fixtures.js';

describe('combinations', () => {
  it('enumerates C(4,2) in lexicographic order', () => {
    expect(combinations(4, 2)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });

  it('produces the 12,870 symmetric splits the paper uses at S = 16', () => {
    expect(combinations(16, 8)).toHaveLength(12_870);
  });
});

describe('probabilityOfBacktestOverfitting', () => {
  it('lands near 0.5 when every configuration is pure noise', () => {
    // The null case: selecting the in-sample winner carries no information, so it
    // falls below the out-of-sample median about half the time.
    const result = probabilityOfBacktestOverfitting(noiseTrials(2024, 512, 20));
    expect(result.pbo).toBeGreaterThan(0.3);
    expect(result.pbo).toBeLessThan(0.7);
  });

  it('collapses toward 0 when one configuration carries a genuine edge', () => {
    const result = probabilityOfBacktestOverfitting(signalTrials(2024, 512, 20));
    expect(result.pbo).toBeLessThan(0.05);
  });

  it('reports the split geometry it used', () => {
    const result = probabilityOfBacktestOverfitting(noiseTrials(7, 512, 10), { splits: 16 });
    expect(result.splits).toBe(16);
    expect(result.combinations).toBe(12_870);
    expect(result.logits).toHaveLength(12_870);
    expect(result.droppedRows).toBe(0);
  });

  it('drops the remainder when T is not divisible by S', () => {
    const result = probabilityOfBacktestOverfitting(noiseTrials(7, 517, 10), { splits: 16 });
    expect(result.droppedRows).toBe(5);
  });

  it('is deterministic', () => {
    const trials = noiseTrials(99, 512, 12);
    const a = probabilityOfBacktestOverfitting(trials);
    const b = probabilityOfBacktestOverfitting(trials);
    expect(a.pbo).toBe(b.pbo);
  });

  it('rejects an odd number of splits', () => {
    expect(() => probabilityOfBacktestOverfitting(noiseTrials(1, 512, 5), { splits: 15 })).toThrow(
      /even/,
    );
  });

  it('rejects a single configuration', () => {
    expect(() => probabilityOfBacktestOverfitting(noiseTrials(1, 512, 1))).toThrow(
      /at least 2 configurations/,
    );
  });

  it('rejects a window too short for the requested splits', () => {
    expect(() => probabilityOfBacktestOverfitting(noiseTrials(1, 20, 5), { splits: 16 })).toThrow(
      /observations/,
    );
  });

  it('rejects a ragged matrix', () => {
    const trials = noiseTrials(1, 512, 5);
    trials[100] = [0.1, 0.2];
    expect(() => probabilityOfBacktestOverfitting(trials)).toThrow(/ragged/);
  });
});
