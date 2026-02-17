import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PublicClientApplication, type Configuration } from '@azure/msal-node';
import dotenv from 'dotenv';
import { optionalEnv, requireEnv } from '../utils/env';

function getScopes(): string[] {
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
  // Matches backend/src/services/graphAuth.ts behavior.
  const cwd = process.cwd();
  const base = path.basename(cwd);
  if (base !== 'backend') return path.join(cwd, 'backend', '.msal-token-cache.json');
  return path.join(cwd, '.msal-token-cache.json');
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

async function main() {
  // Load env vars for local/dev usage.
  // Support running from repo root or from backend/.
  dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });

  const tenantId = optionalEnv('AZURE_TENANT_ID', 'organizations');
  const clientId = requireEnv('AZURE_CLIENT_ID');

  const authority = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`;
  const config: Configuration = {
    auth: { clientId, authority },
  };

  const pca = new PublicClientApplication(config);
  await loadTokenCache(pca);

  const scopes = getScopes();

  // First try silent with any cached account.
  try {
    const accounts = await pca.getTokenCache().getAllAccounts();
    const account = accounts?.[0];
    if (account) {
      const silent = await pca.acquireTokenSilent({ account, scopes });
      if (silent?.accessToken) {
        await saveTokenCache(pca);
        // eslint-disable-next-line no-console
        console.log('Graph token cache already valid (silent).');
        return;
      }
    }
  } catch {
    // continue to device code
  }

  const result = await pca.acquireTokenByDeviceCode({
    scopes,
    deviceCodeCallback: (response: { message: string }) => {
      // eslint-disable-next-line no-console
      console.log(response.message);
    },
  });

  if (!result?.accessToken) {
    throw new Error('Device code login did not return an access token');
  }

  await saveTokenCache(pca);
  // eslint-disable-next-line no-console
  console.log('Graph login complete. Token cache saved to:', tokenCachePath());
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
