import { PublicClientApplication } from '@azure/msal-browser';

function requiredEnv(name) {
  const val = (import.meta.env?.[name] || '').trim();
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
}

export function isMsalConfigured() {
  const tenantId = (import.meta.env?.VITE_ENTRA_TENANT_ID || '').trim();
  const clientId = (import.meta.env?.VITE_ENTRA_CLIENT_ID || '').trim();
  const apiScope = (import.meta.env?.VITE_ENTRA_API_SCOPE || '').trim();
  return Boolean(tenantId && clientId && apiScope);
}

let msalInstance;

export function getMsalInstance() {
  if (msalInstance) return msalInstance;

  const tenantId = (import.meta.env?.VITE_ENTRA_TENANT_ID || '').trim();
  const clientId = (import.meta.env?.VITE_ENTRA_CLIENT_ID || '').trim();

  if (!tenantId || !clientId) {
    throw new Error('MSAL not configured (set VITE_ENTRA_TENANT_ID and VITE_ENTRA_CLIENT_ID)');
  }

  msalInstance = new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: {
      cacheLocation: 'localStorage',
      storeAuthStateInCookie: false,
    },
  });

  return msalInstance;
}

export async function ensureMsalInitialized() {
  const instance = getMsalInstance();
  await instance.initialize();
  return instance;
}

export async function getSignedInAccount() {
  const instance = await ensureMsalInitialized();
  const result = await instance.handleRedirectPromise();
  if (result?.account) {
    instance.setActiveAccount(result.account);
  }

  const active = instance.getActiveAccount();
  if (active) return active;

  const accounts = instance.getAllAccounts();
  const account = accounts?.[0] || null;
  if (account) instance.setActiveAccount(account);
  return account;
}

export async function startLogin({ apiScope }) {
  const scope = (apiScope || '').trim() || requiredEnv('VITE_ENTRA_API_SCOPE');
  const instance = await ensureMsalInitialized();
  await instance.loginRedirect({
    scopes: ['openid', 'profile', 'email', scope],
  });
}

export async function getMsalAccessToken({ apiScope }) {
  const scope = (apiScope || '').trim() || requiredEnv('VITE_ENTRA_API_SCOPE');

  const instance = await ensureMsalInitialized();

  // If we just returned from redirect, process that first.
  const result = await instance.handleRedirectPromise();
  if (result?.account) {
    instance.setActiveAccount(result.account);
  }

  const account = instance.getActiveAccount() || instance.getAllAccounts()?.[0];

  if (!account) {
    // Interactive sign-in required.
    await instance.loginRedirect({
      scopes: ['openid', 'profile', 'email', scope],
    });
    // Redirecting; return empty string for current call.
    return '';
  }

  try {
    const result = await instance.acquireTokenSilent({
      account,
      scopes: [scope],
    });
    return result?.accessToken || '';
  } catch {
    // Force interactive consent if needed.
    await instance.acquireTokenRedirect({ scopes: [scope] });
    return '';
  }
}
