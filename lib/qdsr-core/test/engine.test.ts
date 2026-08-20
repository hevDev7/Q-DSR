import { describe, expect, it } from 'vitest';

import { ENGINE_VERSION, EvidenceValidationError, verify } from '../src/engine.js';
import { bundleFromTrials, noiseTrials, signalTrials } from './fixtures.js';

const FAST = { bootstrapIterations: 500 } as const;

describe('verify — validation', () => {
  it('refuses a bundle without a trials matrix', () => {
    const bundle = bundleFromTrials(noiseTrials(1, 300, 5));
    bundle.trials = [];
    expect(() => verify(bundle, FAST)).toThrow(EvidenceValidationError);
    expect(() => verify(bundle, FAST)).toThrow(/parameter search space/);
  });

  it('refuses a track record shorter than one trading year', () => {
    const bundle = bundleFromTrials(noiseTrials(1, 200, 5));
    expect(() => verify(bundle, FAST)).toThrow(/at least 252 observations/);
  });

  it('refuses a single configuration, where selection bias is unmeasurable', () => {
    const trials = noiseTrials(1, 300, 1);
    const bundle = bundleFromTrials(trials);
    expect(() => verify(bundle, FAST)).toThrow(/at least 2 configurations/);
  });

  it('refuses a series that is not one of the declared configurations', () => {
    // Handing over a polished series that was never in the search space would make
    // the selection bias invisible — exactly what PBO exists to catch.
    const bundle = bundleFromTrials(noiseTrials(1, 300, 5));
    bundle.returns = bundle.returns.map((r) => r * 1.5);
    expect(() => verify(bundle, FAST)).toThrow(/must be one of the declared configurations/);
  });

  it('refuses mismatched timestamps', () => {
    const bundle = bundleFromTrials(noiseTrials(1, 300, 5));
    bundle.timestamps = bundle.timestamps.slice(0, 100);
    expect(() => verify(bundle, FAST)).toThrow(/same length/);
  });

  it('refuses non-finite returns', () => {
    const bundle = bundleFromTrials(noiseTrials(1, 300, 5));
    bundle.returns[10] = NaN;
    expect(() => verify(bundle, FAST)).toThrow(/non-finite return/);
  });

  it('names the offending field on the error', () => {
    const bundle = bundleFromTrials(noiseTrials(1, 200, 5));
    try {
      verify(bundle, FAST);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceValidationError);
      expect((error as EvidenceValidationError).field).toBe('returns');
    }
  });
});

describe('verify — verdicts', () => {
  it('rejects a strategy selected from pure noise', () => {
    const { result } = verify(bundleFromTrials(noiseTrials(2024, 512, 20)), FAST);
    expect(result.verdict).toBe('insignificant');
    expect(result.pbo).toBeGreaterThan(0.2);
  });

  it('certifies a strategy with a persistent, statistically significant edge', () => {
    const { result } = verify(bundleFromTrials(signalTrials(2024, 512, 20), 0), FAST);
    expect(result.verdict).toBe('certified');
    expect(result.dsr).toBeGreaterThanOrEqual(0.95);
    expect(result.pbo).toBeLessThanOrEqual(0.1);
  });

  it('reports every gate, passed or failed', () => {
    const { result } = verify(bundleFromTrials(noiseTrials(2024, 512, 20)), FAST);
    expect(result.gates.map((g) => g.gate)).toEqual([
      'deflated_sharpe_ratio',
      'probability_of_backtest_overfitting',
      'observations',
      'trials',
    ]);
    for (const g of result.gates) {
      expect(typeof g.passed).toBe('boolean');
      expect(Number.isFinite(g.observed)).toBe(true);
    }
  });

  it('honours custom thresholds', () => {
    const bundle = bundleFromTrials(noiseTrials(2024, 512, 20));
    const lenient = verify(bundle, { ...FAST, thresholds: { minDsr: 0, maxPbo: 1 } });
    expect(lenient.result.verdict).toBe('certified');
  });
});

describe('verify — reported metrics', () => {
  const { result, artifacts } = verify(bundleFromTrials(signalTrials(7, 512, 12), 0), FAST);

  it('stamps the engine version and seed', () => {
    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.seed).toBe(1);
  });

  it('reports DSR and PBO as probabilities', () => {
    expect(result.dsr).toBeGreaterThanOrEqual(0);
    expect(result.dsr).toBeLessThanOrEqual(1);
    expect(result.pbo).toBeGreaterThanOrEqual(0);
    expect(result.pbo).toBeLessThanOrEqual(1);
  });

  it('annualises the Sharpe ratio using the manifest calendar', () => {
    expect(result.sharpeAnnualised).toBeCloseTo(result.sharpe * Math.sqrt(252), 12);
  });

  it('returns the artifacts a third party needs to replicate the run', () => {
    expect(artifacts.bootstrapSamples).toHaveLength(500);
    expect(artifacts.cscvLogits).toHaveLength(result.cscv.combinations);
  });

  it('measures every phase it ran', () => {
    expect(result.timings.map((t) => t.phase)).toEqual([
      'validating',
      'fingerprinting',
      'cscv',
      'bootstrap',
      'sealing',
    ]);
    for (const timing of result.timings) {
      expect(timing.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(timing.label.length).toBeGreaterThan(0);
    }
    expect(result.elapsedMs).toBeGreaterThan(0);
  });

  it('reports phases through the callback as they complete', () => {
    const seen: string[] = [];
    verify(bundleFromTrials(signalTrials(7, 512, 12), 0), {
      ...FAST,
      onPhase: (timing) => seen.push(timing.phase),
    });
    expect(seen).toEqual(['validating', 'fingerprinting', 'cscv', 'bootstrap', 'sealing']);
  });

  it('produces a bracketing confidence interval', () => {
    const [lo, hi] = result.bootstrap.ci95;
    expect(lo).toBeLessThan(hi);
    expect(result.bootstrap.meanSharpe).toBeGreaterThan(lo);
    expect(result.bootstrap.meanSharpe).toBeLessThan(hi);
  });
});

describe('verify — reproducibility', () => {
  const bundle = bundleFromTrials(signalTrials(11, 512, 10), 0);

  it('produces an identical digest for an identical seed', () => {
    // This is the protocol's entire trust model: an auditor re-runs and compares.
    const a = verify(bundle, { ...FAST, seed: 12345 });
    const b = verify(bundle, { ...FAST, seed: 12345 });
    expect(a.result.digest).toBe(b.result.digest);

    // Timings are wall-clock measurements and are expected to differ; every
    // number the verdict depends on must not.
    const { timings: _ta, elapsedMs: _ea, ...numericA } = a.result;
    const { timings: _tb, elapsedMs: _eb, ...numericB } = b.result;
    expect(numericA).toEqual(numericB);
  });

  it('produces a different digest for a different seed', () => {
    const a = verify(bundle, { ...FAST, seed: 1 });
    const b = verify(bundle, { ...FAST, seed: 2 });
    expect(a.result.digest).not.toBe(b.result.digest);
  });

  it('keeps DSR and PBO independent of the seed — only the bootstrap is stochastic', () => {
    const a = verify(bundle, { ...FAST, seed: 1 });
    const b = verify(bundle, { ...FAST, seed: 999 });
    expect(a.result.dsr).toBe(b.result.dsr);
    expect(a.result.pbo).toBe(b.result.pbo);
  });

  it('stays stable across repeated runs', () => {
    const digests = new Set<string>();
    for (let i = 0; i < 20; i++) {
      digests.add(verify(bundle, { ...FAST, seed: 42 }).result.digest);
    }
    expect(digests.size).toBe(1);
  });
});
