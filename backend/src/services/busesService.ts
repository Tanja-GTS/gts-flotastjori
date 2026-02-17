import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig, getListIds, getShiftInstancesFieldNames } from './msListsConfig';
import { optionalEnv } from '../utils/env';

type GraphList = {
  id: string;
  displayName?: string;
  name?: string;
};

type GraphListsResponse = {
  value: GraphList[];
};

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

type GraphColumn = Record<string, unknown> & {
  name?: string;
  displayName?: string;
  lookup?: {
    listId?: string;
  };
};

type GraphColumnsResponse = {
  value: GraphColumn[];
};

let inferredBusesListId: string | null = null;
let inferredBusesListIdByName: string | null = null;

async function inferBusesListId(): Promise<string> {
  if (inferredBusesListId != null) return inferredBusesListId;

  const graph = getGraphConfig();
  const lists = getListIds();
  const token = await getGraphAppToken(graph);
  const f = getShiftInstancesFieldNames();

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(lists.shiftInstancesListId)}/columns?$top=999`;

  const res = await graphGet<GraphColumnsResponse>(url, token);
  const cols = res.value || [];

  const busInternal = String(f.busId || '').trim();
  const busCol =
    cols.find((c) => String(c.name || '') === busInternal) ||
    cols.find((c) => String(c.displayName || '') === busInternal) ||
    cols.find((c) => String(c.displayName || '').toLowerCase() === 'busid');

  inferredBusesListId = String(busCol?.lookup?.listId || '').trim() || '';
  return inferredBusesListId;
}

async function inferBusesListIdFromSiteLists(): Promise<string> {
  if (inferredBusesListIdByName != null) return inferredBusesListIdByName;

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists?$top=999`;

  const res = await graphGet<GraphListsResponse>(url, token);
  const lists = res.value || [];

  const pick = lists.find((l) => {
    const dn = String(l.displayName || '').toLowerCase();
    const n = String(l.name || '').toLowerCase();
    return dn.includes('bus') || n.includes('bus');
  });

  inferredBusesListIdByName = String(pick?.id || '').trim() || '';
  return inferredBusesListIdByName;
}

async function getBusesListId(): Promise<string> {
  const explicit = optionalEnv('MS_BUSES_LIST_ID', '').trim();
  if (explicit) return explicit;

  const inferredFromLookup = await inferBusesListId();
  const routesListId = optionalEnv('MS_ROUTES_LIST_ID', '').trim();

  // If the bus lookup seems to point at the Routes list, fall back to a name-based search.
  // This happens when the SharePoint column wiring is wrong, and otherwise the UI shows routes
  // in the bus dropdown.
  if (inferredFromLookup && (!routesListId || inferredFromLookup !== routesListId)) {
    return inferredFromLookup;
  }

  return inferBusesListIdFromSiteLists();
}

/**
 * Lists buses from the Buses list.
 *
 * This expects MS_BUSES_LIST_ID to be set to the list ID referenced by bus lookups.
 * If not set, returns an empty list.
 */
export async function listBuses(): Promise<Array<{ id: string; title: string }>> {
  const busesListId = await getBusesListId();
  if (!busesListId) return [];

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

    const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
      graph.siteId
    )}/lists/${encodeURIComponent(busesListId)}/items?$expand=fields&$top=999`;

  const allItems: GraphListItem[] = [];
  let nextUrl: string | undefined = baseUrl;

  while (nextUrl) {
    const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(nextUrl, token);
    allItems.push(...(page.value || []));
    nextUrl = page['@odata.nextLink'];
  }

  return allItems
    .map((item) => {
      const title =
        // Your Buses list uses field_1 as "License Plate".
        asString(item.fields?.field_1) ||
        asString(item.fields?.Plate) ||
        asString(item.fields?.plate) ||
        asString(item.fields?.LicensePlate) ||
        asString(item.fields?.licensePlate) ||
        asString(item.fields?.Registration) ||
        asString(item.fields?.registration) ||
        asString(item.fields?.Title) ||
        asString(item.fields?.LinkTitle) ||
        asString(item.fields?.Name) ||
        '';
      return { id: String(item.id || ''), title: title.trim() || String(item.id || '') };
    })
    .filter((b) => b.id);
}

/**
 * Resolves bus lookup IDs -> bus Title (plate).
 *
 * Requires MS_BUSES_LIST_ID. If not set, returns an empty map.
 */
export async function resolveBusTitles(params: { busIds: string[] }): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(params.busIds.map((s) => String(s).trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  // Reuse listBuses() to avoid duplicating paging logic.
  const buses = await listBuses();
  const map = new Map<string, string>();
  for (const b of buses) {
    if (uniqueIds.includes(b.id)) map.set(b.id, b.title);
  }
  return map;
}
