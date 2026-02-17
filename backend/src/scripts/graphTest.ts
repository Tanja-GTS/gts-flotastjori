import path from 'node:path';
import dotenv from 'dotenv';
import { getGraphAppToken } from '../services/graphAuth';
import { graphGet } from '../services/graphClient';
import { getGraphConfig } from '../services/msListsConfig';

type GraphListsResponse = {
  value: Array<{ id: string; displayName?: string; name?: string }>;
};

async function main() {
  // Load env vars for local/dev usage.
  dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists?$top=10`;
  const res = await graphGet<GraphListsResponse>(url, token);
  const lists = res.value || [];

  // eslint-disable-next-line no-console
  console.log(`Graph OK. Site lists returned: ${lists.length}`);
  for (const l of lists.slice(0, 10)) {
    // eslint-disable-next-line no-console
    console.log(`- ${l.displayName || l.name || ''} (${l.id})`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
