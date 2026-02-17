import dotenv from 'dotenv';
import path from 'node:path';

// Always try to load backend/.env, even if the process is started from the repo root.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
// Fallback to default behavior (process.cwd()/.env) without overriding existing vars.
dotenv.config();
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { apiRouter } from './routes';
import { entraAuth } from './middleware/entraAuth';

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

app.use('/api', entraAuth(), apiRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fleet-scheduler-backend' });
});

// Optional: serve the built frontend from this same server.
// This makes production deployment simpler (single origin for frontend + /api).
const serveFrontend = String(process.env.SERVE_FRONTEND || '').trim().toLowerCase() === 'true';
if (serveFrontend) {
  const distPath = path.resolve(__dirname, '..', '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  if (serveFrontend) console.log('Serving frontend from /dist');
});
