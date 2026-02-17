import type { RequestHandler } from 'express';

function misconfiguredAuth(message: string): RequestHandler {
  // Keep the server running, but make the problem obvious.
  // Also allow /api/health to work so you can distinguish "backend down" vs "auth misconfigured".
  return (req, res, next) => {
    if (req.path === '/health') return next();
    return res.status(503).json({
      ok: false,
      error: 'Auth is enabled but misconfigured',
      details: message,
      hint: 'Check backend/.env for ENTRA_TENANT_ID and ENTRA_API_AUDIENCE, then restart the backend.',
    });
  };
}

function isEnabled(): boolean {
  const raw = (process.env.AUTH_ENABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function readRequired(name: string): string {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function readOptional(name: string): string {
  return (process.env[name] || '').trim();
}

function bearerFromHeader(authHeader: unknown): string {
  if (typeof authHeader !== 'string') return '';
  const m = authHeader.match(/^\s*Bearer\s+(.+)\s*$/i);
  return m?.[1]?.trim() || '';
}

function normalizeScopes(scopes: unknown): string[] {
  if (typeof scopes !== 'string') return [];
  return scopes
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Middleware that validates Entra ID access tokens for /api.
// Enable by setting AUTH_ENABLED=true and configuring the ENTRA_* env vars.
export function entraAuth(): RequestHandler {
  if (!isEnabled()) {
    return (_req, _res, next) => next();
  }

  let tenantId = '';
  let audience = '';
  try {
    tenantId = readRequired('ENTRA_TENANT_ID');
    audience = readRequired('ENTRA_API_AUDIENCE');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return misconfiguredAuth(msg);
  }

  const requiredScope = readOptional('ENTRA_REQUIRED_SCOPE') || 'access_as_user';

  // jose is ESM-only; load it dynamically so this backend can remain CommonJS.
  const joseInit = (async () => {
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    const jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/discovery/v2.0/keys`)
    );
    return { jwks, jwtVerify };
  })();

  const issuers = [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    // Some tokens (or older configs) still use this issuer.
    `https://sts.windows.net/${tenantId}/`,
  ];

  return async (req, res, next) => {
    try {
      // Allow unauthenticated health checks.
      if (req.path === '/health') return next();

      const { jwks, jwtVerify } = await joseInit;

      const token = bearerFromHeader(req.headers.authorization);
      if (!token) {
        return res.status(401).json({ ok: false, error: 'Missing Authorization: Bearer <token>' });
      }

      const verified = await jwtVerify(token, jwks, {
        issuer: issuers,
        audience,
      });

      const payload = verified.payload as Record<string, unknown>;
      const scopes = normalizeScopes(payload.scp);
      const roles = Array.isArray(payload.roles) ? payload.roles.filter((r) => typeof r === 'string') : [];

      if (requiredScope) {
        const hasScope = scopes.includes(requiredScope);
        const hasRole = roles.includes(requiredScope);
        if (!hasScope && !hasRole) {
          return res.status(403).json({
            ok: false,
            error: `Missing required scope/role: ${requiredScope}`,
          });
        }
      }

      // Stash a minimal user context for controllers if needed.
      res.locals.user = {
        oid: payload.oid,
        tid: payload.tid,
        name: payload.name,
        preferred_username: payload.preferred_username,
        scp: payload.scp,
        roles: payload.roles,
      };

      return next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unauthorized';
      return res.status(401).json({ ok: false, error: 'Unauthorized', details: message });
    }
  };
}
