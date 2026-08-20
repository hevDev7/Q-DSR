import { createRng, type Rng } from '../src/prng.js';
import type { EvidenceBundle } from '../src/types.js';

/** Box–Muller transform on our seeded generator — no Math.random anywhere. */
export function gaussian(rng: Rng): number {
  let u = rng.next();
  while (u === 0) u = rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function normalSeries(rng: Rng, length: number, mu = 0, sigma = 1): number[] {
  const out = new Array<number>(length);
  for (let i = 0; i < length; i++) out[i] = mu + sigma * gaussian(rng);
  return out;
}

/** A trials matrix where every configuration is pure noise — the null case. */
export function noiseTrials(seed: number, rows: number, columns: number): number[][] {
  const rng = createRng(seed);
  const matrix: number[][] = [];
  for (let t = 0; t < rows; t++) {
    const row = new Array<number>(columns);
    for (let n = 0; n < columns; n++) row[n] = 0.01 * gaussian(rng);
    matrix.push(row);
  }
  return matrix;
}

/**
 * A trials matrix where column 0 carries a genuine, persistent edge and the rest
 * are noise. The selection process here is informative, so PBO should be near zero.
 *
 * The default drift is deliberately modest: 0.002 against a 0.01 per-period vol is
 * an annualised Sharpe around 3.5–4, which is what a real edge looks like and what
 * the demo's genuine sample produces. An earlier 0.006 drift certified too, but at
 * an annualised Sharpe above 10 — beyond any real daily record and now correctly
 * rejected by the intake plausibility layer. A genuine fixture must pass that layer.
 */
export function signalTrials(
  seed: number,
  rows: number,
  columns: number,
  drift = 0.002,
): number[][] {
  const rng = createRng(seed);
  const matrix: number[][] = [];
  for (let t = 0; t < rows; t++) {
    const row = new Array<number>(columns);
    for (let n = 0; n < columns; n++) {
      row[n] = (n === 0 ? drift : 0) + 0.01 * gaussian(rng);
    }
    matrix.push(row);
  }
  return matrix;
}

export function isoTimestamps(count: number, startMs = Date.UTC(2024, 0, 1)): string[] {
  const dayMs = 86_400_000;
  return Array.from({ length: count }, (_, i) => new Date(startMs + i * dayMs).toISOString());
}

/** Builds a bundle whose selected series is exactly column `selected` of the matrix. */
export function bundleFromTrials(trials: number[][], selected = 0): EvidenceBundle {
  const returns = trials.map((row) => row[selected]!);
  return {
    manifest: {
      agentName: 'Test Agent',
      strategyFamily: 'unit-test',
      owner: 'test@qdsr',
      periodsPerYear: 252,
    },
    timestamps: isoTimestamps(trials.length),
    returns,
    trials,
  };
}
