import { getGraphAppToken } from './graphAuth';
import { graphGet, graphPatch, graphPost } from './graphClient';
import {
  getGraphConfig,
  getListIds,
  getShiftInstancesFieldNames,
  getShiftPatternsFieldNames,
} from './msListsConfig';
import { listShiftPatterns, type ShiftPatternDto } from './shiftPatternsService';
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
  driverId: string;
}): Promise<void> {
  const fInst = getShiftInstancesFieldNames();
  const driverLookupKey = `${fInst.driverId}LookupId`;
  await patchShiftInstanceFields({
    itemId: params.itemId,
    fields: {
      [driverLookupKey]: Number(params.driverId),
    },
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

function confirmationStatusRank(status?: string): number {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'accepted') return 4;
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
    filterParts.push(`fields/${f.workspaceId} eq ${odataStringLiteral(params.workspaceId)}`);
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
        workspaceId: asString(fields[f.workspaceId]),
        date: normalizeDate(fields[f.date]),
        templateId: readLookupId(fields, f.templateId) || undefined,
        patternId: readLookupId(fields, f.patternId) || undefined,
        driverId: readLookupId(fields, f.driverId) || undefined,
        busId: readLookupId(fields, f.busId) || undefined,
        confirmationStatus: asString(fields[f.confirmationStatus]) || undefined,
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

export async function generateShiftInstances(params: {
  workspaceId: string;
  month: string; // YYYY-MM
}): Promise<{ created: number; skipped: number }>{
  const { workspaceId, month } = params;

  const graph = getGraphConfig();
  const lists = getListIds();
  const token = await getGraphAppToken(graph);

  const fInst = getShiftInstancesFieldNames();
  const fPat = getShiftPatternsFieldNames();

  const patterns = await listShiftPatterns({ workspaceId });
  const existing = await listShiftInstances({ workspaceId, month });

  // Existing key: `${date}|${patternId}`
  const existingKeys = new Set(
    existing
      .map((s) => `${s.date}|${s.patternId || ''}`)
      .filter((k) => !k.endsWith('|'))
  );

  const dates = daysInMonth(month);

  // In your ShiftInstances list, `busId` is required. Prefer getting it from the template.
  // Fallback to DEFAULT_BUS_LOOKUP_ID if template doesn't have one.
  const defaultBusLookupIdRaw = optionalEnv('DEFAULT_BUS_LOOKUP_ID', '').trim();
  const defaultBusLookupId = defaultBusLookupIdRaw ? Number(defaultBusLookupIdRaw) : NaN;

  const concurrency = Math.max(
    1,
    Math.min(20, Number(optionalEnv('GENERATE_CONCURRENCY', '6')) || 6)
  );

  const createUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(lists.shiftInstancesListId)}/items`;

  const toCreate: Array<{ key: string; fields: Record<string, unknown> }> = [];

  let created = 0;
  let skipped = 0;

  for (const pattern of patterns) {
    const dows = normalizeDows(pattern.dayOfWeek);
    if (dows.length === 0) continue;

    for (const date of dates) {
      const dateObj = new Date(`${date}T00:00:00`);
      if (!dows.includes(dateObj.getDay())) continue;

      const key = `${date}|${pattern.id}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }

      // NOTE: Lookup fields usually require "<InternalName>LookupId" when writing.
      // We support both:
      const patternLookupKey = `${fInst.patternId}LookupId`;
      const templateLookupKey = `${fInst.templateId}LookupId`;
      const busLookupKey = `${fInst.busId}LookupId`;

      const fields: Record<string, unknown> = {
        [fInst.workspaceId]: workspaceId,
        // Graph dateTime columns expect an ISO date-time.
        [fInst.date]: `${date}T00:00:00Z`,
        [fInst.generated]: true,
        [fInst.manualOverride]: false,
      };

      // Set pattern lookup
      fields[patternLookupKey] = Number(pattern.id);

      // templateId is required in your list; we attempt to copy from the pattern.
      const templateId = (pattern as ShiftPatternDto).templateId;
      if (templateId) {
        fields[templateLookupKey] = Number(templateId);
      }

      // busId is required.
      let busLookupIdToWrite: number | undefined;

      if (templateId) {
        const defaults = await getTemplateDefaults(templateId);
        if (defaults.busLookupId != null) busLookupIdToWrite = defaults.busLookupId;
      }

      if (busLookupIdToWrite == null) {
        if (!Number.isFinite(defaultBusLookupId)) {
          throw new Error(
            'ShiftInstances column busId is required. Set DEFAULT_BUS_LOOKUP_ID in backend/.env (or ensure the template has BusLookupId).'
          );
        }
        busLookupIdToWrite = defaultBusLookupId;
      }

      fields[busLookupKey] = busLookupIdToWrite;

      // Mark as existing immediately so we don't queue duplicates in-process.
      existingKeys.add(key);
      toCreate.push({ key, fields });
    }
  }

  await runWithConcurrency({
    items: toCreate,
    concurrency,
    worker: async (item) => {
      await graphPost(createUrl, token, { fields: item.fields });
      created += 1;
    },
  });

  return { created, skipped };
}

export async function listHydratedShifts(params: {
  workspaceId?: string;
  month?: string;
}): Promise<HydratedShiftDto[]> {
  const instances = await listShiftInstances(params);

  // Build a pattern lookup map (only for patterns referenced by instances)
  const patterns = await listShiftPatterns({ workspaceId: params.workspaceId });
  const byId = new Map(patterns.map((p) => [p.id, p]));

  const busIds = instances.map((i) => i.busId).filter((v): v is string => Boolean(v));
  const busTitles = await resolveBusTitles({ busIds });

  const driverIds = instances.map((i) => i.driverId).filter((v): v is string => Boolean(v));
  const driversById = await resolveDrivers({ driverIds });

  const templateIds = instances.map((i) => i.templateId).filter((v): v is string => Boolean(v));
  const tripsByTemplateId = await getTripsForTemplateIds({ templateIds });

  return instances
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
        // For the current UI, we still call this "defaultBus".
        defaultBus: inst.busId ? busTitles.get(inst.busId) || inst.busId : undefined,
        trips: inst.templateId ? tripsByTemplateId.get(inst.templateId) || [] : [],
      } as HydratedShiftDto;
    })
    .filter(Boolean) as HydratedShiftDto[];
}

export async function getHydratedShiftById(
  itemId: string,
  options?: { includeTrips?: boolean }
): Promise<HydratedShiftDto | null> {
  const id = String(itemId || '').trim();
  if (!id) return null;

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

  const inst: ShiftInstanceDto = {
    id: item.id,
    workspaceId: asString(fields[f.workspaceId]),
    date: normalizeDate(fields[f.date]),
    templateId: readLookupId(fields, f.templateId) || undefined,
    patternId: readLookupId(fields, f.patternId) || undefined,
    driverId: readLookupId(fields, f.driverId) || undefined,
    busId: readLookupId(fields, f.busId) || undefined,
    confirmationStatus: asString(fields[f.confirmationStatus]) || undefined,
    notes: asString(fields[f.notes]) || undefined,
    generated: asBoolean(fields[f.generated]),
    manualOverride: asBoolean(fields[f.manualOverride]),
  };

  if (!inst.workspaceId || !inst.date) return null;

  // Hydrate via patterns.
  const patterns = await listShiftPatterns({ workspaceId: inst.workspaceId });
  const byId = new Map(patterns.map((p) => [p.id, p]));
  const pattern = inst.patternId ? byId.get(inst.patternId) : undefined;
  if (!pattern) return null;

  const busTitles = await resolveBusTitles({ busIds: inst.busId ? [inst.busId] : [] });
  const driversById = await resolveDrivers({ driverIds: inst.driverId ? [inst.driverId] : [] });
  const includeTrips = options?.includeTrips !== false;
  const tripsByTemplateId = includeTrips
    ? await getTripsForTemplateIds({ templateIds: inst.templateId ? [inst.templateId] : [] })
    : new Map<string, TripDto[]>();

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
