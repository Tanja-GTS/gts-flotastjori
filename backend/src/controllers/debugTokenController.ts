import type { Request, Response } from 'express';
import { getGraphConfig } from '../services/msListsConfig';
import { getGraphAppToken } from '../services/graphAuth';
import { sendApiError } from './apiError';

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

export async function getTokenInfo(_req: Request, res: Response) {
  try {
    const graph = getGraphConfig();
    const token = await getGraphAppToken(graph);
    const payload = decodeJwtPayload(token);

    const scp = typeof payload.scp === 'string' ? payload.scp : '';
    const roles = Array.isArray(payload.roles) ? payload.roles : [];
    const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
    const expiresAt = exp ? new Date(exp * 1000).toISOString() : undefined;

    const scopes = scp
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean);

    const info = {
      ok: true,
      tokenType: scp ? 'delegated' : roles.length ? 'app-only' : 'unknown',
      aud: payload.aud,
      iss: payload.iss,
      scp,
      scopes,
      hasMailSend: scopes.includes('Mail.Send'),
      roles,
      exp,
      expiresAt,
      appid: payload.appid,
      tid: payload.tid,
      upn: payload.upn,
      preferred_username: payload.preferred_username,
    };

    // Do NOT return the token.
    res.json(info);
  } catch (err) {
    sendApiError(res, err);
  }
}
