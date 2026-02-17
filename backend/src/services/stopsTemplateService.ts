import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig } from './msListsConfig';
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

type GraphColumn = {
  name?: string;
  displayName?: string;
};

type GraphColumnsResponse = {
  value: GraphColumn[];
};

export type StopEventDto =
  | {
      type: 'stop';
      time: string;
      label: string;
    }
  | {
      type: 'break';
      duration: number;
      label?: string;
    };

type StopEventWithKey = {
  tripId: string;
  itemId: string;
  sortKey: number;
  event: StopEventDto;
};

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function normalizeTimeHHMM(value: unknown): string {
  const s = asString(value).trim();
  if (!s) return '';

  // Common forms: "6:30", "06:30", "6.30", "06.30"
  {
    const m = s.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
    if (m) {
      const hhNum = Number(m[1]);
      const mmNum = Number(m[2]);
      if (Number.isFinite(hhNum) && Number.isFinite(mmNum) && hhNum >= 0 && hhNum <= 23 && mmNum >= 0 && mmNum <= 59) {
        return `${String(hhNum).padStart(2, '0')}:${String(mmNum).padStart(2, '0')}`;
      }
    }
  }

  // Digits-only clock times: "0630", "630" => 06:30
  // (We only accept values that can be valid HHMM; keeps most break durations intact.)
  if (/^\d{3,4}$/.test(s)) {
    const digits = s.padStart(4, '0');
    const hhNum = Number(digits.slice(0, 2));
    const mmNum = Number(digits.slice(2));
    if (Number.isFinite(hhNum) && Number.isFinite(mmNum) && hhNum >= 0 && hhNum <= 23 && mmNum >= 0 && mmNum <= 59) {
      return `${String(hhNum).padStart(2, '0')}:${String(mmNum).padStart(2, '0')}`;
    }
  }

  return '';
}

function timeToMinutes(value: string): number | null {
  const m = String(value || '').trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function asNumber(value: unknown): number | undefined {
  if (value == null) return undefined;

  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

  const raw = decodeSharePointEncodedValue(asString(value)).trim();
  if (!raw) return undefined;

  // Handle common human-entered forms: "1", "1.0", "1,0", "1st".
  const normalized = raw.replace(',', '.');
  const m = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeColumnKey(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_]/g, '');
}

let columnsCache:
  | null
  | {
      fetchedAtMs: number;
      listId: string;
      columns: GraphColumn[];
    } = null;

async function listColumnsForStopsTemplate(listId: string): Promise<GraphColumn[]> {
  const ttlMs = Number(optionalEnv('STOPSTEMPLATE_COLUMNS_CACHE_TTL_MS', '300000')) || 300000;
  const now = Date.now();
  if (columnsCache && columnsCache.listId === listId && now - columnsCache.fetchedAtMs < ttlMs) {
    return columnsCache.columns;
  }

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);
  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(listId)}/columns?$top=999`;

  const res = await graphGet<GraphColumnsResponse>(url, token);
  const columns = res.value || [];
  columnsCache = { fetchedAtMs: now, listId, columns };
  return columns;
}

function resolveInternalFieldNameByDisplayName(params: {
  columns: GraphColumn[];
  displayNameCandidates: string[];
}): string | undefined {
  const wanted = new Set(params.displayNameCandidates.map(normalizeColumnKey).filter(Boolean));
  if (wanted.size === 0) return undefined;

  for (const col of params.columns) {
    const internal = asString(col.name).trim();
    const dn = asString(col.displayName).trim();
    if (!internal || !dn) continue;
    if (wanted.has(normalizeColumnKey(dn))) return internal;
  }
  return undefined;
}

function decodeSharePointEncodedValue(value: string): string {
  const s = String(value || '').trim();
  if (!s) return '';
  if (!s.includes(';#')) return s;

  // Common SharePoint multi-value encoding: ";#value;#" or "1;#value".
  const parts = s.split(';#').map((p) => p.trim()).filter(Boolean);
  // Prefer the first non-numeric token.
  const nonNumeric = parts.find((p) => !/^\d+$/.test(p));
  return nonNumeric || parts[0] || '';
}

function parseDurationMinutes(value: unknown): number | undefined {
  if (value == null) return undefined;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  const raw = decodeSharePointEncodedValue(asString(value)).trim();
  if (!raw) return undefined;

  const normalized = raw.replace(',', '.');

  // Plain number ("36", "36.5")
  {
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }

  // Number with units ("36 min", "36m")
  {
    const m = normalized.match(/(\d+(?:\.\d+)?)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }

  // "HH:mm" or "H:mm" ("0:36" => 36)
  {
    const m = normalized.match(/^(\d{1,2})\s*[:.]\s*(\d{2})$/);
    if (m) {
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if (Number.isFinite(hh) && Number.isFinite(mm)) return hh * 60 + mm;
    }
  }

  return undefined;
}

let inferredStopsTemplateListId: string | null = null;

async function inferStopsTemplateListId(): Promise<string> {
  if (inferredStopsTemplateListId != null) return inferredStopsTemplateListId;

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists?$top=999`;

  const res = await graphGet<GraphListsResponse>(url, token);
  const lists = res.value || [];

  const preferred = lists.find((l) => {
    const dn = asString(l.displayName).toLowerCase();
    const n = asString(l.name).toLowerCase();
    return (
      (dn.includes('stop') && dn.includes('template')) ||
      (n.includes('stop') && n.includes('template')) ||
      dn === 'stopstemplate' ||
      n === 'stopstemplate'
    );
  });

  inferredStopsTemplateListId = asString(preferred?.id).trim();
  return inferredStopsTemplateListId;
}

async function getStopsTemplateListId(): Promise<string> {
  const explicit = optionalEnv('MS_STOPS_TEMPLATE_LIST_ID', '').trim();
  if (explicit) return explicit;
  return inferStopsTemplateListId();
}

function readTripLookupId(fields: Record<string, unknown>): string {
  const explicit = optionalEnv('STOPSTEMPLATE_FIELD_TRIP_ID', '').trim();
  const candidates = [explicit, 'Trip', 'TripLookupId', 'trip', 'tripLookupId']
    .map((k) => k.trim())
    .filter(Boolean);

  for (const k of candidates) {
    const direct = fields[k];
    const s = asString(direct).trim();
    if (s) return s;

    const lookup = fields[`${k}LookupId`];
    const ls = asString(lookup).trim();
    if (ls) return ls;
  }

  // Default backing field in your list is TripLookupId.
  const fallback = asString(fields.TripLookupId).trim();
  return fallback;
}

function readStopLabel(fields: Record<string, unknown>): string {
  const raw = (
    asString(fields[optionalEnv('STOPSTEMPLATE_FIELD_STOP_NAME', '').trim()]).trim() ||
    asString(fields.field_1).trim() ||
    asString(fields.StopName).trim() ||
    asString(fields.Title).trim() ||
    asString(fields.LinkTitle).trim() ||
    ''
  );

  return decodeSharePointEncodedValue(raw);
}

function readStopTimeRaw(fields: Record<string, unknown>): string {
  const explicit = optionalEnv('STOPSTEMPLATE_FIELD_TIME', '').trim();
  const raw =
    (explicit ? asString(fields[explicit]) : '') ||
    asString(fields.field_2) ||
    asString(fields.Time) ||
    asString(fields.time) ||
    '';
  return asString(raw).trim();
}

function readSortOrder(fields: Record<string, unknown>, resolvedKey?: string): number | undefined {
  const explicit = optionalEnv('STOPSTEMPLATE_FIELD_SORT_ORDER', '').trim();
  const candidates = [
    explicit,
    resolvedKey || '',
    'SortOrder',
    'sortOrder',
    'Order',
    'order',
    'Sequence',
    'sequence',
  ]
    .map((k) => k.trim())
    .filter(Boolean);

  for (const k of candidates) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
    const n = asNumber(fields[k]);
    if (n != null) return n;
  }
  return undefined;
}

function readEventType(
  fields: Record<string, unknown>,
  resolvedKey?: string
): 'stop' | 'break' | null {
  const explicit = optionalEnv('STOPSTEMPLATE_FIELD_EVENT_TYPE', '').trim();
  const candidates = [explicit, resolvedKey || '', 'EventType', 'eventType', 'Type', 'type']
    .map((k) => k.trim())
    .filter(Boolean);

  for (const k of candidates) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
    const raw = decodeSharePointEncodedValue(asString(fields[k])).trim().toLowerCase();
    if (!raw) continue;
    // Be tolerant: choice values often include extra text ("Coffee break", "Break 1").
    if (
      raw === 'break' ||
      raw.includes('break') ||
      raw === 'pause' ||
      raw.includes('pause') ||
      raw === 'rest' ||
      raw.includes('rest') ||
      raw.includes('lunch') ||
      raw.includes('meal')
    ) {
      return 'break';
    }
    if (raw === 'stop' || raw.includes('stop') || raw === 'drive' || raw.includes('drive')) return 'stop';
  }
  return null;
}

function readDurationMinutes(fields: Record<string, unknown>, resolvedKey?: string): number | undefined {
  const explicit = optionalEnv('STOPSTEMPLATE_FIELD_DURATION', '').trim();
  const candidates = [
    explicit,
    resolvedKey || '',
    'Duration',
    'duration',
    'DurationMin',
    'durationMin',
    'Minutes',
    'minutes',
  ]
    .map((k) => k.trim())
    .filter(Boolean);

  for (const k of candidates) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
    const parsed = parseDurationMinutes(fields[k]);
    if (parsed != null) return parsed;
  }
  return undefined;
}

async function listStopTemplateItems(): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
  const listId = await getStopsTemplateListId();
  if (!listId) return [];

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

  return allItems
    .map((i) => ({ id: asString(i.id).trim(), fields: (i.fields || {}) as Record<string, unknown> }))
    .filter((i) => i.id);
}

export async function getStopsForTripIds(params: {
  tripItemIds: string[];
}): Promise<Map<string, StopEventDto[]>> {
  const unique = Array.from(
    new Set((params.tripItemIds || []).map((s) => asString(s).trim()).filter(Boolean))
  );
  if (unique.length === 0) return new Map();

  const listId = await getStopsTemplateListId();
  const columns = listId ? await listColumnsForStopsTemplate(listId) : [];
  const resolvedSortOrderKey = resolveInternalFieldNameByDisplayName({
    columns,
    displayNameCandidates: ['SortOrder', 'Order', 'Sequence'],
  });
  const resolvedEventTypeKey = resolveInternalFieldNameByDisplayName({
    columns,
    displayNameCandidates: ['EventType', 'Type'],
  });
  const resolvedDurationKey = resolveInternalFieldNameByDisplayName({
    columns,
    displayNameCandidates: ['Duration', 'Minutes', 'BreakDuration'],
  });

  const items = await listStopTemplateItems();
  const { eventsByTrip } = computeStopsForTripIds({
    tripItemIds: unique,
    items,
    resolvedKeys: {
      sortOrderKey: resolvedSortOrderKey,
      eventTypeKey: resolvedEventTypeKey,
      durationKey: resolvedDurationKey,
    },
  });

  return eventsByTrip;
}

type ResolvedStopTemplateKeys = {
  sortOrderKey?: string;
  eventTypeKey?: string;
  durationKey?: string;
};

type DebugStopTemplateRow = {
  itemId: string;
  tripId: string;
  label: string;
  timeRaw: string;
  timeNormalized: string;
  sortOrder?: number;
  explicitType: 'stop' | 'break' | null;
  durationFromField?: number;
  numericTimeDuration?: number;
  isBreak: boolean;
  sortKey: number;
};

function computeStopsForTripIds(params: {
  tripItemIds: string[];
  items: Array<{ id: string; fields: Record<string, unknown> }>;
  resolvedKeys: ResolvedStopTemplateKeys;
  debug?: boolean;
}): {
  eventsByTrip: Map<string, StopEventDto[]>;
  debugRows?: DebugStopTemplateRow[];
} {
  const unique = params.tripItemIds;
  const items = params.items;
  const grouped = new Map<string, StopEventWithKey[]>();
  const debugRows: DebugStopTemplateRow[] = [];

  // Keep per-trip state so we can place breaks right after the preceding timed stop.
  const lastTimedStopMinByTrip = new Map<string, number>();
  const breakSeqByTrip = new Map<string, number>();

  const itemIdToNum = (id: string) => {
    const n = Number(String(id || '').trim());
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };

  const itemsSorted = [...items].sort((a, b) => itemIdToNum(a.id) - itemIdToNum(b.id));

  for (const item of itemsSorted) {
    const fields = item.fields || {};
    const tripId = readTripLookupId(fields);
    if (!tripId || !unique.includes(tripId)) continue;

    const label = readStopLabel(fields);
    const timeRaw = readStopTimeRaw(fields);
    const time = normalizeTimeHHMM(timeRaw) || timeRaw;

    const sortOrder = readSortOrder(fields, params.resolvedKeys.sortOrderKey);
    const explicitType = readEventType(fields, params.resolvedKeys.eventTypeKey);
    const durationFromField = readDurationMinutes(fields, params.resolvedKeys.durationKey);

    const arr = grouped.get(tripId) || [];

    // Decide whether this row is a break.
    // Preferred: explicit EventType or Duration field; fallback: numeric "Time" treated as duration.
    const numericTimeDuration = /^\d+$/.test(timeRaw) ? Number(timeRaw) : NaN;
    const isBreak =
      explicitType === 'break' ||
      (explicitType == null && durationFromField != null) ||
      (explicitType == null && Number.isFinite(numericTimeDuration));

    // Drop empty rows, but keep explicit breaks even if they don't have a time/label.
    if (!isBreak && !label && !time) continue;

    if (isBreak) {
      const duration =
        durationFromField != null
          ? durationFromField
          : Number.isFinite(numericTimeDuration)
            ? numericTimeDuration
            : NaN;

      if (!Number.isFinite(duration) || duration <= 0 || duration > 600) continue;

      const lastMin = lastTimedStopMinByTrip.get(tripId);
      const seq = (breakSeqByTrip.get(tripId) || 0) + 1;
      breakSeqByTrip.set(tripId, seq);

      // If a start time is provided (HH:mm), use it.
      // (We avoid interpreting digits-only values as start time, because they often represent duration.)
      const startMin = timeRaw.includes(':') || timeRaw.includes('.')
        ? timeToMinutes(normalizeTimeHHMM(timeRaw) || timeRaw)
        : null;

      // Sort priority:
      //  1) SortOrder column (if present)
      //  2) Break start time (if present)
      //  3) Immediately after the last timed stop (heuristic)
      //  4) Item id (stable fallback)
      const sortKey =
        sortOrder != null
          ? sortOrder
          : startMin != null
            ? startMin + seq * 0.001
            : lastMin != null
              ? lastMin + seq * 0.001
              : 1_000_000 + itemIdToNum(item.id) / 1000;

      if (params.debug) {
        debugRows.push({
          itemId: item.id,
          tripId,
          label,
          timeRaw,
          timeNormalized: time,
          sortOrder,
          explicitType,
          durationFromField,
          numericTimeDuration: Number.isFinite(numericTimeDuration) ? numericTimeDuration : undefined,
          isBreak: true,
          sortKey,
        });
      }

      arr.push({
        tripId,
        itemId: item.id,
        sortKey,
        event: { type: 'break', duration, label: label || undefined },
      });
    } else {
      const min = timeToMinutes(normalizeTimeHHMM(timeRaw) || timeRaw);

      if (min != null) lastTimedStopMinByTrip.set(tripId, min);
      breakSeqByTrip.set(tripId, 0);

      const sortKey =
        sortOrder != null
          ? sortOrder
          : min != null
            ? min
            : 1_000_000 + itemIdToNum(item.id) / 1000;

      if (params.debug) {
        debugRows.push({
          itemId: item.id,
          tripId,
          label,
          timeRaw,
          timeNormalized: time,
          sortOrder,
          explicitType,
          durationFromField,
          numericTimeDuration: Number.isFinite(numericTimeDuration) ? numericTimeDuration : undefined,
          isBreak: false,
          sortKey,
        });
      }

      arr.push({
        tripId,
        itemId: item.id,
        sortKey,
        event: { type: 'stop', time, label },
      });
    }
    grouped.set(tripId, arr);
  }

  const out = new Map<string, StopEventDto[]>();
  for (const [tripId, arr] of grouped.entries()) {
    const sorted = [...arr].sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return itemIdToNum(a.itemId) - itemIdToNum(b.itemId);
    });
    out.set(tripId, sorted.map((x) => x.event));
  }

  return { eventsByTrip: out, debugRows: params.debug ? debugRows : undefined };
}

export async function debugExplainStopsForTripIds(params: {
  tripItemIds: string[];
}): Promise<{
  listId: string;
  resolvedKeys: ResolvedStopTemplateKeys;
  debugRows: DebugStopTemplateRow[];
  eventsByTrip: Record<string, StopEventDto[]>;
}> {
  const unique = Array.from(
    new Set((params.tripItemIds || []).map((s) => asString(s).trim()).filter(Boolean))
  );
  if (unique.length === 0) {
    return {
      listId: '',
      resolvedKeys: {},
      debugRows: [],
      eventsByTrip: {},
    };
  }

  const listId = await getStopsTemplateListId();
  const columns = listId ? await listColumnsForStopsTemplate(listId) : [];
  const resolvedKeys: ResolvedStopTemplateKeys = {
    sortOrderKey: resolveInternalFieldNameByDisplayName({
      columns,
      displayNameCandidates: ['SortOrder', 'Order', 'Sequence'],
    }),
    eventTypeKey: resolveInternalFieldNameByDisplayName({
      columns,
      displayNameCandidates: ['EventType', 'Type'],
    }),
    durationKey: resolveInternalFieldNameByDisplayName({
      columns,
      displayNameCandidates: ['Duration', 'Minutes', 'BreakDuration'],
    }),
  };

  const items = await listStopTemplateItems();
  const computed = computeStopsForTripIds({
    tripItemIds: unique,
    items,
    resolvedKeys,
    debug: true,
  });

  const eventsByTrip: Record<string, StopEventDto[]> = {};
  for (const [tripId, events] of computed.eventsByTrip.entries()) {
    eventsByTrip[tripId] = events;
  }

  return {
    listId,
    resolvedKeys,
    debugRows: computed.debugRows || [],
    eventsByTrip,
  };
}

export async function debugFindBreakRows(params?: {
  limit?: number;
}): Promise<{
  listId: string;
  resolvedKeys: ResolvedStopTemplateKeys;
  breakRows: DebugStopTemplateRow[];
}> {
  const listId = await getStopsTemplateListId();
  const columns = listId ? await listColumnsForStopsTemplate(listId) : [];
  const resolvedKeys: ResolvedStopTemplateKeys = {
    sortOrderKey: resolveInternalFieldNameByDisplayName({
      columns,
      displayNameCandidates: ['SortOrder', 'Order', 'Sequence'],
    }),
    eventTypeKey: resolveInternalFieldNameByDisplayName({
      columns,
      displayNameCandidates: ['EventType', 'Type'],
    }),
    durationKey: resolveInternalFieldNameByDisplayName({
      columns,
      displayNameCandidates: ['Duration', 'Minutes', 'BreakDuration'],
    }),
  };

  const limit = Math.max(1, Math.min(200, Number(params?.limit ?? 30) || 30));
  const items = await listStopTemplateItems();

  // We can reuse the parser by computing for all trip ids present.
  const tripIds = Array.from(
    new Set(
      items
        .map((i) => readTripLookupId(i.fields || {}))
        .map((s) => asString(s).trim())
        .filter(Boolean)
    )
  );

  const computed = computeStopsForTripIds({
    tripItemIds: tripIds,
    items,
    resolvedKeys,
    debug: true,
  });

  const breakRows = (computed.debugRows || []).filter((r) => r.isBreak).slice(0, limit);
  return { listId, resolvedKeys, breakRows };
}
