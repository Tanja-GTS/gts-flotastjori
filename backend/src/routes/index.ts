import { Router } from 'express';
import { shiftsRouter } from './shifts';
import { patternsRouter } from './patterns';
import { generateRouter } from './generate';
import { debugRouter } from './debug';
import { busesRouter } from './buses';
import { driversRouter } from './drivers';
import { workspacesRouter } from './workspaces';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fleet-scheduler-backend', api: true });
});

apiRouter.use('/shifts', shiftsRouter);
apiRouter.use('/patterns', patternsRouter);
apiRouter.use('/generate', generateRouter);
apiRouter.use('/buses', busesRouter);
apiRouter.use('/drivers', driversRouter);
apiRouter.use('/workspaces', workspacesRouter);

function boolEnv(name: string): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
const isProd = nodeEnv === 'production';
const authEnabled = boolEnv('AUTH_ENABLED');
const publicDebugEnabled = boolEnv('PUBLIC_DEBUG_ENDPOINTS');

// Debug endpoints are useful during setup, but they must not be accidentally public in production.
// - In dev/test: always mount.
// - In production: mount only if auth is enabled (so debug is protected), OR if PUBLIC_DEBUG_ENDPOINTS is explicitly enabled.
if (!isProd || authEnabled || publicDebugEnabled) {
  apiRouter.use('/debug', debugRouter);
}
