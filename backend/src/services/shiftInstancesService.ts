import { getGraphAppToken } from './graphAuth';
import { graphDelete, graphGet, graphPatch, graphPost } from './graphClient';
import {
  getGraphConfig,
  getListIds,
  getShiftInstancesFieldNames,
} from './msListsConfig';
import { listShiftPatterns, type ShiftPatternDto } from './shiftPatternsService';
import { listWorkspaces } from './workspacesService';
import { optionalEnv } from '../utils/env';
import { getTemplateDefaults } from './templatesService';
import { resolveBusTitles } from './busesService';
import { resolveDrivers } from './driversService';
import { getTripsForTemplateIds, type TripDto } from './tripTemplatesService';
import { isHttpError } from '../utils/httpError';

export type ShiftInstanceDto = {
  id: string;
  workspaceId: string;
  date: string; // YYYY-MM-DD
  templateId?: string;
  patternId?: string;
  driverId?: string;
  busId?: string;
  confirmationStatus?: string;
  notes?: string;
  generated?: boolean;
  manualOverride?: boolean;
};

// Hydrated shift object the frontend can use immediately
export type HydratedShiftDto = {
  id: string;
  workspaceId: string;
  // Workspace from the linked pattern (if available).
  // Useful for detecting data issues where a ShiftInstance row has workspaceId='school'
  // but references a ShiftPattern with workspaceId='south'.
  patternWorkspaceId?: string;
  date: string; // YYYY-MM-DD
  route: string;
  routeName?: string;
  shiftType: string;
  // Optional label from the pattern (ex: "weekdays" / "weekend")
  weekPart?: string;
  name: string;
  time: string; // "HH:mm–HH:mm"
  defaultBus?: string;
  driverId?: string;
  driverName?: string;
  driverEmail?: string;
  confirmationStatus?: string;
  notes?: string;
  generated?: boolean;
  manualOverride?: boolean;
  patternId?: string;
  templateId?: string;
  busId?: string;
  trips?: TripDto[];
};

type DeleteGeneratedResult = { deleted: number };

function normalizeWorkspaceSlug(raw: unknown): string {
  return String(raw || '').trim();
}

function isGlobalWorkspaceSlug(slug: string): boolean {
  const s = normalizeWorkspaceSlug(slug).toLowerCase();
  return s === '' || s === 'global' || s === 'all';
}

function pickEffectiveWorkspaceId(instanceWorkspaceId: string, patternWorkspaceId: string): string {
  const inst = normalizeWorkspaceSlug(instanceWorkspaceId);
  const pat = normalizeWorkspaceSlug(patternWorkspaceId);
  if (!pat) return inst;
  if (isGlobalWorkspaceSlug(pat)) return inst;
  return pat;
}

function dedupeHydratedShifts(shifts: HydratedShiftDto[]): HydratedShiftDto[] {
  const byKey = new Map<string, HydratedShiftDto>();
  const passthrough: HydratedShiftDto[] = [];

  for (const s of shifts) {
    if (!s.workspaceId || !s.date || !s.patternId) {
      passthrough.push(s);
      continue;
    }

    const key = `${s.workspaceId}|${s.date}|${s.patternId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, s);
      continue;
    }

    // Prefer manual overrides, then assigned drivers, then notes.
    const score = (x: HydratedShiftDto) => {
      let v = 0;
      if (x.manualOverride) v += 100;
      if (x.driverId) v += 20;
      if (x.notes && String(x.notes).trim()) v += 1;
      return v;
    };
    const a = existing;
    const b = s;
    byKey.set(key, score(b) > score(a) ? b : a);
  }

  return [...byKey.values(), ...passthrough];
}

export async function deleteGeneratedShiftInstances(params: {
  workspaceId: string;
  month: string; // YYYY-MM
}): Promise<DeleteGeneratedResult> {
  const { workspaceId, month } = params;
  const graph = getGraphConfig();
  const lists = getListIds();
  const token = await getGraphAppToken(graph);

  const all = await listShiftInstances({ workspaceId, month });
  const toDelete = all
    .filter((s) => {
      if (!s.generated) return false;
      if (s.manualOverride) return false;

      // Never delete shifts that appear to have been acted on.
      // This prevents a reset from wiping driver assignments / confirmations / notes.
      if (s.driverId) return false;
      if (s.confirmationStatus && String(s.confirmationStatus).trim().toLowerCase() !== 'unassigned') return false;
      if (s.notes && String(s.notes).trim()) return false;

      return true;
    })
    .map((s) => s.id);

  if (toDelete.length === 0) return { deleted: 0 };

  const concurrency = Math.max(1, Math.min(20, Number(optionalEnv('DELETE_CONCURRENCY', '8')) || 8));
  let deleted = 0;

  await runWithConcurrency({
    items: toDelete,
    concurrency,
    worker: async (id) => {
      const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
        graph.siteId
      )}/lists/${encodeURIComponent(lists.shiftInstancesListId)}/items/${encodeURIComponent(id)}`;
      await graphDelete(url, token);
      deleted += 1;
    },
  });

  return { deleted };
}

async function patchShiftInstanceFields(params: {
  itemId: string;
  fields: Record<string, unknown>;
}): Promise<void> {
  const graph = getGraphConfig();
  const lists = getListIds();
  const token = await getGraphAppToken(graph);

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(lists.shiftInstancesListId)}/items/${encodeURIComponent(
    params.itemId
  )}/fields`;

  await graphPatch(url, token, params.fields);
}


export async function assignDriverToShiftInstance(params: {
  itemId: string;
  driverId: string | null | undefined;
}): Promise<void> {
  const fInst = getShiftInstancesFieldNames();
  const driverLookupKey = `${fInst.driverId}LookupId`;
  let fields: Record<string, unknown> = {};
  if (params.driverId == null || params.driverId === '' || params.driverId === 'unassigned') {
    // Unassign: clear the driver lookup field
    fields[driverLookupKey] = null;
  } else {
    fields[driverLookupKey] = Number(params.driverId);
  }
  await patchShiftInstanceFields({
    itemId: params.itemId,
    fields,
  });
}

export async function setShiftInstanceConfirmationStatus(params: {
  itemId: string;
  status: string;
}): Promise<void> {
  const fInst = getShiftInstancesFieldNames();
  const key = fInst.confirmationStatus;
  await patchShiftInstanceFields({
    itemId: params.itemId,
    fields: {
      [`${key}@odata.type`]: 'Collection(Edm.String)',
      [key]: [params.status],
    },
  });
}

type GraphListItem = {
  id: string;
  fields?: Record<string, unknown>;
};

type GraphListItemsResponse = {
  value: GraphListItem[];
  '@odata.nextLink'?: string;
};

type GraphColumn = Record<string, unknown> & {
  name?: string;
  displayName?: string;
  lookup?: {
    listId?: string;
  };
  text?: unknown;
  choice?: unknown;
  multiChoice?: unknown;
};

type GraphColumnsResponse = {
  value: GraphColumn[];
};

type WorkspaceMaps = {
  spItemIdBySlug: Map<string, string>;
  slugBySpItemId: Map<string, string>;
};

let workspaceMapsCache: { fetchedAtMs: number; maps: WorkspaceMaps } | null = null;

async function getWorkspaceMaps(): Promise<WorkspaceMaps> {
  const ttlMs = Number(optionalEnv('WORKSPACES_CACHE_TTL_MS', '300000')) || 300000;
  const now = Date.now();
  if (workspaceMapsCache && now - workspaceMapsCache.fetchedAtMs < ttlMs) return workspaceMapsCache.maps;

  const workspaces = await listWorkspaces();
  const spItemIdBySlug = new Map<string, string>();
  const slugBySpItemId = new Map<string, string>();
  for (const w of workspaces) {
    const slug = String(w.id || '').trim();
    const spId = String((w as any).spItemId || '').trim();
    if (!slug || !spId) continue;
    spItemIdBySlug.set(slug, spId);
    slugBySpItemId.set(spId, slug);
  }

  const maps = { spItemIdBySlug, slugBySpItemId };
  workspaceMapsCache = { fetchedAtMs: now, maps };
  return maps;
}

let workspaceColumnCache:
  | {
      fetchedAtMs: number;
      listId: string;
      internalName: string;
      kind: 'lookup' | 'choice' | 'text' | 'unknown';
      lookupListId?: string;
    }
  | null = null;

async function getWorkspaceColumnInfo(): Promise<{
  kind: 'lookup' | 'choice' | 'text' | 'unknown';
  lookupListId?: string;
}> {
  const ttlMs = Number(optionalEnv('SHIFTINSTANCES_COLUMNS_CACHE_TTL_MS', '300000')) || 300000;
  const now = Date.now();

  const graph = getGraphConfig();
  const lists = getListIds();
  const f = getShiftInstancesFieldNames();
  const listId = String(lists.shiftInstancesListId || '').trim();
  const internalName = String(f.workspaceId || '').trim();

  if (
    workspaceColumnCache &&
    workspaceColumnCache.listId === listId &&
    workspaceColumnCache.internalName === internalName &&
    now - workspaceColumnCache.fetchedAtMs < ttlMs
  ) {
    return {
      kind: workspaceColumnCache.kind,
      lookupListId: workspaceColumnCache.lookupListId,
    };
  }

  const token = await getGraphAppToken(graph);
  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(listId)}/columns?$top=999`;
  const res = await graphGet<GraphColumnsResponse>(url, token);
  const cols = res.value || [];

  const lowerInternal = internalName.toLowerCase();
  const col =
    cols.find((c) => String(c.name || '') === internalName) ||
    cols.find((c) => String(c.displayName || '') === internalName) ||
    cols.find((c) => String(c.displayName || '').toLowerCase() === 'workspaceid') ||
    cols.find((c) => String(c.name || '').toLowerCase() === lowerInternal);

  let kind: 'lookup' | 'choice' | 'text' | 'unknown' = 'unknown';
  let lookupListId: string | undefined;
  if (col?.lookup) {
    kind = 'lookup';
    lookupListId = String(col.lookup.listId || '').trim() || undefined;
  } else if ((col as any)?.choice || (col as any)?.multiChoice) {
    kind = 'choice';
  } else if ((col as any)?.text) {
    kind = 'text';
  }

  workspaceColumnCache = {
    fetchedAtMs: now,
    listId,
    internalName,
    kind,
    lookupListId,
  };

  return { kind, lookupListId };
}

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function readLookupId(fields: Record<string, unknown>, internalName: string): string {
  if (!internalName) return '';
  // For SharePoint/Microsoft Lists lookup columns, Graph often returns:
  // - `<name>LookupId` (the numeric item id in the target list)
  // - `<name>` (the lookup value, usually the target item's Title)
  // Most of our services (patterns/drivers/buses/templates) expect the *id*,
  // so prefer the LookupId when present.
  const lookup = fields[`${internalName}LookupId`];
  if (lookup != null && String(lookup).trim().length) return asString(lookup);

  const direct = fields[internalName];
  if (direct != null && String(direct).trim().length) return asString(direct);

  return '';
}

function asBoolean(value: unknown): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === '0') return false;
  return undefined;
}

function normalizeDate(value: unknown): string {
  return asString(value).slice(0, 10);
}

function readWorkspaceId(params: {
  fields: Record<string, unknown>;
  internalName: string;
  workspaceColumnKind: 'lookup' | 'choice' | 'text' | 'unknown';
  slugBySpItemId?: Map<string, string>;
}): string {
  const { fields, internalName, workspaceColumnKind, slugBySpItemId } = params;

  const direct = asString(fields[internalName]).trim();
  if (direct && workspaceColumnKind !== 'lookup') return direct;

  if (direct && workspaceColumnKind === 'lookup') {
    // Graph sometimes provides the lookup value (ex: Title) directly.
    // If it's already a slug, keep it; if it's numeric, try mapping.
    if (!/^\d+$/.test(direct)) return direct;
    const mapped = slugBySpItemId?.get(direct);
    if (mapped) return mapped;
  }

  const lookupId = asString(fields[`${internalName}LookupId`]).trim();
  if (lookupId) {
    const mapped = slugBySpItemId?.get(lookupId);
    if (mapped) return mapped;
    return lookupId;
  }

  return direct;
}

function normalizeConfirmationStatus(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  const raw = asString(value).trim();
  if (!raw) return undefined;
  const s = raw.toLowerCase();

  // Backward-compat / older deployments
  if (s === 'accepted') return 'assigned';
  if (s === 'rejected') return 'declined';

  // Current canonical set
  if (s === 'assigned') return 'assigned';
  if (s === 'pending') return 'pending';
  if (s === 'declined') return 'declined';
  if (s === 'unassigned') return 'unassigned';

  return s;
}

function confirmationStatusRank(status?: string): number {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'assigned') return 4;
  if (s === 'pending') return 3;
  if (s === 'rejected') return 2;
  if (s === 'unassigned') return 1;
  return 0;
}

function numericIdOrInfinity(id: string): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function pickBetterDuplicate(a: ShiftInstanceDto, b: ShiftInstanceDto): ShiftInstanceDto {
  const score = (s: ShiftInstanceDto) => {
    let v = 0;
    if (s.manualOverride) v += 100;
    if (s.driverId) v += 20;
    v += confirmationStatusRank(s.confirmationStatus);
    if (s.notes && String(s.notes).trim()) v += 1;
    return v;
  };

  const sa = score(a);
  const sb = score(b);
  if (sb > sa) return b;
  if (sa > sb) return a;

  // Stable tie-breaker: keep the oldest numeric list item id.
  return numericIdOrInfinity(b.id) < numericIdOrInfinity(a.id) ? b : a;
}

function dedupeShiftInstances(instances: ShiftInstanceDto[]): ShiftInstanceDto[] {
  const byKey = new Map<string, ShiftInstanceDto>();
  const passthrough: ShiftInstanceDto[] = [];

  for (const inst of instances) {
    if (!inst.workspaceId || !inst.date || !inst.patternId) {
      passthrough.push(inst);
      continue;
    }

    const key = `${inst.workspaceId}|${inst.date}|${inst.patternId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, inst);
      continue;
    }
    byKey.set(key, pickBetterDuplicate(existing, inst));
  }

  return [...byKey.values(), ...passthrough];
}

function monthStartEnd(month: string): { start: string; endExclusive: string } {
  // month: YYYY-MM
  const [yStr, mStr] = month.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m || m < 1 || m > 12) throw new Error('Invalid month. Use YYYY-MM');
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toIso(start), endExclusive: toIso(end) };
}

export async function listShiftInstances(params: {
  workspaceId?: string;
  month?: string; // YYYY-MM
  startDate?: string; // YYYY-MM-DD
  endDateExclusive?: string; // YYYY-MM-DD
}): Promise<ShiftInstanceDto[]> {
  const graph = getGraphConfig();
  const lists = getListIds();
  const f = getShiftInstancesFieldNames();

  const token = await getGraphAppToken(graph);

  const workspaceCol = await getWorkspaceColumnInfo();
  const workspaceMaps = workspaceCol.kind === 'lookup' ? await getWorkspaceMaps() : undefined;

  function odataStringLiteral(raw: string): string {
    // Escape single quotes per OData string rules
    return `'${String(raw).replace(/'/g, "''")}'`;
  }

  function toDateTimeZ(isoDate: string): string {
    return `${String(isoDate).slice(0, 10)}T00:00:00Z`;
  }

  const selectFields = Array.from(
    new Set([
      f.workspaceId,
      ...(workspaceCol.kind === 'lookup' ? [`${f.workspaceId}LookupId`] : []),
      f.date,
      f.templateId,
      `${f.templateId}LookupId`,
      f.patternId,
      `${f.patternId}LookupId`,
      f.driverId,
      `${f.driverId}LookupId`,
      f.busId,
      `${f.busId}LookupId`,
      f.confirmationStatus,
      f.notes,
      f.generated,
      f.manualOverride,
    ])
  ).join(',');

  const filterParts: string[] = [];
  if (params.workspaceId) {
    if (workspaceCol.kind === 'lookup') {
      const spId = workspaceMaps?.spItemIdBySlug.get(String(params.workspaceId).trim());
      if (spId) {
        filterParts.push(`fields/${f.workspaceId}LookupId eq ${odataStringLiteral(spId)}`);
      }
      // If we can't map the slug -> list item id, skip server-side filtering
      // and rely on local filtering below.
    } else {
      filterParts.push(`fields/${f.workspaceId} eq ${odataStringLiteral(params.workspaceId)}`);
    }
  }

  const dateStart = params.startDate || (params.month ? monthStartEnd(params.month).start : undefined);
  const dateEndExcl =
    params.endDateExclusive || (params.month ? monthStartEnd(params.month).endExclusive : undefined);

  if (dateStart && dateEndExcl) {
    // Use an inclusive-exclusive range so month/week queries don't need extra logic.
    filterParts.push(
      `fields/${f.date} ge ${odataStringLiteral(toDateTimeZ(dateStart))} and fields/${f.date} lt ${odataStringLiteral(
        toDateTimeZ(dateEndExcl)
      )}`
    );
  }

  const filter = filterParts.length ? `&$filter=${encodeURIComponent(filterParts.join(' and '))}` : '';

  const baseUrlNoFilter = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(
    lists.shiftInstancesListId
  )}/items?$expand=fields($select=${encodeURIComponent(selectFields)})&$top=999`;

  const baseUrlWithFilter = `${baseUrlNoFilter}${filter}`;

  async function fetchAllItems(url: string): Promise<GraphListItem[]> {
    const all: GraphListItem[] = [];
    let nextUrl: string | undefined = url;
    while (nextUrl) {
      const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(nextUrl, token);
      all.push(...(page.value || []));
      nextUrl = page['@odata.nextLink'];
    }
    return all;
  }

  let allItems: GraphListItem[] = [];
  try {
    allItems = await fetchAllItems(filter ? baseUrlWithFilter : baseUrlNoFilter);
  } catch (err) {
    // If SharePoint rejects non-indexed filters, fall back to an unfiltered scan and filter locally.
    // This makes the API reliable even before indexes are configured.
    const details =
      isHttpError(err) && typeof err.details === 'string' ? (err.details as string) : '';
    const isNonIndexedFilterError =
      isHttpError(err) &&
      err.status === 400 &&
      (err.code === 'invalidRequest' || /invalidRequest/i.test(err.message)) &&
      /cannot be referenced in filter or orderby as it is not indexed/i.test(details);

    if (!filter || !isNonIndexedFilterError) throw err;
    allItems = await fetchAllItems(baseUrlNoFilter);
  }

  const items = allItems
    .map((item) => {
      const fields = item.fields || {};
      const dto: ShiftInstanceDto = {
        id: item.id,
        workspaceId: readWorkspaceId({
          fields,
          internalName: f.workspaceId,
          workspaceColumnKind: workspaceCol.kind,
          slugBySpItemId: workspaceMaps?.slugBySpItemId,
        }),
        date: normalizeDate(fields[f.date]),
        templateId: readLookupId(fields, f.templateId) || undefined,
        patternId: readLookupId(fields, f.patternId) || undefined,
        driverId: readLookupId(fields, f.driverId) || undefined,
        busId: readLookupId(fields, f.busId) || undefined,
        confirmationStatus: normalizeConfirmationStatus(fields[f.confirmationStatus]),
        notes: asString(fields[f.notes]) || undefined,
        generated: asBoolean(fields[f.generated]),
        manualOverride: asBoolean(fields[f.manualOverride]),
      };
      return dto;
    })
    .filter((s) => s.workspaceId && s.date);

  // Filters are ideally applied server-side; keep a tiny safety-net here.
  let filtered = items;
  if (params.workspaceId) filtered = filtered.filter((s) => s.workspaceId === params.workspaceId);
  if (dateStart && dateEndExcl) {
    filtered = filtered.filter((s) => s.date >= dateStart && s.date < dateEndExcl);
  }

  // If shift generation has been run multiple times (especially before we correctly
  // parsed lookup IDs), the list can contain duplicates for the same day/pattern.
  // De-dupe here so the UI shows a single shift per pattern per day.
  return dedupeShiftInstances(filtered);
}

function normalizeDow(dow: string): number | null {
  const s = String(dow || '').trim().slice(0, 3).toLowerCase();
  const map: Record<string, number> = {
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
    sun: 0,
  };
  return Object.prototype.hasOwnProperty.call(map, s) ? map[s] : null;
}

function normalizeDows(dow: string | string[]): number[] {
  if (Array.isArray(dow)) {
    return Array.from(
      new Set(
        dow
          .map((d) => normalizeDow(d))
          .filter((n): n is number => n != null)
      )
    );
  }
  const one = normalizeDow(dow);
  return one == null ? [] : [one];
}

function daysInMonth(month: string): string[] {
  const [yStr, mStr] = month.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m || m < 1 || m > 12) throw new Error('Invalid month. Use YYYY-MM');

  const result: string[] = [];
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    result.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return result;
}

function buildTimeLabel(startTime: string, endTime: string): string {
  return `${startTime}–${endTime}`;
}

async function runWithConcurrency<T>(params: {
  items: T[];
  concurrency: number;
  worker: (item: T, index: number) => Promise<void>;
}): Promise<void> {
  const concurrency = Math.max(1, Math.min(20, Math.floor(params.concurrency || 1)));
  let idx = 0;

  async function next(): Promise<void> {
    const cur = idx;
    idx += 1;
    if (cur >= params.items.length) return;
    await params.worker(params.items[cur], cur);
    return next();
  }

  const runners = Array.from({ length: Math.min(concurrency, params.items.length) }, () => next());
  await Promise.all(runners);
}

function formatPatternLabel(pattern: ShiftPatternDto): string {
  const label = String(pattern.routeName || pattern.route || pattern.id || '').trim();
  return label ? `#${pattern.id} “${label}”` : `#${pattern.id}`;
}

function getPatternMissingFields(pattern: ShiftPatternDto): string[] {
  const missing: string[] = [];
  const hasDay = Array.isArray(pattern.dayOfWeek) ? pattern.dayOfWeek.length > 0 : Boolean(pattern.dayOfWeek);
  if (!String(pattern.route || '').trim()) missing.push('route');
  if (!String(pattern.shiftType || '').trim()) missing.push('shiftType');
  if (!hasDay) missing.push('dayOfWeek');
  if (!String(pattern.startTime || '').trim()) missing.push('startTime');
  if (!String(pattern.endTime || '').trim()) missing.push('endTime');
  return missing;
}

function buildInvalidPatternSummary(workspaceId: string, patterns: ShiftPatternDto[]): string {
  const lines = patterns
    .slice(0, 10)
    .map((p) => `${formatPatternLabel(p)} missing: ${getPatternMissingFields(p).join(', ')}`);
  const more = patterns.length > 10 ? ` (+${patterns.length - 10} more)` : '';
  return (
    `ShiftPatterns for workspace “${workspaceId}” are incomplete. Fix these fields in the ShiftPatterns list, then Generate again:\n` +
    lines.join('\n') +
    more
  );
}

async function loadPatternsForGeneration(params: {
  workspaceId: string;
  strict: boolean;
}): Promise<{ patterns: ShiftPatternDto[]; warnings: string[] }> {
  const patternsAll = await listShiftPatterns({ workspaceId: params.workspaceId, includeInvalid: true });
  const warnings: string[] = [];

  if (patternsAll.length === 0) {
    const message =
      `No ShiftPatterns found for workspace “${params.workspaceId}”. ` +
      `Add rows to the ShiftPatterns list with workspaceId=${params.workspaceId}, then try again.`;
    if (params.strict) throw new Error(message);
    return { patterns: [], warnings: [message] };
  }

  const hasAnyWorkspaceTag = patternsAll.some((p) => String((p as any).workspaceId || '').trim());
  if (!hasAnyWorkspaceTag) {
    const message =
      `ShiftPatterns do not appear to have a usable workspaceId field. ` +
      `Refusing to generate for workspace “${params.workspaceId}” because it would mix patterns across workspaces. ` +
      `Fix by adding a workspaceId column to ShiftPatterns (Text or Lookup), ` +
      `or set PATTERN_FIELD_WORKSPACE_ID to your column’s internal name.`;
    if (params.strict) throw new Error(message);
    return { patterns: [], warnings: [message] };
  }

  const invalid = patternsAll.filter((pattern) => getPatternMissingFields(pattern).length > 0);
  if (invalid.length > 0) {
    const message = buildInvalidPatternSummary(params.workspaceId, invalid);
    if (params.strict) throw new Error(message);
    warnings.push(message);
  }

  return {
    patterns: patternsAll.filter((pattern) => getPatternMissingFields(pattern).length === 0),
    warnings,
  };
}

type PreparedPatternForGeneration = {
  pattern: ShiftPatternDto;
  dows: number[];
  templateLookupId?: number;
  busLookupIdToWrite: number;
};

async function preparePatternForGeneration(params: {
  pattern: ShiftPatternDto;
  defaultBusLookupId: number;
  strict: boolean;
  warnings: string[];
}): Promise<PreparedPatternForGeneration | null> {
  const { pattern, defaultBusLookupId, strict, warnings } = params;
  const dows = normalizeDows(pattern.dayOfWeek);
  if (dows.length === 0) return null;

  const templateId = String(pattern.templateId || '').trim();
  let busLookupIdToWrite: number | undefined;

  if (templateId) {
    try {
      const defaults = await getTemplateDefaults(templateId);
      if (defaults.busLookupId != null) busLookupIdToWrite = defaults.busLookupId;
    } catch (err) {
      if (strict) throw err;
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Skipping ${formatPatternLabel(pattern)}: failed to read template ${templateId} (${message}).`);
      return null;
    }
  }

  if (busLookupIdToWrite == null) {
    if (Number.isFinite(defaultBusLookupId)) {
      busLookupIdToWrite = defaultBusLookupId;
    } else {
      const message =
        'ShiftInstances column busId is required. Set the DEFAULT_BUS_LOOKUP_ID environment variable ' +
        '(e.g. in Render → Service → Environment), or ensure the template has BusLookupId.';
      if (strict) throw new Error(message);
      warnings.push(`Skipping ${formatPatternLabel(pattern)}: ${message}`);
      return null;
    }
  }

  return {
    pattern,
    dows,
    templateLookupId: templateId ? Number(templateId) : undefined,
    busLookupIdToWrite,
  };
}

async function createMissingShiftInstances(params: {
  workspaceId: string;
  month: string;
  strict: boolean;
}): Promise<{ created: number; skipped: number; warnings: string[] }> {
  const { workspaceId, month, strict } = params;

  const graph = getGraphConfig();
  const lists = getListIds();
  const token = await getGraphAppToken(graph);
  const fInst = getShiftInstancesFieldNames();

  const workspaceCol = await getWorkspaceColumnInfo();
  const workspaceMaps = workspaceCol.kind === 'lookup' ? await getWorkspaceMaps() : undefined;
  const { patterns, warnings } = await loadPatternsForGeneration({ workspaceId, strict });

  if (patterns.length === 0) return { created: 0, skipped: 0, warnings };

  const existing = await listShiftInstances({ workspaceId, month });
  const existingKeys = new Set(
    existing
      .map((s) => `${s.date}|${s.patternId || ''}`)
      .filter((k) => !k.endsWith('|'))
  );

  const dates = daysInMonth(month);
  const defaultBusLookupIdRaw = optionalEnv('DEFAULT_BUS_LOOKUP_ID', '').trim();
  const defaultBusLookupId = defaultBusLookupIdRaw ? Number(defaultBusLookupIdRaw) : NaN;
  const concurrency = Math.max(
    1,
    Math.min(20, Number(optionalEnv('GENERATE_CONCURRENCY', '6')) || 6)
  );
  const createUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(lists.shiftInstancesListId)}/items`;

  const preparedPatterns = (
    await Promise.all(
      patterns.map((pattern) =>
        preparePatternForGeneration({
          pattern,
          defaultBusLookupId,
          strict,
          warnings,
        })
      )
    )
  ).filter((value): value is PreparedPatternForGeneration => Boolean(value));

  const toCreate: Array<{ key: string; patternLabel: string; fields: Record<string, unknown> }> = [];
  let created = 0;
  let skipped = 0;

  for (const prepared of preparedPatterns) {
    for (const date of dates) {
      const dateObj = new Date(`${date}T00:00:00`);
      if (!prepared.dows.includes(dateObj.getDay())) continue;

      const key = `${date}|${prepared.pattern.id}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }

      const patternLookupKey = `${fInst.patternId}LookupId`;
      const templateLookupKey = `${fInst.templateId}LookupId`;
      const busLookupKey = `${fInst.busId}LookupId`;

      const fields: Record<string, unknown> = {
        [fInst.date]: `${date}T00:00:00Z`,
        [fInst.generated]: true,
        [fInst.manualOverride]: false,
      };

      if (workspaceCol.kind === 'lookup') {
        const spId = workspaceMaps?.spItemIdBySlug.get(String(workspaceId).trim());
        if (!spId) {
          const message =
            `Workspace “${workspaceId}” is not present in the Workspaces list, but ShiftInstances.workspace is configured as a Lookup. ` +
            `Add the workspace to the Workspaces list (Title = slug), or switch the ShiftInstances workspace column back to Text/Choice.`;
          if (strict) throw new Error(message);
          warnings.push(message);
          return { created, skipped, warnings };
        }
        fields[`${fInst.workspaceId}LookupId`] = Number(spId);
      } else {
        fields[fInst.workspaceId] = workspaceId;
      }

      fields[patternLookupKey] = Number(prepared.pattern.id);
      if (prepared.templateLookupId != null) fields[templateLookupKey] = prepared.templateLookupId;
      fields[busLookupKey] = prepared.busLookupIdToWrite;

      existingKeys.add(key);
      toCreate.push({ key, patternLabel: formatPatternLabel(prepared.pattern), fields });
    }
  }

  await runWithConcurrency({
    items: toCreate,
    concurrency,
    worker: async (item) => {
      try {
        await graphPost(createUrl, token, { fields: item.fields });
        created += 1;
      } catch (err) {
        if (strict) throw err;
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Failed to create ${item.patternLabel} for ${item.key}: ${message}`);
      }
    },
  });

  return { created, skipped, warnings };
}

export async function generateShiftInstances(params: {
  workspaceId: string;
  month: string; // YYYY-MM
}): Promise<{ created: number; skipped: number }>{
  const result = await createMissingShiftInstances({
    workspaceId: params.workspaceId,
    month: params.month,
    strict: true,
  });
  return { created: result.created, skipped: result.skipped };
}

export async function ensureShiftInstancesForMonth(params: {
  workspaceId: string;
  month: string;
}): Promise<{ created: number; skipped: number; warnings: string[] }> {
  return createMissingShiftInstances({
    workspaceId: params.workspaceId,
    month: params.month,
    strict: false,
  });
}

export type ShiftGenerationPreviewPattern = {
  id: string;
  label: string;
  route?: string;
  shiftType?: string;
  templateId?: string;
  status: 'invalid' | 'skipped' | 'covered' | 'ready';
  missingFields?: string[];
  reason?: string;
  matchingDates: number;
  existingDates: number;
  missingDates: number;
};

export type ShiftGenerationPreview = {
  workspaceId: string;
  month: string;
  patternCount: number;
  validPatternCount: number;
  invalidPatternCount: number;
  existingInstanceCount: number;
  wouldCreateCount: number;
  alreadyCoveredCount: number;
  warnings: string[];
  patterns: ShiftGenerationPreviewPattern[];
};

export async function previewShiftGeneration(params: {
  workspaceId: string;
  month: string;
}): Promise<ShiftGenerationPreview> {
  const { workspaceId, month } = params;
  const warnings: string[] = [];
  const patternsAll = await listShiftPatterns({ workspaceId, includeInvalid: true });
  const existing = await listShiftInstances({ workspaceId, month });
  const existingKeys = new Set(
    existing
      .map((s) => `${s.date}|${s.patternId || ''}`)
      .filter((k) => !k.endsWith('|'))
  );
  const dates = daysInMonth(month);
  const defaultBusLookupIdRaw = optionalEnv('DEFAULT_BUS_LOOKUP_ID', '').trim();
  const defaultBusLookupId = defaultBusLookupIdRaw ? Number(defaultBusLookupIdRaw) : NaN;

  if (patternsAll.length === 0) {
    warnings.push(
      `No ShiftPatterns found for workspace “${workspaceId}”. Add rows to the ShiftPatterns list with workspaceId=${workspaceId}.`
    );
  }

  const hasAnyWorkspaceTag = patternsAll.some((p) => String((p as any).workspaceId || '').trim());
  if (patternsAll.length > 0 && !hasAnyWorkspaceTag) {
    warnings.push(
      `ShiftPatterns do not appear to have a usable workspaceId field. ` +
        `Fix by adding a workspaceId column to ShiftPatterns (Text or Lookup), ` +
        `or set PATTERN_FIELD_WORKSPACE_ID to your column’s internal name.`
    );
  }

  const patterns: ShiftGenerationPreviewPattern[] = [];
  let validPatternCount = 0;
  let invalidPatternCount = 0;
  let wouldCreateCount = 0;
  let alreadyCoveredCount = 0;

  for (const pattern of patternsAll) {
    const missingFields = getPatternMissingFields(pattern);
    const label = formatPatternLabel(pattern);
    const base = {
      id: pattern.id,
      label,
      route: pattern.route || undefined,
      shiftType: String(pattern.shiftType || '').trim() || undefined,
      templateId: String(pattern.templateId || '').trim() || undefined,
    };

    if (missingFields.length > 0) {
      invalidPatternCount += 1;
      patterns.push({
        ...base,
        status: 'invalid',
        missingFields,
        matchingDates: 0,
        existingDates: 0,
        missingDates: 0,
      });
      continue;
    }

    validPatternCount += 1;
    const dows = normalizeDows(pattern.dayOfWeek);
    const matchingDates = dates.filter((date) => {
      const dateObj = new Date(`${date}T00:00:00`);
      return dows.includes(dateObj.getDay());
    });

    const existingDates = matchingDates.filter((date) => existingKeys.has(`${date}|${pattern.id}`));
    const missingDates = matchingDates.filter((date) => !existingKeys.has(`${date}|${pattern.id}`));

    const templateId = String(pattern.templateId || '').trim();
    let hasBusSource = Number.isFinite(defaultBusLookupId);
    let skipReason = '';

    if (templateId) {
      try {
        const defaults = await getTemplateDefaults(templateId);
        if (defaults.busLookupId != null) hasBusSource = true;
      } catch (err) {
        skipReason = `failed to read template ${templateId}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (!skipReason && !hasBusSource) {
      skipReason =
        'missing bus source: set DEFAULT_BUS_LOOKUP_ID or ensure the template exposes BusLookupId';
    }

    if (skipReason) {
      patterns.push({
        ...base,
        status: 'skipped',
        reason: skipReason,
        matchingDates: matchingDates.length,
        existingDates: existingDates.length,
        missingDates: missingDates.length,
      });
      continue;
    }

    if (missingDates.length > 0) {
      wouldCreateCount += missingDates.length;
      patterns.push({
        ...base,
        status: 'ready',
        matchingDates: matchingDates.length,
        existingDates: existingDates.length,
        missingDates: missingDates.length,
      });
    } else {
      alreadyCoveredCount += existingDates.length;
      patterns.push({
        ...base,
        status: 'covered',
        matchingDates: matchingDates.length,
        existingDates: existingDates.length,
        missingDates: 0,
      });
    }
  }

  return {
    workspaceId,
    month,
    patternCount: patternsAll.length,
    validPatternCount,
    invalidPatternCount,
    existingInstanceCount: existing.length,
    wouldCreateCount,
    alreadyCoveredCount,
    warnings,
    patterns,
  };
}

export async function listHydratedShifts(params: {
  workspaceId?: string;
  month?: string;
}): Promise<HydratedShiftDto[]> {
  const requestedWorkspaceId = normalizeWorkspaceSlug(params.workspaceId);
  const instances = await listShiftInstances(params);

  // Build a pattern lookup map.
  // IMPORTANT: don't scope patterns by workspace here.
  // Instances can legitimately reference patterns whose workspaceId differs (ex: older generated items,
  // manual items, or when patterns haven't been re-tagged yet). If we scope patterns here,
  // shifts silently disappear for that workspace because hydration can't find the pattern.
  const patterns = await listShiftPatterns({});
  const byId = new Map(patterns.map((p) => [p.id, p]));

  const busIds = instances.map((i) => i.busId).filter((v): v is string => Boolean(v));
  const busTitles = await resolveBusTitles({ busIds });

  const driverIds = instances.map((i) => i.driverId).filter((v): v is string => Boolean(v));
  const driversById = await resolveDrivers({ driverIds });

  const templateIds = instances.map((i) => i.templateId).filter((v): v is string => Boolean(v));
  const tripsByTemplateId = await getTripsForTemplateIds({ templateIds });

  const hydrated = instances
    .map((inst): HydratedShiftDto | null => {
      const pattern = inst.patternId ? byId.get(inst.patternId) : undefined;
      if (!pattern) return null;

      const patternWorkspaceId = normalizeWorkspaceSlug((pattern as any).workspaceId);

      // If a workspace was requested, never allow a pattern tagged to a different workspace
      // to be hydrated into this workspace. (Global patterns are allowed.)
      if (requestedWorkspaceId) {
        if (inst.workspaceId !== requestedWorkspaceId) return null;
        if (patternWorkspaceId && !isGlobalWorkspaceSlug(patternWorkspaceId) && patternWorkspaceId !== requestedWorkspaceId) {
          return null;
        }
      }

      const base: HydratedShiftDto = {
        id: inst.id,
        workspaceId: inst.workspaceId,
        date: inst.date,
        route: pattern.route,
        routeName: pattern.routeName,
        shiftType: pattern.shiftType,
        weekPart: (pattern as any).weekPart,
        name: String(pattern.routeName || pattern.route || pattern.shiftType || ''),
        time: buildTimeLabel(pattern.startTime, pattern.endTime),
        driverId: inst.driverId,
        driverName: inst.driverId ? driversById.get(inst.driverId)?.name : undefined,
        driverEmail: inst.driverId ? driversById.get(inst.driverId)?.email : undefined,
        confirmationStatus: inst.confirmationStatus,
        notes: inst.notes,
        generated: inst.generated,
        manualOverride: inst.manualOverride,
        patternId: inst.patternId,
        templateId: inst.templateId,
        busId: inst.busId,
        // For the current UI, we still call this "defaultBus".
        defaultBus: inst.busId ? busTitles.get(inst.busId) || inst.busId : undefined,
        trips: inst.templateId ? tripsByTemplateId.get(inst.templateId) || [] : [],
      };

      if (patternWorkspaceId) base.patternWorkspaceId = patternWorkspaceId;
      return base;
    })
    .filter((v): v is HydratedShiftDto => Boolean(v));

  // When not filtering by workspace, we may have duplicates across workspaces due to bad data
  // (ex: cloned instances with mismatched workspaceId). De-dupe using the effective workspace.
  return dedupeHydratedShifts(hydrated);
}

export async function getHydratedShiftById(
  id: string,
  options?: { includeTrips?: boolean }
): Promise<HydratedShiftDto | null> {
  // Fetch the one instance by ID.
  const graph = getGraphConfig();
  const lists = getListIds();
  const f = getShiftInstancesFieldNames();

  const token = await getGraphAppToken(graph);

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(lists.shiftInstancesListId)}/items/${encodeURIComponent(id)}?$expand=fields`;

  const item = await graphGet<GraphListItem>(url, token);
  const fields = item.fields || {};

  const workspaceCol = await getWorkspaceColumnInfo();
  const workspaceMaps = workspaceCol.kind === 'lookup' ? await getWorkspaceMaps() : undefined;

  const inst: ShiftInstanceDto = {
    id: item.id,
    workspaceId: readWorkspaceId({
      fields,
      internalName: f.workspaceId,
      workspaceColumnKind: workspaceCol.kind,
      slugBySpItemId: workspaceMaps?.slugBySpItemId,
    }),
    date: normalizeDate(fields[f.date]),
    templateId: readLookupId(fields, f.templateId) || undefined,
    patternId: readLookupId(fields, f.patternId) || undefined,
    driverId: readLookupId(fields, f.driverId) || undefined,
    busId: readLookupId(fields, f.busId) || undefined,
    confirmationStatus: normalizeConfirmationStatus(fields[f.confirmationStatus]),
    notes: asString(fields[f.notes]) || undefined,
    generated: asBoolean(fields[f.generated]),
    manualOverride: asBoolean(fields[f.manualOverride]),
  };

  if (!inst.workspaceId || !inst.date) return null;

  // Hydrate via patterns.
  // See note in listHydratedShifts(): don't scope patterns here or the shift can disappear
  // when the instance references a pattern tagged to a different workspace.
  const patterns = await listShiftPatterns({});
  const byId = new Map(patterns.map((p) => [p.id, p]));
  const pattern = inst.patternId ? byId.get(inst.patternId) : undefined;
  if (!pattern) return null;

  const patternWorkspaceId = normalizeWorkspaceSlug((pattern as any).workspaceId);

  const busTitles = await resolveBusTitles({ busIds: inst.busId ? [inst.busId] : [] });
  const driversById = await resolveDrivers({ driverIds: inst.driverId ? [inst.driverId] : [] });
  const includeTrips = options?.includeTrips !== false;
  const tripsByTemplateId = includeTrips
    ? await getTripsForTemplateIds({ templateIds: inst.templateId ? [inst.templateId] : [] })
    : new Map<string, TripDto[]>();

  return {
    id: inst.id,
    workspaceId: inst.workspaceId,
    ...(patternWorkspaceId ? { patternWorkspaceId } : {}),
    date: inst.date,
    route: pattern.route,
    routeName: pattern.routeName,
    shiftType: pattern.shiftType,
    weekPart: (pattern as any).weekPart,
    name: String(pattern.routeName || pattern.route || pattern.shiftType || ''),
    time: buildTimeLabel(pattern.startTime, pattern.endTime),
    driverId: inst.driverId,
    driverName: inst.driverId ? driversById.get(inst.driverId)?.name : undefined,
    driverEmail: inst.driverId ? driversById.get(inst.driverId)?.email : undefined,
    confirmationStatus: inst.confirmationStatus,
    notes: inst.notes,
    generated: inst.generated,
    manualOverride: inst.manualOverride,
    patternId: inst.patternId,
    templateId: inst.templateId,
    busId: inst.busId,
    defaultBus: inst.busId ? busTitles.get(inst.busId) || inst.busId : undefined,
    trips: includeTrips && inst.templateId ? tripsByTemplateId.get(inst.templateId) || [] : [],
  };
}

function isoToUtcDate(isoDate: string): Date {
  return new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
}

function utcDateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekStartMonday(isoDate: string): string {
  const d = isoToUtcDate(isoDate);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - diff);
  return utcDateToIso(d);
}

function addDaysIso(isoDate: string, days: number): string {
  const d = isoToUtcDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDateToIso(d);
}

function isWeekendIso(isoDate: string): boolean {
  const d = isoToUtcDate(isoDate);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export async function getHydratedWeekShiftsForAnchor(params: {
  anchorItemId: string;
}): Promise<
  | null
  | {
      anchor: HydratedShiftDto;
      weekStart: string;
      weekEnd: string;
      shifts: HydratedShiftDto[];
    }
> {
  const anchor = await getHydratedShiftById(params.anchorItemId, { includeTrips: false });
  if (!anchor) return null;

  const anchorPatternId = anchor.patternId ? String(anchor.patternId).trim() : '';

  const weekStart = weekStartMonday(anchor.date);
  const weekEnd = addDaysIso(weekStart, 6);

  const instances = await listShiftInstances({
    workspaceId: anchor.workspaceId,
    startDate: weekStart,
    endDateExclusive: addDaysIso(weekEnd, 1),
  });
  const weekInstances = instances;

  const patterns = await listShiftPatterns({ workspaceId: anchor.workspaceId });
  const byId = new Map(patterns.map((p) => [p.id, p]));

  const anchorPattern = anchor.patternId ? byId.get(anchor.patternId) : undefined;
  const anchorWeekPart = String((anchorPattern as any)?.weekPart || '').trim().toLowerCase();

  const anchorIsWeekend = isWeekendIso(anchor.date);

  const sameGroup = weekInstances.filter((inst) => {
    const pattern = inst.patternId ? byId.get(inst.patternId) : undefined;
    if (!pattern) return false;

    // Prefer grouping by patternId (template) when possible.
    // This prevents distinct patterns that share route+shiftType (e.g. two "evening" runs)
    // from being assigned together.
    if (anchorPatternId) {
      const instPatternId = inst.patternId ? String(inst.patternId).trim() : '';
      if (!instPatternId) return false;
      return instPatternId === anchorPatternId;
    }

    if (!(pattern.route === anchor.route && pattern.shiftType === anchor.shiftType)) return false;

    const pWeekPart = String((pattern as any).weekPart || '').trim().toLowerCase();
    if (anchorWeekPart && pWeekPart) return pWeekPart === anchorWeekPart;

    // Fallback (older schemas): keep weekend patterns separate from weekday patterns.
    return isWeekendIso(inst.date) === anchorIsWeekend;
  });

  const busIds = sameGroup.map((i) => i.busId).filter((v): v is string => Boolean(v));
  const busTitles = await resolveBusTitles({ busIds });

  const driverIds = sameGroup.map((i) => i.driverId).filter((v): v is string => Boolean(v));
  const driversById = await resolveDrivers({ driverIds });

  const shifts: HydratedShiftDto[] = sameGroup
    .map((inst) => {
      const pattern = inst.patternId ? byId.get(inst.patternId) : undefined;
      if (!pattern) return null;
      return {
        id: inst.id,
        workspaceId: inst.workspaceId,
        date: inst.date,
        route: pattern.route,
        routeName: pattern.routeName,
        shiftType: pattern.shiftType,
        weekPart: (pattern as any).weekPart,
        name: String(pattern.routeName || pattern.route || pattern.shiftType || ''),
        time: buildTimeLabel(pattern.startTime, pattern.endTime),
        driverId: inst.driverId,
        driverName: inst.driverId ? driversById.get(inst.driverId)?.name : undefined,
        driverEmail: inst.driverId ? driversById.get(inst.driverId)?.email : undefined,
        confirmationStatus: inst.confirmationStatus,
        notes: inst.notes,
        generated: inst.generated,
        manualOverride: inst.manualOverride,
        patternId: inst.patternId,
        templateId: inst.templateId,
        busId: inst.busId,
        defaultBus: inst.busId ? busTitles.get(inst.busId) || inst.busId : undefined,
      };
    })
    .filter(Boolean) as HydratedShiftDto[];

  // Sort by date for nicer email output.
  shifts.sort((a, b) => a.date.localeCompare(b.date));

  return { anchor, weekStart, weekEnd, shifts };
}
