import { Router, type IRouter } from 'express';

import type { AppContext } from '../context.js';

export function auditRouter(ctx: AppContext): IRouter {
  const router: IRouter = Router();

  router.get('/audit', async (req, res) => {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;

    const events = await ctx.store.listAuditEvents(limit);
    res.json(
      search
        ? events.filter((event) =>
            `${event.actor} ${event.action} ${event.detail}`.toLowerCase().includes(search),
          )
        : events,
    );
  });

  return router;
}
