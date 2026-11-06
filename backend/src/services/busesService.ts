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

// ---------------------------------------------------------------------------
// Bus fields
//
// Each row is a bus. The page shows and edits these fields, each kept in its
// own column, found by the column's name in SharePoint:
//   Route, Plate, Vagn Númer, Tegund (and Capacity, only if that column exists)
// Title is NEVER written by a change: it holds the route number that shift
// patterns look up, so it is what shift names are built from. Writing to it
// renamed shifts once (2026-11-06); it must not happen again.
// ---------------------------------------------------------------------------

export type BusFieldKey = 'route' | 'plate' | 'busNumber' | 'type' | 'capacity';

type BusFieldSpec = {
  key: BusFieldKey;
  names: string[]; // column names that mean this field, compared loosely
  number?: boolean;
  configuredEnv?: string; // an env var that names the column outright
  fallback?: string; // internal name to use when no column has a matching name
};

const BUS_FIELDS: BusFieldSpec[] = [
  { key: 'route', names: ['route', 'leið', 'leid'] },
  {
    key: 'plate',
    names: ['plate', 'bílnúmer', 'license plate', 'licenseplate', 'registration', 'skráningarnúmer'],
    configuredEnv: 'BUSES_FIELD_PLATE',
    // Where plates have always been kept in this list.
    fallback: 'field_1',
  },
  { key: 'busNumber', names: ['vagn númer', 'vagnnúmer', 'vagn nr', 'vagnnr', 'bus number', 'busnumber'] },
  { key: 'type', names: ['tegund', 'type', 'model', 'gerð'] },
  {
    key: 'capacity',
    names: ['capacity', 'seats', 'sæti', 'sætafjöldi', 'fjöldi sæta', 'farþegafjöldi'],
    number: true,
    configuredEnv: 'BUSES_FIELD_CAPACITY',
  },
];

/** Lower case, no accents, no dots, single spaces: "Vagn Númer" -> "vagn numer". */
function looseName(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ð/gi, 'd')
    .replace(/þ/gi, 'th')
    .replace(/æ/gi, 'ae')
    .replace(/\./g, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

export type BusColumns = Partial<Record<BusFieldKey, string>>;
let busColumnsCache: { fetchedAtMs: number; listId: string; cols: BusColumns } | null = null;

function isWritableColumn(col: GraphColumn): boolean {
  if ((col as any).readOnly === true) return false;
  if ((col as any).hidden === true) return false;
  // A lookup is written through <name>LookupId with a row id, not as text.
  if (col.lookup) return false;
  return String(col.name || '') !== 'Title';
}

/** Internal column name for each field that has a column. Never Title. */
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
  const cols = (res.value || []).filter(isWritableColumn);

  const result: BusColumns = {};
  const used = new Set<string>();
  const take = (key: BusFieldKey, name: string) => {
    result[key] = name;
    used.add(name);
  };

  // 1) An env var that names the column outright.
  for (const spec of BUS_FIELDS) {
    const configured = spec.configuredEnv ? optionalEnv(spec.configuredEnv, '').trim() : '';
    if (configured && cols.some((c) => String(c.name || '') === configured) && !used.has(configured)) {
      take(spec.key, configured);
    }
  }
  // 2) A column whose name (shown or internal) matches.
  for (const spec of BUS_FIELDS) {
    if (result[spec.key]) continue;
    const wanted = spec.names.map(looseName);
    const hit = cols.find((c) => {
      const internal = String(c.name || '').trim();
      if (!internal || used.has(internal)) return false;
      return wanted.includes(looseName(c.displayName)) || wanted.includes(looseName(internal));
    });
    if (hit) take(spec.key, String(hit.name).trim());
  }
  // 3) The long-standing fallback (field_1 for the plate).
  for (const spec of BUS_FIELDS) {
    if (result[spec.key] || !spec.fallback) continue;
    if (cols.some((c) => String(c.name || '') === spec.fallback) && !used.has(spec.fallback)) {
      take(spec.key, spec.fallback);
    }
  }

  busColumnsCache = { fetchedAtMs: now, listId: busesListId, cols: result };
  return result;
}

/** Which fields have a column in SharePoint, so the page can show them. */
export async function getBusColumnsInfo(): Promise<Record<BusFieldKey, boolean>> {
  const busesListId = await getBusesListId();
  const cols = busesListId ? await resolveBusColumns(busesListId) : {};
  const info = {} as Record<BusFieldKey, boolean>;
  for (const spec of BUS_FIELDS) info[spec.key] = Boolean(cols[spec.key]);
  return info;
}

type BusEntry = {
  id: string;
  // What shift cards and the bus picker show: the plate, or Title when a row
  // has no plate.
  title: string;
  routeId?: string;
  routeLabel?: string;
  route?: string;
  plate?: string;
  busNumber?: string;
  type?: string;
  capacity?: number;
};
let busesCache: { fetchedAtMs: number; items: BusEntry[] } | null = null;
let busesFetchInProgress: Promise<BusEntry[]> | null = null;

function readField(spec: BusFieldSpec, raw: unknown): string | number | undefined {
  if (raw == null || raw === '') return undefined;
  if (spec.number) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  const text = asString(raw).trim();
  return text || undefined;
}

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

      // A failure here must not break the bus list shift cards depend on.
      let columns: BusColumns = {};
      try {
        columns = await resolveBusColumns(busesListId);
      } catch {
        columns = {};
      }

      const busFields = getBusesFieldNames();
      const busIdToTitle = new Map<string, string>();
      for (const item of allItems) {
        const f = item.fields || {};
        const title =
          (columns.plate ? asString(f[columns.plate]) : '') ||
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
          const entry: BusEntry = {
            id,
            title,
            routeId: routeId || undefined,
            routeLabel: routeLabel || undefined,
          };
          for (const spec of BUS_FIELDS) {
            const column = columns[spec.key];
            if (!column) continue;
            const value = readField(spec, fields[column]);
            if (value !== undefined) (entry as any)[spec.key] = value;
          }
          return entry;
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
 * Resolves bus lookup IDs -> the label shift cards show (the plate).
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
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<BusFieldKey, string> = {
  route: 'Route',
  plate: 'Plate',
  busNumber: 'Vagn Númer',
  type: 'Tegund',
  capacity: 'Capacity',
};

function normalizePlate(raw: unknown): string {
  return asString(raw).trim().replace(/[\s-]+/g, '').toUpperCase();
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

export type BusInput = Partial<Record<BusFieldKey, unknown>>;

/** The value to store: null clears the field. Throws on bad input. */
function parseFieldValue(spec: BusFieldSpec, raw: unknown): string | number | null {
  const text = asString(raw).trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (spec.number) {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 300) {
      throw new HttpError(400, `${FIELD_LABELS[spec.key]} must be a whole number`);
    }
    return n;
  }
  if (text.length > 100) throw new HttpError(400, `${FIELD_LABELS[spec.key]} is too long`);
  return text;
}

function missingColumn(key: BusFieldKey): HttpError {
  return new HttpError(
    400,
    `The Buses list has no "${FIELD_LABELS[key]}" column yet, so it was not saved. ` +
      `Add a column named "${FIELD_LABELS[key]}" to the Buses list in SharePoint.`
  );
}

function assertPlateIsFree(existing: BusEntry[], plate: string, exceptId?: string) {
  const clash = existing.find(
    (b) => b.id !== exceptId && b.plate && normalizePlate(b.plate) === normalizePlate(plate)
  );
  if (clash) throw new HttpError(409, `A bus with that plate already exists: ${clash.plate}`);
}

export async function createBus(input: BusInput): Promise<BusEntry> {
  const values: Partial<Record<BusFieldKey, string | number>> = {};
  for (const spec of BUS_FIELDS) {
    if (input[spec.key] === undefined) continue;
    const value = parseFieldValue(spec, input[spec.key]);
    if (value != null) values[spec.key] = value;
  }
  if (Object.keys(values).length === 0) throw new HttpError(400, 'Fill in at least one field');

  const existing = await listBuses();
  if (values.plate) assertPlateIsFree(existing, String(values.plate));

  const { busesListId, token, itemsUrl } = await busesListContext();
  const columns = await resolveBusColumns(busesListId);

  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(values) as BusFieldKey[]) {
    const column = columns[key];
    if (!column) throw missingColumn(key);
    fields[column] = values[key];
  }
  // SharePoint needs a Title on a new row. On this list Title is the route
  // number shift patterns look up; a new bus has no patterns yet.
  fields.Title = String(values.route ?? values.busNumber ?? values.plate ?? values.type ?? '');

  const created = await graphPost<GraphListItem>(itemsUrl, token, { fields });
  invalidateBusesCache();

  return {
    id: String(created?.id || '').trim(),
    title: String(values.plate ?? fields.Title),
    ...values,
  } as BusEntry;
}

/**
 * Changes only the fields that are given AND differ from what is stored.
 * A field that is left out is never written, and Title never is.
 */
export async function updateBus(id: string, input: BusInput): Promise<BusEntry> {
  const busId = asString(id).trim();
  if (!/^\d+$/.test(busId)) throw new HttpError(400, 'Invalid bus id');

  const existing = await listBuses();
  const current = existing.find((b) => b.id === busId);
  if (!current) throw new HttpError(404, 'Bus not found');

  const { busesListId, token, itemsUrl } = await busesListContext();
  const columns = await resolveBusColumns(busesListId);

  const fields: Record<string, unknown> = {};
  const next: BusEntry = { ...current };
  for (const spec of BUS_FIELDS) {
    if (input[spec.key] === undefined) continue;
    const value = parseFieldValue(spec, input[spec.key]);
    const stored = (current as any)[spec.key] ?? null;
    if (value === stored) continue;
    const column = columns[spec.key];
    if (!column) throw missingColumn(spec.key);
    if (spec.key === 'plate' && value) assertPlateIsFree(existing, String(value), busId);
    fields[column] = value;
    if (value == null) delete (next as any)[spec.key];
    else (next as any)[spec.key] = value;
  }
  if ('Title' in fields) throw new HttpError(500, 'Refusing to write Title');
  if (Object.keys(fields).length === 0) return current;

  await graphPatch(`${itemsUrl}/${encodeURIComponent(busId)}/fields`, token, fields);
  invalidateBusesCache();
  if (next.plate) next.title = next.plate;
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
