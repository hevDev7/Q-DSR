import { Router, type IRouter } from 'express';

import type { AppContext } from '../context.js';
import { agentsRouter } from './agents.js';
import { auditRouter } from './audit.js';
import { chainRouter } from './chain.js';
import { evidenceRouter } from './evidence.js';
import healthRouter from './health.js';
import { runsRouter } from './runs.js';

export function createRouter(ctx: AppContext): IRouter {
  const router: IRouter = Router();

  router.use(healthRouter);
  router.use(agentsRouter(ctx));
  router.use(runsRouter(ctx));
  router.use(evidenceRouter(ctx));
  router.use(auditRouter(ctx));
  router.use(chainRouter(ctx));

  return router;
}
