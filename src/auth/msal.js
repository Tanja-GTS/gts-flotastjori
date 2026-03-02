import { PublicClientApplication } from '@azure/msal-browser';

function requiredEnv(name) {
  const val = (import.meta.env?.[name] || '').trim();
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
}

// Explicitly disable MSAL/AUTH for fleet-scheduler-staging
export function isMsalConfigured() {
  // Enable MSAL if required env vars are present
  const tenantId = (import.meta.env?.VITE_ENTRA_TENANT_ID || '').trim();
  const clientId = (import.meta.env?.VITE_ENTRA_CLIENT_ID || '').trim();
  const apiScope = (import.meta.env?.VITE_ENTRA_API_SCOPE || '').trim();
  return !!(tenantId && clientId && apiScope);
}

// Get MSAL access token if configured
export async function getMsalAccessToken({ apiScope }) {
  if (!isMsalConfigured()) return '';
  // ...existing code for acquiring token...
}

// Dummy MSAL instance for staging
function getDummyMsalInstance() {
  return {
    initialize: async () => {},
    handleRedirectPromise: async () => null,
    getActiveAccount: () => null,
    getAllAccounts: () => [],
    setActiveAccount: () => {},
    loginRedirect: async () => {},
    acquireTokenSilent: async () => ({ accessToken: '' }),
    acquireTokenRedirect: async () => {},
  };
}

export function getMsalInstance() {
  if (!isMsalConfigured()) return getDummyMsalInstance();
  // ...existing code...
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
  if (!isMsalConfigured()) return getDummyMsalInstance();
  const instance = getMsalInstance();
  await instance.initialize();
  return instance;
}

export async function getSignedInAccount() {
  if (!isMsalConfigured()) return null;
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

