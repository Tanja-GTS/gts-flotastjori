import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig } from './msListsConfig';
import { optionalEnv } from '../utils/env';

type GraphListItem = {
  id: string;
  fields?: Record<string, unknown>;
};

type GraphListItemsResponse = {
  value: GraphListItem[];
  '@odata.nextLink'?: string;
};

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

/**
 * Resolves Route lookup IDs -> Route Title.
 *
 * Requires MS_ROUTES_LIST_ID to be set (the list ID referenced by the Route lookup column).
 * If not set, returns an empty map.
 */
export async function resolveRouteTitles(params: {
  routeIds: string[];
}): Promise<Map<string, string>> {
  const routesListId = optionalEnv('MS_ROUTES_LIST_ID', '').trim();
  if (!routesListId) return new Map();

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const uniqueIds = Array.from(new Set(params.routeIds.map((s) => String(s).trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

    const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
      graph.siteId
    )}/lists/${encodeURIComponent(routesListId)}/items?$expand=fields&$top=999`;

  const allItems: GraphListItem[] = [];
  let nextUrl: string | undefined = baseUrl;

  while (nextUrl) {
    const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(nextUrl, token);
    allItems.push(...(page.value || []));
    nextUrl = page['@odata.nextLink'];
  }

  const map = new Map<string, string>();
  for (const item of allItems) {
    const id = String(item.id || '').trim();
    if (!id) continue;
    if (!uniqueIds.includes(id)) continue;

    const title = asString(item.fields?.Title) || asString(item.fields?.LinkTitle) || '';
    if (title) map.set(id, title);
  }

  return map;
}
