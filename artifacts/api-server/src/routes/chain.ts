import { Router, type IRouter } from 'express';

import type { AppContext } from '../context.js';

export function chainRouter(ctx: AppContext): IRouter {
  const router: IRouter = Router();

  router.get('/chain/config', (_req, res) => {
    const status = ctx.chain.status();
    res.json({
      configured: status.configured,
      chainId: status.chainId,
      networkName: status.networkName,
      explorerBaseUrl: status.explorerBaseUrl,
      registryAddress: status.registryAddress,
      agenticIdAddress: status.agenticIdAddress,
      attestorAddress: status.attestorAddress,
      storageMode: ctx.storage.mode,
      engineVersion: ctx.engineVersion,
    });
  });

  router.get('/stats', async (_req, res) => {
    const agents = await ctx.store.listAgents();
    const runs = await ctx.store.listRuns();

    const dsrValues: number[] = [];
    const pboValues: number[] = [];
    let anchored = 0;

    for (const run of runs) {
      if (run.result) {
        dsrValues.push(run.result.dsr);
        pboValues.push(run.result.pbo);
      }
      const anchor = await ctx.store.getAnchor(run.id);
      if (anchor?.status === 'anchored') anchored++;
    }

    const median = (values: number[]): number | null => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    };

    const count = (status: string): number => agents.filter((a) => a.status === status).length;

    res.json({
      total: agents.length,
      certified: count('certified'),
      insignificant: count('insignificant'),
      unverified: count('unverified'),
      verifying: count('verifying'),
      medianDsr: median(dsrValues),
      medianPbo: median(pboValues),
      anchored,
      totalRuns: runs.length,
    });
  });

  return router;
}
