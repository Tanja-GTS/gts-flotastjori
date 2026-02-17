// Trip templates keyed by `${route}-${shiftTypeOrName}`.
// This is temporary seed data until trips come from the backend.

export const TRIPS_BY_SHIFT = {
  // 51A Morning shift (06:00–10:00)
  '51A-morning-06:00–10:00': [
    {
      name: 'Trip 01',
      time: '06:20–07:20',
      busOverride: null,
      events: [
        { type: 'stop', time: '06:20', label: 'Terminal' },
        { type: 'stop', time: '06:35', label: 'Main St' },
        { type: 'stop', time: '06:52', label: 'Harbor' },
        { type: 'break', duration: 10 },
        { type: 'stop', time: '06:55', label: 'Central' },
        { type: 'stop', time: '07:10', label: 'Depot' },
      ],
    },
    {
      name: 'Trip 02',
      time: '07:40–09:00',
      busOverride: 'CD-456',
      events: [
        { type: 'stop', time: '07:40', label: 'Depot' },
        { type: 'stop', time: '08:10', label: 'Airport' },
      ],
    },
  ],

  // 51A Evening shift (11:30–13:00)
  '51A-evening-11:30–13:00': [
    {
      name: 'Trip 01',
      time: '11:45–12:45',
      busOverride: null,
      events: [
        { type: 'stop', time: '11:45', label: 'Depot' },
        { type: 'stop', time: '12:15', label: 'Central' },
      ],
    },
  ],

  // 51A Evening shift (14:00–18:00)
  '51A-evening-14:00–18:00': [
    {
      name: 'Trip 01',
      time: '14:10–15:30',
      busOverride: null,
      events: [
        { type: 'stop', time: '14:10', label: 'Depot' },
        { type: 'stop', time: '14:55', label: 'Harbor' },
      ],
    },
    {
      name: 'Trip 02',
      time: '16:00–17:20',
      busOverride: null,
      events: [
        { type: 'stop', time: '16:00', label: 'Harbor' },
        { type: 'stop', time: '16:40', label: 'Terminal' },
      ],
    },
  ],

  // 53 Morning shift (07:00–11:00)
  '53-morning-07:00–11:00': [
    {
      name: 'Trip 01',
      time: '07:15–08:30',
      busOverride: null,
      events: [
        { type: 'stop', time: '07:15', label: 'Terminal' },
        { type: 'stop', time: '07:50', label: 'Main St' },
      ],
    },
    {
      name: 'Trip 02',
      time: '09:00–10:15',
      busOverride: null,
      events: [
        { type: 'stop', time: '09:00', label: 'Depot' },
        { type: 'stop', time: '09:40', label: 'Airport' },
      ],
    },
  ],
};

function normalizeTimeHHMM(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hh = String(Number(match[1])).padStart(2, '0');
  const mm = match[2];
  return `${hh}:${mm}`;
}

function normalizeTimeRange(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Normalize any dash to an en-dash.
  const parts = raw.split(/[–—-]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return raw;

  const start = normalizeTimeHHMM(parts[0]);
  const end = normalizeTimeHHMM(parts[1]);
  if (!start || !end) return raw;

  return `${start}–${end}`;
}

function timeToMinutes(hhmm) {
  const match = String(hhmm || '').trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function extractStartTimeFromRange(range) {
  const norm = normalizeTimeRange(range);
  const match = String(norm || '').match(/^(\d{2}:\d{2})/);
  return match ? match[1] : '';
}

function findBestTemplateKeyByStartTime({ route, shiftKey, shiftTime }) {
  const prefix = `${route}-${shiftKey}-`;
  const wantedStart = extractStartTimeFromRange(shiftTime);
  const wantedMin = timeToMinutes(wantedStart);

  const candidates = Object.keys(TRIPS_BY_SHIFT).filter(
    (k) => k.toLowerCase().startsWith(prefix.toLowerCase())
  );

  if (candidates.length === 0) return '';
  if (wantedMin == null) return candidates[0];

  let bestKey = candidates[0];
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const k of candidates) {
    const suffix = k.slice(prefix.length);
    const start = extractStartTimeFromRange(suffix);
    const startMin = timeToMinutes(start);
    if (startMin == null) continue;

    const delta = Math.abs(startMin - wantedMin);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestKey = k;
    }
    if (delta === 0) break;
  }

  return bestKey;
}

export function getTripsForShift(shift) {
  if (Array.isArray(shift?.trips) && shift.trips.length > 0) return shift.trips;
  if (!shift?.route) return [];

  const route = String(shift.route);
  const shiftType = shift.shiftType ? String(shift.shiftType) : '';
  const shiftName = shift.name ? String(shift.name) : '';
  const shiftTime = shift.time ? String(shift.time) : '';
  const shiftTimeNorm = normalizeTimeRange(shiftTime);

  const candidates = [];
  if (shiftType && shiftTime) candidates.push(`${route}-${shiftType}-${shiftTime}`);
  if (shiftType && shiftTimeNorm && shiftTimeNorm !== shiftTime)
    candidates.push(`${route}-${shiftType}-${shiftTimeNorm}`);
  if (shiftName && shiftTime) candidates.push(`${route}-${shiftName}-${shiftTime}`);
  if (shiftName && shiftTimeNorm && shiftTimeNorm !== shiftTime)
    candidates.push(`${route}-${shiftName}-${shiftTimeNorm}`);
  if (shiftType) candidates.push(`${route}-${shiftType}`);
  if (shiftName) candidates.push(`${route}-${shiftName}`);

  for (const key of candidates) {
    if (TRIPS_BY_SHIFT[key]) return TRIPS_BY_SHIFT[key];

    const wanted = key.toLowerCase();
    const foundKey = Object.keys(TRIPS_BY_SHIFT).find((k) => k.toLowerCase() === wanted);
    if (foundKey) return TRIPS_BY_SHIFT[foundKey];
  }

  // Fallback: if the exact time range doesn't match, pick the closest template
  // for this route + shift type/name based on start time.
  if (shiftType) {
    const best = findBestTemplateKeyByStartTime({ route, shiftKey: shiftType, shiftTime });
    if (best && TRIPS_BY_SHIFT[best]) return TRIPS_BY_SHIFT[best];
  }
  if (shiftName) {
    const best = findBestTemplateKeyByStartTime({ route, shiftKey: shiftName, shiftTime });
    if (best && TRIPS_BY_SHIFT[best]) return TRIPS_BY_SHIFT[best];
  }

  return [];
}

export function getTripStartTime(trip) {
  if (!trip) return '';
  if (trip.startTime) return trip.startTime;
  const time = String(trip.time || '');
  // Expect formats like "06:00–07:20" or "06:00-07:20"
  const match = time.match(/^(\d{2}:\d{2})/);
  return match ? match[1] : '';
}
