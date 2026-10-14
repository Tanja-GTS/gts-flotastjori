// Made-up data for previewing the app locally without SharePoint or Tímon.
// Enabled with VITE_SAMPLE_DATA=true (see fetchJson in backendApi.js).
// Everything is relative to the real "today" so the clock-in states always show.

const WORKSPACE = 'south';

const DRIVERS = [
  { id: 'd1', name: 'Anna Sigurðardóttir' },
  { id: 'd2', name: 'Daníel Gunnarsson' },
  { id: 'd3', name: 'Marek Svoboda' },
  { id: 'd4', name: 'Jón Jónsson' },
  { id: 'd5', name: 'Piotr Nowak' },
  { id: 'd6', name: 'Elín Björnsdóttir' },
];

const ROUTES = [
  { route: '51-A', routeName: 'Reykjavík – Selfoss', morning: '06:00–12:00', evening: '15:00–21:00' },
  { route: '52', routeName: 'Selfoss – Hella', morning: '06:30–13:30', evening: '14:30–22:00' },
  { route: '53', routeName: 'Hella – Vík', morning: '06:00–14:00', evening: '14:00–22:00' },
  { route: '72', routeName: 'Selfoss – Flúðir', morning: '07:00–13:00', evening: '15:00–20:30' },
];

function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return iso(new Date(y, m - 1, d + n));
}

function today() {
  return iso(new Date());
}

function nowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMin(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function stamp(isoDate, hhmm) {
  return `${isoDate}T${hhmm}:00.000000`;
}

// Fixed situations, placed relative to today.
function scenarios() {
  const t = today();
  return {
    // Forgot to clock out yesterday, clocked out this morning, no clock-in today.
    daniel: { driverId: 'd2', route: '53', type: 'morning', date: addDays(t, -1), in: stamp(addDays(t, -1), '05:58'), out: stamp(t, '06:31') },
    danielToday: { driverId: 'd2', route: '53', type: 'morning', date: t },
    // Still clocked in since two days ago; on today's evening shift.
    marek: { driverId: 'd3', route: '72', type: 'morning', date: addDays(t, -2), in: stamp(addDays(t, -2), '06:02') },
    marekToday: { driverId: 'd3', route: '72', type: 'evening', date: t },
    // Clocked in early this morning.
    anna: { driverId: 'd1', route: '51-A', type: 'morning', date: t, in: stamp(t, '05:40') },
  };
}

function shiftId(date, route, type) {
  return `sample-${date}-${route}-${type}`;
}

function scenarioDriverFor(date, route, type) {
  for (const s of Object.values(scenarios())) {
    if (s.date === date && s.route === route && s.type === type) return s.driverId;
  }
  return null;
}

function buildMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const shifts = [];
  const busyByDate = new Map();
  for (let day = 1; day <= days; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    ROUTES.forEach((r, ri) => {
      ['morning', 'evening'].forEach((type, ti) => {
        const busy = busyByDate.get(date) || new Set();
        let driverId = scenarioDriverFor(date, r.route, type);
        if (!driverId) {
          // Rotate the rest; leave a few unassigned. Never double-book a driver.
          const pick = DRIVERS[(day + ri * 2 + ti) % DRIVERS.length];
          const reserved = Object.values(scenarios()).some((s) => s.date === date && s.driverId === pick.id);
          driverId = (day + ri + ti) % 7 === 0 || reserved || busy.has(pick.id) ? null : pick.id;
        }
        if (driverId) busy.add(driverId);
        busyByDate.set(date, busy);
        const driver = DRIVERS.find((d) => d.id === driverId);
        shifts.push({
          id: shiftId(date, r.route, type),
          workspaceId: WORKSPACE,
          date,
          route: r.route,
          routeName: r.routeName,
          shiftType: type,
          weekPart: 'weekdays',
          season: 'winter',
          name: r.routeName,
          time: r[type],
          driverId: driverId || '',
          driverName: driver ? driver.name : '',
          confirmationStatus: driver ? 'assigned' : 'unassigned',
          trips: [],
        });
      });
    });
  }
  return shifts;
}

function clockStatus(from, to) {
  const t = today();
  const now = nowMinutes();
  const last = to < t ? to : t;
  const sc = scenarios();
  const byShiftId = {};
  const special = new Set(Object.values(sc).map((s) => shiftId(s.date, s.route, s.type)));

  // Ordinary days: everyone assigned clocked in a few minutes early and out on time.
  const months = new Set([from.slice(0, 7), last.slice(0, 7)]);
  for (const month of months) {
    for (const s of buildMonth(month)) {
      if (!s.driverId || s.date < from || s.date > last || special.has(s.id)) continue;
      const [start, end] = s.time.split('–').map(toMin);
      if (s.date === t && now < start - 10) continue;
      const clockIn = stamp(s.date, fromMin(start - 6));
      if (s.date === t && now < end) byShiftId[s.id] = { status: 'on-shift', clockInAt: clockIn, clockOutAt: null };
      else byShiftId[s.id] = { status: 'done', clockInAt: clockIn, clockOutAt: stamp(s.date, fromMin(end + 4)) };
    }
  }

  const put = (s, value) => {
    if (s.date >= from && s.date <= last) byShiftId[shiftId(s.date, s.route, s.type)] = value;
  };
  put(sc.daniel, { status: 'done', clockInAt: sc.daniel.in, clockOutAt: sc.daniel.out });
  put(sc.marek, { status: 'on-shift', clockInAt: sc.marek.in, clockOutAt: null });
  put(sc.marekToday, { status: 'still-on-clock', clockInAt: sc.marek.in, clockOutAt: null });
  put(sc.anna, { status: 'on-shift', clockInAt: sc.anna.in, clockOutAt: null });
  return byShiftId;
}

function clockAlerts() {
  const t = today();
  return [
    { driverId: 'd3', driverName: 'Marek Svoboda', clockInAt: stamp(addDays(t, -2), '06:02') },
    // No shift today: only the bell can show him.
    { driverId: 'd7', driverName: 'Tomasz Kowalski', clockInAt: stamp(addDays(t, -5), '14:55') },
  ];
}

export async function sampleResponse(url, init) {
  const u = new URL(String(url), 'http://sample.local');
  const method = String(init?.method || 'GET').toUpperCase();
  const q = (k) => u.searchParams.get(k) || '';

  if (method !== 'GET') {
    throw new Error('Sample data preview: changes are not saved.');
  }

  switch (u.pathname) {
    case '/api/shifts':
      return { ok: true, shifts: q('month') ? buildMonth(q('month')) : [] };
    case '/api/timon/clock-status':
      return { ok: true, byShiftId: clockStatus(q('from') || q('date') || today(), q('to') || q('date') || today()) };
    case '/api/timon/clock-alerts':
      return { ok: true, alerts: clockAlerts() };
    case '/api/workspaces':
      return { ok: true, workspaces: [{ id: WORKSPACE, name: 'South Iceland (sample)' }] };
    case '/api/drivers':
      return { ok: true, drivers: [...DRIVERS, { id: 'd7', name: 'Tomasz Kowalski' }].map((d) => ({ ...d, email: '', phone: '' })) };
    case '/api/buses':
      return { ok: true, buses: [{ id: 'b1', title: 'AB-123' }, { id: 'b2', title: 'CD-456' }] };
    default:
      throw new Error(`Sample data preview: no sample for ${u.pathname}`);
  }
}
