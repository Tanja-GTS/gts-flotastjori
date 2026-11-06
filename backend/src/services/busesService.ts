import { getGraphAppToken } from './graphAuth';
import { graphGet, graphPatch, graphPost } from './graphClient';
import { HttpError } from '../utils/httpError';
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
let busesFetchInProgress: Promise<BusEntry[]> | null = null;

export async function listBuses(): Promise<BusEntry[]> {
  const ttlMs = Number(optionalEnv('BUSES_CACHE_TTL_MS', '300000')) || 300000;
  const now = Date.now();
  if (busesCache && now - busesCache.fetchedAtMs < ttlMs) return busesCache.items;
  if (busesFetchInProgress) return busesFetchInProgress;

  busesFetchInProgress = (async () => {
    try {
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

      const busFields = getBusesFieldNames();
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

      const routeIdToLabel = new Map<string, string>();
      for (const item of allItems) {
        const id = String(item.id || '');
        routeIdToLabel.set(id, busIdToTitle.get(id) || id);
      }

      const debugEnabled = String(process.env.DEBUG_LIST_BUSES || '').trim() === '1';
      const debug: Array<{id: string; title: string; routeId: string; routeLabel: string; fields: Record<string, unknown>}> = [];
      const result = allItems
        .map((item) => {
          const id = String(item.id || '');
          const fields = item.fields || {};
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
    } finally {
      busesFetchInProgress = null;
    }
  })();
  return busesFetchInProgress;
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


// ---------------------------------------------------------------------------
// Creating and editing buses
//
// In the Buses list the plate is in its own column (field_1 unless
// BUSES_FIELD_PLATE says otherwise) and Title holds the ROUTE NUMBER. Shift
// patterns look routes up through that Title, so it is what shift names are
// built from. Writing a plate into Title renames every shift on that route,
// so a bus edit must only ever touch the plate column.
// ---------------------------------------------------------------------------

// Never "númer"/"number": in this list that can mean the route number.
const PLATE_CANDIDATES = [
  'plate',
  'licenseplate',
  'license plate',
  'registration',
  'bílnúmer',
  'bilnumer',
  'skráningarnúmer',
  'skraningarnumer',
];

let plateColumnCache: { fetchedAtMs: number; name: string } | null = null;

function isWritableColumn(col: GraphColumn): boolean {
  if ((col as any).readOnly === true) return false;
  if ((col as any).hidden === true) return false;
  return true;
}

/**
 * The internal name of the column that holds the plate. Never Title.
 * Empty string when no such column exists, and then nothing may be written.
 */
async function resolveBusPlateColumn(busesListId: string): Promise<string> {
  const ttlMs = Number(optionalEnv('BUSES_COLUMNS_CACHE_TTL_MS', '600000')) || 600000;
  const now = Date.now();
  if (plateColumnCache && now - plateColumnCache.fetchedAtMs < ttlMs) return plateColumnCache.name;

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);
  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(busesListId)}/columns?$top=999`;
  const res = await graphGet<GraphColumnsResponse>(url, token);
  const cols = (res.value || []).filter(isWritableColumn).filter((c) => String(c.name || '') !== 'Title');
  const has = (name: string) => cols.some((c) => String(c.name || '') === name);

  // Same order listBuses() reads the plate in: configured, then field_1.
  const configured = String(getBusesFieldNames().plate || '').trim();
  let name = '';
  if (configured && configured !== 'Title' && has(configured)) {
    name = configured;
  } else if (has('field_1')) {
    name = 'field_1';
  } else {
    const hit = cols.find((c) => {
      const internal = String(c.name || '').trim().toLowerCase();
      const display = String(c.displayName || '').trim().toLowerCase();
      return PLATE_CANDIDATES.includes(internal) || PLATE_CANDIDATES.includes(display);
    });
    name = String(hit?.name || '').trim();
  }

  plateColumnCache = { fetchedAtMs: now, name };
  return name;
}

async function requirePlateColumn(busesListId: string): Promise<string> {
  const plateColumn = await resolveBusPlateColumn(busesListId);
  if (!plateColumn) {
    throw new HttpError(
      500,
      'Could not find the plate column in the Buses list, so nothing was saved. ' +
        'Set BUSES_FIELD_PLATE to its internal column name.'
    );
  }
  return plateColumn;
}

function normalizePlate(raw: unknown): string {
  return asString(raw).trim().replace(/[\s-]+/g, '').toUpperCase();
}

export function invalidateBusesCache(): void {
  busesCache = null;
  plateColumnCache = null;
}

export async function createBus(input: { plate: string }): Promise<BusEntry> {
  // Keep what the manager typed, minus stray outer spaces and doubled spaces.
  const plate = asString(input.plate).trim().replace(/\s+/g, ' ');
  if (!plate) throw new HttpError(400, 'Plate is required');
  if (plate.length > 50) throw new HttpError(400, 'Plate is too long');

  // Two rows with the same plate would make the bus picker ambiguous.
  const existing = await listBuses();
  const key = normalizePlate(plate);
  const clash = existing.find((b) => normalizePlate(b.title) === key);
  if (clash) throw new HttpError(409, `A bus with that plate already exists: ${clash.title}`);

  const busesListId = await getBusesListId();
  if (!busesListId) throw new HttpError(500, 'Could not determine the Buses list id');

  // Plate column only. Title is the route number, and a new bus has no route
  // yet; a manager sets it in SharePoint.
  const plateColumn = await requirePlateColumn(busesListId);
  const fields: Record<string, unknown> = { [plateColumn]: plate };

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);
  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(busesListId)}/items`;

  const created = await graphPost<GraphListItem>(url, token, { fields });

  invalidateBusesCache();

  return { id: String(created?.id || '').trim(), title: plate };
}

export async function updateBus(id: string, input: { plate: string }): Promise<BusEntry> {
  const busId = asString(id).trim();
  if (!/^\d+$/.test(busId)) throw new HttpError(400, 'Invalid bus id');

  const plate = asString(input.plate).trim().replace(/\s+/g, ' ');
  if (!plate) throw new HttpError(400, 'Plate is required');
  if (plate.length > 50) throw new HttpError(400, 'Plate is too long');

  const existing = await listBuses();
  const current = existing.find((b) => b.id === busId);
  if (!current) throw new HttpError(404, 'Bus not found');

  const key = normalizePlate(plate);
  const clash = existing.find((b) => b.id !== busId && normalizePlate(b.title) === key);
  if (clash) throw new HttpError(409, `A bus with that plate already exists: ${clash.title}`);
  if (plate === current.title) return current;

  const busesListId = await getBusesListId();
  if (!busesListId) throw new HttpError(500, 'Could not determine the Buses list id');

  // Plate column only: Title is the route number shift names are built from.
  const plateColumn = await requirePlateColumn(busesListId);
  const fields: Record<string, unknown> = { [plateColumn]: plate };

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);
  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(busesListId)}/items/${encodeURIComponent(busId)}/fields`;

  await graphPatch(url, token, fields);

  invalidateBusesCache();

  return { ...current, title: plate };
}
