import { resolveDriversBySsn } from './driversService';
import {
  assignDriverToShiftInstance,
  listHydratedShifts,
  listShiftInstances,
  patchShiftInstanceFields,
  setShiftInstanceConfirmationStatus,
  type HydratedShiftDto,
} from './shiftInstancesService';
import { getShiftInstanceExternalFieldNames } from './msListsConfig';
import { fetchTimonShiftPlans, type ExternalShiftPlan } from './timonService';
import { optionalEnv } from '../utils/env';

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function normalizeText(raw: unknown): string {
  return asString(raw)
    .trim()
    .toLowerCase()
    // Strip seasonal suffixes so "51-A morgun - V" matches "51-A morgun"
    .replace(/\s*-\s*[vw]\s*$/i, '')
    .replace(/\s+/g, ' ');
}

function normalizeRouteCode(raw: unknown): string {
  return asString(raw)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}

function extractExternalRouteCode(raw: unknown): string {
  const normalized = asString(raw).toUpperCase();
  const match = normalized.match(/\b(\d{1,3})\s*-?\s*([A-Z])\b/);
  if (!match) return '';
  return `${match[1]}${match[2]}`;
}

function normalizeSsn(raw: unknown): string {
  return asString(raw).replace(/\s+/g, '').replace(/-/g, '');
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
  return asString(shift.arr).slice(0, 10);
}

function shiftIsoMonth(shift: ExternalShiftPlan): string {
  return asString(shift.arr).slice(0, 7);
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

type TimonMatchResult = {
  externalShiftId: number;
  externalName: string;
  date: string;
  time: string;
  unassigned: boolean;
  ssn: string | null;
  ssnName: string | null;
  matchedInstanceId?: string;
  matchedDriverId?: string;
  matchedDriverName?: string;
  score?: number;
  via: 'external-id' | 'score' | 'unmatched';
  action: 'assigned' | 'unassigned' | 'missing-driver' | 'unmatched';
  reason?: string;
};

export async function syncTimonShiftAssignments(params: {
  workspaceId?: string;
  shifts?: ExternalShiftPlan[];
  fromdate?: string;
  todate?: string;
  groups?: string;
  ssns?: string;
  dryRun?: boolean;
}): Promise<{
  summary: {
    workspaceId: string;
    dryRun: boolean;
    externalShiftCount: number;
    matchedShiftCount: number;
    assignedCount: number;
    unassignedCount: number;
    missingDriverCount: number;
    unmatchedCount: number;
  };
  results: TimonMatchResult[];
  warnings: string[];
}> {
  const workspaceId = asString(params.workspaceId || 'south').trim() || 'south';
  const dryRun = params.dryRun !== false;
  const externalShifts =
    params.shifts && params.shifts.length > 0
      ? params.shifts
      : await fetchTimonShiftPlans({
          fromdate: params.fromdate,
          todate: params.todate,
          groups: params.groups,
          ssns: params.ssns,
        });

  const months = Array.from(new Set(externalShifts.map(shiftIsoMonth).filter(Boolean)));
  const localShifts = (
    await Promise.all(months.map((month) => listHydratedShifts({ workspaceId, month })))
  ).flat();
  const rawInstances = (
    await Promise.all(months.map((month) => listShiftInstances({ workspaceId, month })))
  ).flat();

  const rawById = new Map(rawInstances.map((inst) => [inst.id, inst]));
  const hydratedById = new Map(localShifts.map((shift) => [shift.id, shift]));
  const instanceIdByExternalShiftId = new Map<string, string>();
  for (const inst of rawInstances) {
    const externalShiftId = asString(inst.externalShiftId).trim();
    if (externalShiftId && !instanceIdByExternalShiftId.has(externalShiftId)) {
      instanceIdByExternalShiftId.set(externalShiftId, inst.id);
    }
  }

  const driversBySsn = await resolveDriversBySsn({
    ssns: externalShifts.map((shift) => normalizeSsn(shift.ssn)).filter(Boolean),
  });

  const usedInstanceIds = new Set<string>();
  const warnings: string[] = [];
  const results: TimonMatchResult[] = [];
  const minScore = Math.max(1, Number(optionalEnv('TIMON_MIN_MATCH_SCORE', '55')) || 55);
  const minMargin = Math.max(0, Number(optionalEnv('TIMON_MIN_MATCH_MARGIN', '8')) || 8);
  const ext = getShiftInstanceExternalFieldNames();

  for (const externalShift of externalShifts) {
    const externalShiftId = asString(externalShift.id).trim();
    const date = shiftIsoDate(externalShift);
    const time = buildExternalTimeLabel(externalShift);
    const ssn = normalizeSsn(externalShift.ssn);
    const matchedDriver = ssn ? driversBySsn.get(ssn) : undefined;
    const unassigned = Boolean(externalShift.unassigned) || !ssn;

    let matchedInstanceId = instanceIdByExternalShiftId.get(externalShiftId);
    // If the stored external-id points to an instance that is no longer visible
    // in the UI (e.g. linked to an expired/deleted pattern), fall through to
    // score-based matching so we write to the instance managers can actually see.
    if (matchedInstanceId && !hydratedById.has(matchedInstanceId)) {
      matchedInstanceId = undefined;
    }
    let via: TimonMatchResult['via'] = matchedInstanceId ? 'external-id' : 'unmatched';
    let matchedScore: number | undefined;
    let reason = '';

    if (!matchedInstanceId) {
      const candidates = localShifts
        .filter((shift) => shift.date === date && !usedInstanceIds.has(shift.id))
        .map((shift) => ({ shift, score: scoreCandidate(externalShift, shift) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

      const best = candidates[0];
      const runnerUp = candidates[1];
      if (best && best.score >= minScore && (!runnerUp || best.score - runnerUp.score >= minMargin)) {
        matchedInstanceId = best.shift.id;
        matchedScore = best.score;
        via = 'score';
      } else if (best) {
        reason = `best score ${best.score} below confidence threshold`;
      } else {
        reason = 'no candidate shift found on same date';
      }
    }

    if (!matchedInstanceId) {
      results.push({
        externalShiftId: Number(externalShift.id),
        externalName: asString(externalShift.name).trim(),
        date,
        time,
        unassigned,
        ssn: ssn || null,
        ssnName: asString(externalShift.ssn_name).trim() || null,
        via,
        action: 'unmatched',
        reason,
      });
      continue;
    }

    usedInstanceIds.add(matchedInstanceId);
    const hydrated = hydratedById.get(matchedInstanceId);
    const raw = rawById.get(matchedInstanceId);
    const matchedDriverId = matchedDriver?.id;
    const matchedDriverName = matchedDriver?.name;

    let action: TimonMatchResult['action'] = 'assigned';
    if (unassigned) action = 'unassigned';
    else if (!matchedDriverId) action = 'missing-driver';

    if (!dryRun) {
      if (action === 'assigned') {
        await assignDriverToShiftInstance({ itemId: matchedInstanceId, driverId: matchedDriverId });
        try {
          await setShiftInstanceConfirmationStatus({ itemId: matchedInstanceId, status: 'assigned' });
        } catch {
          // ignore confirmation status write failures for sync
        }
      } else if (action === 'unassigned') {
        await assignDriverToShiftInstance({ itemId: matchedInstanceId, driverId: null });
        try {
          await setShiftInstanceConfirmationStatus({ itemId: matchedInstanceId, status: 'unassigned' });
        } catch {
          // ignore confirmation status write failures for sync
        }
      }

      const patchFields: Record<string, unknown> = {
        [ext.externalSource]: 'timon',
        [ext.externalShiftId]: externalShiftId,
        [ext.externalEmployeeSsn]: ssn || null,
        [ext.externalEmployeeName]: asString(externalShift.ssn_name).trim() || null,
        [ext.externalShiftName]: asString(externalShift.name).trim() || null,
        [ext.externalArr]: asString(externalShift.arr).trim() || null,
        [ext.externalDep]: asString(externalShift.dep).trim() || null,
        [ext.lastSyncedAt]: new Date().toISOString(),
      };

      try {
        await patchShiftInstanceFields({ itemId: matchedInstanceId, fields: patchFields });
      } catch (err) {
        warnings.push(
          `Matched shift ${matchedInstanceId} but failed to write external metadata: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (action === 'missing-driver') {
      warnings.push(
        `Matched shift ${matchedInstanceId} for external shift ${externalShiftId}, but no local driver matched SSN ${ssn || 'n/a'}.`
      );
    }

    results.push({
      externalShiftId: Number(externalShift.id),
      externalName: asString(externalShift.name).trim(),
      date,
      time,
      unassigned,
      ssn: ssn || null,
      ssnName: asString(externalShift.ssn_name).trim() || null,
      matchedInstanceId,
      matchedDriverId,
      matchedDriverName,
      score: matchedScore,
      via,
      action,
      reason:
        action === 'missing-driver'
          ? `no local driver found for SSN ${ssn || 'n/a'}`
          : hydrated
            ? undefined
            : raw
              ? 'matched raw shift instance'
              : undefined,
    });
  }

  return {
    summary: {
      workspaceId,
      dryRun,
      externalShiftCount: externalShifts.length,
      matchedShiftCount: results.filter((result) => Boolean(result.matchedInstanceId)).length,
      assignedCount: results.filter((result) => result.action === 'assigned').length,
      unassignedCount: results.filter((result) => result.action === 'unassigned').length,
      missingDriverCount: results.filter((result) => result.action === 'missing-driver').length,
      unmatchedCount: results.filter((result) => result.action === 'unmatched').length,
    },
    results,
    warnings,
  };
}