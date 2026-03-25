import { getListFieldDiagnostics } from './debugListsService';
import { listDrivers, resolveDriversBySsn } from './driversService';
import { listHydratedShifts, type HydratedShiftDto } from './shiftInstancesService';
import { getShiftInstanceExternalFieldNames } from './msListsConfig';
import { fetchTimonShiftPlans, getTimonConfig, timonTokenConfigured, type ExternalShiftPlan } from './timonService';

function normalizeText(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeRouteCode(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}

function extractExternalRouteCode(raw: unknown): string {
  const normalized = String(raw || '').toUpperCase();
  const match = normalized.match(/\b(\d{1,3})\s*-?\s*([A-Z])\b/);
  if (!match) return '';
  return `${match[1]}${match[2]}`;
}

function normalizeSsn(raw: unknown): string {
  return String(raw || '').replace(/\s+/g, '').replace(/-/g, '');
}

function formatUtcHm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function normalizeTimeLabel(raw: unknown): string {
  const parts = String(raw || '')
    .trim()
    .replace(/[—-]/g, '–')
    .split('–')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return '';

  return parts
    .map((part) => {
      const match = part.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return part;
      return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
    })
    .join('–');
}

function parseTimeRangeToMinutes(raw: unknown): { start: number; end: number } | null {
  const normalized = normalizeTimeLabel(raw);
  if (!normalized.includes('–')) return null;
  const [startRaw, endRaw] = normalized.split('–');
  const parseOne = (value: string) => {
    const match = value.trim().match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const start = parseOne(startRaw || '');
  const end = parseOne(endRaw || '');
  if (start == null || end == null) return null;
  return { start, end };
}

function buildExternalTimeLabel(shift: ExternalShiftPlan): string {
  const start = formatUtcHm(shift.arr);
  const end = formatUtcHm(shift.dep || undefined);
  return start && end ? `${start}–${end}` : start;
}

function shiftIsoDate(shift: ExternalShiftPlan): string {
  return String(shift.arr || '').slice(0, 10);
}

function shiftIsoMonth(shift: ExternalShiftPlan): string {
  return String(shift.arr || '').slice(0, 7);
}

function scoreCandidate(externalShift: ExternalShiftPlan, localShift: HydratedShiftDto): number {
  let score = 0;
  const externalName = normalizeText(externalShift.name);
  const localName = normalizeText(localShift.name);
  const localRoute = normalizeText(localShift.route);
  const localRouteName = normalizeText(localShift.routeName);
  const localTimonShiftName = normalizeText(localShift.timonShiftName);
  const externalRouteCode = normalizeRouteCode(extractExternalRouteCode(externalShift.name));
  const localRouteCode = normalizeRouteCode(localShift.route);
  const localTimonRouteCode = normalizeRouteCode(localShift.timonRouteCode);
  const externalTime = normalizeTimeLabel(buildExternalTimeLabel(externalShift));
  const localTime = normalizeTimeLabel(localShift.time);
  const externalMinutes = parseTimeRangeToMinutes(externalTime);
  const localMinutes = parseTimeRangeToMinutes(localTime);

  if (shiftIsoDate(externalShift) === localShift.date) score += 20;
  if (externalTime && externalTime === localTime) score += 35;
  else if (externalMinutes && localMinutes) {
    const startDiff = Math.abs(externalMinutes.start - localMinutes.start);
    const endDiff = Math.abs(externalMinutes.end - localMinutes.end);
    if (startDiff <= 10 && endDiff <= 10) score += 30;
    else if (startDiff <= 30 && endDiff <= 30) score += 18;
  }
  if (externalName && localTimonShiftName && externalName === localTimonShiftName) score += 80;
  if (externalName && localName && externalName === localName) score += 45;
  if (externalName && localRoute && externalName === localRoute) score += 35;
  if (externalName && localRouteName && externalName === localRouteName) score += 35;
  if (externalRouteCode && localTimonRouteCode && externalRouteCode === localTimonRouteCode) score += 60;
  if (externalRouteCode && localRouteCode && externalRouteCode === localRouteCode) score += 35;
  if (externalName && localName && (externalName.includes(localName) || localName.includes(externalName))) score += 10;
  if (externalName && localRoute && (externalName.includes(localRoute) || localRoute.includes(externalName))) score += 8;

  return score;
}

async function loadLocalShiftsForMonths(params: {
  workspaceId: string;
  months: string[];
}): Promise<HydratedShiftDto[]> {
  const all = await Promise.all(
    params.months.map((month) => listHydratedShifts({ workspaceId: params.workspaceId, month }))
  );
  return all.flat();
}

export async function getTimonReadiness() {
  const drivers = await listDrivers();
  const ssnCounts = new Map<string, number>();
  for (const driver of drivers) {
    const ssn = normalizeSsn(driver.ssn);
    if (!ssn) continue;
    ssnCounts.set(ssn, (ssnCounts.get(ssn) || 0) + 1);
  }

  const duplicateSsns = Array.from(ssnCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([ssn, count]) => ({ ssn, count }));

  const missingSsn = drivers.filter((driver) => !normalizeSsn(driver.ssn)).map((driver) => ({
    id: driver.id,
    name: driver.name,
  }));

  const diagnostics = await getListFieldDiagnostics({ list: 'instances', sample: 0 });
  const cols = diagnostics.columns || [];
  const externalFields = getShiftInstanceExternalFieldNames();
  const requiredColumns = Object.entries(externalFields).map(([key, internalName]) => {
    const found = cols.find(
      (col) => String(col.name || '').trim() === internalName || String(col.displayName || '').trim() === internalName
    );
    return {
      key,
      configuredName: internalName,
      present: Boolean(found),
      actualName: found?.name || null,
      actualDisplayName: found?.displayName || null,
      type: found?.type || null,
    };
  });

  return {
    timon: {
      baseUrl: getTimonConfig().baseUrl,
      tokenConfigured: timonTokenConfigured(),
      tokenHeader: getTimonConfig().tokenHeader,
      tokenPrefix: getTimonConfig().tokenPrefix,
    },
    drivers: {
      total: drivers.length,
      withSsn: drivers.length - missingSsn.length,
      missingSsnCount: missingSsn.length,
      duplicateSsnCount: duplicateSsns.length,
      missingSsn: missingSsn.slice(0, 20),
      duplicateSsns: duplicateSsns.slice(0, 20),
    },
    shiftInstances: {
      externalColumns: requiredColumns,
    },
  };
}

export async function previewTimonShiftMatching(params: {
  workspaceId?: string;
  shifts?: ExternalShiftPlan[];
  fromdate?: string;
  todate?: string;
  groups?: string;
  ssns?: string;
}) {
  const workspaceId = String(params.workspaceId || 'south').trim() || 'south';
  const externalShifts =
    params.shifts && params.shifts.length
      ? params.shifts
      : await fetchTimonShiftPlans({
          fromdate: params.fromdate,
          todate: params.todate,
          groups: params.groups,
          ssns: params.ssns,
        });

  const months = Array.from(new Set(externalShifts.map(shiftIsoMonth).filter(Boolean)));
  const localShifts = await loadLocalShiftsForMonths({ workspaceId, months });
  const driversBySsn = await resolveDriversBySsn({
    ssns: externalShifts.map((shift) => normalizeSsn(shift.ssn)).filter(Boolean),
  });

  const results = externalShifts.map((externalShift) => {
    const externalDate = shiftIsoDate(externalShift);
    const externalTime = buildExternalTimeLabel(externalShift);
    const localCandidates = localShifts
      .filter((localShift) => localShift.date === externalDate)
      .map((localShift) => ({
        shift: localShift,
        score: scoreCandidate(externalShift, localShift),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const best = localCandidates[0];
    const ssn = normalizeSsn(externalShift.ssn);
    const driver = ssn ? driversBySsn.get(ssn) : undefined;

    return {
      externalShiftId: externalShift.id,
      name: externalShift.name,
      date: externalDate,
      time: externalTime,
      ssn: ssn || null,
      ssnName: externalShift.ssn_name || null,
      unassigned: Boolean(externalShift.unassigned),
      matchedDriver: driver
        ? { id: driver.id, name: driver.name, ssn: driver.ssn || null }
        : null,
      bestLocalMatch: best
        ? {
            id: best.shift.id,
            name: best.shift.name,
            route: best.shift.route,
            routeName: best.shift.routeName || null,
            date: best.shift.date,
            time: best.shift.time,
            score: best.score,
          }
        : null,
      localCandidates: localCandidates.map((entry) => ({
        id: entry.shift.id,
        name: entry.shift.name,
        route: entry.shift.route,
        routeName: entry.shift.routeName || null,
        date: entry.shift.date,
        time: entry.shift.time,
        score: entry.score,
      })),
    };
  });

  const matchedShifts = results.filter((item) => item.bestLocalMatch).length;
  const matchedDrivers = results.filter((item) => item.matchedDriver).length;

  return {
    summary: {
      workspaceId,
      externalShiftCount: externalShifts.length,
      localShiftCount: localShifts.length,
      matchedShiftCount: matchedShifts,
      unmatchedShiftCount: externalShifts.length - matchedShifts,
      matchedDriverCount: matchedDrivers,
      missingDriverCount: externalShifts.length - matchedDrivers,
    },
    results,
  };
}
