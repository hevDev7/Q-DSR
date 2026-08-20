import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let app: Express;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'qdsr-api-'));
  process.env.QDSR_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  // A small bootstrap keeps the suite quick; the engine is exercised properly in
  // its own package. What matters here is that the wiring holds together.
  process.env.QDSR_BOOTSTRAP_ITERATIONS = '500';

  const { createApp } = await import('../src/app.js');
  app = await createApp();
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function createAgent(name: string) {
  const response = await request(app)
    .post('/api/agents')
    .send({ name, family: 'unit-test / ETH', owner: 'lab@qdsr' })
    .expect(201);
  return response.body;
}

async function sample(kind: 'overfit' | 'genuine') {
  const response = await request(app)
    .post('/api/evidence/sample')
    .send({ kind, observations: 756, trials: 60, seed: 4242 })
    .expect(200);
  return response.body;
}

async function runToCompletion(agentId: string, kind: 'overfit' | 'genuine') {
  const evidence = await sample(kind);
  const started = await request(app)
    .post(`/api/agents/${agentId}/verify`)
    .send({
      returnsCsv: evidence.returnsCsv,
      trialsCsv: evidence.trialsCsv,
      selectedColumn: evidence.selectedColumn,
    })
    .expect(202);

  const runId = started.body.id as string;

  for (let attempt = 0; attempt < 200; attempt++) {
    const poll = await request(app).get(`/api/runs/${runId}`).expect(200);
    if (poll.body.status === 'completed' || poll.body.status === 'failed') return poll.body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('run did not finish in time');
}

describe('health', () => {
  it('answers', async () => {
    const response = await request(app).get('/api/healthz').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('agent registration', () => {
  it('derives a stable on-chain identity', async () => {
    const agent = await createAgent('Cinder Delta');
    expect(agent.agentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(agent.status).toBe('unverified');
  });

  it('refuses a duplicate name for the same owner', async () => {
    await createAgent('Duplicate Guard');
    await request(app)
      .post('/api/agents')
      .send({ name: 'Duplicate Guard', family: 'x', owner: 'lab@qdsr' })
      .expect(422);
  });

  it('requires the fields it cannot invent', async () => {
    await request(app).post('/api/agents').send({ family: 'x', owner: 'y' }).expect(422);
  });
});

describe('sample evidence', () => {
  it('is reproducible from its seed', async () => {
    const a = await sample('overfit');
    const b = await sample('overfit');
    expect(a.returnsCsv).toBe(b.returnsCsv);
    expect(a.trialsCsv).toBe(b.trialsCsv);
  });

  it('puts the submitted series inside the declared search space', async () => {
    const evidence = await sample('overfit');
    expect(evidence.trialsCsv.split('\n')[0]).toContain(evidence.selectedColumn);
  });

  it('rejects an unknown kind', async () => {
    await request(app).post('/api/evidence/sample').send({ kind: 'wishful' }).expect(422);
  });
});

describe('verification workflow', () => {
  it('rejects an agent selected from pure noise', async () => {
    const agent = await createAgent('Juniper Flow');
    const run = await runToCompletion(agent.id, 'overfit');

    expect(run.status).toBe('completed');
    expect(run.result.verdict).toBe('insignificant');
    expect(run.result.pbo).toBeGreaterThan(0.2);
    expect(run.result.dsr).toBeLessThan(0.95);
    // The point of the protocol in one assertion: pure noise still advertises a
    // Sharpe ratio a trading agent would happily market.
    expect(run.result.sharpeAnnualised).toBeGreaterThan(1);
    expect(run.result.cscv.combinations).toBe(12_870);
    expect(run.result.timings).toHaveLength(5);
    expect(run.result.elapsedMs).toBeGreaterThan(0);

    const detail = await request(app).get(`/api/agents/${agent.id}`).expect(200);
    expect(detail.body.status).toBe('insignificant');
    expect(detail.body.metrics.verdict).toBe('insignificant');
  });

  it('certifies an agent with a genuine, persistent edge', async () => {
    const agent = await createAgent('Vega Lantern');
    const run = await runToCompletion(agent.id, 'genuine');

    expect(run.result.verdict).toBe('certified');
    expect(run.result.dsr).toBeGreaterThanOrEqual(0.95);
    expect(run.result.pbo).toBeLessThanOrEqual(0.1);

    const detail = await request(app).get(`/api/agents/${agent.id}`).expect(200);
    expect(detail.body.status).toBe('certified');
  });

  it('refuses a submission with no trials matrix', async () => {
    const agent = await createAgent('No Search Space');
    const evidence = await sample('overfit');
    const response = await request(app)
      .post(`/api/agents/${agent.id}/verify`)
      .send({ returnsCsv: evidence.returnsCsv, trialsCsv: '' })
      .expect(422);
    expect(response.body.field).toBe('trialsCsv');
    expect(response.body.error).toMatch(/Probability of Backtest Overfitting/);
  });

  it('reports the offending line when a CSV is malformed', async () => {
    const agent = await createAgent('Ragged Upload');
    const evidence = await sample('overfit');
    const broken = `${evidence.trialsCsv.split('\n').slice(0, 3).join('\n')}\n2023-01-05,0.1\n`;
    const response = await request(app)
      .post(`/api/agents/${agent.id}/verify`)
      .send({ returnsCsv: evidence.returnsCsv, trialsCsv: broken })
      .expect(422);
    expect(response.body.error).toMatch(/line \d+/);
  });

  it('404s for an unknown agent', async () => {
    await request(app).post('/api/agents/agt_missing/verify').send({ returnsCsv: 'a', trialsCsv: 'b' }).expect(404);
  });
});

describe('anchoring and replication', () => {
  it('seals evidence under a real 0G merkle root even without credentials', async () => {
    const agent = await createAgent('Anchor Subject');
    const run = await runToCompletion(agent.id, 'genuine');

    const anchor = await request(app).post(`/api/runs/${run.id}/anchor`).expect(200);
    expect(anchor.body.evidenceRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(anchor.body.storageMode).toBe('local');
    // No chain configured in the test environment, so anchoring reports failure
    // honestly rather than pretending a transaction happened.
    expect(anchor.body.status).toBe('failed');
    expect(anchor.body.error).toMatch(/not configured/i);
  });

  it('reproduces the anchored digest byte for byte', async () => {
    const agent = await createAgent('Replication Subject');
    const run = await runToCompletion(agent.id, 'genuine');
    await request(app).post(`/api/runs/${run.id}/anchor`).expect(200);

    const report = await request(app).post(`/api/runs/${run.id}/replicate`).expect(200);
    expect(report.body.reproduced).toBe(true);
    expect(report.body.recomputedDigest).toBe(run.result.digest);
    expect(report.body.recomputedDigest).toBe(report.body.anchoredDigest);
  });

  it('refuses to anchor a run that never completed', async () => {
    await request(app).post('/api/runs/run_missing/anchor').expect(404);
  });
});

describe('audit trail', () => {
  it('records what happened, newest first', async () => {
    const response = await request(app).get('/api/audit').expect(200);
    expect(response.body.length).toBeGreaterThan(0);
    const actions = response.body.map((event: { action: string }) => event.action);
    expect(actions).toContain('Certified agent');
    expect(actions).toContain('Rejected certification');
  });

  it('filters by search term', async () => {
    const response = await request(app).get('/api/audit?search=vega').expect(200);
    for (const event of response.body) {
      expect(`${event.actor} ${event.action} ${event.detail}`.toLowerCase()).toContain('vega');
    }
  });
});

describe('mint intent', () => {
  it('refuses a certified agent whose verdict is not on chain yet', async () => {
    const agent = await createAgent('Mint Candidate');
    const run = await runToCompletion(agent.id, 'genuine');
    await request(app).post(`/api/runs/${run.id}/anchor`).expect(200);

    const intent = await request(app).get(`/api/agents/${agent.id}/mint-intent`).expect(200);
    // Sealed locally, but no chain is configured in tests — so the registry has
    // nothing, and the contract would revert.
    expect(intent.body.ready).toBe(false);
    expect(intent.body.verdict).toBe('certified');
    expect(intent.body.agentIdHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('explains an unverified agent rather than returning a bare false', async () => {
    const agent = await createAgent('Never Verified');
    const intent = await request(app).get(`/api/agents/${agent.id}/mint-intent`).expect(200);
    expect(intent.body.ready).toBe(false);
    expect(intent.body.blockedReason.length).toBeGreaterThan(10);
  });

  it('404s for an unknown agent', async () => {
    await request(app).get('/api/agents/agt_missing/mint-intent').expect(404);
  });
});

describe('chain configuration', () => {
  it('states plainly that nothing is connected', async () => {
    const response = await request(app).get('/api/chain/config').expect(200);
    expect(response.body.configured).toBe(false);
    expect(response.body.storageMode).toBe('local');
    expect(response.body.engineVersion).toMatch(/^qdsr-core\//);
  });
});

describe('fleet statistics', () => {
  it('counts verdicts across the registry', async () => {
    const response = await request(app).get('/api/stats').expect(200);
    expect(response.body.total).toBeGreaterThan(0);
    expect(response.body.certified).toBeGreaterThan(0);
    expect(response.body.insignificant).toBeGreaterThan(0);
    expect(response.body.totalRuns).toBeGreaterThan(0);
  });
});
