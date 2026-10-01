import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Accordion, Button, Checkbox, Group, SegmentedControl, Title } from '@mantine/core';
import { useI18n } from './i18n';
import { compareRoutes } from './domain/selectors';
import './timetables.css';

const DOW_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOW_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function weekdayOf(isoDate) {
  const d = new Date(`${String(isoDate || '').slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : DOW_SHORT[d.getDay()];
}

function titleCase(value) {
  const s = String(value || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}

// One printable sheet per pattern: route + shift type + week part + season.
// The PDF header says MON-TUE-WED-THU-FRI, not a date, so instances collapse.
function buildSheets(shifts, workspaceId) {
  const byKey = new Map();

  for (const s of shifts || []) {
    if (s.workspaceId !== workspaceId) continue;
    const route = String(s.route || '').trim();
    if (!route) continue;

    const season = String(s.season || '').trim();
    const weekPart = String(s.weekPart || '').trim();
    const shiftType = String(s.shiftType || '').trim();
    const key = `${route}|${shiftType}|${weekPart}|${season}`;

    let sheet = byKey.get(key);
    if (!sheet) {
      sheet = {
        key,
        route,
        routeName: String(s.routeName || '').trim(),
        shiftType,
        weekPart,
        season,
        time: String(s.time || '').trim(),
        days: new Set(),
        trips: [],
      };
      byKey.set(key, sheet);
    }

    const dow = weekdayOf(s.date);
    if (dow) sheet.days.add(dow);
    if (sheet.trips.length === 0 && Array.isArray(s.trips) && s.trips.length > 0) {
      sheet.trips = s.trips;
    }
  }

  return Array.from(byKey.values()).sort(
    (a, b) => compareRoutes(a.route, b.route) || a.shiftType.localeCompare(b.shiftType)
  );
}

function formatDays(days) {
  return DOW_ORDER.filter((d) => days.has(d)).join('-');
}

// Each event gets a key that survives a trip skipping a stop, so a trip that
// does not serve Landeyjahofn lines up with the others and shows "--".
function eventKeyFor(ev, seen) {
  if (ev?.type === 'break') {
    seen.__break = (seen.__break || 0) + 1;
    return `break#${seen.__break}`;
  }
  const label = String(ev?.label || '').trim();
  seen[label] = (seen[label] || 0) + 1;
  return `stop#${label}#${seen[label]}`;
}

function buildRows(trips) {
  const indexed = (trips || []).map((trip) => {
    const seen = {};
    const map = new Map();
    const order = [];
    for (const ev of trip?.events || []) {
      const k = eventKeyFor(ev, seen);
      map.set(k, ev);
      order.push(k);
    }
    return { trip, map, order };
  });

  if (indexed.length === 0) return { rows: [], trips: [] };

  // The longest trip defines the row order; shorter ones fill in or show "--".
  const spine = indexed.reduce((a, b) => (b.order.length > a.order.length ? b : a), indexed[0]);

  const rows = spine.order.map((k) => {
    const ev = spine.map.get(k);
    return {
      key: k,
      type: ev?.type === 'break' ? 'break' : 'stop',
      label: String(ev?.label || '').trim(),
      cells: indexed.map((t) => t.map.get(k) || null),
    };
  });

  return { rows, trips: indexed.map((t) => t.trip) };
}

function Sheet({ sheet }) {
  const { t } = useI18n();
  const { rows, trips } = useMemo(() => buildRows(sheet.trips), [sheet.trips]);

  return (
    <article className="ttSheet">
      <header className="ttSheet__head">
        <div className="ttSheet__headLeft">
          <div className="ttSheet__days">{formatDays(sheet.days) || '—'}</div>
          <div className="ttSheet__name">{sheet.routeName || sheet.route}</div>
        </div>
        <div className="ttSheet__headRight">
          {sheet.shiftType && <span className="ttSheet__type">{sheet.shiftType.toUpperCase()}</span>}
          <span className="ttSheet__route">{sheet.route}</span>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="ttSheet__empty">{t('timetables.noTrips')}</p>
      ) : (
        <table className="ttSheet__table">
          <thead>
            <tr>
              <th />
              {trips.map((trip, i) => (
                <th key={`${trip?.name || 'trip'}-${i}`}>{sheet.route}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.type === 'break' ? 'is-break' : undefined}>
                <th scope="row">
                  {row.type === 'break' ? t('timetables.stopRow') : row.label}
                </th>
                {row.cells.map((ev, i) => (
                  <td key={i}>
                    {!ev
                      ? '--'
                      : ev.type === 'break'
                      ? `${ev.duration} min`
                      : ev.time || '--'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="ttSheet__foot">
        <span>{titleCase(sheet.season)}</span>
      </footer>
    </article>
  );
}

export default function Timetables({ shifts = [], workspaceId }) {
  const { t } = useI18n();

  const sheets = useMemo(() => buildSheets(shifts, workspaceId), [shifts, workspaceId]);

  const seasons = useMemo(() => {
    const set = new Set(sheets.map((s) => s.season).filter(Boolean));
    return Array.from(set).sort();
  }, [sheets]);

  const [season, setSeason] = useState('');
  const activeSeason = season || seasons[0] || '';

  const [selected, setSelected] = useState(() => new Set());

  const visible = useMemo(
    () => sheets.filter((s) => (activeSeason ? s.season === activeSeason : true)),
    [sheets, activeSeason]
  );

  const weekParts = useMemo(() => {
    const set = new Set(visible.map((s) => s.weekPart || '').filter(Boolean));
    return Array.from(set).sort();
  }, [visible]);

  const toggle = (keys, on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  const allKeys = visible.map((s) => s.key);
  const allChecked = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someChecked = allKeys.some((k) => selected.has(k)) && !allChecked;

  const selectedSheets = sheets.filter((s) => selected.has(s.key));

  return (
    <div className="ttPage">
      <div className="ttBrowse">
        <div className="ttBreadcrumbs">
          <Link to="/" className="ttBreadcrumbs__link">{t('drivers.breadcrumbs.home')}</Link>
          <span className="ttBreadcrumbs__sep">/</span>
          <span>{t('timetables.title')}</span>
        </div>

        <Title order={2} className="ttTitle">{t('timetables.title')}</Title>

        {seasons.length > 0 && (
          <SegmentedControl
            value={activeSeason}
            onChange={setSeason}
            data={seasons.map((s) => ({ value: s, label: titleCase(s) }))}
            className="ttSeason"
          />
        )}

        <Group className="ttBulk">
          <Checkbox
            label={t('timetables.selectAll')}
            checked={allChecked}
            indeterminate={someChecked}
            onChange={(e) => toggle(allKeys, e.target.checked)}
          />
          <Button onClick={() => window.print()} disabled={selectedSheets.length === 0}>
            {t('timetables.print')} ({selectedSheets.length})
          </Button>
        </Group>

        {visible.length === 0 && <p className="ttEmpty">{t('timetables.empty')}</p>}

        <Accordion multiple defaultValue={weekParts}>
          {weekParts.map((wp) => {
            const inPart = visible.filter((s) => s.weekPart === wp);
            const routes = Array.from(new Set(inPart.map((s) => s.route))).sort(compareRoutes);

            return (
              <Accordion.Item key={wp} value={wp}>
                <Accordion.Control>
                  <strong>{titleCase(wp)}</strong>
                  <span className="ttCount">{inPart.length}</span>
                </Accordion.Control>
                <Accordion.Panel>
                  {routes.map((route) => {
                    const forRoute = inPart.filter((s) => s.route === route);
                    const routeKeys = forRoute.map((s) => s.key);
                    const routeAll = routeKeys.every((k) => selected.has(k));
                    const routeSome = routeKeys.some((k) => selected.has(k)) && !routeAll;

                    return (
                      <div key={route} className="ttRouteGroup">
                        <Checkbox
                          className="ttRouteGroup__head"
                          label={<strong>{route}</strong>}
                          checked={routeAll}
                          indeterminate={routeSome}
                          onChange={(e) => toggle(routeKeys, e.target.checked)}
                        />
                        <div className="ttRouteGroup__items">
                          {forRoute.map((s) => (
                            <Checkbox
                              key={s.key}
                              label={`${titleCase(s.shiftType)}${s.time ? ` · ${s.time}` : ''}`}
                              checked={selected.has(s.key)}
                              onChange={(e) => toggle([s.key], e.target.checked)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>

        {selectedSheets.length > 0 && (
          <section className="ttPreview">
            <h3 className="ttPreview__title">{t('timetables.preview')}</h3>
            {selectedSheets.map((s) => (
              <Sheet key={s.key} sheet={s} />
            ))}
          </section>
        )}
      </div>

      {/* Only this block is sent to the printer. */}
      <div className="ttPrintArea">
        {selectedSheets.map((s) => (
          <Sheet key={s.key} sheet={s} />
        ))}
      </div>
    </div>
  );
}
