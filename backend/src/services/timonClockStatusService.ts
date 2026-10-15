import { optionalEnv } from '../utils/env';
import { resolveDriversBySsn } from './driversService';
import { listHydratedShifts, type HydratedShiftDto } from './shiftInstancesService';
import { cacheGetOrSet } from './simpleCache';
import { fetchTimonArrdeps, type ExternalArrdep } from './timonService';

export type ShiftClockStatus = {
  // still-on-clock: the driver never clocked out of an earlier day's punch,
  // shown on his later shifts until he does.
  status: 'on-shift' | 'done' | 'still-on-clock';
  clockInAt: string;
  clockOutAt: string | null;
};

const DAY_MS = 86_400_000;
const ARRDEPS_TTL_MS = 45_000;

function lookbackDays(): number {
  const n = Number(optionalEnv('TIMON_OPEN_PUNCH_LOOKBACK_DAYS', '14'));
  return Number.isFinite(n) && n >= 1 ? Math.min(60, Math.floor(n)) : 14;
}

function normalizeSsn(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, '').replace(/-/g, '');
}

// "2026-09-07T05:55:03.976605" -> { date: "2026-09-07", minutes: 355 }
function parseTimonTs(raw: unknown): { date: string; minutes: number } | null {
  const m = String(raw ?? '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return { date: m[1], minutes: Number(m[2]) * 60 + Number(m[3]) };
}

// "05:55–12:05" (or "-" / "—") -> { start: 355, end: 725 }. End < start => overnight (+24h).
function parseShiftWindow(time: unknown): { start: number; end: number } | null {
  const parts = String(time ?? '')
    .replace(/[—-]/g, '–')
    .split('–')
    .map((p) => p.trim());
  if (parts.length < 2) return null;
  const toMin = (p: string) => {
    const mm = p.match(/^(\d{1,2}):(\d{2})$/);
    return mm ? Number(mm[1]) * 60 + Number(mm[2]) : null;
  };
  const start = toMin(parts[0]);
  let end = toMin(parts[1]);
  if (start == null || end == null) return null;
  if (end <= start) end += 24 * 60;
  return { start, end };
}

function addDaysIso(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// Minutes from the start of `date` to a timestamp; a clock-out two days later is +2880.
// Tímon timestamps are UTC-naive and Iceland is UTC, so they compare as UTC.
function minutesFromDate(ts: { date: string; minutes: number }, date: string): number {
  const days = Math.round((Date.parse(`${ts.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
  return days * 24 * 60 + ts.minutes;
}

export function nowTs(): { date: string; minutes: number } {
  const now = new Date();
  return { date: now.toISOString().slice(0, 10), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
}

export type ClockPunch = {
  ssn: string;
  inTs: { date: string; minutes: number };
  outTs: { date: string; minutes: number } | null;
  arr: string;
  dep: string | null;
};

// Real clock-ins only: arrdeptype TI. Tímon's arrdeps also carries the planned
// schedule (VK) and leave, which must never read as someone clocking in.
export function punchesFromArrdeps(arrdeps: ExternalArrdep[]): ClockPunch[] {
  const punches: ClockPunch[] = [];
  for (const row of arrdeps) {
    if (String(row.arrdeptype || '').toUpperCase() !== 'TI') continue;
    const ssn = normalizeSsn(row.ssn);
    const inTs = parseTimonTs(row.arr);
    if (!ssn || !inTs) continue;
    const outTs = row.dep ? parseTimonTs(row.dep) : null;
    punches.push({ ssn, inTs, outTs, arr: String(row.arr), dep: row.dep ? String(row.dep) : null });
  }
  return punches;
}

async function loadPunches(fromdate: string, todate: string): Promise<ClockPunch[]> {
  const arrdeps = await cacheGetOrSet<ExternalArrdep[]>({
    key: `timon-arrdeps|${fromdate}|${todate}`,
    ttlMs: ARRDEPS_TTL_MS,
    factory: () => fetchTimonArrdeps({ fromdate, todate }),
    staleWhileRevalidate: false,
  });
  return punchesFromArrdeps(arrdeps);
}

// Still open, and clocked in on an earlier day than `onDate`.
function forgotToClockOut(punch: ClockPunch, onDate: string): boolean {
  return !punch.outTs && punch.inTs.date < onDate;
}

type Punch = { inMin: number; outMin: number | null; arr: string; dep: string | null };

/**
 * Decide which of one driver's shifts each of his punches belongs to.
 *
 * A punch counts for every shift it overlaps (a driver who clocks in once for
 * the whole day covers all his shifts) AND for the shift whose start is nearest
 * his clock-in. The second rule is what makes an early clock-in show at once:
 * clocking in at 06:00 for a 06:40 shift overlaps nothing yet, but it is
 * plainly that shift's clock-in. Managers need to see early clock-ins as they
 * happen, and a wrong start time on one shift must not hide them.
 * Shifts that were already over when he clocked in are skipped for "nearest"
 * so an evening clock-in never lands on the morning card - unless every shift
 * is over, which only happens when a shift time is wrong.
 */
export function matchDriverPunchesToShifts(params: {
  shifts: Array<{ id: string; start: number; end: number }>;
  punches: Punch[];
  nowMinutes: number | null;
}): Record<string, ShiftClockStatus> {
  const { shifts, punches, nowMinutes } = params;
  const openById = new Map<string, Punch>();
  const closedById = new Map<string, Punch>();
  if (shifts.length === 0) return {};

  for (const punch of punches) {
    const punchEnd = punch.outMin ?? nowMinutes ?? Number.POSITIVE_INFINITY;
    const targets = new Set<string>();
    for (const shift of shifts) {
      if (punch.inMin < shift.end && punchEnd > shift.start) targets.add(shift.id);
    }

    const notOver = shifts.filter((shift) => shift.end > punch.inMin);
    const pool = notOver.length > 0 ? notOver : shifts;
    let nearest = pool[0];
    for (const shift of pool) {
      if (Math.abs(shift.start - punch.inMin) < Math.abs(nearest.start - punch.inMin)) nearest = shift;
    }
    targets.add(nearest.id);

    const into = punch.outMin == null ? openById : closedById;
    for (const id of targets) {
      const prev = into.get(id);
      if (!prev || punch.inMin > prev.inMin) into.set(id, punch);
    }
  }

  const byShiftId: Record<string, ShiftClockStatus> = {};
  for (const shift of shifts) {
    const open = openById.get(shift.id);
    const closed = closedById.get(shift.id);
    if (open) byShiftId[shift.id] = { status: 'on-shift', clockInAt: open.arr, clockOutAt: null };
    else if (closed) byShiftId[shift.id] = { status: 'done', clockInAt: closed.arr, clockOutAt: closed.dep };
  }
  return byShiftId;
}

/** Pure core of getShiftClockStatus, separate so it can be checked without Tímon or SharePoint. */
export function buildClockStatuses(params: {
  shifts: Array<{ id: string; date: string; time: string; driverId?: string }>;
  punches: ClockPunch[];
  driverIdBySsn: Map<string, string>;
  from: string;
  to: string;
  now: { date: string; minutes: number };
}): Record<string, ShiftClockStatus> {
  const { shifts, punches, driverIdBySsn, from, to, now } = params;
  const punchesByDriverId = new Map<string, ClockPunch[]>();
  for (const punch of punches) {
    const driverId = driverIdBySsn.get(punch.ssn);
    if (!driverId) continue;
    const bucket = punchesByDriverId.get(driverId) ?? [];
    bucket.push(punch);
    punchesByDriverId.set(driverId, bucket);
  }

  // date -> driverId -> that driver's shifts on that date
  const shiftsByDateDriver = new Map<string, Map<string, Array<{ id: string; start: number; end: number }>>>();
  for (const shift of shifts) {
    if (!shift.driverId || shift.date < from || shift.date > to) continue;
    if (!punchesByDriverId.has(shift.driverId)) continue;
    const window = parseShiftWindow(shift.time);
    if (!window) continue;
    const byDriver = shiftsByDateDriver.get(shift.date) ?? new Map();
    const bucket = byDriver.get(shift.driverId) ?? [];
    bucket.push({ id: shift.id, ...window });
    byDriver.set(shift.driverId, bucket);
    shiftsByDateDriver.set(shift.date, byDriver);
  }

  const byShiftId: Record<string, ShiftClockStatus> = {};
  for (const [date, byDriver] of shiftsByDateDriver) {
    for (const [driverId, driverShifts] of byDriver) {
      const driverPunches = punchesByDriverId.get(driverId) ?? [];
      const sameDay: Punch[] = driverPunches
        .filter((p) => p.inTs.date === date)
        .map((p) => ({
          inMin: p.inTs.minutes,
          outMin: p.outTs ? minutesFromDate(p.outTs, date) : null,
          arr: p.arr,
          dep: p.dep,
        }));
      const statuses = matchDriverPunchesToShifts({
        shifts: driverShifts,
        punches: sameDay,
        nowMinutes: minutesFromDate(now, date),
      });

      const forgotten = driverPunches
        .filter((p) => forgotToClockOut(p, date))
        .sort((a, b) => a.arr.localeCompare(b.arr))[0];
      for (const shift of driverShifts) {
        if (statuses[shift.id]) byShiftId[shift.id] = statuses[shift.id];
        else if (forgotten) {
          byShiftId[shift.id] = { status: 'still-on-clock', clockInAt: forgotten.arr, clockOutAt: null };
        }
      }
    }
  }

  return byShiftId;
}

/**
 * Clock-in status for every assigned shift dated `from`..`to` (future days are
 * skipped). Each punch belongs to the day it was clocked in on, so a punch from
 * yesterday that was only clocked out this morning stays on yesterday's card.
 * A driver who never clocked out of an earlier day gets 'still-on-clock' on his
 * later shifts that have no clock-in of their own.
 */
export async function getShiftClockStatus(params: {
  workspaceId: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  // Where to get the shifts from. Pass the schedule's own (cached) list so
  // badges are keyed to the very cards on screen.
  loadShifts?: (workspaceId: string, month: string) => Promise<HydratedShiftDto[]>;
}): Promise<{ from: string; to: string; byShiftId: Record<string, ShiftClockStatus>; generatedAt: string }> {
  const workspaceId = String(params.workspaceId || 'south').trim() || 'south';
  const from = String(params.from || '').slice(0, 10);
  const now = nowTs();
  const requestedTo = String(params.to || from).slice(0, 10);
  const to = requestedTo < now.date ? requestedTo : now.date;
  const generatedAt = new Date().toISOString();
  if (!from || from > to) return { from, to: requestedTo, byShiftId: {}, generatedAt };

  const months: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    if (!months.includes(d.slice(0, 7))) months.push(d.slice(0, 7));
  }

  const [shiftPages, punches] = await Promise.all([
    Promise.all(
      months.map((month) =>
        params.loadShifts ? params.loadShifts(workspaceId, month) : listHydratedShifts({ workspaceId, month })
      )
    ),
    loadPunches(addDaysIso(from, -lookbackDays()), to),
  ]);
  if (punches.length === 0) return { from, to: requestedTo, byShiftId: {}, generatedAt };

  const driversBySsn = await resolveDriversBySsn({ ssns: Array.from(new Set(punches.map((p) => p.ssn))) });
  const byShiftId = buildClockStatuses({
    shifts: shiftPages.flat(),
    punches,
    driverIdBySsn: new Map(Array.from(driversBySsn, ([ssn, driver]) => [ssn, driver.id])),
    from,
    to,
    now,
  });

  return { from, to: requestedTo, byShiftId, generatedAt };
}
