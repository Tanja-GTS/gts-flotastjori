import 'dotenv/config';

const BASE_URL = (process.env.APP_ORIGIN ?? 'https://gts-flotastjori.onrender.com').replace(/\/$/, '');
const WORKSPACES = (process.env.WARMUP_WORKSPACES || 'south').split(',').map((s) => s.trim()).filter(Boolean);

function currentAndNextMonth(): string[] {
  const now = new Date();
  return [0, 1].map((offset) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function warmup() {
  const months = currentAndNextMonth();
  const pairs = WORKSPACES.flatMap((ws) => months.map((m) => ({ ws, m })));

  console.log(`[warmup] ${new Date().toISOString()} — warming ${pairs.length} cache(s) sequentially`);

  let ok = 0;
  for (const { ws, m } of pairs) {
    const url = `${BASE_URL}/api/shifts?workspaceId=${ws}&month=${m}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      console.log(`[warmup] ${res.status} ${url}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ok += 1;
    } catch (err) {
      console.error(`[warmup] failed: ${url} — ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(5_000);
  }

  console.log(`[warmup] done: ${ok}/${pairs.length} succeeded`);
  if (ok < pairs.length) process.exit(1);
}

warmup().catch((err) => {
  console.error('[warmup] fatal:', err);
  process.exit(1);
});
