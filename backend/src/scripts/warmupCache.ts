import 'dotenv/config';

const BASE_URL = (process.env.APP_ORIGIN ?? 'https://gts-flotastjori.onrender.com').replace(/\/$/, '');
const WORKSPACES = ['south', 'school', 'airport'];

function currentAndNextMonth(): string[] {
  const now = new Date();
  return [0, 1].map((offset) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

async function warmup() {
  const months = currentAndNextMonth();
  const urls = WORKSPACES.flatMap((ws) =>
    months.map((m) => `${BASE_URL}/api/shifts?workspaceId=${ws}&month=${m}`)
  );

  console.log(`[warmup] ${new Date().toISOString()} — hitting ${urls.length} endpoints`);

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      console.log(`[warmup] ${res.status} ${url}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    })
  );

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    console.error(`[warmup] ${failed.length} request(s) failed`);
    process.exit(1);
  }

  console.log('[warmup] done');
}

warmup().catch((err) => {
  console.error('[warmup] fatal:', err);
  process.exit(1);
});
