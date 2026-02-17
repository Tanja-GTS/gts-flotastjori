import { HttpError } from '../utils/httpError';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(res: Response): number {
  const h = res.headers.get('retry-after');
  if (!h) return 0;
  const sec = Number(h);
  if (Number.isFinite(sec) && sec > 0) return Math.min(60_000, Math.round(sec * 1000));
  return 0;
}

async function fetchWithRetry(url: string, init: RequestInit, methodLabel: string): Promise<Response> {
  const maxRetries = 6;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetch(url, init);
    if (res.ok) return res;

    const retryable = res.status === 429 || res.status === 503 || res.status === 504;
    if (!retryable || attempt === maxRetries) return res;

    const retryAfterMs = parseRetryAfterMs(res);
    const base = 500 * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(30_000, Math.max(retryAfterMs, base + jitter));

    // Drain the body to avoid resource leaks in some runtimes.
    try {
      await res.text();
    } catch {
      // ignore
    }

    // eslint-disable-next-line no-console
    console.warn(`Graph ${methodLabel} retrying after ${delay}ms (status ${res.status})`);
    await sleep(delay);
  }

  // Unreachable, but TS likes a return.
  return fetch(url, init);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractGraphError(text: string): { code?: string; message?: string } {
  const parsed = typeof text === 'string' ? tryParseJson(text) : undefined;
  const err =
    parsed && typeof parsed === 'object' && parsed && 'error' in (parsed as any)
      ? (parsed as any).error
      : undefined;

  if (err && typeof err === 'object') {
    const code = typeof (err as any).code === 'string' ? (err as any).code : undefined;
    const message = typeof (err as any).message === 'string' ? (err as any).message : undefined;
    return { code, message };
  }

  return {};
}

function graphHttpError(method: string, status: number, text: string) {
  const g = extractGraphError(text);
  const suffix = g.code || g.message ? ` (${[g.code, g.message].filter(Boolean).join(': ')})` : '';
  return new HttpError(status, `Graph ${method} failed: ${status}${suffix}`, {
    code: g.code,
    details: text,
  });
}

export async function graphGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetchWithRetry(
    url,
    {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      // SharePoint-backed list queries often require indexed columns for $filter/$orderby.
      // This header allows non-indexed queries (with the caveat they may fail on very large lists).
      Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly',
    },
    },
    'GET'
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw graphHttpError('GET', res.status, text);
  }

  return (await res.json()) as T;
}

export async function graphPost<T>(
  url: string,
  accessToken: string,
  body: unknown
): Promise<T> {
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    'POST'
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw graphHttpError('POST', res.status, text);
  }

  // Some endpoints (e.g., /sendMail) return 202 Accepted with no body.
  if (res.status === 202 || res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    return (text as unknown) as T;
  }

  const text = await res.text().catch(() => '');
  if (!text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

export async function graphPatch<T>(
  url: string,
  accessToken: string,
  body: unknown
): Promise<T> {
  const res = await fetchWithRetry(
    url,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    'PATCH'
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw graphHttpError('PATCH', res.status, text);
  }

  // Many PATCH endpoints return 204 No Content.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
