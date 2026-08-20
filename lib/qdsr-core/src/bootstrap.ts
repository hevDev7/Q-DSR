/**
 * Circular block bootstrap over a return series.
 *
 * Plain (i.i.d.) resampling would destroy the serial correlation that trading
 * returns almost always carry, producing confidence intervals that are far too
 * narrow. Resampling *blocks* of consecutive observations preserves short-range
 * dependence. The block wraps around the end of the series so every observation
 * has an equal chance of being drawn — otherwise the tails are under-sampled.
 *
 * The resulting distribution of Sharpe ratios is the artifact pushed to 0G Storage:
 * it is what a third party recomputes to check our verdict.
 */

import { createRng } from './prng.js';
import { quantile, sharpeRatio } from './stats.js';

export interface BootstrapOptions {
  /** Number of resamples. Default 10,000. */
  iterations?: number;
  /** Block length. Default ⌈T^(1/3)⌉, the standard rule of thumb. */
  blockSize?: number;
  /** Seed for the deterministic generator. */
  seed: number;
}

export interface BootstrapResult {
  iterations: number;
  blockSize: number;
  /** Sharpe ratio of each resample, in draw order. */
  samples: number[];
  meanSharpe: number;
  stdSharpe: number;
  /** 95% percentile confidence interval. */
  ci95: [number, number];
  /** Fraction of resamples with a positive Sharpe ratio. */
  probabilityPositive: number;
}

/** Default block length: ⌈T^(1/3)⌉. */
export function defaultBlockSize(observations: number): number {
  return Math.max(1, Math.ceil(Math.cbrt(observations)));
}

export function circularBlockBootstrap(
  returns: readonly number[],
  options: BootstrapOptions,
): BootstrapResult {
  const T = returns.length;
  if (T < 4) throw new RangeError('bootstrap: need at least 4 observations');

  const iterations = options.iterations ?? 10_000;
  const blockSize = options.blockSize ?? defaultBlockSize(T);

  if (iterations < 1) throw new RangeError('bootstrap: iterations must be positive');
  if (blockSize < 1 || blockSize > T) {
    throw new RangeError(`bootstrap: blockSize must be in [1, ${T}], got ${blockSize}`);
  }

  const rng = createRng(options.seed);
  const blocksNeeded = Math.ceil(T / blockSize);
  const resample = new Array<number>(T);
  const samples: number[] = new Array(iterations);

  for (let iter = 0; iter < iterations; iter++) {
    let filled = 0;
    for (let b = 0; b < blocksNeeded && filled < T; b++) {
      const start = rng.nextInt(T);
      for (let i = 0; i < blockSize && filled < T; i++) {
        resample[filled++] = returns[(start + i) % T]!;
      }
    }
    samples[iter] = sharpeRatio(resample);
  }

  let sum = 0;
  let positive = 0;
  for (let i = 0; i < iterations; i++) {
    sum += samples[i]!;
    if (samples[i]! > 0) positive++;
  }
  const meanSharpe = sum / iterations;

  let sq = 0;
  for (let i = 0; i < iterations; i++) {
    const d = samples[i]! - meanSharpe;
    sq += d * d;
  }
  const stdSharpe = iterations > 1 ? Math.sqrt(sq / (iterations - 1)) : 0;

  return {
    iterations,
    blockSize,
    samples,
    meanSharpe,
    stdSharpe,
    ci95: [quantile(samples, 0.025), quantile(samples, 0.975)],
    probabilityPositive: positive / iterations,
  };
}
