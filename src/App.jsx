import { Routes, Route } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Timeline from './Timeline';
import ConfirmShift from './ConfirmShift';
import ErrorBoundary from './ErrorBoundary';
import { WORKSPACES } from './workspaces';
import PrintDay from './PrintDay';
import { fetchBuses, fetchDrivers, fetchShifts, fetchWorkspaces, generateShifts } from './data/backendApi';
import { useI18n } from './i18n';

function isMsalConfiguredFromEnv() {
  const tenantId = (import.meta.env?.VITE_ENTRA_TENANT_ID || '').trim();
  const clientId = (import.meta.env?.VITE_ENTRA_CLIENT_ID || '').trim();
  const apiScope = (import.meta.env?.VITE_ENTRA_API_SCOPE || '').trim();
  return Boolean(tenantId && clientId && apiScope);
}

const GENERATE_DURATIONS_KEY = 'fleetScheduler.generateDurationsMs';

function readGenerateDurationsMs() {
  try {
    const raw = localStorage.getItem(GENERATE_DURATIONS_KEY);
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr)) return [];
    return arr
      .map((n) => (typeof n === 'number' ? n : Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0 && n < 30 * 60 * 1000);
  } catch {
    return [];
  }
}

function avgMs(values) {
  if (!values || values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function monthsInRange(startISO, endISO) {
  if (!startISO || !endISO) return [];
  const start = new Date(`${String(startISO).slice(0, 10)}T00:00:00`);
  const end = new Date(`${String(endISO).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (end < start) return [];

  const months = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= endMonth) {
    const yyyy = String(cur.getFullYear());
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    months.push(`${yyyy}-${mm}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function normalizeShift(apiShift) {
  return {
    ...apiShift,
    token: apiShift.id,
    driverId: apiShift.driverId || '',
    driver: apiShift.driverName || 'Unassigned',
    driverEmail: apiShift.driverEmail || '',
    note: apiShift.notes || '',
    confirmationStatus: apiShift.confirmationStatus || 'unassigned',
    defaultBus: apiShift.defaultBus || '',
  };
}

export default function App() {
  const { t } = useI18n();
  // Enable authentication if MSAL is configured
  const msalConfigured = isMsalConfiguredFromEnv();
  const [authStatus, setAuthStatus] = useState(msalConfigured ? 'checking' : 'disabled');
  const [authError, setAuthError] = useState('');

  // Detect backend auth mode (public vs Entra-protected) so the UI behavior stays consistent.
  // This prevents the common failure mode where VITE_ENTRA_* is set (so frontend expects login)
  // but the backend is actually public (or vice-versa), making shifts/generate appear broken.
  const [backendAuthEnabled, setBackendAuthEnabled] = useState(false);

  const handleSignIn = useCallback(async () => {
    const apiScope = (import.meta.env?.VITE_ENTRA_API_SCOPE || '').trim();
    if (!apiScope) throw new Error('Missing VITE_ENTRA_API_SCOPE');
    const { startLogin } = await import('./auth/msal');
    await startLogin({ apiScope });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/health')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setBackendAuthEnabled(Boolean(j && j.authEnabled));
      })
      .catch(() => {
        // If we can't reach /health (proxy mismatch, etc.), don't block the app.
        if (cancelled) return;
        setBackendAuthEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canCallApi = backendAuthEnabled ? authStatus === 'signed-in' : true;

  const [shifts, setShifts] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const fallbackWorkspaces = useMemo(() => WORKSPACES, []);

  const workspaceOptions = useMemo(() => {
    const src = Array.isArray(workspaces) && workspaces.length ? workspaces : fallbackWorkspaces;
    return (src || [])
      .map((w) => ({
        value: String(w.id || '').trim(),
        label: String(w.name || w.id || '').trim(),
      }))
      .filter((w) => w.value && w.label);
  }, [workspaces, fallbackWorkspaces]);

  const [workspaceId, setWorkspaceId] = useState(() => {
    if (typeof window === 'undefined') return WORKSPACES[0].id;
    const saved = String(localStorage.getItem('fleetScheduler.workspaceId') || '').trim();
    return saved || WORKSPACES[0].id;
  });

  useEffect(() => {
    try {
      if (workspaceId) localStorage.setItem('fleetScheduler.workspaceId', workspaceId);
    } catch {
      // ignore
    }
  }, [workspaceId]);

  const [visibleRange, setVisibleRange] = useState({ start: null, end: null, viewDays: 7 });
  const [isLoadingShifts, setIsLoadingShifts] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStartedAtMs, setGenerateStartedAtMs] = useState(0);
  const [generateElapsedMs, setGenerateElapsedMs] = useState(0);
  const [generateAvgDurationMs, setGenerateAvgDurationMs] = useState(() => {
    if (typeof window === 'undefined') return 0;
    return avgMs(readGenerateDurationsMs());
  });
  const [loadError, setLoadError] = useState('');
  const [generateResultSummary, setGenerateResultSummary] = useState('');

  const [busOptions, setBusOptions] = useState([]);
  const [driverOptions, setDriverOptions] = useState([]);
  const [didBackfillDriverPhones, setDidBackfillDriverPhones] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!canCallApi) return () => {
      cancelled = true;
    };

    fetchWorkspaces()
      .then((ws) => {
        if (cancelled) return;
        const list = Array.isArray(ws) ? ws : [];
        setWorkspaces(list);

        const ids = new Set(list.map((w) => String(w?.id || '').trim()).filter(Boolean));
        if (ids.size > 0 && !ids.has(String(workspaceId || '').trim())) {
          const first = list.map((w) => String(w?.id || '').trim()).find(Boolean);
          if (first) setWorkspaceId(first);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspaces([]);
      });

    return () => {
      cancelled = true;
    };
  }, [canCallApi, workspaceId]);

  useEffect(() => {
    if (!isGenerating || !generateStartedAtMs) return;
    let raf = 0;
    const tick = () => {
      setGenerateElapsedMs(Date.now() - generateStartedAtMs);
      raf = window.setTimeout(tick, 500);
    };
    tick();
    return () => {
      window.clearTimeout(raf);
    };
  }, [isGenerating, generateStartedAtMs]);

  useEffect(() => {
    let cancelled = false;
    if (!msalConfigured) {
      setAuthStatus('disabled');
      setAuthError('');
      return;
    }

    setAuthStatus('checking');
    setAuthError('');
    import('./auth/msal')
      .then(({ getSignedInAccount }) => getSignedInAccount())
      .then((account) => {
        if (cancelled) return;
        if (account) setAuthStatus('signed-in');
        else setAuthStatus('signed-out');
      })
      .catch((e) => {
        if (cancelled) return;
        setAuthStatus('signed-out');
        setAuthError(e instanceof Error ? e.message : 'Auth error');
      });

    return () => {
      cancelled = true;
    };
  }, [msalConfigured]);

  useEffect(() => {
    let cancelled = false;
    if (!canCallApi) return () => {
      cancelled = true;
    };
    fetchBuses()
      .then((buses) => {
        if (cancelled) return;
        const opts = (buses || [])
          .map((b) => ({
            value: b.id, // Use bus id as value
            label: b.routeLabel && b.routeLabel !== b.title
              ? `${b.title} (${b.routeLabel})`
              : b.title,
            title: b.title,
            routeLabel: b.routeLabel || '',
            id: b.id,
          }))
          .filter((o) => o.value);
        setBusOptions(opts);
      })
      .catch(() => {
        setBusOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canCallApi]);

  useEffect(() => {
    let cancelled = false;
    if (!canCallApi) return () => {
      cancelled = true;
    };
    fetchDrivers()
      .then((drivers) => {
        if (cancelled) return;
        const opts = (drivers || [])
          .map((d) => ({
            value: String(d.id),
            label: d.name,
            name: d.name,
            email: d.email || '',
            phone: d.phone || '',
          }))
          .filter((o) => o.value);
        setDriverOptions(opts);
      })
      .catch(() => {
        setDriverOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canCallApi]);

  // If the app was already open before we added driver phone support,
  // it may have cached driverOptions without `phone`. Refetch once to backfill.
  useEffect(() => {
    if (!canCallApi) return;
    if (didBackfillDriverPhones) return;
    if (!Array.isArray(driverOptions) || driverOptions.length === 0) return;

    const hasAnyPhone = driverOptions.some((o) => typeof o?.phone === 'string' && o.phone.trim());
    const hasPhoneKey = driverOptions.some((o) => Object.prototype.hasOwnProperty.call(o || {}, 'phone'));

    if (hasAnyPhone || hasPhoneKey) {
      setDidBackfillDriverPhones(true);
      return;
    }

    let cancelled = false;
    fetchDrivers()
      .then((drivers) => {
        if (cancelled) return;
        const opts = (drivers || [])
          .map((d) => ({
            value: String(d.id),
            label: d.name,
            name: d.name,
            email: d.email || '',
            phone: d.phone || '',
          }))
          .filter((o) => o.value);
        setDriverOptions(opts);
        setDidBackfillDriverPhones(true);
      })
      .catch(() => {
        setDidBackfillDriverPhones(true);
      });

    return () => {
      cancelled = true;
    };
  }, [canCallApi, didBackfillDriverPhones, driverOptions]);

  const monthsToFetch = useMemo(
    () => monthsInRange(visibleRange.start, visibleRange.end),
    [visibleRange.start, visibleRange.end]
  );

  const loadShiftsForMonths = useCallback(
    async (months) => {
      if (!workspaceId) return;
      const list = Array.from(new Set((months || []).filter(Boolean)));
      if (list.length === 0) return;

      const pages = await Promise.all(list.map((m) => fetchShifts({ workspaceId, month: m })));
      const merged = pages.flat().map(normalizeShift);
      const byId = new Map(merged.map((s) => [s.id, s]));
      setShifts(Array.from(byId.values()));
    },
    [workspaceId]
  );

  const refreshShifts = useCallback(async () => {
    if (!workspaceId) return;
    if (monthsToFetch.length === 0) return;

    if (backendAuthEnabled && authStatus !== 'signed-in') {
      setLoadError('Sign in required to load shifts.');
      setShifts([]);
      return;
    }

    setIsLoadingShifts(true);
    setLoadError('');
    try {
      await loadShiftsForMonths(monthsToFetch);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('errors.failedLoadShifts'));
      setShifts([]);
    } finally {
      setIsLoadingShifts(false);
    }
  }, [workspaceId, monthsToFetch, t, loadShiftsForMonths, backendAuthEnabled, authStatus]);

  useEffect(() => {
    if (!canCallApi) return;
    refreshShifts();
  }, [refreshShifts, canCallApi]);

  const handleGenerate = useCallback(
    async ({ month }) => {
      if (!workspaceId || !month) return;

      if (backendAuthEnabled && authStatus !== 'signed-in') {
        setLoadError('Sign in required to generate shifts.');
        return;
      }

      const startedAt = Date.now();
      setGenerateStartedAtMs(startedAt);
      setGenerateElapsedMs(0);
      setIsGenerating(true);
      setLoadError('');
      setGenerateResultSummary('');
      try {
        const result = await generateShifts({ workspaceId, month });
        const created = result && typeof result.created === 'number' ? result.created : null;
        const skipped = result && typeof result.skipped === 'number' ? result.skipped : null;
        if (created != null && skipped != null) {
          setGenerateResultSummary(`Created ${created} • Skipped ${skipped}`);
        }

        // IMPORTANT: always fetch the generated month explicitly.
        // If the user clicks Generate before the Timeline has reported its visible range,
        // the in-flight handler could be holding a refreshShifts() closure with an empty monthsToFetch.
        await loadShiftsForMonths([month]);

        const durationMs = Math.max(0, Date.now() - startedAt);
        const prev = readGenerateDurationsMs();
        const next = [...prev, durationMs].slice(-10);
        try {
          localStorage.setItem(GENERATE_DURATIONS_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        setGenerateAvgDurationMs(avgMs(next));
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : t('errors.failedGenerateShifts'));
      } finally {
        setIsGenerating(false);
        setGenerateStartedAtMs(0);
        setGenerateElapsedMs(0);
      }
    },
    [workspaceId, t, loadShiftsForMonths, backendAuthEnabled, authStatus]
  );


  // ...existing code...

  return (
    <ErrorBoundary>
      <Routes>
        <Route
          path="/"
          element={
            <Timeline
              shifts={shifts}
              setShifts={setShifts}
              workspaceId={workspaceId}
              setWorkspaceId={setWorkspaceId}
              workspaceOptions={workspaceOptions}
              busOptions={busOptions}
              driverOptions={driverOptions}
              onRangeChange={setVisibleRange}
              onRefresh={refreshShifts}
              onGenerate={handleGenerate}
              isLoading={isLoadingShifts}
              isGenerating={isGenerating}
              generatingElapsedMs={generateElapsedMs}
              generatingAvgMs={generateAvgDurationMs}
              generateResultSummary={generateResultSummary}
              loadError={loadError}
              authStatus={authStatus}
              authError={authError}
              backendAuthEnabled={backendAuthEnabled}
              onSignIn={handleSignIn}
            />
          }
        />
        <Route
          path="/confirm-shift"
          element={
            <ConfirmShift shifts={shifts} setShifts={setShifts} workspaceId={workspaceId} />
          }
        />
        <Route
          path="/confirm-shift/:token"
          element={
            <ConfirmShift shifts={shifts} setShifts={setShifts} workspaceId={workspaceId} />
          }
        />
        <Route path="/print-day" element={<PrintDay shifts={shifts} workspaceId={workspaceId} />} />
      </Routes>
    </ErrorBoundary>
  );
}
