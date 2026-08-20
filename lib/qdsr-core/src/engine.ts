/**
 * The Q-DSR verification engine.
 *
 * Takes an evidence bundle, returns a verdict. Pure computation — no network, no
 * database, no chain. Given the same (bundle, seed, engine version) it returns
 * bit-identical numbers on any machine, which is the property the whole protocol
 * rests on.
 */

import { createHash } from 'node:crypto';

import { circularBlockBootstrap, defaultBlockSize } from './bootstrap.js';
import {
  deflatedSharpeRatio,
  expectedMaxSharpe,
  minimumTrackRecordLength,
} from './dsr.js';
import { probabilityOfBacktestOverfitting } from './pbo.js';
import {
  annualise,
  kurtosis,
  sharpeRatio,
  skewness,
  variance,
} from './stats.js';
import {
  DEFAULT_THRESHOLDS,
  type EvidenceBundle,
  type GateOutcome,
  type PhaseTiming,
  type Thresholds,
  type VerificationRun,
  type VerifyOptions,
  type VerifyPhase,
} from './types.js';

const PHASE_LABELS: Record<VerifyPhase, string> = {
  validating: 'Validating evidence bundle',
  fingerprinting: 'Fingerprinting return series',
  cscv: 'Running CSCV overfitting suite',
  bootstrap: 'Block bootstrap resampling',
  sealing: 'Sealing reproducibility digest',
};

/**
 * Engine version. Embedded in every result and anchored on-chain.
 * Bump this whenever a change could alter a numeric output — an auditor
 * re-running an old verdict must be able to pin the exact engine that produced it.
 */
export const ENGINE_VERSION = 'qdsr-core/1.0.0';

export class EvidenceValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'EvidenceValidationError';
    this.field = field;
  }
}

/** Relative tolerance when matching the submitted series against a trials column. */
const SERIES_MATCH_TOLERANCE = 1e-9;

function seriesMatchesColumn(
  returns: readonly number[],
  trials: readonly (readonly number[])[],
  column: number,
): boolean {
  for (let t = 0; t < returns.length; t++) {
    const a = returns[t]!;
    const b = trials[t]![column]!;
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    if (Math.abs(a - b) > SERIES_MATCH_TOLERANCE * scale) return false;
  }
  return true;
}

/**
 * Locates the submitted return series inside the trials matrix.
 *
 * A submitter who hands over a polished series that was never part of the declared
 * search space has defeated the point of PBO — the selection bias we are measuring
 * would be invisible. Refusing that submission is a feature, not a validation
 * inconvenience.
 */
function findSelectedTrial(
  returns: readonly number[],
  trials: readonly (readonly number[])[],
): number {
  const strategies = trials[0]!.length;
  for (let n = 0; n < strategies; n++) {
    if (seriesMatchesColumn(returns, trials, n)) return n;
  }
  return -1;
}

function validate(bundle: EvidenceBundle, thresholds: Thresholds): void {
  const { returns, trials, timestamps, manifest } = bundle;

  if (!Array.isArray(returns) || returns.length === 0) {
    throw new EvidenceValidationError('returns', 'returns.csv is empty or missing');
  }
  if (timestamps.length !== returns.length) {
    throw new EvidenceValidationError(
      'timestamps',
      `timestamps (${timestamps.length}) and returns (${returns.length}) must be the same length`,
    );
  }
  for (let i = 0; i < returns.length; i++) {
    if (!Number.isFinite(returns[i]!)) {
      throw new EvidenceValidationError('returns', `non-finite return at row ${i}`);
    }
  }

  if (!Array.isArray(trials) || trials.length === 0) {
    throw new EvidenceValidationError(
      'trials',
      'trials.csv is required — PBO cannot be computed without the full parameter search space',
    );
  }
  if (trials.length !== returns.length) {
    throw new EvidenceValidationError(
      'trials',
      `trials matrix has ${trials.length} rows but returns has ${returns.length}`,
    );
  }

  const strategies = trials[0]!.length;
  for (let t = 0; t < trials.length; t++) {
    if (trials[t]!.length !== strategies) {
      throw new EvidenceValidationError('trials', `ragged trials matrix at row ${t}`);
    }
    for (let n = 0; n < strategies; n++) {
      if (!Number.isFinite(trials[t]![n]!)) {
        throw new EvidenceValidationError('trials', `non-finite value at row ${t}, column ${n}`);
      }
    }
  }

  if (returns.length < thresholds.minObservations) {
    throw new EvidenceValidationError(
      'returns',
      `need at least ${thresholds.minObservations} observations, got ${returns.length}`,
    );
  }
  if (strategies < thresholds.minTrials) {
    throw new EvidenceValidationError(
      'trials',
      `need at least ${thresholds.minTrials} configurations, got ${strategies}`,
    );
  }

  if (!Number.isFinite(manifest.periodsPerYear) || manifest.periodsPerYear <= 0) {
    throw new EvidenceValidationError('manifest.periodsPerYear', 'must be a positive number');
  }
}

/** Canonical serialisation of the numeric result — the reproducibility fingerprint. */
function computeDigest(values: Record<string, number | string>): string {
  const canonical = Object.keys(values)
    .sort()
    .map((k) => `${k}=${values[k]}`)
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function gate(
  name: string,
  observed: number,
  required: number,
  comparison: 'gte' | 'lte',
): GateOutcome {
  return {
    gate: name,
    observed,
    required,
    comparison,
    passed: comparison === 'gte' ? observed >= required : observed <= required,
  };
}

/**
 * Runs a full verification.
 *
 * @throws {EvidenceValidationError} when the bundle cannot support a meaningful
 *         verdict. Refusing to answer is deliberate: a wrong number carries more
 *         weight here than no number.
 */
export function verify(bundle: EvidenceBundle, options: VerifyOptions = {}): VerificationRun {
  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };

  const timings: PhaseTiming[] = [];
  const startedAt = performance.now();
  let phaseStart = startedAt;

  const mark = (phase: VerifyPhase): void => {
    const now = performance.now();
    const timing: PhaseTiming = {
      phase,
      label: PHASE_LABELS[phase],
      elapsedMs: now - phaseStart,
    };
    phaseStart = now;
    timings.push(timing);
    options.onPhase?.(timing);
  };

  validate(bundle, thresholds);
  mark('validating');

  const { returns, trials, manifest } = bundle;
  const seed = options.seed ?? 1;
  const T = returns.length;
  const N = trials[0]!.length;

  const selectedTrial = findSelectedTrial(returns, trials);
  if (selectedTrial < 0) {
    throw new EvidenceValidationError(
      'returns',
      'the submitted return series does not appear in the trials matrix — ' +
        'the selected strategy must be one of the declared configurations',
    );
  }

  // Moments of the selected strategy.
  const sharpe = sharpeRatio(returns);
  const g3 = skewness(returns);
  const g4 = kurtosis(returns);

  // Selection-bias correction across the declared search space.
  const trialSharpes = new Array<number>(N);
  for (let n = 0; n < N; n++) {
    const column = new Array<number>(T);
    for (let t = 0; t < T; t++) column[t] = trials[t]![n]!;
    trialSharpes[n] = sharpeRatio(column);
  }
  const sr0 = expectedMaxSharpe(variance(trialSharpes), N);
  mark('fingerprinting');

  const dsr = deflatedSharpeRatio({
    sharpe,
    expectedMaxSharpe: sr0,
    observations: T,
    skewness: g3,
    kurtosis: g4,
  });

  const mtrl = minimumTrackRecordLength(
    { sharpe, expectedMaxSharpe: sr0, skewness: g3, kurtosis: g4 },
    thresholds.minDsr,
  );

  const pboResult = probabilityOfBacktestOverfitting(trials, {
    splits: options.cscvSplits ?? 16,
  });
  mark('cscv');

  const blockSize = options.blockSize ?? defaultBlockSize(T);
  const bootstrap = circularBlockBootstrap(returns, {
    iterations: options.bootstrapIterations ?? 10_000,
    blockSize,
    seed,
  });
  mark('bootstrap');

  const gates: GateOutcome[] = [
    gate('deflated_sharpe_ratio', dsr, thresholds.minDsr, 'gte'),
    gate('probability_of_backtest_overfitting', pboResult.pbo, thresholds.maxPbo, 'lte'),
    gate('observations', T, thresholds.minObservations, 'gte'),
    gate('trials', N, thresholds.minTrials, 'gte'),
  ];

  const verdict = gates.every((g) => g.passed) ? 'certified' : 'insignificant';

  const digest = computeDigest({
    engineVersion: ENGINE_VERSION,
    seed,
    observations: T,
    trials: N,
    sharpe: sharpe.toString(),
    skewness: g3.toString(),
    kurtosis: g4.toString(),
    expectedMaxSharpe: sr0.toString(),
    dsr: dsr.toString(),
    pbo: pboResult.pbo.toString(),
    bootstrapMean: bootstrap.meanSharpe.toString(),
    bootstrapStd: bootstrap.stdSharpe.toString(),
  });
  mark('sealing');

  return {
    result: {
      engineVersion: ENGINE_VERSION,
      seed,
      verdict,
      gates,
      observations: T,
      trials: N,
      sharpe,
      sharpeAnnualised: annualise(sharpe, manifest.periodsPerYear),
      skewness: g3,
      kurtosis: g4,
      expectedMaxSharpe: sr0,
      dsr,
      pbo: pboResult.pbo,
      minimumTrackRecordLength: mtrl,
      bootstrap: {
        iterations: bootstrap.iterations,
        blockSize: bootstrap.blockSize,
        meanSharpe: bootstrap.meanSharpe,
        stdSharpe: bootstrap.stdSharpe,
        ci95: bootstrap.ci95,
        probabilityPositive: bootstrap.probabilityPositive,
      },
      cscv: {
        splits: pboResult.splits,
        combinations: pboResult.combinations,
        droppedRows: pboResult.droppedRows,
      },
      timings,
      elapsedMs: performance.now() - startedAt,
      digest,
    },
    artifacts: {
      bootstrapSamples: bootstrap.samples,
      cscvLogits: pboResult.logits,
    },
  };
}
