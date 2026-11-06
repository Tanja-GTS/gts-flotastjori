import { getGraphAppToken } from './graphAuth';
import { graphDelete, graphGet, graphPatch, graphPost } from './graphClient';
import { listShiftPatterns } from './shiftPatternsService';
import { getTemplateDefaults } from './templatesService';
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

type BusEntry = {
  id: string;
  title: string; // the plate
  routeId?: string;
  routeLabel?: string;
  // Title of the row. Shift patterns look routes up through it, so it is
  // what shift names are built from.
  route?: string;
  capacity?: number;
};
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
      // Only needed for capacity; a failure here must not break the bus list.
      let capacityColumn = '';
      try {
        capacityColumn = (await resolveBusColumns(busesListId)).capacity;
      } catch {
        capacityColumn = '';
      }
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
          const route = asString(fields.Title).trim();
          const capacityRaw = capacityColumn ? fields[capacityColumn] : undefined;
          const capacity = capacityRaw == null || capacityRaw === '' ? NaN : Number(capacityRaw);
          return {
            id,
            title,
            routeId: routeId || undefined,
            routeLabel: routeLabel || undefined,
            route: route || undefined,
            capacity: Number.isFinite(capacity) ? capacity : undefined,
          };
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
// Adding, changing and deleting buses
//
// Each row is a bus: plate in its own column (field_1 unless
// BUSES_FIELD_PLATE says otherwise), capacity in a Capacity column, and
// Title holds the ROUTE number. Shift patterns look routes up through that
// Title, so changing Route renames the shifts on that route, and deleting a
// row a pattern uses would leave those shifts without a route. So:
// - a change writes only the fields that actually changed;
// - the plate never goes into Title;
// - a row still used by a pattern, a template, or as the default bus cannot
//   be deleted.
// ---------------------------------------------------------------------------

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

const CAPACITY_CANDIDATES = [
  'capacity',
  'seats',
  'seat capacity',
  'sæti',
  'saeti',
  'sætafjöldi',
  'saetafjoldi',
  'fjöldi sæta',
  'farþegafjöldi',
  'farthegafjoldi',
];

type BusColumns = { plate: string; capacity: string };
let busColumnsCache: { fetchedAtMs: number; listId: string; cols: BusColumns } | null = null;

function isWritableColumn(col: GraphColumn): boolean {
  if ((col as any).readOnly === true) return false;
  if ((col as any).hidden === true) return false;
  return true;
}

/** Internal names of the plate and capacity columns. Never Title; '' when missing. */
async function resolveBusColumns(busesListId: string): Promise<BusColumns> {
  const ttlMs = Number(optionalEnv('BUSES_COLUMNS_CACHE_TTL_MS', '600000')) || 600000;
  const now = Date.now();
  if (busColumnsCache && busColumnsCache.listId === busesListId && now - busColumnsCache.fetchedAtMs < ttlMs) {
    return busColumnsCache.cols;
  }

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);
  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(busesListId)}/columns?$top=999`;
  const res = await graphGet<GraphColumnsResponse>(url, token);
  const cols = (res.value || []).filter(isWritableColumn).filter((c) => String(c.name || '') !== 'Title');
  const has = (name: string) => Boolean(name) && name !== 'Title' && cols.some((c) => String(c.name || '') === name);
  const byName = (candidates: string[], except: string) =>
    String(
      cols.find((c) => {
        const internal = String(c.name || '').trim();
        if (!internal || internal === except) return false;
        const display = String(c.displayName || '').trim().toLowerCase();
        return candidates.includes(internal.toLowerCase()) || candidates.includes(display);
      })?.name || ''
    ).trim();

  // Plate: same order listBuses() reads it in — configured, then field_1.
  const configured = getBusesFieldNames();
  let plate = '';
  if (has(String(configured.plate || '').trim())) plate = String(configured.plate).trim();
  else if (has('field_1')) plate = 'field_1';
  else plate = byName(PLATE_CANDIDATES, '');

  let capacity = '';
  if (has(String(configured.capacity || '').trim())) capacity = String(configured.capacity).trim();
  else capacity = byName(CAPACITY_CANDIDATES, plate);

  const result = { plate, capacity };
  busColumnsCache = { fetchedAtMs: now, listId: busesListId, cols: result };
  return result;
}

function normalizePlate(raw: unknown): string {
  return asString(raw).trim().replace(/[\s-]+/g, '').toUpperCase();
}

function cleanText(raw: unknown): string {
  return asString(raw).trim().replace(/\s+/g, ' ');
}

/** '' clears it; otherwise a whole number of seats. */
function parseCapacity(raw: unknown): number | null {
  const text = asString(raw).trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > 300) {
    throw new HttpError(400, 'Capacity must be a whole number of seats');
  }
  return n;
}

export function invalidateBusesCache(): void {
  busesCache = null;
  busColumnsCache = null;
}

async function busesListContext() {
  const busesListId = await getBusesListId();
  if (!busesListId) throw new HttpError(500, 'Could not determine the Buses list id');
  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);
  const itemsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(busesListId)}/items`;
  return { busesListId, token, itemsUrl };
}

function missingCapacityColumn(): HttpError {
  return new HttpError(
    500,
    'The Buses list has no Capacity column yet, so capacity was not saved. ' +
      'Add a Number column named "Capacity" to the Buses list in SharePoint.'
  );
}

export type BusInput = { plate?: string; route?: string; capacity?: string | number | null };

export async function createBus(input: BusInput): Promise<BusEntry> {
  const plate = cleanText(input.plate);
  const route = cleanText(input.route);
  const capacity = parseCapacity(input.capacity);
  if (!plate) throw new HttpError(400, 'Plate is required');
  if (plate.length > 50) throw new HttpError(400, 'Plate is too long');
  if (route.length > 100) throw new HttpError(400, 'Route is too long');

  // Two rows with the same plate would make the bus picker ambiguous.
  const existing = await listBuses();
  const clash = existing.find((b) => normalizePlate(b.title) === normalizePlate(plate));
  if (clash) throw new HttpError(409, `A bus with that plate already exists: ${clash.title}`);

  const { busesListId, token, itemsUrl } = await busesListContext();
  const columns = await resolveBusColumns(busesListId);
  if (!columns.plate) {
    throw new HttpError(500, 'Could not find the plate column in the Buses list, so nothing was saved.');
  }
  if (capacity != null && !columns.capacity) throw missingCapacityColumn();

  const fields: Record<string, unknown> = { [columns.plate]: plate };
  if (route) fields.Title = route;
  if (capacity != null) fields[columns.capacity] = capacity;

  const created = await graphPost<GraphListItem>(itemsUrl, token, { fields });
  invalidateBusesCache();

  return {
    id: String(created?.id || '').trim(),
    title: plate,
    route: route || undefined,
    capacity: capacity ?? undefined,
  };
}

/**
 * Changes only the fields that are given AND differ from what is stored.
 * A field that is left out is never written.
 */
export async function updateBus(id: string, input: BusInput): Promise<BusEntry> {
  const busId = asString(id).trim();
  if (!/^\d+$/.test(busId)) throw new HttpError(400, 'Invalid bus id');

  const existing = await listBuses();
  const current = existing.find((b) => b.id === busId);
  if (!current) throw new HttpError(404, 'Bus not found');

  const fields: Record<string, unknown> = {};
  const next: BusEntry = { ...current };
  const { busesListId, token, itemsUrl } = await busesListContext();
  const columns = await resolveBusColumns(busesListId);

  if (input.plate !== undefined) {
    const plate = cleanText(input.plate);
    if (!plate) throw new HttpError(400, 'Plate cannot be empty');
    if (plate.length > 50) throw new HttpError(400, 'Plate is too long');
    if (plate !== current.title) {
      const clash = existing.find((b) => b.id !== busId && normalizePlate(b.title) === normalizePlate(plate));
      if (clash) throw new HttpError(409, `A bus with that plate already exists: ${clash.title}`);
      if (!columns.plate) {
        throw new HttpError(500, 'Could not find the plate column in the Buses list, so nothing was saved.');
      }
      fields[columns.plate] = plate;
      next.title = plate;
    }
  }

  if (input.route !== undefined) {
    const route = cleanText(input.route);
    if (!route) throw new HttpError(400, 'Route cannot be empty');
    if (route.length > 100) throw new HttpError(400, 'Route is too long');
    if (route !== asString(current.route).trim()) {
      fields.Title = route;
      next.route = route;
    }
  }

  if (input.capacity !== undefined) {
    const capacity = parseCapacity(input.capacity);
    if (capacity !== (current.capacity ?? null)) {
      if (!columns.capacity) throw missingCapacityColumn();
      fields[columns.capacity] = capacity;
      next.capacity = capacity ?? undefined;
    }
  }

  if (Object.keys(fields).length === 0) return current;

  await graphPatch(`${itemsUrl}/${encodeURIComponent(busId)}/fields`, token, fields);
  invalidateBusesCache();
  return next;
}

/**
 * Deletes a bus row, unless something still points at it: a shift pattern
 * uses it as its route, a template uses it as its bus, or it is the default
 * bus new shifts get.
 */
export async function deleteBus(id: string): Promise<void> {
  const busId = asString(id).trim();
  if (!/^\d+$/.test(busId)) throw new HttpError(400, 'Invalid bus id');

  const existing = await listBuses();
  const current = existing.find((b) => b.id === busId);
  if (!current) throw new HttpError(404, 'Bus not found');
  const label = current.route ? `${current.title} (route ${current.route})` : current.title;

  if (optionalEnv('DEFAULT_BUS_LOOKUP_ID', '').trim() === busId) {
    throw new HttpError(409, `${label} is the default bus for new shifts, so it cannot be deleted.`);
  }

  const { busesListId, token, itemsUrl } = await busesListContext();

  // Patterns point at routes. That is this list when the Routes list is this
  // list, or when it is not configured and so cannot be ruled out.
  const routesListId = optionalEnv('MS_ROUTES_LIST_ID', '').trim();
  const patterns = await listShiftPatterns({ includeInvalid: true });
  if (!routesListId || routesListId === busesListId) {
    const usingRoute = patterns.filter((p) => String(p.routeId || '').trim() === busId);
    if (usingRoute.length > 0) {
      throw new HttpError(
        409,
        `${label} is the route for ${usingRoute.length} shift pattern(s), so deleting it would leave ` +
          'those shifts without a route. It was not deleted.'
      );
    }
  }

  const templateIds = Array.from(
    new Set(patterns.map((p) => String(p.templateId || '').trim()).filter(Boolean))
  );
  const templates = await Promise.all(
    templateIds.map((templateId) => getTemplateDefaults(templateId).catch(() => null))
  );
  const usingBus = templates.filter((t) => t && String(t.busLookupId ?? '') === busId).length;
  if (usingBus > 0) {
    throw new HttpError(
      409,
      `${label} is the bus on ${usingBus} shift template(s), so it cannot be deleted. It was not deleted.`
    );
  }

  await graphDelete(`${itemsUrl}/${encodeURIComponent(busId)}`, token);
  invalidateBusesCache();
}
