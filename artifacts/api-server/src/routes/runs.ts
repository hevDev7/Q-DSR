import { Router, type IRouter } from 'express';

import type { AppContext } from '../context.js';
import { AnchorConflictError } from '../services/anchor.js';
import { toRunDto } from '../services/mapper.js';

export function runsRouter(ctx: AppContext): IRouter {
  const router: IRouter = Router();

  router.get('/runs', async (req, res) => {
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    const runs = await ctx.store.listRuns(agentId);
    const payload = await Promise.all(
      runs.map(async (run) =>
        toRunDto(run, await ctx.store.getAgent(run.agentId), await ctx.store.getAnchor(run.id)),
      ),
    );
    res.json(payload);
  });

  router.get('/runs/:runId', async (req, res) => {
    const run = await ctx.store.getRun(req.params.runId!);
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    const agent = await ctx.store.getAgent(run.agentId);
    const anchor = await ctx.store.getAnchor(run.id);
    res.json(toRunDto(run, agent, anchor));
  });

  router.post('/runs/:runId/anchor', async (req, res) => {
    const run = await ctx.store.getRun(req.params.runId!);
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    const agent = await ctx.store.getAgent(run.agentId);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    try {
      const anchor = await ctx.anchoring.anchor(agent, run);
      res.json(anchor);
    } catch (error) {
      if (error instanceof AnchorConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  router.post('/runs/:runId/replicate', async (req, res) => {
    const run = await ctx.store.getRun(req.params.runId!);
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    const agent = await ctx.store.getAgent(run.agentId);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    try {
      const report = await ctx.anchoring.replicate(agent, run);
      await ctx.audit({
        actor: 'auditor',
        action: report.reproduced ? 'Replication verified' : 'Replication mismatch',
        detail: `${agent.name} · digest ${report.recomputedDigest.slice(0, 16)}… · ${Math.round(report.elapsedMs)} ms`,
        tone: report.reproduced ? 'good' : 'bad',
      });
      res.json(report);
    } catch (error) {
      if (error instanceof AnchorConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  return router;
}
