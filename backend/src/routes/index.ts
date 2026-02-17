import { Router } from 'express';
import { shiftsRouter } from './shifts';
import { patternsRouter } from './patterns';
import { generateRouter } from './generate';
import { debugRouter } from './debug';
import { busesRouter } from './buses';
import { driversRouter } from './drivers';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fleet-scheduler-backend', api: true });
});

apiRouter.use('/shifts', shiftsRouter);
apiRouter.use('/patterns', patternsRouter);
apiRouter.use('/generate', generateRouter);
apiRouter.use('/debug', debugRouter);
apiRouter.use('/buses', busesRouter);
apiRouter.use('/drivers', driversRouter);
