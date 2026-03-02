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

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fleet-scheduler-backend' });
});

// Optional: serve the built frontend from this same server.
// This makes production deployment simpler (single origin for frontend + /api).
const serveFrontendEnv = String(process.env.SERVE_FRONTEND || '').trim().toLowerCase();
const isRender = Boolean(process.env.RENDER) || Boolean(process.env.RENDER_EXTERNAL_URL) || Boolean(process.env.RENDER_SERVICE_ID);
const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const serveFrontend = serveFrontendEnv === 'true' || ((isRender || isProd) && serveFrontendEnv !== 'false');

function pickDistPath(): string | null {
  const candidates = [
    // When running from backend/ (Render serviceRoot=backend): backend/dist
    path.resolve(__dirname, '..', 'dist'),
    // When running from repo root without copying dist: ../dist (from backend/src)
    path.resolve(__dirname, '..', '..', 'dist'),
    // Fallbacks based on cwd
    path.resolve(process.cwd(), 'dist'),
    path.resolve(process.cwd(), '..', 'dist'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(path.join(p, 'index.html'))) return p;
    } catch {
      // ignore
    }
  }
  return null;
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

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  if (serveFrontend) console.log('Serving frontend (dist auto-detected)');
});
