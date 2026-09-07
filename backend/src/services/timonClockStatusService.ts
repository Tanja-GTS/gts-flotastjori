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

/**
 * For a single day, work out which assigned shifts have their driver clocked in
 * (an open TI punch overlapping the shift window) or clocked out ("done").
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
  const punchesBySsn = new Map<string, Array<{ inMin: number; outMin: number | null; arr: string; dep: string | null }>>();
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
  const punchesByDriverId = new Map<string, Array<{ inMin: number; outMin: number | null; arr: string; dep: string | null }>>();
  for (const [ssn, driver] of driversBySsn) {
    const punches = punchesBySsn.get(ssn);
    if (punches) punchesByDriverId.set(driver.id, punches);
  }

  const now = new Date();
  const nowMinutesUtc = now.getUTCHours() * 60 + now.getUTCMinutes();
  const nowMinutesOnDate = punchMinutesOnDate({ date: now.toISOString().slice(0, 10), minutes: nowMinutesUtc }, date);

  const byShiftId: Record<string, ShiftClockStatus> = {};
  for (const shift of shifts) {
    if (shift.date !== date || !shift.driverId) continue;
    const punches = punchesByDriverId.get(shift.driverId);
    if (!punches || punches.length === 0) continue;
    const window = parseShiftWindow(shift.time);
    if (!window) continue;

    let onShift: { arr: string } | null = null;
    let done: { arr: string; dep: string | null } | null = null;
    for (const punch of punches) {
      const punchEnd = punch.outMin ?? (nowMinutesOnDate ?? window.end);
      const overlaps = punch.inMin < window.end && punchEnd > window.start;
      if (!overlaps) continue;
      if (punch.outMin == null) {
        onShift = { arr: punch.arr };
        break;
      }
      done = { arr: punch.arr, dep: punch.dep };
    }

    const shiftHasStarted = nowMinutesOnDate == null || nowMinutesOnDate >= window.start;
    if (onShift) {
      byShiftId[shift.id] = { status: 'on-shift', clockInAt: onShift.arr, clockOutAt: null };
    } else if (done && shiftHasStarted) {
      byShiftId[shift.id] = { status: 'done', clockInAt: done.arr, clockOutAt: done.dep };
    }
  }

  return { date, byShiftId, generatedAt: new Date().toISOString() };
}
