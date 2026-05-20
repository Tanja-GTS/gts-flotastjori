import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig, getListIds, getShiftPatternsFieldNames } from './msListsConfig';
import { resolveRouteTitles } from './routesService';
import { getTemplateDefaults } from './templatesService';
import { listWorkspaces } from './workspacesService';
import { optionalEnv } from '../utils/env';

export type ShiftPatternDto = {
  id: string;
  route: string;
  routeName?: string;
  timonRouteCode?: string;
  timonShiftName?: string;
  shiftType: 'morning' | 'single' | 'evening' | string;
  // Optional grouping label (ex: "weekdays" / "weekend")
  weekPart?: string;
  dayOfWeek: string | string[]; // Mon..Sun (single or multi-choice)
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  workspaceId?: string;
  templateId?: string;
  // Seasonal support: season label, active date range, shift mode, and trips
  season?: string;
  effectiveFrom?: string; // ISO date string (YYYY-MM-DD)
  effectiveTo?: string; // ISO date string (YYYY-MM-DD)
  shiftMode?: string;
  trips?: any[]; // Array of trip objects with name, time, busOverride, events
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

function asStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => asString(v)).filter(Boolean);
  const s = asString(value);
  return s ? [s] : [];
}

function readField(fields: Record<string, unknown>, fieldName: string): string {
  if (!fieldName) return '';
  return asString(fields[fieldName]);
}

let workspaceSlugBySpIdCache: { fetchedAtMs: number; map: Map<string, string> } | null = null;

async function getWorkspaceSlugBySpItemId(): Promise<Map<string, string>> {
  // Keep TTL aligned with other list caches.
  const ttlMs = 300000;
  const now = Date.now();
  if (workspaceSlugBySpIdCache && now - workspaceSlugBySpIdCache.fetchedAtMs < ttlMs) {
    return workspaceSlugBySpIdCache.map;
  }

  const workspaces = await listWorkspaces();
  const map = new Map<string, string>();
  for (const w of workspaces) {
    const slug = String(w.id || '').trim();
    const spId = String((w as any).spItemId || '').trim();
    if (slug && spId) map.set(spId, slug);
  }
  workspaceSlugBySpIdCache = { fetchedAtMs: now, map };
  return map;
}

async function readWorkspaceSlug(fields: Record<string, unknown>, internalName: string): Promise<string> {
  if (!internalName) return '';
  const direct = asString(fields[internalName]).trim();
  if (direct && !/^\d+$/.test(direct)) return direct;

  const lookupId = asString(fields[`${internalName}LookupId`]).trim();
  if (lookupId) {
    const map = await getWorkspaceSlugBySpItemId();
    return map.get(lookupId) || lookupId;
  }

  if (direct) {
    const map = await getWorkspaceSlugBySpItemId();
    return map.get(direct) || direct;
  }
  return '';
}

let enrichedPatternsCache: { fetchedAtMs: number; items: ShiftPatternDto[] } | null = null;

function readAny(fields: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (!k) continue;
    if (Object.prototype.hasOwnProperty.call(fields, k)) return fields[k];
  }
  return undefined;
}

function normalizeShiftType(value: string): string {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'morning') return 'morning';
  if (s === 'evening') return 'evening';
  if (s === 'single') return 'single';
  return value;
}

function normalizeWeekPart(value: string): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s === 'weekday' || s === 'weekdays' || s === 'workday' || s === 'workdays' || s === 'work days') {
    return 'weekdays';
  }
  if (s === 'weekend' || s === 'weekends') return 'weekend';
  return raw;
}

/**
 * Check if a pattern is active for a given month (YYYY-MM format).
 * A pattern is active if the month falls within its effectiveFrom and effectiveTo dates.
 * If either date is missing, it's treated as unbounded (always matches).
 */
function isPatternActiveForMonth(pattern: ShiftPatternDto, month: string): boolean {
  if (!pattern.effectiveFrom && !pattern.effectiveTo) {
    // No date restrictions, always active
    return true;
  }

  const [year, mon] = month.split('-').map(Number);
  if (isNaN(year) || isNaN(mon)) return true; // Invalid month format, allow it

  // Extract just the date part (YYYY-MM-DD) from ISO strings, ignoring time/timezone
  function extractDateOnly(isoString: string): string {
    return isoString.split('T')[0]; // "2026-06-05T07:00:00Z" → "2026-06-05"
  }

  const monthStart = new Date(year, mon - 1, 1);
  monthStart.setHours(0, 0, 0, 0);

  const monthEnd = new Date(year, mon, 0);
  monthEnd.setHours(23, 59, 59, 999);

  if (pattern.effectiveFrom) {
    const fromDateStr = extractDateOnly(pattern.effectiveFrom);
    const from = new Date(fromDateStr);
    from.setHours(0, 0, 0, 0);
    if (monthEnd < from) {
      // Month ends before pattern starts
      return false;
    }
  }

  if (pattern.effectiveTo) {
    const toDateStr = extractDateOnly(pattern.effectiveTo);
    const to = new Date(toDateStr);
    to.setHours(23, 59, 59, 999);
    if (monthStart > to) {
      // Month starts after pattern ends
      return false;
    }
  }

  return true;
}

// Fetches and enriches all patterns from SharePoint, cached for PATTERNS_CACHE_TTL_MS.
// The result includes ALL patterns (valid + invalid, all workspaces) before any local filtering.
// listShiftPatterns() applies the cheap local filters on top of this cache.
async function fetchAllEnrichedPatterns(): Promise<ShiftPatternDto[]> {
  const ttlMs = Number(optionalEnv('PATTERNS_CACHE_TTL_MS', '300000')) || 300000;
  const now = Date.now();
  if (enrichedPatternsCache && now - enrichedPatternsCache.fetchedAtMs < ttlMs) {
    return enrichedPatternsCache.items;
  }

  const graph = getGraphConfig();
  const lists = getListIds();
  const f = getShiftPatternsFieldNames();
  const token = await getGraphAppToken(graph);

  const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(lists.shiftPatternsListId)}/items?$expand=fields&$top=999`;

  const allItems: GraphListItem[] = [];
  let nextUrl: string | undefined = baseUrl;
  while (nextUrl) {
    const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(nextUrl, token);
    allItems.push(...(page.value || []));
    nextUrl = page['@odata.nextLink'];
  }

  const rawPatterns = await Promise.all(
    allItems.map(async (item) => {
      const fields = item.fields || {};

      const routeValue = readAny(fields, [f.route, 'RouteLookupId', 'Route']);
      const routeNameValue = readAny(fields, [
        (f as any).routeName,
        'routeName', 'RouteName', 'routeTitle', 'RouteTitle',
      ]);
      const timonRouteCodeValue = readAny(fields, [
        (f as any).timonRouteCode, 'timonRouteCode', 'TimonRouteCode',
      ]);
      const timonShiftNameValue = readAny(fields, [
        (f as any).timonShiftName, 'timonShiftName', 'TimonShiftName',
      ]);
      const titleValue = readAny(fields, ['Title', 'LinkTitle', 'LinkTitleNoMenu']);
      const dayValue = readAny(fields, [f.dayOfWeek, 'DayOfWeek']);
      const shiftTypeValue = readAny(fields, [f.shiftType, 'Type0']);
      const weekPartValue = readAny(fields, [
        (f as any).weekPart, 'ShiftType', 'WeekPart', 'WeekType', 'DayType',
      ]);
      const startValue = readAny(fields, [f.startTime, 'field_5', 'StartTime']);
      const endValue = readAny(fields, [f.endTime, 'field_6', 'EndTime']);
      const templateValue = readAny(fields, [f.templateId, 'ShiftLookupId', 'Shift']);
      const seasonValue = readAny(fields, [(f as any).season, 'Season']);
      const effectiveFromValue = readAny(fields, [(f as any).effectiveFrom, 'EffectiveFrom']);
      const effectiveToValue = readAny(fields, [(f as any).effectiveTo, 'EffectiveTo']);
      const shiftModeValue = readAny(fields, [(f as any).shiftMode, 'ShiftMode']);
      const tripsValue = readAny(fields, [(f as any).trips, 'Trips']);

      const title = asString(titleValue).trim();

      let trips: any[] | undefined;
      try {
        const tripsStr = asString(tripsValue).trim();
        trips = tripsStr ? JSON.parse(tripsStr) : undefined;
      } catch {
        trips = undefined;
      }

      const dto: ShiftPatternDto = {
        id: item.id,
        route: asString(routeValue),
        routeName: asString(routeNameValue).trim() || undefined,
        timonRouteCode: asString(timonRouteCodeValue).trim() || undefined,
        timonShiftName: asString(timonShiftNameValue).trim() || undefined,
        shiftType: normalizeShiftType(asString(shiftTypeValue)),
        weekPart: normalizeWeekPart(asString(weekPartValue)),
        dayOfWeek: Array.isArray(dayValue) ? asStringArray(dayValue) : asString(dayValue),
        startTime: asString(startValue),
        endTime: asString(endValue),
        workspaceId: f.workspaceId ? (await readWorkspaceSlug(fields, f.workspaceId)) || undefined : undefined,
        templateId: f.templateId ? readField(fields, f.templateId) || undefined : undefined,
        season: asString(seasonValue).trim() || undefined,
        effectiveFrom: asString(effectiveFromValue).trim() || undefined,
        effectiveTo: asString(effectiveToValue).trim() || undefined,
        shiftMode: asString(shiftModeValue).trim() || undefined,
        trips,
      };

      if (!dto.templateId) {
        const rawTemplate = asString(templateValue);
        dto.templateId = rawTemplate ? rawTemplate : undefined;
      }

      return { dto, title };
    })
  );

  // Enrich from templates (getTemplateDefaults has its own forever-lived cache per ID).
  const templateIdsNeeding = Array.from(
    new Set(
      rawPatterns
        .map((p) => p.dto)
        .filter((p) => p.templateId && (!p.routeName || !p.timonRouteCode || !p.timonShiftName))
        .map((p) => String(p.templateId))
    )
  );

  const templateRouteNames = new Map<string, string>();
  const templateTimonRouteCodes = new Map<string, string>();
  const templateTimonShiftNames = new Map<string, string>();
  await Promise.all(
    templateIdsNeeding.map(async (templateId) => {
      try {
        const defaults = await getTemplateDefaults(templateId);
        const rn = String(defaults.routeName || '').trim();
        if (rn) templateRouteNames.set(templateId, rn);
        const trc = String(defaults.timonRouteCode || '').trim();
        if (trc) templateTimonRouteCodes.set(templateId, trc);
        const tsn = String(defaults.timonShiftName || '').trim();
        if (tsn) templateTimonShiftNames.set(templateId, tsn);
      } catch {
        // Ignore template enrichment errors; patterns will still work.
      }
    })
  );

  const enriched = rawPatterns.map(({ dto, title }) => {
    const templateRouteName = dto.templateId ? templateRouteNames.get(String(dto.templateId)) : undefined;
    const templateTimonRouteCode = dto.templateId ? templateTimonRouteCodes.get(String(dto.templateId)) : undefined;
    const templateTimonShiftName = dto.templateId ? templateTimonShiftNames.get(String(dto.templateId)) : undefined;
    const routeName = String(templateRouteName || dto.routeName || title || '').trim();
    return {
      ...dto,
      routeName: routeName || undefined,
      timonRouteCode: String(dto.timonRouteCode || templateTimonRouteCode || '').trim() || undefined,
      timonShiftName: String(dto.timonShiftName || templateTimonShiftName || '').trim() || undefined,
    } as ShiftPatternDto;
  });

  // Resolve route lookup IDs -> titles.
  const routeIds = Array.from(
    new Set(enriched.map((p) => p.route).filter((v) => typeof v === 'string' && v.trim().length))
  );
  const routeTitles = await resolveRouteTitles({ routeIds });

  const items = enriched.map((p) => ({ ...p, route: routeTitles.get(p.route) || p.route }));
  enrichedPatternsCache = { fetchedAtMs: now, items };
  return items;
}

export async function listShiftPatterns(params?: {
  workspaceId?: string;
  includeInvalid?: boolean;
  month?: string;
}): Promise<ShiftPatternDto[]> {
  const patternsAll = await fetchAllEnrichedPatterns();

  const patternsValid = patternsAll.filter((p) => {
    const hasDay = Array.isArray(p.dayOfWeek) ? p.dayOfWeek.length > 0 : Boolean(p.dayOfWeek);
    return p.route && p.shiftType && hasDay && p.startTime && p.endTime;
  });

  const patterns = params?.includeInvalid ? patternsAll : patternsValid;

  const month = (params as any)?.month;
  const dateFiltered = month
    ? patterns.filter((p) => isPatternActiveForMonth(p, month))
    : patterns;

  if (params?.workspaceId) {
    const canFilter = dateFiltered.some((p) => p.workspaceId != null);
    if (canFilter) {
      const wanted = String(params.workspaceId || '').trim();
      const scoped = dateFiltered.filter((p) => String(p.workspaceId || '').trim() === wanted);
      if (scoped.length > 0) return scoped;
      return dateFiltered.filter((p) => p.workspaceId == null);
    }
  }

  return dateFiltered;
}
