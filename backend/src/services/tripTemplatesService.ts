import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig } from './msListsConfig';
import { optionalEnv } from '../utils/env';
import { resolveBusTitles } from './busesService';
import { getStopsForTripIds, type StopEventDto } from './stopsTemplateService';

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

export type TripDto = {
  name: string;
  time: string;
  tripItemId?: string;
  busOverride?: string | null;
  events?: Array<Record<string, unknown>>;
};

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function asNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeTimeHHMM(value: unknown): string {
  const m = asString(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const hh = String(Number(m[1])).padStart(2, '0');
  return `${hh}:${m[2]}`;
}

function normalizeTimeRange(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw) return '';
  const parts = raw.split(/[–—-]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return raw;
  const start = normalizeTimeHHMM(parts[0]);
  const end = normalizeTimeHHMM(parts[1]);
  if (!start || !end) return raw;
  return `${start}–${end}`;
}

let inferredTripTemplatesListId: string | null = null;

async function inferTripTemplatesListId(): Promise<string> {
  if (inferredTripTemplatesListId != null) return inferredTripTemplatesListId;

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists?$top=999`;

  const res = await graphGet<GraphListsResponse>(url, token);
  const lists = res.value || [];

  // Prefer exact-ish names first.
  const preferred = lists.find((l) => {
    const dn = asString(l.displayName).toLowerCase();
    const n = asString(l.name).toLowerCase();
    return (
      dn.includes('trip') &&
      dn.includes('template')
    ) || (n.includes('trip') && n.includes('template'));
  });

  inferredTripTemplatesListId = asString(preferred?.id).trim();
  return inferredTripTemplatesListId;
}

async function getTripTemplatesListId(): Promise<string> {
  const explicit = optionalEnv('MS_TRIP_TEMPLATES_LIST_ID', '').trim();
  if (explicit) return explicit;
  return inferTripTemplatesListId();
}

function pickFirst(fields: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const s = asString(fields[k]).trim();
    if (s) return s;
  }
  return '';
}

function pickEvents(fields: Record<string, unknown>): Array<Record<string, unknown>> {
  const keys = [
    optionalEnv('TRIPTEMPLATE_FIELD_EVENTS', ''),
    'events',
    'Events',
    'EventsJson',
    'eventsJson',
    'Stops',
    'stops',
  ]
    .map((k) => asString(k).trim())
    .filter(Boolean);

  for (const k of keys) {
    const raw = fields[k];
    if (Array.isArray(raw)) {
      return raw.filter((e) => e && typeof e === 'object') as Array<Record<string, unknown>>;
    }
    const text = asString(raw).trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.filter((e) => e && typeof e === 'object') as Array<Record<string, unknown>>;
      }
    } catch {
      // ignore
    }
  }

  return [];
}

function readTemplateLookupId(fields: Record<string, unknown>): string {
  const explicit = optionalEnv('TRIPTEMPLATE_FIELD_TEMPLATE_ID', '').trim();
  const candidates = [
    explicit,
    'templateId',
    'Template',
    'TemplateLookupId',
    'TemplateId',
    'ShiftTemplate',
    'ShiftTemplateLookupId',
    // Common backing fields for a lookup column called "Shift" in Microsoft Lists
    'ShiftLookupId',
    'Shift',
  ]
    .map((k) => k.trim())
    .filter(Boolean);

  for (const k of candidates) {
    const direct = fields[k];
    if (direct != null && String(direct).trim()) return asString(direct).trim();
    const lookup = fields[`${k}LookupId`];
    if (lookup != null && String(lookup).trim()) return asString(lookup).trim();
  }

  // Safer fallback heuristic: only consider lookup-id fields that look related to templates.
  // (Avoid accidentally using RouteLookupId / BusLookupId etc, which would yield empty matches.)
  const templateishKeys = Object.keys(fields).filter((k) => {
    const lc = k.toLowerCase();
    if (!lc.endsWith('lookupid')) return false;
    return lc.includes('template');
  });

  for (const k of templateishKeys) {
    const s = asString(fields[k]).trim();
    if (s && /^\d+$/.test(s)) return s;
  }

  return '';
}

let cache:
  | null
  | {
      fetchedAtMs: number;
      items: Array<{ id: string; fields: Record<string, unknown> }>;
    } = null;

async function listTripTemplateItems(): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
  const listId = await getTripTemplatesListId();
  if (!listId) return [];

  const ttlMs = Number(optionalEnv('TRIP_TEMPLATES_CACHE_TTL_MS', '30000')) || 30000;
  const now = Date.now();
  if (cache && now - cache.fetchedAtMs < ttlMs) return cache.items;

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(listId)}/items?$expand=fields&$top=999`;

  const allItems: GraphListItem[] = [];
  let nextUrl: string | undefined = baseUrl;
  while (nextUrl) {
    const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(nextUrl, token);
    allItems.push(...(page.value || []));
    nextUrl = page['@odata.nextLink'];
  }

  const items = allItems
    .map((i) => ({ id: asString(i.id), fields: (i.fields || {}) as Record<string, unknown> }))
    .filter((i) => i.id);

  cache = { fetchedAtMs: now, items };
  return items;
}

function toTripDto(item: { id: string; fields: Record<string, unknown> }): TripDto & {
  templateId: string;
  tripItemId: string;
  sortKey: number;
} | null {
  const fields = item.fields || {};
  const templateId = readTemplateLookupId(fields);
  if (!templateId) return null;

  const name =
    pickFirst(fields, [
      optionalEnv('TRIPTEMPLATE_FIELD_NAME', '').trim(),
      'Title',
      'name',
      'Name',
      'TripName',
      'tripName',
      'LinkTitle',
    ].filter(Boolean)) || `Trip ${item.id}`;

  const timeRaw = pickFirst(fields, [
    optionalEnv('TRIPTEMPLATE_FIELD_TIME', '').trim(),
    'time',
    'Time',
    'TimeRange',
    'timeRange',
  ].filter(Boolean));

  const start = pickFirst(fields, [
    optionalEnv('TRIPTEMPLATE_FIELD_START', '').trim(),
    // Your TripsTemplates list uses field_3/field_4.
    'field_3',
    'startTime',
    'StartTime',
    'start',
    'Start',
  ].filter(Boolean));

  const end = pickFirst(fields, [
    optionalEnv('TRIPTEMPLATE_FIELD_END', '').trim(),
    'field_4',
    'endTime',
    'EndTime',
    'end',
    'End',
  ].filter(Boolean));

  const time =
    normalizeTimeRange(timeRaw) ||
    (normalizeTimeHHMM(start) && normalizeTimeHHMM(end)
      ? `${normalizeTimeHHMM(start)}–${normalizeTimeHHMM(end)}`
      : '');

  const busOverride = pickFirst(fields, [
    optionalEnv('TRIPTEMPLATE_FIELD_BUS_OVERRIDE', '').trim(),
    'busOverride',
    'BusOverride',
    'bus',
    'Bus',
    'BusLookupId',
    'BusPlate',
    'Plate',
  ].filter(Boolean));

  const order =
    asNumber(fields.SortOrder) ||
    asNumber(fields.sortOrder) ||
    asNumber(fields.Order) ||
    asNumber(fields.order) ||
    undefined;

  const sortKey =
    order != null
      ? order
      : (() => {
          const startStr = time.match(/^(\d{2}:\d{2})/); 
          if (!startStr) return Number.MAX_SAFE_INTEGER;
          const [hh, mm] = startStr[1].split(':').map(Number);
          return hh * 60 + mm;
        })();

  return {
    templateId,
    tripItemId: item.id,
    sortKey,
    name,
    time,
    busOverride: busOverride ? busOverride : null,
    events: pickEvents(fields),
  };
}

export async function getTripsForTemplateIds(params: {
  templateIds: string[];
}): Promise<Map<string, TripDto[]>> {
  const unique = Array.from(new Set((params.templateIds || []).map((s) => asString(s).trim()).filter(Boolean)));
  if (unique.length === 0) return new Map();

  const items = await listTripTemplateItems();
  const grouped = new Map<string, Array<ReturnType<typeof toTripDto>>>();

  for (const item of items) {
    const trip = toTripDto(item);
    if (!trip) continue;
    if (!unique.includes(trip.templateId)) continue;
    const arr = grouped.get(trip.templateId) || [];
    arr.push(trip);
    grouped.set(trip.templateId, arr);
  }

  const out = new Map<string, TripDto[]>();

  // Gather all trip item IDs + bus override ids so we can resolve stops + bus plates.
  const allTrips: Array<NonNullable<ReturnType<typeof toTripDto>>> = [];
  for (const tid of unique) {
    const arr = (grouped.get(tid) || []).filter(Boolean) as Array<NonNullable<ReturnType<typeof toTripDto>>>;
    arr.sort((a, b) => a.sortKey - b.sortKey);
    allTrips.push(...arr);
    out.set(
      tid,
      arr.map((t) => ({
        name: t.name,
        time: t.time,
        tripItemId: t.tripItemId,
        busOverride: t.busOverride ?? null,
        events: t.events || [],
      }))
    );
  }

  // Attach StopsTemplate events to trips (keyed by TripsTemplates item id).
  const tripItemIds = Array.from(new Set(allTrips.map((t) => asString(t.tripItemId).trim()).filter(Boolean)));
  const stopsByTripId = await getStopsForTripIds({ tripItemIds });

  // Resolve bus overrides (if lookup IDs) to license plates.
  const busOverrideIds = Array.from(
    new Set(
      allTrips
        .map((t) => asString(t.busOverride).trim())
        .filter((s) => /^\d+$/.test(s))
    )
  );
  const busTitles = await resolveBusTitles({ busIds: busOverrideIds });

  for (const tid of unique) {
    const current = out.get(tid) || [];
    const tripsWithMeta = (grouped.get(tid) || []).filter(Boolean) as Array<NonNullable<ReturnType<typeof toTripDto>>>;
    const metaSorted = [...tripsWithMeta].sort((a, b) => a.sortKey - b.sortKey);

    const patched = current.map((t, idx) => {
      const meta = metaSorted[idx];
      const tripId = meta ? asString(meta.tripItemId).trim() : '';
      const stops = tripId ? (stopsByTripId.get(tripId) || []) : [];

      const override = asString(t.busOverride).trim();
      const resolvedOverride = /^\d+$/.test(override) ? (busTitles.get(override) || override) : (override || null);

      const baseEvents = Array.isArray(t.events) ? (t.events as Array<Record<string, unknown>>) : [];
      const stopEvents = stops as StopEventDto[];

      return {
        ...t,
        busOverride: resolvedOverride,
        events: baseEvents.length > 0 ? baseEvents : (stopEvents as unknown as Array<Record<string, unknown>>),
      };
    });

    out.set(tid, patched);
  }

  return out;
}
