import { toBasisPoints, type ChainClient } from '@workspace/og-chain';
import type { EvidenceStorage } from '@workspace/og-storage';
import { verify } from '@workspace/qdsr-core';

import type { AgentRecord, AnchorRecord, RunRecord, Store } from '../store/index.js';
import { buildBundle } from './verification.js';

export class AnchorConflictError extends Error {
  readonly status = 409;
}

/**
 * The evidence document published to 0G Storage.
 *
 * Deliberately self-contained: the CSVs, the seed, the engine version and the
 * artifacts are all here, so a stranger holding only the root hash has everything
 * needed to reproduce the verdict. Anything the auditor would have to ask us for
 * would defeat the point.
 */
export interface EvidenceDocument {
  protocol: 'q-dsr';
  version: 1;
  agent: { id: string; agentId: string; name: string; family: string; owner: string; periodsPerYear: number };
  run: {
    id: string;
    seed: number;
    bootstrapIterations: number;
    cscvSplits: number;
    engineVersion: string;
    createdAt: string;
  };
  evidence: { returnsCsv: string; trialsCsv: string; selectedColumn?: string };
  result: unknown;
  artifacts: { bootstrapSamples: number[]; cscvLogits: number[] };
}

export interface ReplicationReport {
  runId: string;
  reproduced: boolean;
  anchoredDigest: string;
  recomputedDigest: string;
  engineVersion: string;
  elapsedMs: number;
  note?: string;
}

export class AnchorService {
  constructor(
    private readonly store: Store,
    private readonly storage: EvidenceStorage,
    private readonly chain: ChainClient,
    private readonly onAudit: (event: {
      actor: string;
      action: string;
      detail: string;
      tone: 'good' | 'bad' | 'warn' | 'cyan' | 'neutral';
    }) => Promise<void>,
  ) {}

  private buildDocument(agent: AgentRecord, run: RunRecord): EvidenceDocument {
    return {
      protocol: 'q-dsr',
      version: 1,
      agent: {
        id: agent.id,
        agentId: agent.agentId,
        name: agent.name,
        family: agent.family,
        owner: agent.owner,
        periodsPerYear: agent.periodsPerYear,
      },
      run: {
        id: run.id,
        seed: run.seed,
        bootstrapIterations: run.bootstrapIterations,
        cscvSplits: run.cscvSplits,
        engineVersion: run.result!.engineVersion,
        createdAt: run.createdAt,
      },
      evidence: {
        returnsCsv: run.evidence!.returnsCsv,
        trialsCsv: run.evidence!.trialsCsv,
        selectedColumn: run.evidence!.selectedColumn,
      },
      result: run.result,
      artifacts: {
        bootstrapSamples: run.bootstrapSamples ?? [],
        cscvLogits: run.cscvLogits ?? [],
      },
    };
  }

  /**
   * Publishes evidence to 0G Storage and the verdict to 0G Chain.
   *
   * The two steps are recorded independently. Storage succeeding while the chain
   * transaction reverts is a real outcome, and it leaves the run with a valid
   * evidence root and a `failed` anchor status that can be retried — rather than
   * losing the upload.
   */
  async anchor(agent: AgentRecord, run: RunRecord): Promise<AnchorRecord> {
    if (run.status !== 'completed' || !run.result || !run.evidence) {
      throw new AnchorConflictError('only a completed run with a result can be anchored');
    }

    const document = this.buildDocument(agent, run);
    const payload = new TextEncoder().encode(JSON.stringify(document));

    let anchor: AnchorRecord = { runId: run.id, status: 'pending' };
    await this.store.upsertAnchor(anchor);

    const upload = await this.storage.upload(payload, `${agent.name}-${run.id}.json`);
    anchor = {
      ...anchor,
      evidenceRoot: upload.rootHash,
      storageTxHash: upload.txHash,
      storageMode: upload.mode,
    };
    await this.store.upsertAnchor(anchor);
    await this.store.updateRun(run.id, {
      evidence: { ...run.evidence, evidenceRoot: upload.rootHash },
    });

    await this.onAudit({
      actor: 'verification-engine',
      action: upload.mode === 'live' ? 'Evidence published to 0G Storage' : 'Evidence sealed locally',
      detail: `${agent.name} · root ${upload.rootHash.slice(0, 18)}… · ${upload.bytes.toLocaleString()} bytes`,
      tone: upload.mode === 'live' ? 'good' : 'neutral',
    });

    try {
      const receipt = await this.chain.submitVerdict({
        agentId: agent.agentId,
        evidenceRoot: upload.rootHash,
        resultDigest: `0x${run.result.digest}`,
        engineVersion: run.result.engineVersion,
        dsrBps: toBasisPoints(run.result.dsr),
        pboBps: toBasisPoints(run.result.pbo),
        trials: run.result.trials,
        observations: run.result.observations,
      });

      anchor = {
        ...anchor,
        status: 'anchored',
        chainId: receipt.chainId,
        registryAddress: receipt.registryAddress,
        chainTxHash: receipt.txHash,
        blockNumber: receipt.blockNumber,
        explorerUrl: receipt.explorerUrl,
        anchoredAt: new Date().toISOString(),
        error: undefined,
      };

      await this.onAudit({
        actor: 'verification-engine',
        action: 'Verdict anchored on 0G Chain',
        detail: `${agent.name} · block ${receipt.blockNumber.toLocaleString()} · ${receipt.txHash.slice(0, 18)}…`,
        tone: 'good',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      anchor = { ...anchor, status: 'failed', error: message };
      await this.onAudit({
        actor: 'verification-engine',
        action: 'Chain anchoring failed',
        detail: `${agent.name} · ${message}`,
        tone: 'warn',
      });
    }

    return this.store.upsertAnchor(anchor);
  }

  /**
   * The trustless audit path.
   *
   * Fetches the published evidence back out of storage, re-runs the pinned engine
   * with the recorded seed, and compares digests. This is the operation that makes
   * the protocol's claim checkable rather than merely asserted — and it is exposed
   * to anyone, because a proof only you can run is not a proof.
   */
  async replicate(agent: AgentRecord, run: RunRecord): Promise<ReplicationReport> {
    if (!run.result) throw new AnchorConflictError('run has no result to replicate');

    const anchor = await this.store.getAnchor(run.id);
    const root = anchor?.evidenceRoot ?? run.evidence?.evidenceRoot;

    let evidence = run.evidence;
    let note: string | undefined;

    if (root && (await this.storage.has(root))) {
      const bytes = await this.storage.download(root);
      const document = JSON.parse(new TextDecoder().decode(bytes)) as EvidenceDocument;
      evidence = document.evidence;
    } else {
      note = 'evidence has not been published yet — replicated from the submitted bundle';
    }

    if (!evidence) throw new AnchorConflictError('no evidence available to replicate');

    const started = performance.now();
    // The digest covers the bootstrap moments, so the resample count and split
    // geometry must match the original run — defaults would silently diverge.
    const { result } = verify(buildBundle(agent, evidence), {
      seed: run.seed,
      bootstrapIterations: run.bootstrapIterations,
      cscvSplits: run.cscvSplits,
    });
    const elapsedMs = performance.now() - started;

    return {
      runId: run.id,
      reproduced: result.digest === run.result.digest,
      anchoredDigest: run.result.digest,
      recomputedDigest: result.digest,
      engineVersion: result.engineVersion,
      elapsedMs,
      note,
    };
  }
}
