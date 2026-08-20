export { ENGINE_VERSION, EvidenceValidationError, verify } from './engine.js';
export {
  EULER_MASCHERONI,
  deflatedSharpeRatio,
  expectedMaxSharpe,
  expectedMaxSharpeFromTrials,
  minimumTrackRecordLength,
} from './dsr.js';
export { combinations, probabilityOfBacktestOverfitting } from './pbo.js';
export { circularBlockBootstrap, defaultBlockSize } from './bootstrap.js';
export { createRng, seedFromString } from './prng.js';
export { erf, erfc, normalCdf, normalInv, normalPdf } from './normal.js';
export {
  annualise,
  kurtosis,
  mean,
  quantile,
  sharpeFromMoments,
  sharpeRatio,
  skewness,
  stdev,
  variance,
} from './stats.js';
export { DEFAULT_THRESHOLDS } from './types.js';
export {
  PLAUSIBILITY_DEFAULTS,
  assertHonestSearchSpace,
  checkReturnsPlausibility,
  distinctTrialColumns,
} from './plausibility.js';
export type {
  BootstrapOptions,
  BootstrapResult,
} from './bootstrap.js';
export type { DeflatedSharpeInput } from './dsr.js';
export type { PboOptions, PboResult } from './pbo.js';
export type {
  EvidenceBundle,
  EvidenceManifest,
  GateOutcome,
  Thresholds,
  VerificationArtifacts,
  VerificationResult,
  VerificationRun,
  Verdict,
  VerifyOptions,
  VerifyPhase,
  PhaseTiming,
  PlausibilityWarning,
  PlausibilityThresholds,
} from './types.js';
