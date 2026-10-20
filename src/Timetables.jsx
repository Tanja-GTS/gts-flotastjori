import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Checkbox } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconCoffee, IconMoonFilled, IconPrinter, IconSunFilled } from '@tabler/icons-react';
import { fetchTimetables } from './data/backendApi';
import { useI18n } from './i18n';
import './timetables.css';

const WEEKEND = new Set(['sat', 'sun']);
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Seasons per workspace, kept while the app is open so going from the season
// list into a season (and back) does not load everything again.
const loaded = new Map();

function useTimetables(workspaceId) {
  // Results are tagged with their workspace, so switching workspace shows
  // "loading" instead of the previous workspace's seasons.
  const [state, setState] = useState(() => ({ workspaceId, ...(loaded.get(workspaceId) || { status: 'loading', seasons: [] }) }));
  useEffect(() => {
    let cancelled = false;
    fetchTimetables({ workspaceId })
      .then((seasons) => {
        const next = { status: 'ready', seasons };
        loaded.set(workspaceId, next);
        if (!cancelled) setState({ workspaceId, ...next });
      })
      .catch((err) => {
        console.error('[timetables] load failed:', err);
        if (!cancelled && !loaded.has(workspaceId)) setState({ workspaceId, status: 'error', seasons: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);
  if (state.workspaceId !== workspaceId) return loaded.get(workspaceId) || { status: 'loading', seasons: [] };
  return state;
}

// "2026-08-24" -> "24/08/26"
function shortDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : '';
}

function seasonTitle(season, t) {
  const known = t(`timetables.seasonTitles.${season.id}`);
  if (typeof known === 'string' && !known.startsWith('timetables.')) return known;
  return t('timetables.seasonTitleFallback', { season: season.name || season.id });
}

function seasonCrumb(season, t) {
  const known = t(`timetables.seasonCrumbs.${season.id}`);
  if (typeof known === 'string' && !known.startsWith('timetables.')) return known;
  return season.name || season.id;
}

function shiftTypeLabel(type, t) {
  const known = t(`timetables.shiftTypes.${type}`);
  if (typeof known === 'string' && !known.startsWith('timetables.')) return known;
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : '';
}

function DayChips({ days, size = 'md' }) {
  const { t } = useI18n();
  return (
    <span className={`ttDays ttDays--${size}`}>
      {DAY_ORDER.filter((d) => days.includes(d)).map((d) => (
        <span key={d} className={`ttDay${WEEKEND.has(d) ? ' ttDay--weekend' : ''}`}>
          {t(`date.weekdaysShort.${d}`)}
        </span>
      ))}
    </span>
  );
}

function Breadcrumbs({ items }) {
  const { t } = useI18n();
  return (
    <nav className="ttBreadcrumbs" aria-label={t('drivers.breadcrumbs.label')}>
      <Link to="/" className="ttBreadcrumbs__link">{t('drivers.breadcrumbs.home')}</Link>
      {items.map((item) => (
        <span key={item.label} className="ttBreadcrumbs__part">
          <span className="ttBreadcrumbs__sep" aria-hidden="true">/</span>
          {item.to ? <Link to={item.to} className="ttBreadcrumbs__link">{item.label}</Link> : <span>{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

function Duration({ season }) {
  const { t } = useI18n();
  if (!season.from && !season.to) return null;
  return <p className="ttDuration">{t('timetables.duration', { from: shortDate(season.from), to: shortDate(season.to) })}</p>;
}

// ---------------------------------------------------------------------------
// Printed sheet
// ---------------------------------------------------------------------------

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
  if (indexed.length === 0) return [];

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

  // First and last stop of each leg (legs are split by the break) are bold.
  return rows.map((row, i) => ({
    ...row,
    terminal:
      row.type === 'stop' &&
      (i === 0 || rows[i - 1].type === 'break' || i === rows.length - 1 || rows[i + 1].type === 'break'),
  }));
}

// The route a trip runs on (51, or 73 when the shift switches route), from its stops.
function tripRoutes(trip, fallback) {
  const routes = [];
  for (const ev of trip?.events || []) {
    const m = String(ev?.route || '').match(/\d+/);
    if (m && !routes.includes(m[0])) routes.push(m[0]);
  }
  return routes.length ? routes.join(' / ') : fallback;
}

// The printed sheets are hidden on screen, so the browser never fetches their
// font by itself and the first print would fall back to Inter. Load it first.
const PRINT_FONT_FACES = ['400 14px "Space Grotesk"', '500 14px "Space Grotesk"', '600 14px "Space Grotesk"', '700 14px "Space Grotesk"'];

function loadPrintFont() {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  return Promise.all(PRINT_FONT_FACES.map((f) => document.fonts.load(f))).catch(() => undefined);
}

function printSheets() {
  // Never wait long on a slow network: print in Inter rather than not at all.
  const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
  Promise.race([loadPrintFont(), timeout]).then(() => window.print());
}

function breakLength(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h}h ${m} min` : `${m} min`;
}

function ShiftIcon({ type }) {
  if (type === 'evening') return <IconMoonFilled size={24} className="ttSheet__icon ttSheet__icon--evening" aria-hidden="true" />;
  return <IconSunFilled size={26} className="ttSheet__icon" aria-hidden="true" />;
}

function Sheet({ sheet }) {
  const { t } = useI18n();
  const rows = useMemo(() => buildRows(sheet.trips), [sheet.trips]);

  return (
    <article className="ttSheet">
      <header className="ttSheet__head">
        <div>
          <div className="ttSheet__titleRow">
            <span className="ttSheet__route">{sheet.route.replace(/-/g, '')}</span>
            <ShiftIcon type={sheet.shiftType} />
            <span className="ttSheet__type">{shiftTypeLabel(sheet.shiftType, t).toUpperCase()}</span>
          </div>
          <DayChips days={sheet.days} size="sm" />
        </div>
        <div className="ttSheet__name">{sheet.routeName}</div>
      </header>

      {rows.length === 0 ? (
        <p className="ttSheet__empty">{t('timetables.noTrips')}</p>
      ) : (
        <table className="ttSheet__table">
          <thead>
            <tr>
              <th aria-hidden="true" />
              {sheet.trips.map((trip, i) => (
                <th key={`${trip?.tripItemId || trip?.name || 'trip'}-${i}`}>
                  <span className="ttSheet__badge">{tripRoutes(trip, sheet.routeGroup)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              row.type === 'break' ? (
                <tr key={row.key} className="is-break">
                  <th scope="row">
                    <IconCoffee size={20} stroke={1.5} aria-hidden="true" />{t('timetables.stopRow')}
                  </th>
                  {row.cells.map((ev, i) => (
                    <td key={i}>{ev ? breakLength(ev.duration) : '--'}</td>
                  ))}
                </tr>
              ) : (
                <tr key={row.key} className={row.terminal ? 'is-terminal' : undefined}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((ev, i) => (
                    <td key={i}>{ev?.time || '--'}</td>
                  ))}
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Season list
// ---------------------------------------------------------------------------

function SeasonList({ seasons }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  if (seasons.length === 0) return <p className="ttEmpty">{t('timetables.empty')}</p>;
  return (
    <div className="ttSeasons">
      {seasons.map((season) => (
        <section key={season.id} className="ttSeasonCard">
          <span className={`ttTag${season.active ? ' ttTag--active' : ''}`}>
            {season.active ? t('timetables.active') : t('timetables.inactive')}
          </span>
          <h2 className="ttSeasonCard__title">{seasonTitle(season, t)}</h2>
          <Duration season={season} />
          <button type="button" className="ttButton" onClick={() => navigate(`/timetables/${encodeURIComponent(season.id)}`)}>
            {t('timetables.open')}
          </button>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One season: route filter, route accordions, sheet selection, print
// ---------------------------------------------------------------------------

function SeasonView({ season }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(() => new Set());
  const [openRoutes, setOpenRoutes] = useState(() => new Set());
  const [pinnedGroup, setPinnedGroup] = useState('');

  useEffect(() => {
    loadPrintFont();
  }, []);

  const routes = useMemo(() => {
    const byRoute = new Map();
    for (const sheet of season.sheets) {
      const list = byRoute.get(sheet.route) || [];
      list.push(sheet);
      byRoute.set(sheet.route, list);
    }
    return Array.from(byRoute, ([route, sheets]) => ({
      route,
      group: sheets[0].routeGroup,
      sheets,
      days: DAY_ORDER.filter((d) => sheets.some((s) => s.days.includes(d))),
    }));
  }, [season.sheets]);

  const groups = useMemo(() => Array.from(new Set(routes.map((r) => r.group))), [routes]);

  // The chosen route number is pulled to the top; the rest keep their order.
  const ordered = useMemo(
    () => (pinnedGroup ? [...routes.filter((r) => r.group === pinnedGroup), ...routes.filter((r) => r.group !== pinnedGroup)] : routes),
    [routes, pinnedGroup]
  );

  const toggleSheets = (keys, on) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  const toggleOpen = (route) =>
    setOpenRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(route)) next.delete(route);
      else next.add(route);
      return next;
    });

  // Print sends every ticked sheet, across all routes, in page order.
  const toPrint = season.sheets.filter((s) => selected.has(s.key));

  return (
    <>
      <div className="ttBrowse">
        <Breadcrumbs items={[{ label: t('timetables.title'), to: '/timetables' }, { label: seasonCrumb(season, t) }]} />
        <h1 className="ttTitle">{seasonTitle(season, t)}</h1>
        <Duration season={season} />

        {groups.length > 1 && (
          <div className="ttFilters" role="group" aria-label={t('timetables.filterRoutes')}>
            {groups.map((g) => (
              <button
                key={g}
                type="button"
                className={`ttFilter${pinnedGroup === g ? ' is-on' : ''}`}
                aria-pressed={pinnedGroup === g}
                onClick={() => setPinnedGroup((cur) => (cur === g ? '' : g))}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        {ordered.length === 0 && <p className="ttEmpty">{t('timetables.noSheets')}</p>}

        <div className="ttRoutes">
          {ordered.map((r) => {
            const open = openRoutes.has(r.route);
            const keys = r.sheets.map((s) => s.key);
            const all = keys.every((k) => selected.has(k));
            const some = !all && keys.some((k) => selected.has(k));
            const panelId = `tt-route-${r.route}`;
            return (
              <section key={r.route} className={`ttRoute${open ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="ttRoute__head"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggleOpen(r.route)}
                >
                  <span>
                    <span className="ttRoute__name">{r.route}</span>
                    <DayChips days={r.days} />
                  </span>
                  <span className="ttRoute__chevron" aria-hidden="true">
                    {open ? <IconChevronUp size={22} stroke={1.5} /> : <IconChevronDown size={22} stroke={1.5} />}
                  </span>
                </button>

                {open && (
                  <div className="ttRoute__body" id={panelId}>
                    <div className="ttRoute__bar">
                      <Checkbox
                        aria-label={t('timetables.selectAllInRoute', { route: r.route })}
                        checked={all}
                        indeterminate={some}
                        onChange={(e) => toggleSheets(keys, e.currentTarget.checked)}
                      />
                      <button type="button" className="ttButton ttButton--print" onClick={printSheets} disabled={toPrint.length === 0}>
                        <IconPrinter size={20} stroke={1.75} aria-hidden="true" />
                        {toPrint.length > 0 ? t('timetables.printCount', { count: toPrint.length }) : t('timetables.print')}
                      </button>
                    </div>
                    <ul className="ttSheets">
                      {r.sheets.map((s) => (
                        <li key={s.key} className="ttSheetRow">
                          <Checkbox
                            checked={selected.has(s.key)}
                            onChange={(e) => toggleSheets([s.key], e.currentTarget.checked)}
                            label={
                              <span className="ttSheetRow__label">
                                <span className="ttSheetRow__name">
                                  {r.route} {shiftTypeLabel(s.shiftType, t)}
                                </span>
                                <DayChips days={s.days} />
                              </span>
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* Only this block is sent to the printer: one A4 page per ticked sheet. */}
      <div className="ttPrintArea">
        {toPrint.map((s) => (
          <Sheet key={s.key} sheet={s} />
        ))}
      </div>
    </>
  );
}

export default function Timetables({ workspaceId }) {
  const { t } = useI18n();
  const { seasonId } = useParams();
  const { status, seasons } = useTimetables(workspaceId);
  const season = seasonId ? seasons.find((s) => s.id === decodeURIComponent(seasonId)) : null;

  let body;
  if (status === 'loading') body = <p className="ttEmpty">{t('timetables.loading')}</p>;
  else if (status === 'error') body = <p className="ttEmpty">{t('timetables.loadFailed')}</p>;
  else if (seasonId && !season) body = <p className="ttEmpty">{t('timetables.seasonNotFound')}</p>;

  if (body || !seasonId) {
    return (
      <div className="ttPage">
        <div className="ttBrowse">
          <Breadcrumbs items={seasonId ? [{ label: t('timetables.title'), to: '/timetables' }] : [{ label: t('timetables.title') }]} />
          <h1 className="ttTitle">{t('timetables.title')}</h1>
          {body || <SeasonList seasons={seasons} />}
        </div>
      </div>
    );
  }

  return (
    <div className="ttPage">
      <SeasonView key={season.id} season={season} />
    </div>
  );
}
