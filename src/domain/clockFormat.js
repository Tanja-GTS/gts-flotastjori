const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Tímon timestamps are "2026-10-13T05:58:10.123" (UTC-naive; Iceland is UTC).
// Read the parts directly so the viewer's own timezone never shifts them.
function parts(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const weekday = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay();
  return { date: `${y}-${mo}-${d}`, day: Number(d), month: Number(mo) - 1, weekday, time: `${hh}:${mm}` };
}

// "06:00"
export function clockTime(iso) {
  return parts(iso)?.time || '';
}

// "2026-10-13"
export function clockDate(iso) {
  return parts(iso)?.date || '';
}

// "Mon 13 Oct, 06:00" (localised weekday/month via the app's date.* keys)
export function clockWhen(iso, t) {
  const p = parts(iso);
  if (!p) return '';
  const dow = t(`date.weekdaysShort.${WEEKDAY_KEYS[p.weekday]}`);
  const mon = t(`date.monthsShort.${MONTH_KEYS[p.month]}`);
  return `${dow} ${p.day} ${mon}, ${p.time}`;
}

// A time on the shift's own day reads "06:00"; on another day it gets the date.
export function clockTimeOnShiftDay(iso, shiftDate, t) {
  if (!iso) return '';
  return clockDate(iso) === String(shiftDate || '').slice(0, 10) ? clockTime(iso) : clockWhen(iso, t);
}
