import { getGraphAppToken } from './graphAuth';
import { graphPost } from './graphClient';
import { getGraphConfig } from './msListsConfig';
import { optionalEnv } from '../utils/env';

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

function isDelegatedToken(token: string): boolean {
  const payload = decodeJwtPayload(token);
  return typeof payload.scp === 'string' && payload.scp.length > 0;
}

function isAppOnlyToken(token: string): boolean {
  const payload = decodeJwtPayload(token);
  return Array.isArray(payload.roles) && payload.roles.length > 0;
}

function hasScope(token: string, scope: string): boolean {
  const payload = decodeJwtPayload(token);
  const scp = typeof payload.scp === 'string' ? payload.scp : '';
  const scopes = scp.split(' ').map((s) => s.trim()).filter(Boolean);
  return scopes.includes(scope);
}

function parseJsonRecord(value: string): Record<string, string> {
  const trimmed = String(value || '').trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!k) continue;
      const s = v == null ? '' : String(v);
      if (!s.trim()) continue;
      out[String(k)] = s.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function getReplyToForWorkspace(workspaceId?: string): { address: string; name?: string } | null {
  const mapEmails = parseJsonRecord(optionalEnv('WORKSPACE_MANAGER_EMAILS', '').trim());
  const mapNames = parseJsonRecord(optionalEnv('WORKSPACE_MANAGER_NAMES', '').trim());

  const globalEmail = optionalEnv('MAIL_REPLY_TO_EMAIL', '').trim();
  const globalName = optionalEnv('MAIL_REPLY_TO_NAME', '').trim();

  const mappedEmail = workspaceId ? String(mapEmails[workspaceId] || '').trim() : '';
  const mappedName = workspaceId ? String(mapNames[workspaceId] || '').trim() : '';

  const address = mappedEmail || globalEmail;
  if (!address) return null;
  const name = mappedEmail ? mappedName : globalName;
  return { address, name: name || undefined };
}

export async function sendConfirmationEmail(params: {
  to: string;
  subject: string;
  html: string;
  workspaceId?: string;
  replyToEmail?: string;
  replyToName?: string;
}): Promise<void> {
  const graph = getGraphConfig();
  const mailBearerToken = optionalEnv('GRAPH_MAIL_BEARER_TOKEN', '').trim();
  const token = await getGraphAppToken({
    ...graph,
    bearerToken: mailBearerToken || graph.bearerToken,
  });

  if (isDelegatedToken(token) && !hasScope(token, 'Mail.Send')) {
    throw new Error(
      'GRAPH_BEARER_TOKEN is missing the Mail.Send scope. ' +
        'If you copied it from Graph Explorer, go to “Modify permissions” and add Mail.Send (Delegated), consent it, then copy a fresh token.'
    );
  }

  const senderUpn = optionalEnv('MAIL_SENDER_UPN', '').trim();

  // Delegated tokens: send as the signed-in user.
  // App-only tokens: /me is not allowed; you must pick a mailbox and use /users/{id|UPN}/sendMail.
  let url = 'https://graph.microsoft.com/v1.0/me/sendMail';
  if (!isDelegatedToken(token) && isAppOnlyToken(token)) {
    if (!senderUpn) {
      throw new Error(
        'Email sending is using an app-only token, but MAIL_SENDER_UPN is not set. ' +
          'If you just edited backend/.env, restart the backend so it reloads env vars. ' +
          'Either (1) unset AZURE_CLIENT_SECRET to use Device Code (delegated) with Mail.Send, ' +
          'or (2) set MAIL_SENDER_UPN and grant application permission Mail.Send with admin consent.'
      );
    }
    url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUpn)}/sendMail`;
  }

  const explicitReplyToEmail = optionalEnv('MAIL_REPLY_TO_EMAIL', '').trim();
  const replyTo = params.replyToEmail?.trim()
    ? { address: params.replyToEmail.trim(), name: params.replyToName?.trim() || undefined }
    : getReplyToForWorkspace(params.workspaceId) || (explicitReplyToEmail ? { address: explicitReplyToEmail } : null);

  try {
    await graphPost(url, token, {
      message: {
        subject: params.subject,
        body: {
          contentType: 'HTML',
          content: params.html,
        },
        ...(replyTo
          ? {
              replyTo: [
                {
                  emailAddress: {
                    address: replyTo.address,
                    ...(replyTo.name ? { name: replyTo.name } : {}),
                  },
                },
              ],
            }
          : {}),
        toRecipients: [
          {
            emailAddress: {
              address: params.to,
            },
          },
        ],
      },
      saveToSentItems: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // Most common cause: delegated token missing Mail.Send consent/scope.
    if (msg.includes('403') && msg.includes('ErrorAccessDenied')) {
      throw new Error(
        msg +
          ' — This usually means your access token does not include Mail.Send (or admin consent is missing for app-only). ' +
          'If using Device Code, set GRAPH_SCOPES to include https://graph.microsoft.com/Mail.Send, delete backend/.msal-token-cache.json, then restart the backend and sign in again.'
      );
    }
    throw e;
  }
}
