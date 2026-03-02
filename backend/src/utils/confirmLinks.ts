import crypto from 'node:crypto';
import { optionalEnv } from './env';

export type ConfirmLinkPayloadV1 = {
  v: 1;
  shiftId: string; // can be numeric item id or week:<anchorId>
  exp: number; // unix seconds
};

function base64urlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf.toString('base64url');
}

function base64urlDecodeToString(input: string): string {
  return Buffer.from(String(input || ''), 'base64url').toString('utf8');
}

function readSecret(): string {
  // IMPORTANT: must be stable across restarts/deploys, otherwise old email links break.
  return optionalEnv('CONFIRM_LINK_SECRET', '').trim();
}

export function signConfirmLink(payload: ConfirmLinkPayloadV1): string {
  const secret = readSecret();
  if (!secret) {
    throw new Error('Missing CONFIRM_LINK_SECRET (required for email confirmation links)');
  }

  const json = JSON.stringify(payload);
  const body = base64urlEncode(json);
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyConfirmLink(token: string): ConfirmLinkPayloadV1 {
  const secret = readSecret();
  if (!secret) {
    throw new Error('Missing CONFIRM_LINK_SECRET (required for email confirmation links)');
  }

  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) throw new Error('Invalid confirmation token');

  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');

  // Constant-time compare.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid confirmation token');
  }

  const json = base64urlDecodeToString(body);
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('Invalid confirmation token');
  }

  const p = payload as Partial<ConfirmLinkPayloadV1>;
  if (p.v !== 1) throw new Error('Invalid confirmation token');
  const shiftId = String(p.shiftId || '').trim();
  const exp = Number(p.exp);
  if (!shiftId) throw new Error('Invalid confirmation token');
  if (!Number.isFinite(exp) || exp <= 0) throw new Error('Invalid confirmation token');

  const now = Math.floor(Date.now() / 1000);
  if (exp < now) throw new Error('Confirmation link expired');

  return { v: 1, shiftId, exp };
}

export function buildConfirmLinkToken(params: { shiftId: string; ttlDays?: number }): string {
  const ttlDays =
    params.ttlDays != null
      ? Math.max(1, Math.min(120, Math.floor(params.ttlDays)))
      : Math.max(1, Math.min(120, Number(optionalEnv('CONFIRM_LINK_TTL_DAYS', '30')) || 30));

  const exp = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;
  return signConfirmLink({ v: 1, shiftId: String(params.shiftId || '').trim(), exp });
}
