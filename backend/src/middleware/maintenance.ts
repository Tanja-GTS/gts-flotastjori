import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// Maintenance mode: while MAINTENANCE_MODE=true, everyone gets an "under
// maintenance" page (or a 503 from the API) instead of the app, so nobody
// works on data while it is being fixed.
//
// Whoever is doing the work opens the app once with
//   ?maintenance_key=<MAINTENANCE_BYPASS_KEY>
// which sets a cookie that lets that browser use the app as normal.
//
// Always let through, even in maintenance:
// - /health and /api/health (Render's health check)
// - /confirm (drivers confirming a shift from the email link)
// - /api/report (the daily report email the cron job asks for)

const COOKIE = 'fleet_maint';
const COOKIE_MAX_AGE_S = 12 * 60 * 60;

function isOn(): boolean {
  return ['true', '1', 'yes', 'on'].includes(String(process.env.MAINTENANCE_MODE || '').trim().toLowerCase());
}

function bypassKey(): string {
  return String(process.env.MAINTENANCE_BYPASS_KEY || '').trim();
}

// The cookie holds a hash of the key, never the key itself.
function cookieValueFor(key: string): string {
  return crypto.createHash('sha256').update(`fleet-maintenance:${key}`).digest('hex');
}

function readCookie(req: Request, name: string): string {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function isAlwaysAllowed(path: string): boolean {
  return (
    path === '/health' ||
    path === '/api/health' ||
    path === '/confirm' ||
    path.startsWith('/confirm/') ||
    path === '/api/report' ||
    path.startsWith('/api/report/')
  );
}

function maintenanceMessage(): string {
  return String(process.env.MAINTENANCE_MESSAGE || '').trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function maintenancePage(): string {
  const extra = maintenanceMessage();
  return `<!doctype html>
<html lang="is">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Í viðhaldi · Under maintenance</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; background: #f5f6f8; color: #151922; }
  main { max-width: 440px; margin: 24px 16px; padding: 32px 28px; background: #fff; border: 1px solid #e3e6eb;
         border-radius: 12px; text-align: center; }
  h1 { margin: 0 0 6px; font-size: 22px; }
  h2 { margin: 0 0 18px; font-size: 16px; font-weight: 500; color: #5c6370; }
  p { margin: 0 0 10px; font-size: 15px; line-height: 1.5; }
  .en { color: #5c6370; }
  .note { margin-top: 18px; padding-top: 14px; border-top: 1px solid #eceef2; font-size: 14px; }
</style>
</head>
<body>
<main>
  <h1>Í viðhaldi</h1>
  <h2>Under maintenance</h2>
  <p>Verið er að vinna að kerfinu. Reyndu aftur eftir smá stund.</p>
  <p class="en">We are working on the system. Please try again shortly.</p>
  ${extra ? `<p class="note">${escapeHtml(extra)}</p>` : ''}
</main>
</body>
</html>`;
}

export function maintenanceGate() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isOn()) return next();
    if (isAlwaysAllowed(req.path)) return next();

    const key = bypassKey();
    if (key) {
      const expected = cookieValueFor(key);

      // Opening the app with ?maintenance_key=<key> lets this browser in.
      const given = typeof req.query.maintenance_key === 'string' ? req.query.maintenance_key : '';
      if (given && safeEqual(cookieValueFor(given), expected)) {
        const secure = req.secure || String(req.headers['x-forwarded-proto'] || '') === 'https';
        res.setHeader(
          'Set-Cookie',
          `${COOKIE}=${expected}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
        );
        // Drop the key from the address bar.
        const url = new URL(req.originalUrl, 'http://x');
        url.searchParams.delete('maintenance_key');
        return res.redirect(302, url.pathname + (url.search || ''));
      }

      if (safeEqual(readCookie(req, COOKIE), expected)) {
        // Tell the app it is in maintenance, so it can show a reminder banner.
        res.setHeader('X-Maintenance-Mode', 'bypass');
        return next();
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '600');
    if (req.path.startsWith('/api/') || req.path === '/api') {
      return res.status(503).json({
        ok: false,
        code: 'maintenance',
        error: 'The system is under maintenance. Please try again shortly.',
        message: maintenanceMessage() || undefined,
      });
    }
    return res.status(503).type('html').send(maintenancePage());
  };
}
