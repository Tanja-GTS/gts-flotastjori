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

// Tímon represents a double-booking as two separate shiftplan rows with different
// `id` but identical name + arr + dep. Group assigned rows by that triple to detect it.
function conflictGroupKey(shift: ExternalShiftPlan): string {
  return [normalizeText(shift.name), asString(shift.arr).trim(), asString(shift.dep).trim()].join('|');
}

function shiftIsoMonth(shift: ExternalShiftPlan): string {
  return asString(shift.arr).slice(0, 7);
}

// ---------------------------------------------------------------------------
// Matching Tímon rows to cards
//
// A Tímon row may only land on a card for the SAME route: same Tímon shift
// name, same route/shift name, or same route code. Times never decide the
// route - many routes share start/end times (51C and 72A mornings do), and
// "same day + same times" used to be enough to put Wieslaw's 51C shift on 72A.
// Within a route, times choose between cards (morning vs evening).
//
// Every run plans all matches from scratch, best pairs first, so a mistake
// made by an earlier run is corrected by the next one. A card's previous link
// only breaks exact ties, to keep things stable.
// ---------------------------------------------------------------------------

// "51C - Morgun - V" -> "51C", "72-A morgun" -> "72A", "73 - Morgun" -> "73"
export function timonRouteCode(name: unknown): string {
  const upper = asString(name).toUpperCase();
  const lettered = upper.match(/\b(\d{1,3})\s*-?\s*([A-Z])\b/);
  if (lettered) return `${lettered[1]}${lettered[2]}`;
  const digits = upper.match(/^\s*(\d{1,3})\b/);
  return digits ? digits[1] : '';
}

// How sure we are that this Tímon row and this card are the same route and
// shift; 0 = different route, never match.
export function routeIdentityScore(externalShift: ExternalShiftPlan, localShift: HydratedShiftDto): number {
  const externalName = normalizeText(externalShift.name);
  if (!externalName) return 0;
  const timonShiftName = normalizeText(localShift.timonShiftName);
  if (timonShiftName && externalName === timonShiftName) return 100;
  const names = [localShift.name, localShift.route, localShift.routeName].map(normalizeText).filter(Boolean);
  if (names.includes(externalName)) return 80;
  const code = normalizeRouteCode(timonRouteCode(externalShift.name));
  const localCodes = [localShift.timonRouteCode, localShift.route].map(normalizeRouteCode).filter(Boolean);
  if (code && localCodes.includes(code)) return 60;
  return 0;
}

function timeFitScore(externalShift: ExternalShiftPlan, localShift: HydratedShiftDto): number {
  const externalTime = normalizeTimeLabel(buildExternalTimeLabel(externalShift));
  const localTime = normalizeTimeLabel(localShift.time);
  if (externalTime && externalTime === localTime) return 35;
  const a = parseTimeRangeToMinutes(externalTime);
  const b = parseTimeRangeToMinutes(localTime);
  if (!a || !b) return 0;
  const diff = Math.max(Math.abs(a.start - b.start), Math.abs(a.end - b.end));
  if (diff <= 10) return 30;
  if (diff <= 30) return 18;
  return 0;
}

function numericOrMax(id: string): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export type TimonMatchPlan = Map<string, { instanceId: string; score: number } | { reason: string }>;

export function planTimonMatches(params: {
  externalShifts: ExternalShiftPlan[];
  localShifts: HydratedShiftDto[];
  // Tímon row id -> card it was linked to by an earlier run (tie-breaker only)
  previousInstanceByExternalId?: Map<string, string>;
}): TimonMatchPlan {
  const previous = params.previousInstanceByExternalId ?? new Map<string, string>();
  const shiftsByDate = new Map<string, HydratedShiftDto[]>();
  for (const s of params.localShifts) {
    const list = shiftsByDate.get(s.date) ?? [];
    list.push(s);
    shiftsByDate.set(s.date, list);
  }

  const pairs: Array<{ externalId: string; instanceId: string; score: number; wasLinked: boolean }> = [];
  const plan: TimonMatchPlan = new Map();
  for (const externalShift of params.externalShifts) {
    const externalId = asString(externalShift.id).trim();
    const sameDay = shiftsByDate.get(shiftIsoDate(externalShift)) ?? [];
    let candidates = 0;
    for (const local of sameDay) {
      const identity = routeIdentityScore(externalShift, local);
      if (identity === 0) continue;
      candidates += 1;
      pairs.push({
        externalId,
        instanceId: local.id,
        score: identity + timeFitScore(externalShift, local),
        wasLinked: previous.get(externalId) === local.id,
      });
    }
    plan.set(externalId, {
      reason: sameDay.length === 0
        ? 'no cards on this date'
        : candidates === 0
          ? `no card for route ${timonRouteCode(externalShift.name) || `"${asString(externalShift.name).trim()}"`} on this date`
          : 'its card was taken by a better match (double-booked in Tímon?)',
    });
  }

  // Best pairs first; ties: keep last run's link, then oldest card, then oldest Tímon row.
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.wasLinked) - Number(a.wasLinked) ||
      numericOrMax(a.instanceId) - numericOrMax(b.instanceId) ||
      numericOrMax(a.externalId) - numericOrMax(b.externalId)
  );
  const takenCards = new Set<string>();
  const placedRows = new Set<string>();
  for (const pair of pairs) {
    if (takenCards.has(pair.instanceId) || placedRows.has(pair.externalId)) continue;
    takenCards.add(pair.instanceId);
    placedRows.add(pair.externalId);
    plan.set(pair.externalId, { instanceId: pair.instanceId, score: pair.score });
  }
  return plan;
}

type TimonClearedCard = {
  instanceId: string;
  date: string;
  route: string;
  shiftType: string;
  previousDriverName: string | null;
};

// If more than this share of Tímon's assigned rows find no card, the matching
// itself is suspect (renamed shifts in Tímon, missing patterns...): report, but
// do not clear any card.
const MAX_UNMATCHED_SHARE_FOR_CLEANUP = 0.3;

type TimonConflict = {
  date: string;
  shiftName: string;
  time: string;
  routeCode: string | null;
  externalShiftIds: number[];
  drivers: Array<{
    ssn: string;
    name: string | null;
    matchedDriverId: string | null;
    matchedDriverName: string | null;
  }>;
  matchedInstanceId?: string;
};

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
  via: 'route' | 'unmatched';
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
    conflictCount: number;
    clearedCount: number;
  };
  results: TimonMatchResult[];
  conflicts: TimonConflict[];
  cleared: TimonClearedCard[];
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

  const warnings: string[] = [];
  const results: TimonMatchResult[] = [];
  const ext = getShiftInstanceExternalFieldNames();
  const plan = planTimonMatches({
    externalShifts,
    localShifts,
    previousInstanceByExternalId: instanceIdByExternalShiftId,
  });

  // Detect double-bookings: the same shift (name + arr + dep) assigned to 2+ people in Tímon.
  const assignedRowsByGroup = new Map<string, ExternalShiftPlan[]>();
  for (const shift of externalShifts) {
    if (shift.unassigned) continue;
    if (!normalizeSsn(shift.ssn)) continue;
    const key = conflictGroupKey(shift);
    const bucket = assignedRowsByGroup.get(key);
    if (bucket) bucket.push(shift);
    else assignedRowsByGroup.set(key, [shift]);
  }

  const conflicts: TimonConflict[] = [];
  const conflictLabelByGroup = new Map<string, string>();
  for (const [key, rows] of assignedRowsByGroup) {
    const distinctBySsn = new Map<string, ExternalShiftPlan>();
    for (const row of rows) distinctBySsn.set(normalizeSsn(row.ssn), row);
    if (distinctBySsn.size < 2) continue;

    const distinctRows = Array.from(distinctBySsn.values());
    const drivers = distinctRows.map((row) => {
      const ssn = normalizeSsn(row.ssn);
      const driver = driversBySsn.get(ssn);
      return {
        ssn,
        name: asString(row.ssn_name).trim() || null,
        matchedDriverId: driver?.id ?? null,
        matchedDriverName: driver?.name ?? null,
      };
    });
    const displayNames = drivers.map((d) => d.name || d.ssn).join(', ');
    conflictLabelByGroup.set(key, `${distinctBySsn.size} drivers assigned in Tímon: ${displayNames}`);
    conflicts.push({
      date: shiftIsoDate(distinctRows[0]),
      shiftName: asString(distinctRows[0].name).trim(),
      time: buildExternalTimeLabel(distinctRows[0]),
      routeCode: normalizeRouteCode(extractExternalRouteCode(distinctRows[0].name)) || null,
      externalShiftIds: distinctRows.map((row) => Number(row.id)),
      drivers,
    });
  }

  for (const externalShift of externalShifts) {
    const externalShiftId = asString(externalShift.id).trim();
    const date = shiftIsoDate(externalShift);
    const time = buildExternalTimeLabel(externalShift);
    const ssn = normalizeSsn(externalShift.ssn);
    const matchedDriver = ssn ? driversBySsn.get(ssn) : undefined;
    const unassigned = Boolean(externalShift.unassigned) || !ssn;

    const planned = plan.get(externalShiftId);
    const matchedInstanceId = planned && 'instanceId' in planned ? planned.instanceId : undefined;
    const matchedScore = planned && 'instanceId' in planned ? planned.score : undefined;
    const via: TimonMatchResult['via'] = matchedInstanceId ? 'route' : 'unmatched';
    const reason = planned && 'reason' in planned ? planned.reason : '';

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

    const hydrated = hydratedById.get(matchedInstanceId);
    const raw = rawById.get(matchedInstanceId);
    const matchedDriverId = matchedDriver?.id;
    const matchedDriverName = matchedDriver?.name;

    // If this Tímon row belongs to a double-booked group, flag the matched
    // instance; otherwise clear any stale flag left by a previous sync.
    const conflictGroup = conflictGroupKey(externalShift);
    const conflictLabel = conflictLabelByGroup.get(conflictGroup) ?? null;
    if (conflictLabel) {
      const conflict = conflicts.find((c) => c.externalShiftIds.includes(Number(externalShift.id)));
      if (conflict && !conflict.matchedInstanceId) conflict.matchedInstanceId = matchedInstanceId;
    }

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
        [ext.externalConflict]: conflictLabel,
      };

      try {
        await patchShiftInstanceFields({ itemId: matchedInstanceId, fields: patchFields });
      } catch (err) {
        warnings.push(
          `Matched shift ${matchedInstanceId} but failed to write external metadata: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (hydrated && action === 'assigned' && hydrated.driverId !== matchedDriverId) {
      // eslint-disable-next-line no-console
      console.log(
        `[timon-sync] ${date} "${asString(externalShift.name).trim()}" ${asString(externalShift.ssn_name).trim()} -> ` +
          `${hydrated.route} ${hydrated.shiftType} (card ${matchedInstanceId}, was ${hydrated.driverName || 'empty'})${dryRun ? ' [test run]' : ''}`
      );
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

  // Clean-up: a card filled from Tímon that no Tímon row matches any more loses
  // its driver, so a wrong match (or a shift Tímon dropped) never lingers.
  // Only on dates Tímon actually returned rows for, and only when matching
  // looks healthy - an outage or a mass rename must never wipe the schedule.
  const cleared: TimonClearedCard[] = [];
  const matchedIds = new Set(results.map((r) => r.matchedInstanceId).filter((id): id is string => Boolean(id)));
  const datesFromTimon = new Set(externalShifts.map(shiftIsoDate).filter(Boolean));
  const assignedRows = results.filter((r) => !r.unassigned);
  const unmatchedAssigned = assignedRows.filter((r) => r.action === 'unmatched');
  for (const r of unmatchedAssigned) {
    warnings.push(`Not placed: ${r.date} "${r.externalName}" (${r.ssnName || 'no name'}) - ${r.reason || 'no matching card'}`);
  }
  const unmatchedShare = assignedRows.length ? unmatchedAssigned.length / assignedRows.length : 0;
  const partialRun = Boolean(params.ssns || params.groups || (params.shifts && params.shifts.length > 0));
  if (partialRun) {
    // Only some people's rows were fetched: every other card would look unmatched.
  } else if (assignedRows.length === 0 || unmatchedShare > MAX_UNMATCHED_SHARE_FOR_CLEANUP) {
    warnings.push(
      `Clean-up skipped: ${unmatchedAssigned.length} of ${assignedRows.length} assigned Tímon shifts found no card. ` +
        'Check shift names in Tímon against the patterns before trusting this run.'
    );
  } else {
    for (const card of localShifts) {
      if (!card.driverId || matchedIds.has(card.id) || !datesFromTimon.has(card.date)) continue;
      const raw = rawById.get(card.id);
      if (asString(raw?.externalSource).trim().toLowerCase() !== 'timon') continue;
      cleared.push({
        instanceId: card.id,
        date: card.date,
        route: card.route,
        shiftType: card.shiftType,
        previousDriverName: card.driverName || null,
      });
      // eslint-disable-next-line no-console
      console.log(
        `[timon-sync] ${card.date} ${card.route} ${card.shiftType} (card ${card.id}): removing ${card.driverName || 'driver'} - no Tímon shift matches this card${dryRun ? ' [test run]' : ''}`
      );
      if (dryRun) continue;
      await assignDriverToShiftInstance({ itemId: card.id, driverId: null });
      try {
        await setShiftInstanceConfirmationStatus({ itemId: card.id, status: 'unassigned' });
      } catch {
        // ignore confirmation status write failures for sync
      }
      try {
        await patchShiftInstanceFields({
          itemId: card.id,
          fields: {
            [ext.externalShiftId]: null,
            [ext.externalEmployeeSsn]: null,
            [ext.externalEmployeeName]: null,
            [ext.externalConflict]: null,
            [ext.lastSyncedAt]: new Date().toISOString(),
          },
        });
      } catch (err) {
        warnings.push(`Cleared driver on ${card.id} but failed to clear its Tímon link: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  for (const conflict of conflicts) {
    const who = conflict.drivers.map((d) => d.name || d.ssn).join(' & ');
    warnings.push(
      `Tímon double-booking on ${conflict.date} ${conflict.shiftName} (${conflict.time}): ${who}` +
        (conflict.matchedInstanceId ? ` — flagged shift ${conflict.matchedInstanceId}` : ' — no local shift matched')
    );
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
      conflictCount: conflicts.length,
      clearedCount: cleared.length,
    },
    results,
    conflicts,
    cleared,
    warnings,
  };
}