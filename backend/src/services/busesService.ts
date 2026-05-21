import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig, getListIds, getShiftInstancesFieldNames, getBusesFieldNames } from './msListsConfig';
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

export async function getBusesListId(): Promise<string> {
  const explicit = optionalEnv('MS_BUSES_LIST_ID', '').trim();
  if (explicit) return explicit;

  const inferredFromLookup = await inferBusesListId();
  const routesListId = optionalEnv('MS_ROUTES_LIST_ID', '').trim();

  // Only trust the inferred lookup list if we can positively confirm it is NOT the Routes list.
  // When MS_ROUTES_LIST_ID is not set we cannot make that check, so fall back to a name-based
  // search. (The original guard `!routesListId || ...` was always true when the env var was
  // absent, silently returning the Routes list as the Buses list.)
  if (inferredFromLookup && routesListId && inferredFromLookup !== routesListId) {
    return inferredFromLookup;
  }

  return inferBusesListIdFromSiteLists();
}

type BusEntry = { id: string; title: string; routeId?: string; routeLabel?: string };
let busesCache: { fetchedAtMs: number; items: BusEntry[] } | null = null;

/**
 * Lists buses from the Buses list.
 *
 * This expects MS_BUSES_LIST_ID to be set to the list ID referenced by bus lookups.
 * If not set, returns an empty list.
 */
export async function listBuses(): Promise<BusEntry[]> {
  const ttlMs = Number(optionalEnv('BUSES_CACHE_TTL_MS', '300000')) || 300000;
  const now = Date.now();
  if (busesCache && now - busesCache.fetchedAtMs < ttlMs) return busesCache.items;

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

  // Collect all Route lookup IDs
  const routeIds = allItems
    .map((item) => {
      // Try to get RouteLookupId or Route (if it's a lookup)
      const fields = item.fields || {};
      return fields['RouteLookupId'] || fields['Route'] || undefined;
    })
    .map(asString)
    .filter((id) => id && !isNaN(Number(id)));

  const busFields = getBusesFieldNames();

  // Map of busId -> bus title
  const busIdToTitle = new Map<string, string>();
  for (const item of allItems) {
    const f = item.fields || {};
    const title =
      (busFields.plate ? asString(f[busFields.plate]) : '') ||
      asString(f.field_1) ||
      asString(f.Plate) ||
      asString(f.plate) ||
      asString(f.LicensePlate) ||
      asString(f.licensePlate) ||
      asString(f.Registration) ||
      asString(f.registration) ||
      asString(f.Title) ||
      asString(f.LinkTitle) ||
      asString(f.Name) ||
      '';
    busIdToTitle.set(String(item.id || ''), title.trim() || String(item.id || ''));
  }

  // Map of routeId -> route label (bus title)
  const routeIdToLabel = new Map<string, string>();
  for (const item of allItems) {
    const id = String(item.id || '');
    const title = busIdToTitle.get(id) || id;
    routeIdToLabel.set(id, title);
  }

  const debugEnabled = String(process.env.DEBUG_LIST_BUSES || '').trim() === '1';
  const debug: Array<{id: string; title: string; routeId: string; routeLabel: string; fields: Record<string, unknown>}> = [];
  const result = allItems
    .map((item) => {
      const id = String(item.id || '');
      const fields = item.fields || {};
      // Route can be a lookup (RouteLookupId) or direct value
      const routeId = asString(fields['RouteLookupId'] || fields['Route'] || '');
      const routeLabel = routeIdToLabel.get(routeId) || '';
      const title = busIdToTitle.get(id) || id;
      if (debugEnabled) debug.push({id, title, routeId, routeLabel, fields});
      return { id, title, routeId: routeId || undefined, routeLabel: routeLabel || undefined };
    })
    .filter((b) => b.id);
  if (debugEnabled) {
    // eslint-disable-next-line no-console
    console.log('[listBuses] debug:', JSON.stringify(debug, null, 2));
  }
  busesCache = { fetchedAtMs: now, items: result };
  return result;
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
