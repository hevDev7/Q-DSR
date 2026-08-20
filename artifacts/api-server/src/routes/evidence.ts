import { Router, type IRouter } from 'express';

import type { AppContext } from '../context.js';
import { generateSampleEvidence } from '../services/sample.js';

export function evidenceRouter(_ctx: AppContext): IRouter {
  const router: IRouter = Router();

  router.post('/evidence/sample', async (req, res) => {
    const { kind, observations, trials, seed } = req.body ?? {};

    if (kind !== 'overfit' && kind !== 'genuine') {
      res.status(422).json({ error: 'kind must be "overfit" or "genuine"', field: 'kind' });
      return;
    }

    res.json(
      generateSampleEvidence({
        kind,
        observations: Number.isFinite(observations) ? observations : undefined,
        trials: Number.isFinite(trials) ? trials : undefined,
        seed: Number.isFinite(seed) ? seed : undefined,
      }),
    );
  });

  return router;
}
