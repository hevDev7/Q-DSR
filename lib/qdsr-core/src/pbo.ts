/**
 * Probability of Backtest Overfitting, via Combinatorially Symmetric
 * Cross-Validation (CSCV).
 *
 * Bailey, D. H., Borwein, J., López de Prado, M. & Zhu, Q. J. (2014),
 * "The Probability of Backtest Overfitting", Journal of Computational Finance.
 *
 * The question CSCV answers: when you pick the best-performing configuration on
 * one half of your data, how often does it land in the *bottom* half of the
 * ranking on the other half? If that happens about 50% of the time, your selection
 * process carries no information and you have been fitting noise.
 *
 * PBO ≈ 0.5 means pure overfitting. PBO near 0 means the selection generalises.
 */

import { sharpeFromMoments } from './stats.js';

export interface PboOptions {
  /**
   * S — number of disjoint submatrices the observation window is split into.
   * Must be even. S = 16 gives C(16,8) = 12,870 symmetric splits, which is the
   * value used in the original paper.
   */
  splits?: number;
}

export interface PboResult {
  /** Probability of backtest overfitting, in [0,1]. */
  pbo: number;
  /** Number of symmetric splits evaluated — C(S, S/2). */
  combinations: number;
  /** S actually used. */
  splits: number;
  /** Logit of the out-of-sample relative rank for each split. */
  logits: number[];
  /** Rows dropped because T was not divisible by S. */
  droppedRows: number;
}

/** Enumerates every subset of size k from {0..n-1}, in lexicographic order. */
export function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const current = new Array<number>(k);

  const recurse = (start: number, depth: number): void => {
    if (depth === k) {
      out.push([...current]);
      return;
    }
    // Prune branches that cannot be completed.
    for (let i = start; i <= n - (k - depth); i++) {
      current[depth] = i;
      recurse(i + 1, depth + 1);
    }
  };

  recurse(0, 0);
  return out;
}

/**
 * Computes PBO for a trials matrix.
 *
 * @param trials T × N matrix — `trials[t][n]` is the return of configuration `n`
 *               in period `t`. Every configuration explored during optimisation
 *               must be present; a matrix containing only the winner makes PBO
 *               meaningless.
 */
export function probabilityOfBacktestOverfitting(
  trials: readonly (readonly number[])[],
  options: PboOptions = {},
): PboResult {
  const splits = options.splits ?? 16;

  if (splits % 2 !== 0) throw new RangeError('pbo: splits (S) must be even');
  if (splits < 4) throw new RangeError('pbo: splits (S) must be at least 4');

  const totalRows = trials.length;
  if (totalRows === 0) throw new RangeError('pbo: empty trials matrix');

  const strategies = trials[0]!.length;
  if (strategies < 2) throw new RangeError('pbo: need at least 2 configurations');

  const rowsPerSplit = Math.floor(totalRows / splits);
  if (rowsPerSplit < 2) {
    throw new RangeError(
      `pbo: need at least ${splits * 2} observations for S=${splits}, got ${totalRows}`,
    );
  }
  const usedRows = rowsPerSplit * splits;

  // Per-(submatrix, strategy) sufficient statistics. Sharpe over any union of
  // submatrices is reconstructed from these, so each split costs O(S·N) instead
  // of O(T·N) — the difference between ~20M and ~640M operations at T=1000, N=100.
  const sums: Float64Array[] = [];
  const sumSquares: Float64Array[] = [];

  for (let s = 0; s < splits; s++) {
    const sum = new Float64Array(strategies);
    const sumSq = new Float64Array(strategies);
    const from = s * rowsPerSplit;
    const to = from + rowsPerSplit;
    for (let t = from; t < to; t++) {
      const row = trials[t]!;
      if (row.length !== strategies) {
        throw new RangeError(`pbo: ragged trials matrix at row ${t}`);
      }
      for (let n = 0; n < strategies; n++) {
        const v = row[n]!;
        sum[n]! += v;
        sumSq[n]! += v * v;
      }
    }
    sums.push(sum);
    sumSquares.push(sumSq);
  }

  const totalSum = new Float64Array(strategies);
  const totalSumSq = new Float64Array(strategies);
  for (let s = 0; s < splits; s++) {
    for (let n = 0; n < strategies; n++) {
      totalSum[n]! += sums[s]![n]!;
      totalSumSq[n]! += sumSquares[s]![n]!;
    }
  }

  const half = splits / 2;
  const splitSets = combinations(splits, half);
  const observationsPerHalf = half * rowsPerSplit;

  const logits: number[] = [];
  const inSampleSum = new Float64Array(strategies);
  const inSampleSumSq = new Float64Array(strategies);

  let overfitCount = 0;

  for (const chosen of splitSets) {
    inSampleSum.fill(0);
    inSampleSumSq.fill(0);

    for (const s of chosen) {
      const sum = sums[s]!;
      const sumSq = sumSquares[s]!;
      for (let n = 0; n < strategies; n++) {
        inSampleSum[n]! += sum[n]!;
        inSampleSumSq[n]! += sumSq[n]!;
      }
    }

    // Best configuration in sample.
    let best = 0;
    let bestSharpe = -Infinity;
    for (let n = 0; n < strategies; n++) {
      const sr = sharpeFromMoments(inSampleSum[n]!, inSampleSumSq[n]!, observationsPerHalf);
      if (sr > bestSharpe) {
        bestSharpe = sr;
        best = n;
      }
    }

    // Out of sample is the complement — obtained by subtraction, which halves the work.
    const bestOosSharpe = sharpeFromMoments(
      totalSum[best]! - inSampleSum[best]!,
      totalSumSq[best]! - inSampleSumSq[best]!,
      observationsPerHalf,
    );

    let rank = 0;
    for (let n = 0; n < strategies; n++) {
      const oos = sharpeFromMoments(
        totalSum[n]! - inSampleSum[n]!,
        totalSumSq[n]! - inSampleSumSq[n]!,
        observationsPerHalf,
      );
      if (oos <= bestOosSharpe) rank++;
    }

    const omega = rank / (strategies + 1);
    const logit = Math.log(omega / (1 - omega));
    logits.push(logit);
    if (logit <= 0) overfitCount++;
  }

  return {
    pbo: overfitCount / splitSets.length,
    combinations: splitSets.length,
    splits,
    logits,
    droppedRows: totalRows - usedRows,
  };
}
