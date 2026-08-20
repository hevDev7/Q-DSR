import type { VerificationResult } from '@workspace/qdsr-core';

import type { AgentRecord, AnchorRecord, RunRecord } from '../store/index.js';

/**
 * Domain records to API payloads.
 *
 * Two things need translating rather than passing through. `Infinity` is not
 * representable in JSON, so an unreachable minimum track record length becomes
 * `null`. And the bootstrap confidence interval is a tuple internally but two
 * named fields on the wire, because an array of two numbers is the kind of thing
 * clients read backwards.
 */
export function toResultDto(result: VerificationResult): Record<string, unknown> {
  return {
    engineVersion: result.engineVersion,
    seed: result.seed,
    verdict: result.verdict,
    gates: result.gates,
    observations: result.observations,
    trials: result.trials,
    sharpe: result.sharpe,
    sharpeAnnualised: result.sharpeAnnualised,
    skewness: result.skewness,
    kurtosis: result.kurtosis,
    expectedMaxSharpe: result.expectedMaxSharpe,
    dsr: result.dsr,
    pbo: result.pbo,
    minimumTrackRecordLength: Number.isFinite(result.minimumTrackRecordLength)
      ? result.minimumTrackRecordLength
      : null,
    bootstrap: {
      iterations: result.bootstrap.iterations,
      blockSize: result.bootstrap.blockSize,
      meanSharpe: result.bootstrap.meanSharpe,
      stdSharpe: result.bootstrap.stdSharpe,
      ci95Low: result.bootstrap.ci95[0],
      ci95High: result.bootstrap.ci95[1],
      probabilityPositive: result.bootstrap.probabilityPositive,
    },
    cscv: result.cscv,
    timings: result.timings,
    elapsedMs: result.elapsedMs,
    digest: result.digest,
  };
}

export type AnchorDto = AnchorRecord;

export function toAnchorDto(anchor: AnchorRecord | undefined, runId: string): AnchorDto {
  return anchor ?? { runId, status: 'none' };
}

export function toRunDto(
  run: RunRecord,
  agent: AgentRecord | undefined,
  anchor?: AnchorRecord,
): Record<string, unknown> {
  return {
    id: run.id,
    agentId: run.agentId,
    agentName: agent?.name ?? 'unknown agent',
    status: run.status,
    progress: run.progress,
    step: run.step,
    error: run.error,
    seed: run.seed,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    result: run.result ? toResultDto(run.result) : undefined,
    anchor: anchor ? toAnchorDto(anchor, run.id) : undefined,
  };
}

export function toAgentDto(
  agent: AgentRecord,
  latestRun?: RunRecord,
  anchor?: AnchorRecord,
  /** ERC-7857 token id, read from the chain. Absent when nothing has been minted. */
  tokenId?: string,
): Record<string, unknown> {
  const result = latestRun?.result;
  return {
    id: agent.id,
    agentId: agent.agentId,
    name: agent.name,
    family: agent.family,
    owner: agent.owner,
    periodsPerYear: agent.periodsPerYear,
    status: agent.status,
    accent: agent.accent,
    description: agent.description,
    imageUrl: agent.imageUrl,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    latestRunId: agent.latestRunId,
    tokenId,
    metrics: result
      ? {
          dsr: result.dsr,
          pbo: result.pbo,
          sharpe: result.sharpe,
          sharpeAnnualised: result.sharpeAnnualised,
          observations: result.observations,
          trials: result.trials,
          verdict: result.verdict,
          anchorStatus: anchor?.status ?? 'none',
        }
      : undefined,
  };
}
