import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APP_URL = (process.env.APP_URL || 'https://gts-flotastjori.onrender.com').trim();

async function main() {
  console.log('[daily-report] Triggering report on web service...');
  // Single request with a long timeout — the web service wakes up from this
  // call and handles everything internally (SharePoint auth + email send).
  const res = await fetch(`${APP_URL}/api/report/daily`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(300_000), // 5 minutes
  });
  const body = await res.json() as any;
  if (!res.ok || body.ok === false) {
    throw new Error(`Report failed: ${body.reason || res.status}${body.results ? ` — ${JSON.stringify(body.results)}` : ''}`);
  }
  console.log('[daily-report] Done:', body.subject);
  if (Array.isArray(body.sent)) console.log('[daily-report] Sent to:', body.sent.join(', ') || '(none)');
  if (Array.isArray(body.failed) && body.failed.length) {
    for (const f of body.failed) console.error(`[daily-report] FAILED ${f.email}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error('[daily-report] Failed:', err);
  process.exit(1);
});
