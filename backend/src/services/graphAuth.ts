import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  PublicClientApplication,
  type Configuration,
} from '@azure/msal-node';
import { optionalEnv } from '../utils/env';
import { HttpError } from '../utils/httpError';

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let appOnlyCache: TokenCache | null = null;
let delegatedCache: TokenCache | null = null;

function nowMs() {
  return Date.now();
}

function getScopes(): string[] {
  // Comma-separated or space-separated. Examples:
  //   GRAPH_SCOPES="https://graph.microsoft.com/Sites.Read.All"
  //   GRAPH_SCOPES="https://graph.microsoft.com/Sites.ReadWrite.All,offline_access"
  const raw = optionalEnv(
    'GRAPH_SCOPES',
    'https://graph.microsoft.com/Sites.ReadWrite.All https://graph.microsoft.com/Mail.Send offline_access'
  );
  return raw
    .split(/[\s,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
}

function tokenCachePath(): string {
  // Store in backend/ so it survives restarts but is easy to ignore.
  // If the backend is started from the repo root, prefer ./backend/.msal-token-cache.json.
  const cwd = process.cwd();
  const base = path.basename(cwd);
  if (base !== 'backend') {
    const candidate = path.join(cwd, 'backend');
    return path.join(candidate, '.msal-token-cache.json');
  }
  return path.join(cwd, '.msal-token-cache.json');
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
  try {
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isJwtExpired(token: string, skewSeconds = 60): { expired: boolean; exp?: number; expiresAt?: string } {
  const payload = decodeJwtPayload(token);
  const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
  if (!exp) return { expired: false };
  const now = Math.floor(Date.now() / 1000);
  const expired = exp - now <= skewSeconds;
  return { expired, exp, expiresAt: new Date(exp * 1000).toISOString() };
}

async function loadTokenCache(pca: PublicClientApplication) {
  const file = tokenCachePath();
  try {
    const data = await fs.readFile(file, 'utf8');
    pca.getTokenCache().deserialize(data);
  } catch {
    // ignore
  }
}

async function saveTokenCache(pca: PublicClientApplication) {
  const file = tokenCachePath();
  await ensureDir(path.dirname(file));
  const data = pca.getTokenCache().serialize();
  await fs.writeFile(file, data, 'utf8');
}

async function getClientCredentialsToken(params: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  if (appOnlyCache && appOnlyCache.expiresAtMs - nowMs() > 60_000) {
    return appOnlyCache.accessToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    params.tenantId
  )}/oauth2/v2.0/token`;

  const body = new URLSearchParams();
  body.set('client_id', params.clientId);
  body.set('client_secret', params.clientSecret);
  body.set('grant_type', 'client_credentials');
  body.set('scope', 'https://graph.microsoft.com/.default');

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph token request failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  const expiresAtMs = nowMs() + (json.expires_in ?? 3600) * 1000;
  appOnlyCache = { accessToken: json.access_token, expiresAtMs };
  return json.access_token;
}

async function getDeviceCodeToken(params: {
  tenantId: string;
  clientId: string;
}): Promise<string> {
  if (delegatedCache && delegatedCache.expiresAtMs - nowMs() > 60_000) {
    return delegatedCache.accessToken;
  }

  const authority = `https://login.microsoftonline.com/${encodeURIComponent(params.tenantId)}`;
  const config: Configuration = {
    auth: { clientId: params.clientId, authority },
  };
  const pca = new PublicClientApplication(config);
  await loadTokenCache(pca);

  const scopes = getScopes();

  const autoPrompt = optionalEnv('GRAPH_DEVICE_CODE_AUTOPROMPT', 'false').trim().toLowerCase() === 'true';

  // Try silent refresh using cached account first (keeps the backend stable without prompting).
  try {
    const accounts = await pca.getTokenCache().getAllAccounts();
    const account = accounts?.[0];
    if (account) {
      const silent = await pca.acquireTokenSilent({
        account,
        scopes,
      });
      if (silent?.accessToken) {
        const expiresAtMs = silent.expiresOn ? silent.expiresOn.getTime() : nowMs() + 55 * 60 * 1000;
        delegatedCache = { accessToken: silent.accessToken, expiresAtMs };
        return silent.accessToken;
      }
    }
  } catch {
    // Fall back to device code below.
  }

  if (!autoPrompt) {
    // Don't block API requests waiting for an interactive device-code flow.
    // Instead, require the operator to run an explicit login step once.
    throw new HttpError(
      401,
      'Backend Graph access not initialized. For an always-on shared Mac, set AZURE_CLIENT_SECRET in backend/.env (app-only). ' +
        'If you prefer delegated/device-code, run `cd backend && npm run graph:login` and complete the device-code sign-in once, then retry.',
      { code: 'GRAPH_DEVICE_CODE_REQUIRED' }
    );
  }

  const result = await pca.acquireTokenByDeviceCode({
    scopes,
    deviceCodeCallback: (response: { message: string }) => {
      // eslint-disable-next-line no-console
      console.log(response.message);
    },
  });

  await saveTokenCache(pca);

  if (!result?.accessToken) {
    throw new Error('Failed to acquire Graph access token via device code');
  }

  const expiresAtMs = result.expiresOn ? result.expiresOn.getTime() : nowMs() + 55 * 60 * 1000;
  delegatedCache = { accessToken: result.accessToken, expiresAtMs };
  return result.accessToken;
}

// Backwards-compatible name used throughout the codebase.
// If AZURE_CLIENT_SECRET is set, uses app-only client_credentials.
// Otherwise uses delegated Device Code flow (no card/subscription required).
export async function getGraphAppToken(params: {
  bearerToken?: string;
  tenantId: string;
  clientId: string;
  clientSecret?: string;
}): Promise<string> {
  let bearer = (params.bearerToken || '').trim();
  if (bearer.length) {
    // Allow users to paste either a raw JWT or the full "Bearer <token>" value.
    if (/^bearer\s+/i.test(bearer)) bearer = bearer.replace(/^bearer\s+/i, '').trim();

    // Copy/paste from portals sometimes introduces whitespace/newlines.
    bearer = bearer.replace(/[\s\r\n\t]+/g, '');

    // Basic shape check so we fail fast with a helpful message.
    // Access tokens are typically JWS: header.payload.signature
    const looksLikeJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(bearer);
    if (!looksLikeJwt) {
      throw new HttpError(
        401,
        'GRAPH_BEARER_TOKEN does not look like a valid access token. Paste ONLY the raw access token (3 dot-separated parts), not JSON, not an ID token, and not a refresh token.',
        { code: 'GRAPH_TOKEN_MALFORMED' }
      );
    }

    const expInfo = isJwtExpired(bearer, 60);
    if (expInfo.expired) {
      const when = expInfo.expiresAt ? ` (expired at ${expInfo.expiresAt})` : '';

      const secret = (params.clientSecret || '').trim();
      if (secret.length) {
        return getClientCredentialsToken({
          tenantId: params.tenantId,
          clientId: params.clientId,
          clientSecret: secret,
        });
      }

      if (params.clientId && params.clientId.trim().length) {
        return getDeviceCodeToken({ tenantId: params.tenantId, clientId: params.clientId });
      }

      throw new HttpError(
        401,
        `GRAPH_BEARER_TOKEN is expired${when}. Paste a fresh token in backend/.env, or remove it and configure AZURE_CLIENT_ID / AZURE_CLIENT_SECRET for long-running stability.`,
        { code: 'GRAPH_TOKEN_EXPIRED' }
      );
    }

    return bearer;
  }

  const secret = (params.clientSecret || '').trim();
  if (secret.length) {
    return getClientCredentialsToken({
      tenantId: params.tenantId,
      clientId: params.clientId,
      clientSecret: secret,
    });
  }

  if (!params.clientId || !params.clientId.trim()) {
    throw new Error('Missing env var: AZURE_CLIENT_ID (or set GRAPH_BEARER_TOKEN)');
  }

  return getDeviceCodeToken({ tenantId: params.tenantId, clientId: params.clientId });
}
