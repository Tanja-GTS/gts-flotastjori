import { Routes, Route } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Timeline from './Timeline';
import ConfirmShift from './ConfirmShift';
import ErrorBoundary from './ErrorBoundary';
import { WORKSPACES } from './workspaces';
import PrintDay from './PrintDay';
import { fetchBuses, fetchDrivers, fetchShifts, generateShifts } from './data/backendApi';
import { useI18n } from './i18n';
import { getSignedInAccount, isMsalConfigured, startLogin } from './auth/msal';

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
  const msalConfigured = isMsalConfigured();
  const [authStatus, setAuthStatus] = useState(msalConfigured ? 'checking' : 'disabled');
  const [authError, setAuthError] = useState('');

  const canCallApi = !msalConfigured || authStatus === 'signed-in';

  const [shifts, setShifts] = useState([]);
  const [workspaceId, setWorkspaceId] = useState(WORKSPACES[0].id);

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
    getSignedInAccount()
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
          .map((b) => ({ value: b.title, label: b.title }))
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
            label: d.email ? `${d.name} (${d.email})` : d.name,
            name: d.name,
            email: d.email || '',
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
  }, [workspaceId, monthsToFetch, t, loadShiftsForMonths]);

  useEffect(() => {
    if (!canCallApi) return;
    refreshShifts();
  }, [refreshShifts, canCallApi]);

  const handleGenerate = useCallback(
    async ({ month }) => {
      if (!workspaceId || !month) return;
      if (!canCallApi) return;

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
    [workspaceId, t, canCallApi, loadShiftsForMonths]
  );


  if (msalConfigured && authStatus !== 'signed-in') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ maxWidth: 520, width: '100%', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: 20 }}>
          <h2 style={{ margin: 0, marginBottom: 8 }}>Sign in</h2>
          <p style={{ marginTop: 0, opacity: 0.85 }}>
            This app is protected. Please sign in with your Microsoft account to continue.
          </p>
          {authError ? (
            <p style={{ marginTop: 0, color: '#ffb3b3' }}>
              {authError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setAuthError('');
              setAuthStatus('signing-in');
              startLogin({ apiScope: import.meta.env?.VITE_ENTRA_API_SCOPE }).catch((e) => {
                setAuthStatus('signed-out');
                setAuthError(e instanceof Error ? e.message : 'Login failed');
              });
            }}
            style={{
              width: '100%',
              height: 44,
              borderRadius: 9999,
              border: '1px solid rgba(17, 24, 39, 0.18)',
              background: '#111827',
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {authStatus === 'signing-in' ? 'Signing in…' : 'Sign in with Microsoft'}
          </button>
        </div>
      </div>
    );
  }

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
            />
          }
        />
        <Route
          path="/confirm-shift"
          element={
            <ConfirmShift shifts={shifts} setShifts={setShifts} workspaceId={workspaceId} />
          }
        />
        <Route path="/print-day" element={<PrintDay shifts={shifts} workspaceId={workspaceId} />} />
      </Routes>
    </ErrorBoundary>
  );
}
