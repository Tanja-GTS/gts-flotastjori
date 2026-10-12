import { resolveDriversBySsn } from './driversService';
import { listHydratedShifts } from './shiftInstancesService';
import { fetchTimonArrdeps, type ExternalArrdep } from './timonService';

export type ShiftClockStatus = {
  status: 'on-shift' | 'done';
  clockInAt: string;
  clockOutAt: string | null;
};

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

// Minutes-since-midnight of a Tímon punch relative to the shift's date.
// Punches on the day after the shift date carry +24h (overnight shift clock-out).
function punchMinutesOnDate(
  punch: { date: string; minutes: number },
  shiftDate: string
): number | null {
  if (punch.date === shiftDate) return punch.minutes;
  const shiftDay = Date.parse(`${shiftDate}T00:00:00Z`);
  const punchDay = Date.parse(`${punch.date}T00:00:00Z`);
  if (!Number.isFinite(shiftDay) || !Number.isFinite(punchDay)) return null;
  const deltaDays = Math.round((punchDay - shiftDay) / 86_400_000);
  if (deltaDays < 0 || deltaDays > 1) return null;
  return punch.minutes + deltaDays * 24 * 60;
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

/**
 * For a single day, work out which assigned shifts have their driver clocked in
 * (an open TI punch, see matchDriverPunchesToShifts) or clocked out ("done").
 * Stale punches from other days are ignored — a punch only counts if its clock-in
 * or clock-out falls on the shift's date.
 */
export async function getShiftClockStatus(params: {
  workspaceId: string;
  date: string; // YYYY-MM-DD
  arrdeps?: ExternalArrdep[];
}): Promise<{ date: string; byShiftId: Record<string, ShiftClockStatus>; generatedAt: string }> {
  const workspaceId = String(params.workspaceId || 'south').trim() || 'south';
  const date = String(params.date || '').slice(0, 10);
  const month = date.slice(0, 7);

  const [shifts, arrdeps] = await Promise.all([
    listHydratedShifts({ workspaceId, month }),
    params.arrdeps ?? fetchTimonArrdeps({ fromdate: date, todate: date }),
  ]);

  // Real clock-in punches only (type TI), touching this date.
  const punchesBySsn = new Map<string, Punch[]>();
  for (const row of arrdeps) {
    if (String(row.arrdeptype || '').toUpperCase() !== 'TI') continue;
    const ssn = normalizeSsn(row.ssn);
    if (!ssn) continue;
    const arrTs = parseTimonTs(row.arr);
    const depTs = row.dep ? parseTimonTs(row.dep) : null;
    if (!arrTs) continue;
    if (arrTs.date !== date && depTs?.date !== date) continue;

    const inMin = punchMinutesOnDate(arrTs, date);
    if (inMin == null) continue;
    const outMin = depTs ? punchMinutesOnDate(depTs, date) : null;
    const bucket = punchesBySsn.get(ssn) ?? [];
    bucket.push({ inMin, outMin, arr: String(row.arr), dep: row.dep ? String(row.dep) : null });
    punchesBySsn.set(ssn, bucket);
  }

  if (punchesBySsn.size === 0) {
    return { date, byShiftId: {}, generatedAt: new Date().toISOString() };
  }

  const driversBySsn = await resolveDriversBySsn({ ssns: Array.from(punchesBySsn.keys()) });
  const punchesByDriverId = new Map<string, Punch[]>();
  for (const [ssn, driver] of driversBySsn) {
    const punches = punchesBySsn.get(ssn);
    if (punches) punchesByDriverId.set(driver.id, punches);
  }

  const now = new Date();
  const nowMinutesUtc = now.getUTCHours() * 60 + now.getUTCMinutes();
  const nowMinutesOnDate = punchMinutesOnDate({ date: now.toISOString().slice(0, 10), minutes: nowMinutesUtc }, date);

  // Group each driver's shifts for the day, then place his punches among them.
  const shiftsByDriverId = new Map<string, Array<{ id: string; start: number; end: number }>>();
  for (const shift of shifts) {
    if (shift.date !== date || !shift.driverId) continue;
    if (!punchesByDriverId.has(shift.driverId)) continue;
    const window = parseShiftWindow(shift.time);
    if (!window) continue;
    const bucket = shiftsByDriverId.get(shift.driverId) ?? [];
    bucket.push({ id: shift.id, ...window });
    shiftsByDriverId.set(shift.driverId, bucket);
  }

  const byShiftId: Record<string, ShiftClockStatus> = {};
  for (const [driverId, driverShifts] of shiftsByDriverId) {
    Object.assign(
      byShiftId,
      matchDriverPunchesToShifts({
        shifts: driverShifts,
        punches: punchesByDriverId.get(driverId) ?? [],
        nowMinutes: nowMinutesOnDate,
      })
    );
  }

  return { date, byShiftId, generatedAt: new Date().toISOString() };
}
