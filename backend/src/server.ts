import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

// Always try to load backend/.env, even if the process is started from the repo root.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
// Fallback to default behavior (process.cwd()/.env) without overriding existing vars.
dotenv.config();
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { apiRouter } from './routes';
import { entraAuth } from './middleware/entraAuth';
import { confirmRouter } from './routes/confirm';
import { warmShiftCache } from './controllers/shiftsController';

const app = express();

const appOrigin = (process.env.APP_ORIGIN || '').trim();
app.use(
  cors({
    origin: appOrigin.length ? [appOrigin] : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api', entraAuth(), apiRouter);

// Email confirmation pages (lightweight HTML; avoids requiring the full React app)
app.use('/confirm', confirmRouter);

type DistPick = { distPath: string; distLocation: 'backend/dist' | 'repo/dist' | 'cwd/dist' | 'parent/dist' };

function pickDist(): DistPick | null {
  const candidates: Array<DistPick> = [
    { distLocation: 'backend/dist', distPath: path.resolve(__dirname, '..', 'dist') },
    { distLocation: 'repo/dist', distPath: path.resolve(__dirname, '..', '..', 'dist') },
    { distLocation: 'cwd/dist', distPath: path.resolve(process.cwd(), 'dist') },
    { distLocation: 'parent/dist', distPath: path.resolve(process.cwd(), '..', 'dist') },
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c.distPath, 'index.html'))) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

app.get('/health', (_req, res) => {
  const serveFrontendEnv = String(process.env.SERVE_FRONTEND || '').trim().toLowerCase();
  const isRender = Boolean(process.env.RENDER) || Boolean(process.env.RENDER_EXTERNAL_URL) || Boolean(process.env.RENDER_SERVICE_ID);
  const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const serveFrontend = serveFrontendEnv === 'true' || ((isRender || isProd) && serveFrontendEnv !== 'false');

  const authEnabledRaw = String(process.env.AUTH_ENABLED || '').trim().toLowerCase();
  const authEnabled = authEnabledRaw === '1' || authEnabledRaw === 'true' || authEnabledRaw === 'yes' || authEnabledRaw === 'on';

  const defaultBusLookupId = String(process.env.DEFAULT_BUS_LOOKUP_ID || '').trim() || null;

  // Render commonly exposes a git commit SHA in env; fall back to empty.
  const gitCommit =
    String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.COMMIT_SHA || '').trim() || null;

  const pickedDist = pickDist();
  const distFound = Boolean(pickedDist);

  res.json({
    ok: true,
    service: 'fleet-scheduler-backend',
    gitCommit,
    render: isRender,
    nodeEnv: String(process.env.NODE_ENV || ''),
    authEnabled,
    serveFrontend,
    distFound,
    distLocation: pickedDist?.distLocation || null,
    defaultBusLookupId,
  });
});

// Optional: serve the built frontend from this same server.
// This makes production deployment simpler (single origin for frontend + /api).
const serveFrontendEnv = String(process.env.SERVE_FRONTEND || '').trim().toLowerCase();
const isRender = Boolean(process.env.RENDER) || Boolean(process.env.RENDER_EXTERNAL_URL) || Boolean(process.env.RENDER_SERVICE_ID);
const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const serveFrontend = serveFrontendEnv === 'true' || ((isRender || isProd) && serveFrontendEnv !== 'false');

process.on('unhandledRejection', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled promise rejection:', err);
});

process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught exception:', err);
});

function pickDistPath(): string | null {
  return pickDist()?.distPath ?? null;
}

if (serveFrontend) {
  const distPath = pickDistPath();
  if (distPath) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn('SERVE_FRONTEND enabled, but no dist/index.html found');
  }
}

const portRaw = String(process.env.PORT || '').trim();
const port = Number.parseInt(portRaw, 10) || 4000;
const host = String(process.env.HOST || '').trim() || '0.0.0.0';

// eslint-disable-next-line no-console
console.log(`Starting backend (render=${isRender}, prod=${isProd}, serveFrontend=${serveFrontend})`);
// eslint-disable-next-line no-console
console.log(`Binding HTTP server on ${host}:${port} (PORT=${portRaw || '<unset>'})`);

const server = app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://${host}:${port}`);
  // eslint-disable-next-line no-console
  if (serveFrontend) console.log('Serving frontend (dist auto-detected)');

  // Warm the shift caches on startup so the first user request is fast.
  // Runs in the background — does not block the server from accepting connections.
  const warmupEnabled = !['false', '0', 'no', 'off'].includes(
    String(process.env.STARTUP_WARMUP ?? 'true').trim().toLowerCase()
  );
  if (warmupEnabled) {
    const workspacesRaw = (process.env.WARMUP_WORKSPACES || 'south,school,airport').trim();
    const workspaces = workspacesRaw.split(',').map((s) => s.trim()).filter(Boolean);

    const now = new Date();
    const months = [0, 1].map((offset) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });

    const pairs = workspaces.flatMap((ws) => months.map((m) => ({ ws, m })));
    // eslint-disable-next-line no-console
    console.log(`[startup] Warming ${pairs.length} shift caches...`);

    // Sequential with a pause between each pair so Graph quota is never flooded.
    // Shared caches (patterns, buses, drivers) are deduplicated across concurrent callers,
    // so user requests that arrive during warmup don't launch duplicate Graph fetches.
    (async () => {
      let ok = 0;
      for (const { ws, m } of pairs) {
        try {
          await warmShiftCache(ws, m);
          // eslint-disable-next-line no-console
          console.log(`[startup] warmed ok: workspaceId=${ws}&month=${m}`);
          ok += 1;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[startup] warm failed: workspaceId=${ws}&month=${m} — ${err instanceof Error ? err.message : String(err)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      // eslint-disable-next-line no-console
      console.log(`[startup] Cache warmup done: ${ok}/${pairs.length} succeeded`);
    })();
  }
});

server.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Server listen error:', err);
});
