import { cacheGetOrSet } from './simpleCache';
import { listShiftPatterns, type ShiftPatternDto } from './shiftPatternsService';
import { getTripsForTemplateIds, type TripDto } from './tripTemplatesService';

// Printable timetables, built from ShiftPatterns (not ShiftInstances) so every
// season is available whatever month the schedule has loaded.
// One sheet per route + shift type + set of trips; patterns stored one per
// weekday collapse into a single sheet carrying all their days.

const TTL_MS = 5 * 60 * 1000;
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type TimetableSheet = {
  key: string;
  route: string; // "51-A"
  routeGroup: string; // "51" - the filter buttons on the season page
  routeName: string; // "Selfoss N1 ⇋ Mjódd E"
  shiftType: string;
  weekPart: string;
  days: string[]; // "mon".."sun", in week order
  trips: TripDto[];
};

export type TimetableSeason = {
  id: string; // "winter"
  name: string; // as written in SharePoint
  from: string | null; // YYYY-MM-DD
  to: string | null;
  active: boolean;
  sheets: TimetableSheet[];
};

function dayKey(raw: unknown): string | null {
  const s = String(raw || '').trim().slice(0, 3).toLowerCase();
  return DAY_ORDER.includes(s) ? s : null;
}

function dayList(dow: ShiftPatternDto['dayOfWeek']): string[] {
  const list = Array.isArray(dow) ? dow : [dow];
  return list.map(dayKey).filter((d): d is string => Boolean(d));
}

// "51-A" -> "51", "73" -> "73"
export function routeGroupOf(route: string): string {
  const m = String(route || '').match(/^\s*(\d+)/);
  return m ? m[1] : String(route || '').trim();
}

function compareRoute(a: string, b: string): number {
  const na = Number(routeGroupOf(a));
  const nb = Number(routeGroupOf(b));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

const SHIFT_ORDER = ['morning', 'single', 'evening'];

export function buildTimetables(
  patterns: ShiftPatternDto[],
  tripsByTemplateId: Map<string, TripDto[]>,
  today: string
): TimetableSeason[] {
  const seasons = new Map<string, TimetableSeason & { sheetByKey: Map<string, TimetableSheet & { daySet: Set<string> }> }>();

  for (const p of patterns) {
    const seasonName = String(p.season || '').trim();
    const seasonId = seasonName.toLowerCase() || 'all-year';
    let season = seasons.get(seasonId);
    if (!season) {
      season = { id: seasonId, name: seasonName, from: null, to: null, active: false, sheets: [], sheetByKey: new Map() };
      seasons.set(seasonId, season);
    }
    const from = String(p.effectiveFrom || '').slice(0, 10);
    const to = String(p.effectiveTo || '').slice(0, 10);
    if (from && (!season.from || from < season.from)) season.from = from;
    if (to && (!season.to || to > season.to)) season.to = to;

    const route = String(p.route || '').trim();
    const shiftType = String(p.shiftType || '').trim().toLowerCase();
    const templateId = String(p.templateId || '').trim();
    // Same route + shift type + trips = one printed sheet, whichever days it runs.
    const key = `${seasonId}|${route}|${shiftType}|${templateId || `${p.startTime}-${p.endTime}`}`;
    let sheet = season.sheetByKey.get(key);
    if (!sheet) {
      sheet = {
        key,
        route,
        routeGroup: routeGroupOf(route),
        routeName: String(p.routeName || '').trim(),
        shiftType,
        weekPart: String(p.weekPart || '').trim(),
        days: [],
        daySet: new Set(),
        trips: templateId ? tripsByTemplateId.get(templateId) || [] : [],
      };
      season.sheetByKey.set(key, sheet);
    }
    for (const d of dayList(p.dayOfWeek)) sheet.daySet.add(d);
  }

  const out: TimetableSeason[] = [];
  for (const season of seasons.values()) {
    const sheets = Array.from(season.sheetByKey.values()).map(({ daySet, ...sheet }) => ({
      ...sheet,
      days: DAY_ORDER.filter((d) => daySet.has(d)),
    }));
    // Within a route: weekday sheets before weekend ones, then morning, single, evening.
    const firstDay = (s: TimetableSheet) => (s.days.length ? DAY_ORDER.indexOf(s.days[0]) : 9);
    sheets.sort(
      (a, b) =>
        compareRoute(a.route, b.route) ||
        firstDay(a) - firstDay(b) ||
        SHIFT_ORDER.indexOf(a.shiftType) - SHIFT_ORDER.indexOf(b.shiftType)
    );
    out.push({
      id: season.id,
      name: season.name,
      from: season.from,
      to: season.to,
      active: Boolean((season.from || season.to) && (!season.from || season.from <= today) && (!season.to || today <= season.to)),
      sheets,
    });
  }
  // Active season first, then by start date.
  return out.sort((a, b) => Number(b.active) - Number(a.active) || String(b.from || '').localeCompare(String(a.from || '')));
}

export async function listTimetables(workspaceId: string): Promise<TimetableSeason[]> {
  return cacheGetOrSet({
    key: `timetables|${workspaceId}`,
    ttlMs: TTL_MS,
    factory: async () => {
      const patterns = await listShiftPatterns({ workspaceId });
      const templateIds = Array.from(new Set(patterns.map((p) => String(p.templateId || '').trim()).filter(Boolean)));
      const tripsByTemplateId = await getTripsForTemplateIds({ templateIds });
      return buildTimetables(patterns, tripsByTemplateId, new Date().toISOString().slice(0, 10));
    },
  });
}
