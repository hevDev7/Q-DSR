import { describe, expect, it } from 'vitest';

import type { ChainStatus } from '@workspace/og-chain';

import { buildMintIntent } from '../src/services/mint.js';
import type { AgentRecord, AnchorRecord, RunRecord } from '../src/store/types.js';

const AGENT_ID = `0x${'ab'.repeat(32)}`;
const EVIDENCE_ROOT = `0x${'cd'.repeat(32)}`;
const DIGEST = 'ef'.repeat(32);

const agent: AgentRecord = {
  id: 'agt_1',
  agentId: AGENT_ID,
  name: 'Cinder Delta',
  family: 'Market-neutral / ETH',
  owner: 'quants@cinder',
  periodsPerYear: 252,
  status: 'certified',
  accent: '#c8f169',
  latestRunId: 'run_1',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

const chain: ChainStatus = {
  configured: true,
  chainId: 16661,
  networkName: '0G mainnet',
  explorerBaseUrl: 'https://chainscan.0g.ai',
  registryAddress: `0x${'11'.repeat(20)}`,
  agenticIdAddress: `0x${'22'.repeat(20)}`,
  attestorAddress: `0x${'33'.repeat(20)}`,
};

function runWith(verdict: 'certified' | 'insignificant'): RunRecord {
  return {
    id: 'run_1',
    agentId: agent.id,
    status: 'completed',
    progress: 100,
    step: 'Complete',
    seed: 1,
    bootstrapIterations: 10_000,
    cscvSplits: 16,
    createdAt: '2026-08-20T00:00:00.000Z',
    result: {
      engineVersion: 'qdsr-core/1.0.0',
      seed: 1,
      verdict,
      gates: [],
      observations: 756,
      trials: 60,
      sharpe: 0.21,
      sharpeAnnualised: 3.37,
      skewness: 0,
      kurtosis: 3,
      expectedMaxSharpe: 0.08,
      dsr: verdict === 'certified' ? 0.9982 : 0.4889,
      pbo: verdict === 'certified' ? 0.0004 : 0.5041,
      minimumTrackRecordLength: 22,
      bootstrap: {
        iterations: 10_000,
        blockSize: 10,
        meanSharpe: 0.21,
        stdSharpe: 0.03,
        ci95: [0.15, 0.27],
        probabilityPositive: 1,
      },
      cscv: { splits: 16, combinations: 12_870, droppedRows: 0 },
      timings: [],
      elapsedMs: 135,
      digest: DIGEST,
    },
  };
}

const anchored: AnchorRecord = {
  runId: 'run_1',
  status: 'anchored',
  storageMode: 'local',
  evidenceRoot: EVIDENCE_ROOT,
  chainTxHash: `0x${'99'.repeat(32)}`,
  blockNumber: 1_842_907,
};

describe('buildMintIntent — the readiness ladder', () => {
  it('is ready once the verdict is certified and anchored', () => {
    const intent = buildMintIntent({ agent, run: runWith('certified'), anchor: anchored, chain });

    expect(intent.ready).toBe(true);
    expect(intent.blockedReason).toBeUndefined();
    expect(intent.agentIdHash).toBe(AGENT_ID);
    expect(intent.metadataURI).toBe(`0g://storage/${EVIDENCE_ROOT}`);
    expect(intent.metadataHash).toBe(`0x${DIGEST}`);
    expect(intent.agenticIdAddress).toBe(chain.agenticIdAddress);
  });

  it('produces a metadataHash the contract will accept as bytes32', () => {
    const intent = buildMintIntent({ agent, run: runWith('certified'), anchor: anchored, chain });
    expect(intent.metadataHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('reports the missing contract first, before anything else', () => {
    const intent = buildMintIntent({
      agent,
      run: runWith('certified'),
      anchor: anchored,
      chain: { configured: false, networkName: 'not connected' },
    });
    expect(intent.ready).toBe(false);
    expect(intent.blockedReason).toMatch(/AGENTIC_ID_ADDRESS/);
  });

  it('blocks an agent that has never been verified', () => {
    const intent = buildMintIntent({ agent, chain });
    expect(intent.ready).toBe(false);
    expect(intent.blockedReason).toMatch(/no completed verification/);
  });

  it('still hands over usable mint arguments when blocked, so the gate can be probed', () => {
    // A zero metadataHash would trip the contract's EmptyMetadata guard before it
    // ever reached the certification check, and the caller would be told the wrong
    // reason for the refusal.
    const intent = buildMintIntent({
      agent,
      run: runWith('insignificant'),
      anchor: anchored,
      chain,
    });
    expect(intent.ready).toBe(false);
    expect(intent.metadataHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(intent.metadataHash).not.toBe(`0x${'00'.repeat(32)}`);
    expect(intent.metadataURI).toBe(`0g://storage/${EVIDENCE_ROOT}`);
  });

  it('blocks an insignificant verdict and quotes the numbers', () => {
    const intent = buildMintIntent({
      agent,
      run: runWith('insignificant'),
      anchor: anchored,
      chain,
    });
    expect(intent.ready).toBe(false);
    expect(intent.blockedReason).toMatch(/DSR 0\.4889/);
    expect(intent.blockedReason).toMatch(/PBO 0\.5041/);
    expect(intent.verdict).toBe('insignificant');
  });

  it('blocks when the evidence has not been sealed', () => {
    const intent = buildMintIntent({ agent, run: runWith('certified'), chain });
    expect(intent.ready).toBe(false);
    expect(intent.blockedReason).toMatch(/not been sealed/);
  });

  it('blocks when the verdict is sealed but not published to the registry', () => {
    // The contract reads isCertified() from the registry, so a verdict that
    // exists only in our database is invisible to it.
    const intent = buildMintIntent({
      agent,
      run: runWith('certified'),
      anchor: { ...anchored, status: 'failed', error: 'chain not configured' },
      chain,
    });
    expect(intent.ready).toBe(false);
    expect(intent.blockedReason).toMatch(/registry/);
    expect(intent.blockedReason).toMatch(/revert/);
  });

  it('always returns the agent identity, even when blocked', () => {
    for (const intent of [
      buildMintIntent({ agent, chain }),
      buildMintIntent({ agent, run: runWith('insignificant'), chain }),
      buildMintIntent({ agent, chain: { configured: false, networkName: 'not connected' } }),
    ]) {
      expect(intent.agentIdHash).toBe(AGENT_ID);
      expect(intent.networkName.length).toBeGreaterThan(0);
    }
  });
});
