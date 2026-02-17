import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, Group } from '@mantine/core';
import { getTripsForShift, getTripStartTime } from './domain/tripsTemplate';
import { useI18n } from './i18n';

/**
 * Build printable rows for ONE day
 * Result shape:
 * { time, route, routeName, bus, driver }
 */
function timeToMinutes(hhmm) {
  const match = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getTripBusPlate(shift, trip) {
  const perTrip = shift?.tripBusOverrides?.[trip.name];
  if (perTrip) return perTrip;

  if (trip.busOverride) return trip.busOverride;
  if (shift?.defaultBus) return shift.defaultBus;
  return '—';
}

function buildPrintableRows(shifts, date, workspaceId) {
  const normalizedDate = String(date || '').slice(0, 10);
  const dayShifts = shifts.filter(
    (s) => String(s.date || '').slice(0, 10) === normalizedDate && s.workspaceId === workspaceId
  );

  const rows = dayShifts.flatMap((shift) => {
    const trips = getTripsForShift(shift);

    if (trips.length === 0) {
      return [];
    }

    return trips.map((trip) => ({
      time: getTripStartTime(trip) || '—',
      route: shift.route,
      routeName: shift.routeName || '—',
      bus: getTripBusPlate(shift, trip),
      driver: shift.driver || 'Unassigned',
    }));
  });

  return rows.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

export default function PrintDay({ shifts, workspaceId }) {
  const { t, locale } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const datesParam = params.get('dates');
  const dates = datesParam
    ? datesParam
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean)
    : [];

  return (
    <div style={{ padding: 24 }}>
      {/* Top actions */}
      <Group mb="md" justify="space-between">
        <Button variant="default" onClick={() => navigate(-1)}>
          ← {t('common.back')}
        </Button>
        <Button onClick={() => window.print()}>
          {t('common.print')}
        </Button>
      </Group>

      {dates.map(date => {
        const rows = buildPrintableRows(shifts, date, workspaceId);
        const dateObj = new Date(`${String(date).slice(0, 10)}T00:00:00`);

        return (
          <div
            key={date}
            style={{
              pageBreakAfter: 'always',
              marginBottom: 48,
            }}
          >
            {/* Date header */}
            <h2 style={{ marginBottom: 6 }}>
              {dateObj.toLocaleDateString(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </h2>

            <p style={{ color: '#666', marginBottom: 24 }}>
              {t('printDay.titleHint')}
            </p>

            {/* Empty state */}
            {rows.length === 0 && (
              <p style={{ fontSize: 13, color: '#999' }}>
                {t('printDay.noTrips')}
              </p>
            )}

            {/* Chronological list */}
            {rows.map((row, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 140px 1fr 140px 160px',
                  padding: '6px 0',
                  borderBottom: '1px solid #eee',
                  fontSize: 14,
                }}
              >
                <div>{row.time}</div>
                <div>{row.route}</div>
                <div>{row.routeName}</div>
                <div>{row.bus}</div>
                <div>{row.driver === 'Unassigned' ? t('common.unassigned') : row.driver}</div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
