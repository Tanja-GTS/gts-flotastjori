function getBaseUrl() {
  // When running `vite dev`, we proxy `/api` to the backend.
  // If you ever deploy separately, set VITE_BACKEND_URL (e.g. https://api.example.com).
  const base = (import.meta.env?.VITE_BACKEND_URL || '').trim();
  return base;
}

async function getAccessToken() {
  // Optional auth: if Entra config isn't present, run unauthenticated.
  const tenantId = (import.meta.env?.VITE_ENTRA_TENANT_ID || '').trim();
  const clientId = (import.meta.env?.VITE_ENTRA_CLIENT_ID || '').trim();
  const apiScope = (import.meta.env?.VITE_ENTRA_API_SCOPE || '').trim();
  if (!tenantId || !clientId || !apiScope) return '';

  // Dynamic import keeps the app working even if auth isn't configured.
  const { getMsalAccessToken } = await import('../auth/msal.js');
  return getMsalAccessToken({ apiScope });
}

async function withAuth(init = {}) {
  const token = await getAccessToken().catch(() => '');
  if (!token) return init;

  const headers = new Headers(init.headers || {});
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

async function fetchJson(url, init) {
  let res;
  try {
    res = await fetch(url, await withAuth(init));
  } catch (e) {
    // Network errors (no response at all).
    const raw = e instanceof Error ? e.message : String(e);
    if (/failed to fetch/i.test(raw)) {
      throw new Error(
        `Backend not reachable (${String(url)}). ` +
          `Start it with \`npm run dev:reset\` (recommended). ` +
          `If you still get this, run backend+frontend in two terminals: ` +
          `\`npm run backend:dev\` and \`npm run dev:frontend\` (backend port 4000).`
      );
    }
    throw e instanceof Error ? e : new Error(raw);
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');

  if (!res.ok) {
    // Prefer backend-provided structured errors.
    if (body && typeof body === 'object') {
      const err = body;
      const msg =
        (typeof err.error === 'string' && err.error) ||
        (typeof err.message === 'string' && err.message) ||
        (typeof err.details === 'string' && err.details) ||
        `HTTP ${res.status}`;
      const hint = typeof err.hint === 'string' && err.hint ? `\n${err.hint}` : '';
      throw new Error(`${msg}${hint}`);
    }

    const text = typeof body === 'string' ? body : '';
    // Vite proxy / connection-refused cases often surface as plain text with a 500.
    if (/ECONNREFUSED|connect ECONNREFUSED|socket hang up|proxy error/i.test(text)) {
      throw new Error(
        `Backend not reachable (${String(url)}). ` +
          `Start it with \`npm run dev:reset\` (recommended). ` +
          `If you still get this, run backend+frontend in two terminals: ` +
          `\`npm run backend:dev\` and \`npm run dev:frontend\` (backend port 4000).`
      );
    }

    // Vite proxy can return a plain-text 500 with an empty body when the target is down.
    if (
      res.status === 500 &&
      (!text || !String(text).trim()) &&
      typeof url === 'string' &&
      url.includes('/api/')
    ) {
      throw new Error(
        `Backend not reachable (${String(url)}). ` +
          `Start it with \`npm run dev:reset\` (recommended). ` +
          `If you still get this, run backend+frontend in two terminals: ` +
          `\`npm run backend:dev\` and \`npm run dev:frontend\` (backend port 4000).`
      );
    }

    // If the backend returned a useful non-JSON error, show a trimmed version.
    const trimmed = String(text || '').trim();
    if (trimmed) {
      const firstLine = trimmed.split(/\r?\n/)[0];
      throw new Error(firstLine.slice(0, 240));
    }

    throw new Error(`HTTP ${res.status}`);
  }

  return body;
}

export async function fetchShifts({ workspaceId, month }) {
  const base = getBaseUrl();
  const qs = new URLSearchParams();
  if (workspaceId) qs.set('workspaceId', workspaceId);
  if (month) qs.set('month', month);

  const data = await fetchJson(`${base}/api/shifts?${qs.toString()}`);
  return data.shifts || [];
}

export async function generateShifts({ workspaceId, month }) {
  const base = getBaseUrl();
  const qs = new URLSearchParams();
  if (workspaceId) qs.set('workspaceId', workspaceId);
  if (month) qs.set('month', month);

  return fetchJson(`${base}/api/generate/shifts?${qs.toString()}`, { method: 'POST' });
}

export async function fetchBuses() {
  const base = getBaseUrl();
  const data = await fetchJson(`${base}/api/buses`);
  return data.buses || [];
}

export async function fetchDrivers() {
  const base = getBaseUrl();
  const data = await fetchJson(`${base}/api/drivers`);
  return data.drivers || [];
}

export async function fetchShiftById(id) {
  const base = getBaseUrl();
  const data = await fetchJson(`${base}/api/shifts/${encodeURIComponent(id)}`);
  return data.shift || null;
}

export async function assignDriverAndEmail({ shiftId, driverId }) {
  const base = getBaseUrl();
  return fetchJson(`${base}/api/shifts/${encodeURIComponent(shiftId)}/assign-and-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId }),
  });
}

// Assign + email for the whole week-group (weekdays or weekend) that the clicked shift belongs to.
export async function assignWeekAndEmail({ shiftId, driverId }) {
  const base = getBaseUrl();
  return fetchJson(`${base}/api/shifts/${encodeURIComponent(shiftId)}/assign-week-and-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId }),
  });
}

export async function confirmShift({ shiftId, status }) {
  const base = getBaseUrl();
  return fetchJson(`${base}/api/shifts/${encodeURIComponent(shiftId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}
