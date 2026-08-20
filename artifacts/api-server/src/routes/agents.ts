import { Router, type IRouter } from 'express';

import type { AppContext } from '../context.js';
import { accentFor, newId } from '../lib/ids.js';
import { toAgentDto, toRunDto } from '../services/mapper.js';
import { buildMintIntent } from '../services/mint.js';
import { EvidenceRequestError } from '../services/verification.js';

export function agentsRouter(ctx: AppContext): IRouter {
  const router: IRouter = Router();

  router.get('/agents', async (req, res) => {
    const agents = await ctx.store.listAgents();
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;

    const payload = await Promise.all(
      agents
        .filter((agent) => (status ? agent.status === status : true))
        .filter((agent) =>
          search
            ? `${agent.name} ${agent.family} ${agent.owner}`.toLowerCase().includes(search)
            : true,
        )
        .map(async (agent) => {
          const run = agent.latestRunId ? await ctx.store.getRun(agent.latestRunId) : undefined;
          const anchor = run ? await ctx.store.getAnchor(run.id) : undefined;
          return toAgentDto(agent, run, anchor);
        }),
    );

    res.json(payload);
  });

  router.post('/agents', async (req, res) => {
    const { name, family, owner, periodsPerYear } = req.body ?? {};

    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(422).json({ error: 'name is required', field: 'name' });
      return;
    }
    if (typeof family !== 'string' || family.trim().length === 0) {
      res.status(422).json({ error: 'family is required', field: 'family' });
      return;
    }
    if (typeof owner !== 'string' || owner.trim().length === 0) {
      res.status(422).json({ error: 'owner is required', field: 'owner' });
      return;
    }

    // The on-chain identity is derived from an address. Owners given as a handle
    // rather than an address still need a stable key, so the handle is hashed into
    // a deterministic pseudo-address instead of being rejected.
    const ownerAddress = /^0x[0-9a-fA-F]{40}$/.test(owner.trim())
      ? owner.trim()
      : `0x${Buffer.from(owner.trim()).toString('hex').padEnd(40, '0').slice(0, 40)}`;

    const agentId = ctx.deriveAgentId(ownerAddress, name.trim());
    const existing = await ctx.store.getAgentByAgentId(agentId);
    if (existing) {
      res.status(422).json({
        error: `an agent named "${name.trim()}" already exists for this owner`,
        field: 'name',
      });
      return;
    }

    const now = new Date().toISOString();
    const agent = await ctx.store.createAgent({
      id: newId('agt'),
      agentId,
      name: name.trim(),
      family: family.trim(),
      owner: owner.trim(),
      periodsPerYear: Number.isFinite(periodsPerYear) && periodsPerYear > 0 ? periodsPerYear : 252,
      status: 'unverified',
      accent: accentFor(agentId),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.audit({
      actor: agent.owner,
      action: 'Registered agent',
      detail: `${agent.name} · ${agent.family}`,
      tone: 'neutral',
    });

    res.status(201).json(toAgentDto(agent));
  });

  router.get('/agents/:agentId', async (req, res) => {
    const agent = await ctx.store.getAgent(req.params.agentId!);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    const runs = await ctx.store.listRuns(agent.id);
    const latest = agent.latestRunId ? runs.find((run) => run.id === agent.latestRunId) : runs[0];
    const anchor = latest ? await ctx.store.getAnchor(latest.id) : undefined;

    const runDtos = await Promise.all(
      runs.map(async (run) => toRunDto(run, agent, await ctx.store.getAnchor(run.id))),
    );

    res.json({ ...toAgentDto(agent, latest, anchor), runs: runDtos });
  });

  router.get('/agents/:agentId/mint-intent', async (req, res) => {
    const agent = await ctx.store.getAgent(req.params.agentId!);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    const run = agent.latestRunId ? await ctx.store.getRun(agent.latestRunId) : undefined;
    const anchor = run ? await ctx.store.getAnchor(run.id) : undefined;

    res.json(buildMintIntent({ agent, run, anchor, chain: ctx.chain.status() }));
  });

  router.post('/agents/:agentId/verify', async (req, res) => {
    const agent = await ctx.store.getAgent(req.params.agentId!);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    const { returnsCsv, trialsCsv, selectedColumn, seed, bootstrapIterations, cscvSplits } =
      req.body ?? {};

    if (typeof returnsCsv !== 'string' || returnsCsv.trim().length === 0) {
      res.status(422).json({ error: 'returnsCsv is required', field: 'returnsCsv' });
      return;
    }
    if (typeof trialsCsv !== 'string' || trialsCsv.trim().length === 0) {
      res.status(422).json({
        error:
          'trialsCsv is required — the Probability of Backtest Overfitting cannot be ' +
          'computed without every configuration that was explored',
        field: 'trialsCsv',
      });
      return;
    }

    try {
      const run = await ctx.verification.start(agent, {
        returnsCsv,
        trialsCsv,
        selectedColumn: typeof selectedColumn === 'string' ? selectedColumn : undefined,
        seed: Number.isFinite(seed) ? seed : undefined,
        bootstrapIterations: Number.isFinite(bootstrapIterations) ? bootstrapIterations : undefined,
        cscvSplits: Number.isFinite(cscvSplits) ? cscvSplits : undefined,
      });
      res.status(202).json(toRunDto(run, agent));
    } catch (error) {
      if (error instanceof EvidenceRequestError) {
        res.status(error.status).json({ error: error.message, field: error.field });
        return;
      }
      throw error;
    }
  });

  return router;
}
