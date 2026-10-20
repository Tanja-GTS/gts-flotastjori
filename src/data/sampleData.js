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

// ---- Timetables: stops and times from the printed 51A sample ----
const LEG_51_OUT = [['Selfoss/N1', 0], ['Selfoss/FSU', 2], ['Selfoss/Ráðhusið', 4], ['Hveragerði', 17], ['Helluvað', 47], ['Mjódd E', 54]];
const LEG_51_BACK = [['Mjódd E', 0], ['Helluvað', 7], ['Hveragerði', 37], ['Selfoss/Ráðhusið', 49], ['Selfoss/FSU', 51], ['Selfoss/N1', 54]];
const LEG_52_OUT = [['Selfoss/N1', 0], ['Hella', 30], ['Hvolsvöllur', 45], ['Landeyjahöfn', 70]];
const LEG_52_BACK = [['Landeyjahöfn', 0], ['Hvolsvöllur', 25], ['Hella', 40], ['Selfoss/N1', 70]];

function hhmm(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// One column on the sheet: out, a break at the far end, and back.
function sampleTrip(start, out, back, breakMin, route, backRoute = route, skip = '') {
  const s = toMin(start);
  const events = out
    .filter(([label]) => label !== skip)
    .map(([label, off]) => ({ type: 'stop', label, time: hhmm(s + off), route }));
  const arrive = s + out[out.length - 1][1];
  events.push({ type: 'break', duration: breakMin });
  const leave = arrive + breakMin;
  for (const [label, off] of back) {
    if (label !== skip) events.push({ type: 'stop', label, time: hhmm(leave + off), route: backRoute });
  }
  return { name: `${route} ${start}`, time: `${start}–${hhmm(leave + back[back.length - 1][1])}`, events };
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND_DAYS = ['sat', 'sun'];

function sampleSheets(season) {
  const sheet = (route, shiftType, days, routeName, trips) => ({
    key: `${season}|${route}|${shiftType}|${days.join('')}`,
    route,
    routeGroup: route.match(/^\d+/)[0],
    routeName,
    shiftType,
    weekPart: days === WEEKEND_DAYS ? 'weekend' : 'weekdays',
    days,
    trips,
  });
  const n51 = 'Selfoss N1 ⇋ Mjódd E';
  const late = season === 'summer' ? 15 : 0;
  return [
    sheet('51-A', 'morning', WEEKDAYS, n51, [sampleTrip(hhmm(385 + late), LEG_51_OUT, LEG_51_BACK, 36, '51'), sampleTrip(hhmm(550 + late), LEG_51_OUT, LEG_51_BACK, 96, '51')]),
    sheet('51-A', 'evening', WEEKDAYS, n51, [sampleTrip('14:10', LEG_51_OUT, LEG_51_BACK, 30, '51'), sampleTrip('16:40', LEG_51_OUT, LEG_51_BACK, 45, '51'), sampleTrip('19:20', LEG_51_OUT, LEG_51_BACK, 25, '51')]),
    sheet('51-A', 'morning', WEEKEND_DAYS, n51, [sampleTrip('08:25', LEG_51_OUT, LEG_51_BACK, 40, '51')]),
    sheet('51-A', 'evening', WEEKEND_DAYS, n51, [sampleTrip('15:25', LEG_51_OUT, LEG_51_BACK, 40, '51')]),
    // Second trip switches to route 73 on the way back.
    sheet('51-B', 'morning', WEEKDAYS, n51, [sampleTrip('06:55', LEG_51_OUT, LEG_51_BACK, 30, '51'), sampleTrip('09:40', LEG_51_OUT, LEG_51_BACK, 50, '51', '73')]),
    sheet('51-B', 'evening', WEEKDAYS, n51, [sampleTrip('15:05', LEG_51_OUT, LEG_51_BACK, 35, '51')]),
    sheet('51-C', 'single', [...WEEKDAYS, ...WEEKEND_DAYS], n51, [sampleTrip('11:15', LEG_51_OUT, LEG_51_BACK, 30, '51')]),
    // The 12:30 trip does not serve Hvolsvöllur: shows "--".
    sheet('52-A', 'morning', WEEKDAYS, 'Selfoss N1 ⇋ Landeyjahöfn', [sampleTrip('07:30', LEG_52_OUT, LEG_52_BACK, 45, '52'), sampleTrip('12:30', LEG_52_OUT, LEG_52_BACK, 60, '52', '52', 'Hvolsvöllur')]),
    sheet('52-A', 'evening', [...WEEKDAYS, ...WEEKEND_DAYS], 'Selfoss N1 ⇋ Landeyjahöfn', [sampleTrip('16:30', LEG_52_OUT, LEG_52_BACK, 45, '52')]),
    sheet('72', 'morning', WEEKDAYS, 'Selfoss N1 ⇋ Flúðir', [sampleTrip('07:00', [['Selfoss/N1', 0], ['Reykholt', 40], ['Flúðir', 55]], [['Flúðir', 0], ['Reykholt', 15], ['Selfoss/N1', 55]], 20, '72')]),
    sheet('73', 'evening', WEEKDAYS, 'Selfoss N1 ⇋ Þorlákshöfn', [sampleTrip('17:10', [['Selfoss/N1', 0], ['Þorlákshöfn', 25]], [['Þorlákshöfn', 0], ['Selfoss/N1', 25]], 15, '73')]),
  ];
}

function sampleTimetables() {
  const t = today();
  const winter = { from: '2026-08-24', to: '2027-06-15' };
  const summer = { from: '2026-06-15', to: '2026-08-23' };
  return [
    { id: 'winter', name: 'Winter', ...winter, active: winter.from <= t && t <= winter.to, sheets: sampleSheets('winter') },
    { id: 'summer', name: 'Summer', ...summer, active: summer.from <= t && t <= summer.to, sheets: sampleSheets('summer') },
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
    case '/api/timetables':
      return { ok: true, seasons: sampleTimetables() };
    case '/api/workspaces':
      return { ok: true, workspaces: [{ id: WORKSPACE, name: 'South Iceland (sample)' }] };
    case '/api/drivers':
      return { ok: true, drivers: DRIVERS.map((d) => ({ ...d, email: '', phone: '' })) };
    case '/api/buses':
      return { ok: true, buses: [{ id: 'b1', title: 'AB-123' }, { id: 'b2', title: 'CD-456' }] };
    default:
      throw new Error(`Sample data preview: no sample for ${u.pathname}`);
  }
}
