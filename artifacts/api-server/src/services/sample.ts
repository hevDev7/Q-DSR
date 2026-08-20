import { createRng } from '@workspace/qdsr-core';

import { toCsv } from '../lib/csv.js';

export type SampleKind = 'overfit' | 'genuine';

export interface SampleEvidence {
  kind: SampleKind;
  returnsCsv: string;
  trialsCsv: string;
  selectedColumn: string;
  observations: number;
  trials: number;
  seed: number;
}

interface Rng {
  next(): number;
}

/** Box–Muller on a seeded generator, so a sample is reproducible from its seed. */
function gaussian(rng: Rng): number {
  let u = rng.next();
  while (u === 0) u = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

function isoDay(index: number): string {
  const start = Date.UTC(2023, 0, 2);
  return new Date(start + index * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Builds a synthetic evidence bundle.
 *
 * `overfit` is the case the protocol exists to catch: every configuration is pure
 * noise, and the "winner" is whichever one got lucky. Its backtest looks good and
 * means nothing.
 *
 * `genuine` gives one configuration a small, persistent edge — realistic rather
 * than spectacular, so the certified example is not a strawman.
 */
export function generateSampleEvidence(options: {
  kind: SampleKind;
  observations?: number;
  trials?: number;
  seed?: number;
}): SampleEvidence {
  const observations = Math.max(252, Math.floor(options.observations ?? 756));
  const trials = Math.max(2, Math.floor(options.trials ?? 60));
  const seed = options.seed ?? 20260820;

  const rng = createRng(seed);
  const volatility = 0.011;
  // Calibrated, not guessed. At this drift the genuine sample clears DSR >= 0.95 and
  // PBO <= 0.10 across the sizes the API exposes, while a smaller edge (~1.7
  // annualised Sharpe) is correctly rejected as unprovable at 60 trials. The
  // contrast that matters is the other direction: the overfit sample, built from
  // pure noise, still reports roughly 1.3 annualised Sharpe.
  const drift = options.kind === 'genuine' ? 0.0018 : 0;

  const matrix: number[][] = [];
  for (let t = 0; t < observations; t++) {
    const row = new Array<number>(trials);
    for (let n = 0; n < trials; n++) {
      row[n] = (n === 0 ? drift : 0) + volatility * gaussian(rng);
    }
    matrix.push(row);
  }

  // The submitted series is whichever configuration a naive optimiser would pick:
  // the one with the best in-sample Sharpe ratio.
  let selected = 0;
  let bestSharpe = -Infinity;
  for (let n = 0; n < trials; n++) {
    let sum = 0;
    let sumSq = 0;
    for (let t = 0; t < observations; t++) {
      sum += matrix[t]![n]!;
      sumSq += matrix[t]![n]! * matrix[t]![n]!;
    }
    const mean = sum / observations;
    const sd = Math.sqrt((sumSq - observations * mean * mean) / (observations - 1));
    const sharpe = sd > 0 ? mean / sd : 0;
    if (sharpe > bestSharpe) {
      bestSharpe = sharpe;
      selected = n;
    }
  }

  const columns = Array.from({ length: trials }, (_, n) => `cfg_${String(n + 1).padStart(3, '0')}`);
  const selectedColumn = columns[selected]!;

  const returnsCsv = toCsv(
    ['timestamp', selectedColumn],
    matrix.map((row, t) => [isoDay(t), row[selected]!.toFixed(8)]),
  );

  const trialsCsv = toCsv(
    ['timestamp', ...columns],
    matrix.map((row, t) => [isoDay(t), ...row.map((v) => v.toFixed(8))]),
  );

  return { kind: options.kind, returnsCsv, trialsCsv, selectedColumn, observations, trials, seed };
}
