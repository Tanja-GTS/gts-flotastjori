import type { Response } from 'express';
import { isHttpError } from '../utils/httpError';

function isLikelyGraphAuthError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('invalidauthenticationtoken') ||
    m.includes('token is expired') ||
    m.includes('lifetime validation failed') ||
    m.includes('graph token')
  );
}

export function sendApiError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : 'Unknown error';

  if (isHttpError(err)) {
    // Special-case Graph auth issues so the UI shows a clear action.
    if (err.status === 401 || err.status === 403 || isLikelyGraphAuthError(message)) {
      res.status(401).json({
        ok: false,
        error: message,
        hint:
          'Graph auth is required. Refresh backend/.env GRAPH_BEARER_TOKEN, or use Device Code auth (AZURE_CLIENT_ID) / client credentials (AZURE_CLIENT_SECRET).',
      });
      return;
    }

    res.status(err.status).json({ ok: false, error: message });
    return;
  }

  if (isLikelyGraphAuthError(message)) {
    res.status(401).json({
      ok: false,
      error: message,
      hint:
        'Graph token expired. Update backend/.env (GRAPH_BEARER_TOKEN) or restart using Device Code / client credentials.',
    });
    return;
  }

  res.status(500).json({ ok: false, error: message });
}
