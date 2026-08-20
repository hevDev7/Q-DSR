import {
  EvidenceValidationError,
  verify,
  type EvidenceBundle,
  type VerificationResult,
} from '@workspace/qdsr-core';

import { CsvParseError, parseReturns, parseTrials } from '../lib/csv.js';
import { newId } from '../lib/ids.js';
import type { AgentRecord, RunRecord, Store } from '../store/index.js';

export class EvidenceRequestError extends Error {
  readonly field: string;
  readonly status = 422;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'EvidenceRequestError';
    this.field = field;
  }
}

export interface StartVerificationInput {
  returnsCsv: string;
  trialsCsv: string;
  selectedColumn?: string;
  seed?: number;
  bootstrapIterations?: number;
  cscvSplits?: number;
}

export interface VerificationDefaults {
  bootstrapIterations: number;
  cscvSplits: number;
  seed: number;
}

/**
 * Turns two CSV documents into the bundle the engine expects.
 *
 * Parsing errors are translated into field-tagged 422s rather than 500s: a bad
 * upload is the user's problem to fix, and telling them which line failed is the
 * difference between a usable protocol and an opaque one.
 */
export function buildBundle(
  agent: AgentRecord,
  input: StartVerificationInput,
): EvidenceBundle {
  let returns;
  let trials;

  try {
    returns = parseReturns(input.returnsCsv, input.selectedColumn);
  } catch (error) {
    if (error instanceof CsvParseError) throw new EvidenceRequestError('returnsCsv', error.message);
    throw error;
  }

  try {
    trials = parseTrials(input.trialsCsv);
  } catch (error) {
    if (error instanceof CsvParseError) throw new EvidenceRequestError('trialsCsv', error.message);
    throw error;
  }

  if (trials.matrix.length !== returns.returns.length) {
    throw new EvidenceRequestError(
      'trialsCsv',
      `the trials matrix has ${trials.matrix.length} rows but the return series has ${returns.returns.length}`,
    );
  }

  return {
    manifest: {
      agentName: agent.name,
      strategyFamily: agent.family,
      owner: agent.owner,
      periodsPerYear: agent.periodsPerYear,
      searchSpace: { columns: trials.columns },
    },
    timestamps: returns.timestamps,
    returns: returns.returns,
    trials: trials.matrix,
  };
}

/**
 * Runs verifications.
 *
 * Runs execute one at a time on a simple in-process queue. The engine is CPU-bound
 * and finishes in well under a second, so a queue is enough to keep a burst of
 * submissions from competing for the same core — a worker pool would be machinery
 * without a problem to solve.
 */
export class VerificationService {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: Store,
    private readonly defaults: VerificationDefaults,
    private readonly onAudit: (event: {
      actor: string;
      action: string;
      detail: string;
      tone: 'good' | 'bad' | 'warn' | 'cyan' | 'neutral';
    }) => Promise<void>,
  ) {}

  async start(agent: AgentRecord, input: StartVerificationInput): Promise<RunRecord> {
    // Parse before accepting, so an unusable bundle fails immediately with a
    // specific message rather than becoming a queued run that fails later.
    const bundle = buildBundle(agent, input);

    const run: RunRecord = {
      id: newId('run'),
      agentId: agent.id,
      status: 'queued',
      progress: 0,
      step: 'Queued',
      seed: input.seed ?? this.defaults.seed,
      bootstrapIterations: input.bootstrapIterations ?? this.defaults.bootstrapIterations,
      cscvSplits: input.cscvSplits ?? this.defaults.cscvSplits,
      evidence: {
        returnsCsv: input.returnsCsv,
        trialsCsv: input.trialsCsv,
        selectedColumn: input.selectedColumn,
      },
      createdAt: new Date().toISOString(),
    };

    await this.store.createRun(run);
    await this.store.updateAgent(agent.id, { status: 'verifying', latestRunId: run.id });
    await this.onAudit({
      actor: agent.owner,
      action: 'Submitted evidence',
      detail: `${agent.name} · ${bundle.returns.length} observations × ${bundle.trials[0]!.length} configurations`,
      tone: 'cyan',
    });

    this.enqueue(run.id, agent, bundle, input);
    return run;
  }

  private enqueue(
    runId: string,
    agent: AgentRecord,
    bundle: EvidenceBundle,
    input: StartVerificationInput,
  ): void {
    this.queue = this.queue.then(() => this.execute(runId, agent, bundle, input)).catch(() => undefined);
  }

  private async execute(
    runId: string,
    agent: AgentRecord,
    bundle: EvidenceBundle,
    input: StartVerificationInput,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    await this.store.updateRun(runId, {
      status: 'running',
      startedAt,
      progress: 5,
      step: 'Validating evidence bundle',
    });

    try {
      // Phase updates are written as the engine reports them. They are fire and
      // forget: a slow store write must not hold up the computation.
      const phaseProgress: Record<string, number> = {
        validating: 15,
        fingerprinting: 35,
        cscv: 70,
        bootstrap: 90,
        sealing: 98,
      };

      const { result, artifacts } = verify(bundle, {
        seed: input.seed ?? this.defaults.seed,
        bootstrapIterations: input.bootstrapIterations ?? this.defaults.bootstrapIterations,
        cscvSplits: input.cscvSplits ?? this.defaults.cscvSplits,
        // Every stochastic and structural parameter above is persisted on the run,
        // so a replication reruns the identical computation rather than a similar one.
        onPhase: (timing) => {
          void this.store.updateRun(runId, {
            progress: phaseProgress[timing.phase] ?? 50,
            step: timing.label,
          });
        },
      });

      const finishedAt = new Date().toISOString();
      await this.store.updateRun(runId, {
        status: 'completed',
        progress: 100,
        step: 'Complete',
        result,
        bootstrapSamples: artifacts.bootstrapSamples,
        cscvLogits: artifacts.cscvLogits,
        finishedAt,
        elapsedMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      });

      await this.store.updateAgent(agent.id, {
        status: result.verdict === 'certified' ? 'certified' : 'insignificant',
        latestRunId: runId,
      });

      await this.onAudit({
        actor: 'verification-engine',
        action: result.verdict === 'certified' ? 'Certified agent' : 'Rejected certification',
        detail: this.summarise(agent.name, result),
        tone: result.verdict === 'certified' ? 'good' : 'bad',
      });
    } catch (error) {
      const message = this.describe(error);
      await this.store.updateRun(runId, {
        status: 'failed',
        progress: 100,
        step: 'Failed',
        error: message,
        finishedAt: new Date().toISOString(),
      });
      await this.store.updateAgent(agent.id, { status: 'failed', latestRunId: runId });
      await this.onAudit({
        actor: 'verification-engine',
        action: 'Verification failed',
        detail: `${agent.name} · ${message}`,
        tone: 'warn',
      });
    }
  }

  private summarise(name: string, result: VerificationResult): string {
    return (
      `${name} · DSR ${result.dsr.toFixed(4)} · PBO ${result.pbo.toFixed(4)} · ` +
      `${result.cscv.combinations.toLocaleString()} CSCV splits in ${Math.round(result.elapsedMs)} ms`
    );
  }

  private describe(error: unknown): string {
    if (error instanceof EvidenceValidationError) return error.message;
    if (error instanceof EvidenceRequestError) return error.message;
    return error instanceof Error ? error.message : String(error);
  }
}
