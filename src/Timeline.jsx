
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Select, Checkbox, Accordion, TextInput, Drawer, Popover } from '@mantine/core';
import { IconAlertCircle, IconChevronDown, IconChevronUp, IconChevronLeft, IconChevronRight, IconPrinter } from '@tabler/icons-react';
import { addDays, format } from 'date-fns';
import './timeline.css';
import { selectRoutesForWorkspace, selectVisibleShifts } from './domain/selectors';
import { SHIFT_TYPES_ORDERED, SHIFT_TYPE_LABELS, isShiftType } from './domain/shiftTypes';
import { getTripsForShift } from './domain/tripsTemplate';
import { assignWeekAndEmail } from './data/backendApi';
import { notifications } from '@mantine/notifications';
import { useI18n } from './i18n';

const fallbackDrivers = ['Ahmed', 'Maria', 'Jon', 'Sara'].map((name) => ({ value: name, label: name, name }));

function formatTripShortName(tripName) {
  const raw = String(tripName || '').trim();
  if (!raw) return '';

  const match = raw.match(/trip\s*\d+\b/i);
  if (match) {
    const digits = match[0].match(/\d+/)?.[0];
    return digits ? `Trip${digits}` : match[0].replace(/\s+/g, '');
  }

  const lastToken = raw.split(/\s+/).filter(Boolean).pop();
  return lastToken || raw;
}

function formatDurationShort(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const sec = Math.max(1, Math.round(safeMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  return `${hr}h`;
}

export default function Timeline({
  shifts,
  setShifts,
  workspaceId,
  setWorkspaceId,
  busOptions = [],
  driverOptions = [],
  onRangeChange,
  onRefresh,
  onGenerate,
  isLoading = false,
  isGenerating = false,
  generatingElapsedMs = 0,
  generatingAvgMs = 0,
  generateResultSummary = '',
  loadError = '',
}) {
  const navigate = useNavigate();
  const { lang, setLang, t, locale } = useI18n();

  const workspaceOptions = useMemo(
    () => [
      { value: 'south', label: 'South Iceland' },
      { value: 'school', label: 'School Transport' },
      { value: 'airport', label: 'Airport Transfers' },
    ],
    []
  );

  const routes = selectRoutesForWorkspace(shifts, workspaceId);
  const routeOptions = routes.map((route) => ({ value: route, label: route }));
  const [selectedShiftToken, setSelectedShiftToken] = useState(null);
  const [selectedRowKey, setSelectedRowKey] = useState(null);
  const [editedDriverId, setEditedDriverId] = useState(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [viewDays, setViewDays] = useState(7);
  const [showNotes, setShowNotes] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editedNote, setEditedNote] = useState('');
  const [addMode, setAddMode] = useState(false);
  const [newShift, setNewShift] = useState({
    route: '',
    shiftType: 'morning',
    date: '',
    name: '',
    startTime: '',
    endTime: '',
    defaultBus: '',
  });
  const [formError, setFormError] = useState('');
  const [selectedDates, setSelectedDates] = useState([]);

  const avgLabel = generatingAvgMs ? formatDurationShort(generatingAvgMs) : '';
  const remainingMs = generatingAvgMs ? Math.max(0, generatingAvgMs - (generatingElapsedMs || 0)) : 0;
  const remainingLabel = generatingAvgMs ? formatDurationShort(remainingMs) : '';
  const takingLongerThanUsual = Boolean(
    generatingAvgMs && generatingElapsedMs && generatingElapsedMs > generatingAvgMs * 2
  );
  const [monthYearOpened, setMonthYearOpened] = useState(false);
  const [workspaceOpened, setWorkspaceOpened] = useState(false);
  const [viewOpened, setViewOpened] = useState(false);

  const visibleShifts = selectVisibleShifts(shifts, workspaceId, routes);

  const getShiftCardTitle = useCallback(
    (shift) => {
      const routeName = String(shift?.routeName || '').trim();
      const route = String(shift?.route || '').trim();
      if (routeName) return routeName;
      return route;
    },
    []
  );

  const driverById = useMemo(() => {
    const m = new Map();
    (driverOptions || []).forEach((o) => {
      if (!o?.value) return;
      m.set(String(o.value), o);
    });
    return m;
  }, [driverOptions]);

  const normalizeShiftType = useCallback((shift) => {
    const raw = String(shift?.shiftType || '').trim();
    const rawLower = raw.toLowerCase();

    if (isShiftType(rawLower)) return rawLower;

    // Common real-world values coming from SharePoint/Graph lists.
    // We map them into the 3 UI buckets so shifts don't disappear.
    if (
      rawLower === 'am' ||
      rawLower.includes('morning') ||
      rawLower.includes('morn') ||
      rawLower.includes('morgun') ||
      rawLower.includes('morg')
    ) {
      return 'morning';
    }

    if (
      rawLower === 'pm' ||
      rawLower.includes('evening') ||
      rawLower.includes('even') ||
      rawLower.includes('kveld') ||
      rawLower.includes('kvld') ||
      rawLower.includes('kvold')
    ) {
      return 'evening';
    }

    if (rawLower.includes('single') || rawLower.includes('mid') || rawLower.includes('one')) {
      return 'single';
    }

    const name = String(shift?.name || '').toLowerCase();
    if (name.includes('morning') || name.includes('morgun') || name.includes('am')) return 'morning';
    if (name.includes('evening') || name.includes('kveld') || name.includes('pm')) return 'evening';
    if (name.includes('single')) return 'single';

    // Never drop shifts entirely: show unknown types under Single.
    return 'single';
  }, []);

  const shiftBuckets = useMemo(() => {
    const m = new Map();
    for (const shift of visibleShifts) {
      if (!shift) continue;
      if (showUnassignedOnly && shift.driver !== 'Unassigned') continue;

      const normalized = normalizeShiftType(shift);
      if (!normalized) continue;

      const date = String(shift.date || '');
      const route = String(shift.route || '');
      if (!date || !route) continue;

      const key = `${route}__${normalized}__${date}`;
      const list = m.get(key);
      if (list) list.push(shift);
      else m.set(key, [shift]);
    }
    return m;
  }, [visibleShifts, showUnassignedOnly, normalizeShiftType]);

  // Route × ShiftType blocks ordered by shift type first.
  const rows = SHIFT_TYPES_ORDERED.flatMap((shiftType) =>
    routes
      .filter((route) => visibleShifts.some((s) => s.route === route && normalizeShiftType(s) === shiftType))
      .map((route) => ({ route, shiftType }))
  );

  const toggleDateSelection = (date) => {
    setSelectedDates((prev) => {
      const exists = prev.some(d => d.toDateString() === date.toDateString());

      if (exists) {
        return prev.filter(d => d.toDateString() !== date.toDateString());
      }

      return [...prev, date];
    });
  };

  const selectedDateKeys = useMemo(
    () => new Set(selectedDates.map((d) => d.toDateString())),
    [selectedDates]
  );

  // Find the selected shift by token
  const selectedShift = selectedShiftToken ? visibleShifts.find(s => s.token === selectedShiftToken) : null;

  const selectedTrips = useMemo(() => {
    const trips = selectedShift ? getTripsForShift(selectedShift) : [];
    if (!Array.isArray(trips) || trips.length === 0) return [];

    // De-dupe identical trips (common when seed/backend data repeats entries).
    // Keying by name+time keeps distinct trips that share the same name.
    const seen = new Set();
    const unique = [];

    for (const trip of trips) {
      const name = String(trip?.name || '').trim();
      const time = String(trip?.time || '').trim();
      const key = `${name}||${time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(trip);
    }

    return unique;
  }, [selectedShift]);

  const getTripBusPlate = useCallback(
    (trip) => {
      const perTrip = selectedShift?.tripBusOverrides?.[trip.name];
      if (perTrip) return perTrip;

      const templateOverride = trip.busOverride;
      if (templateOverride && templateOverride !== 'null') return templateOverride;

      return selectedShift?.defaultBus || '';
    },
    [selectedShift]
  );

  const setTripBusPlate = useCallback(
    (tripName, busPlate) => {
      if (!selectedShiftToken) return;
      setShifts((prev) =>
        prev.map((s) => {
          if (s.token !== selectedShiftToken) return s;
          return {
            ...s,
            tripBusOverrides: {
              ...(s.tripBusOverrides || {}),
              [tripName]: busPlate || '',
            },
          };
        })
      );
    },
    [selectedShiftToken, setShifts]
  );

  const existingNote = selectedShift ? selectedShift.note || '' : '';

  const busesUsed = selectedShift
    ? Array.from(
        new Set(
          selectedTrips
            .map((trip) => getTripBusPlate(trip))
            .filter(Boolean)
        )
      )
    : [];
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  });

  useEffect(() => {
    if (!onRangeChange) return;
    const start = format(currentWeekStart, 'yyyy-MM-dd');
    const end = format(addDays(currentWeekStart, viewDays - 1), 'yyyy-MM-dd');
    onRangeChange({ start, end, viewDays });
  }, [currentWeekStart, viewDays, onRangeChange]);

  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }).map((_, monthIndex) => ({
        value: String(monthIndex),
        label: new Date(2026, monthIndex, 1).toLocaleDateString(locale, { month: 'long' }),
      })),
    [locale]
  );

  const yearOptions = useMemo(() => {
    const years = shifts
      .map((s) => String(s?.date || '').slice(0, 10))
      .map((d) => (d ? new Date(`${d}T00:00:00`) : null))
      .filter((d) => d && !Number.isNaN(d.getTime()))
      .map((d) => d.getFullYear());

    const currentYear = currentWeekStart.getFullYear();
    const minYear = years.length ? Math.min(...years) - 1 : currentYear - 2;
    const maxYear = years.length ? Math.max(...years) + 1 : currentYear + 2;
    const opts = [];
    for (let y = minYear; y <= maxYear; y += 1) {
      opts.push({ value: String(y), label: String(y) });
    }
    return opts;
  }, [shifts, currentWeekStart]);

  const [pickerMonth, setPickerMonth] = useState(String(currentWeekStart.getMonth()));
  const [pickerYear, setPickerYear] = useState(String(currentWeekStart.getFullYear()));

  useEffect(() => {
    if (monthYearOpened) return;
    setPickerMonth(String(currentWeekStart.getMonth()));
    setPickerYear(String(currentWeekStart.getFullYear()));
  }, [currentWeekStart, monthYearOpened]);

  const applyMonthYear = useCallback(() => {
    const monthIndex = Number(pickerMonth);
    const year = Number(pickerYear);
    if (Number.isNaN(monthIndex) || Number.isNaN(year)) return;

    // Jump to the first Monday that is within the selected month.
    const firstOfMonth = new Date(year, monthIndex, 1);
    const day = firstOfMonth.getDay(); // 0 Sun ... 6 Sat
    const daysUntilMonday = (8 - day) % 7; // 0 if Monday, else 1..6
    const firstMonday = new Date(year, monthIndex, 1 + daysUntilMonday);
    setCurrentWeekStart(firstMonday);
    setMonthYearOpened(false);
  }, [pickerMonth, pickerYear]);

  const handlePrevious = () => {
    setCurrentWeekStart(prev => addDays(prev, -viewDays));
  };

  const handleNext = () => {
    setCurrentWeekStart(prev => addDays(prev, viewDays));
  };

  const handleToday = () => {
    setCurrentWeekStart(() => {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(d.setDate(diff));
    });
  };

  const handleSaveNewShift = () => {
    if (!newShift.route || !newShift.shiftType || !newShift.date || !newShift.name || !newShift.startTime || !newShift.endTime || !newShift.defaultBus) {
      setFormError('Please fill all fields.');
      return;
    }

    const dateObj = new Date(newShift.date);
    if (isNaN(dateObj.getTime())) {
      setFormError('Invalid date.');
      return;
    }

    setFormError('');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[dateObj.getDay()];
    // Generate a unique token for the shift
    const token = `${newShift.route}-${newShift.name}-${newShift.date}-${Math.random().toString(36).slice(2,8)}`;

    setShifts(prev => [
      ...prev,
      {
        route: newShift.route,
        shiftType: newShift.shiftType,
        day: dayName,
        date: newShift.date, // Store actual date for manual shifts
        name: newShift.name,
        time: `${newShift.startTime}–${newShift.endTime}`,
        driver: 'Unassigned',
        defaultBus: newShift.defaultBus,
        manual: true,
        token,
        confirmationStatus: 'unassigned',
        workspaceId: workspaceId
      },
    ]);

    // Reset form
    setNewShift({
      route: '',
      shiftType: 'morning',
      date: '',
      name: '',
      startTime: '',
      endTime: '',
      defaultBus: '',
    });
    setAddMode(false);
  };

  const handleCancelAdd = () => {
    setAddMode(false);
    setNewShift({
      route: '',
      shiftType: 'morning',
      date: '',
      name: '',
      startTime: '',
      endTime: '',
      defaultBus: '',
    });
  };

  const dayDates = Array.from({ length: viewDays }).map((_, i) =>
    addDays(currentWeekStart, i)
  );

  const todayISO = format(new Date(), 'yyyy-MM-dd');

  const monthStartISO = format(
    new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), 1),
    'yyyy-MM-dd'
  );
  const monthEndISO = format(
    new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth() + 1, 0),
    'yyyy-MM-dd'
  );
  const hasShiftsInMonth = shifts.some((s) => {
    if (!s || s.workspaceId !== workspaceId) return false;
    const d = String(s.date || '').slice(0, 10);
    return d >= monthStartISO && d <= monthEndISO;
  });

  const daysWithNames = dayDates.map((date) => ({
    date,
    name: date.toLocaleDateString(locale, { weekday: 'short' }),
  }));

  return (
    <div className="timelinePage">

     <div className="headerNav">
  <div className="topbar">
  <Popover
    opened={workspaceOpened}
    onChange={setWorkspaceOpened}
    position="bottom-start"
    withArrow
    shadow="md"
  >
    <Popover.Target>
      <div className="workspacebar">
        <button
          className="workspacebar__pill"
          type="button"
          aria-label="Select workspace"
          aria-expanded={workspaceOpened}
          aria-controls="workspace-menu"
          onClick={() => setWorkspaceOpened((o) => !o)}
        >
          {workspaceOptions.find((o) => o.value === workspaceId)?.label || 'Select workspace'}
        </button>

        <button
          className={`workspacebar__icon${workspaceOpened ? ' is-open' : ''}`}
          type="button"
          aria-label="Open workspace menu"
          aria-expanded={workspaceOpened}
          aria-controls="workspace-menu"
          onClick={() => setWorkspaceOpened((o) => !o)}
        >
          <IconChevronDown className="workspacebar__chev" size={18} aria-hidden="true" />
        </button>
      </div>
    </Popover.Target>

    <Popover.Dropdown>
      <div className="workspacebar__menu" id="workspace-menu" role="menu" aria-label="Workspaces">
        {workspaceOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`workspacebar__option${opt.value === workspaceId ? ' is-selected' : ''}`}
            role="menuitemradio"
            aria-checked={opt.value === workspaceId}
            onClick={() => {
              setWorkspaceId(opt.value);
              setWorkspaceOpened(false);
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </Popover.Dropdown>
  </Popover>
</div>

  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <Select
      aria-label={t('lang.label')}
      data={[
        { value: 'en', label: 'EN' },
        { value: 'is', label: 'ÍS' },
      ]}
      value={lang}
      onChange={(v) => v && setLang(v)}
      allowDeselect={false}
      variant="unstyled"
      rightSection={<IconChevronDown size={16} aria-hidden="true" />}
      rightSectionWidth={18}
      style={{ width: 64 }}
      styles={{
        input: {
          height: 36,
          background: 'transparent',
          border: 0,
          boxShadow: 'none',
          paddingLeft: 0,
          paddingRight: 18,
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: '0.02em',
          color: 'var(--header-nav-fg)',
        },
        section: {
          height: 36,
          color: 'var(--header-nav-fg)',
          opacity: 0.9,
        },
        dropdown: {
          borderRadius: 12,
          border: '1px solid rgba(17, 24, 39, 0.10)',
          boxShadow: '0 8px 20px rgba(0,0,0,0.10)',
        },
        option: {
          fontSize: 13,
          fontWeight: 500,
        },
      }}
    />
  </div>
</div>
     
      <header>
        {/* Intentionally empty: header controls are rendered in the controls row below */}
      </header>




      {/* Controls row just above the timeline */}
      {loadError && (
        <div
          style={{
            color: '#b00020',
            fontSize: 12,
            fontWeight: 600,
            padding: '0 24px 8px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
          role="alert"
        >
          <div style={{ flex: 1, minWidth: 0 }}>{loadError}</div>
          {typeof onRefresh === 'function' && (
            <Button size="xs" variant="outline" color="red" onClick={() => onRefresh()}>
              Retry
            </Button>
          )}
        </div>
      )}
      <div className="timelineControlsRow">
        {/* Left: Month/Year + arrows */}
        <div className="timelineControlsRow__left">
          <Popover
            opened={monthYearOpened}
            onChange={setMonthYearOpened}
            position="bottom-start"
            withArrow
            shadow="md"
            closeOnClickOutside={false}
          >
            <Popover.Target>
              <div className="monthbar">
                <button
                  className={`monthbar__icon${monthYearOpened ? ' is-open' : ''}`}
                  type="button"
                  aria-label="Open month picker"
                  onClick={() => setMonthYearOpened((o) => !o)}
                >
                  <IconChevronDown className="monthbar__chev" size={20} aria-hidden="true" />
                </button>

                <button
                  className="monthbar__pill"
                  type="button"
                  aria-label="Select month and year"
                  onClick={() => setMonthYearOpened((o) => !o)}
                >
                  {currentWeekStart.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
                </button>

                <div className="monthbar__nav" aria-label="Change week">
                  <button
                    className="monthbar__navBtn"
                    type="button"
                    onClick={handlePrevious}
                    aria-label="Previous week"
                  >
                    <IconChevronLeft size={22} aria-hidden="true" />
                  </button>

                  <button
                    className="monthbar__navBtn"
                    type="button"
                    onClick={handleNext}
                    aria-label="Next week"
                  >
                    <IconChevronRight size={22} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </Popover.Target>

            <Popover.Dropdown>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minWidth: 320 }}>
                <Select
                  aria-label={t('common.month')}
                  data={monthOptions}
                  value={pickerMonth}
                  onChange={(v) => v != null && setPickerMonth(v)}
                  placeholder={t('common.month')}
                  searchable
                  withinPortal={false}
                  comboboxProps={{ withinPortal: false }}
                />
                <Select
                  aria-label={t('common.year')}
                  data={yearOptions}
                  value={pickerYear}
                  onChange={(v) => v != null && setPickerYear(v)}
                  placeholder={t('common.year')}
                  searchable
                  withinPortal={false}
                  comboboxProps={{ withinPortal: false }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <Button size="xs" onClick={applyMonthYear}>
                  {t('common.go')}
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() => {
                    setPickerMonth(String(currentWeekStart.getMonth()));
                    setPickerYear(String(currentWeekStart.getFullYear()));
                    setMonthYearOpened(false);
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </Popover.Dropdown>
          </Popover>
        </div>

        {/* Middle: Today + View + Filter */}
        <div className="timelineControlsRow__middle">
          <Button
            variant="default"
            className="todayBtn"
            styles={{ root: { height: 36 } }}
            onClick={handleToday}
            aria-label="Go to current week"
          >
            {t('common.today')}
          </Button>
          <Popover
            opened={viewOpened}
            onChange={setViewOpened}
            position="bottom-start"
            withArrow
            shadow="md"
          >
            <Popover.Target>
              <div className="viewbar">
                <button
                  className="viewbar__pill"
                  type="button"
                  aria-label="Select view"
                  aria-expanded={viewOpened}
                  aria-controls="view-menu"
                  onClick={() => setViewOpened((o) => !o)}
                >
                  {viewDays === 7
                    ? t('timeline.view1Week')
                    : viewDays === 14
                      ? t('timeline.view2Weeks')
                      : `${viewDays} days`}
                </button>

                <button
                  className={`viewbar__icon${viewOpened ? ' is-open' : ''}`}
                  type="button"
                  aria-label="Open view menu"
                  aria-expanded={viewOpened}
                  aria-controls="view-menu"
                  onClick={() => setViewOpened((o) => !o)}
                >
                  <IconChevronDown className="viewbar__chev" size={18} aria-hidden="true" />
                </button>
              </div>
            </Popover.Target>

            <Popover.Dropdown>
              <div className="viewbar__menu" id="view-menu" role="menu" aria-label="View">
                {[
                  { value: 7, label: t('timeline.view1Week') },
                  { value: 14, label: t('timeline.view2Weeks') },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`viewbar__option${opt.value === viewDays ? ' is-selected' : ''}`}
                    role="menuitemradio"
                    aria-checked={opt.value === viewDays}
                    onClick={() => {
                      setViewDays(opt.value);
                      setViewOpened(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </Popover.Dropdown>
          </Popover>
          <Checkbox
            label={t('timeline.showUnassignedOnly')}
            checked={showUnassignedOnly}
            onChange={(e) => setShowUnassignedOnly(e.currentTarget.checked)}
          />
        </div>

        {/* Right: Generate shifts (conditional) + Add shift */}
        <div className="timelineControlsRow__right">
          {!hasShiftsInMonth && (
            <Button
              variant="default"
              styles={{ root: { height: 40 } }}
              className="generate-shifts-btn"
              disabled={!onGenerate || isGenerating}
              loading={isGenerating}
              onClick={() => {
                const month = format(currentWeekStart, 'yyyy-MM');
                onGenerate?.({ month });
              }}
            >
              {isGenerating
                ? generatingAvgMs
                  ? `Generating… ~${remainingLabel} left`
                  : 'Generating…'
                : t('timeline.generateMonth')}
            </Button>
          )}

          {isGenerating && (
            <div className="generateStatus" role="status" aria-live="polite">
              {generatingAvgMs ? (
                <div>
                  Avg ~{avgLabel}
                  {takingLongerThanUsual ? (
                    <span className="generateStatus__warn"> • taking longer than usual</span>
                  ) : null}
                </div>
              ) : (
                <div>Generating…</div>
              )}
            </div>
          )}

          {!isGenerating && generateResultSummary ? (
            <div className="generateStatus" role="status" aria-live="polite">
              {generateResultSummary}
            </div>
          ) : null}
          <Button
            radius={9999}
            styles={{ root: { height: 40 } }}
            className="add-shift-btn"
            onClick={() => setAddMode(true)}
            aria-label={t('timeline.addShift')}
          >
            {t('timeline.addShift')}
          </Button>
        </div>
      </div>

      <main className="timelineMain">
      <div className="timelineViewport">
        {isLoading && (
          <div style={{ padding: 12, fontSize: 13, color: '#666' }}>{t('timeline.loadingShifts')}</div>
        )}
        <div
  className="timeline"
  style={{
    gridTemplateColumns: `90px repeat(${viewDays}, 1fr)`
  }}
>
          {/* top-left corner */}
          <div className="corner">
            <Button
              size="xs"
              disabled={selectedDates.length === 0}
              onClick={() => {
                const datesParam = selectedDates
                  // Use local calendar date (avoid UTC shift from toISOString)
                  .map((d) => format(d, 'yyyy-MM-dd'))
                  .join(',');

                setSelectedDates([]);
                navigate(`/print-day?dates=${datesParam}`);
              }}
              aria-label={t('common.print')}
              style={{ whiteSpace: 'normal', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <IconPrinter size={16} />
              <span>{t('common.print')}</span>
            </Button>
          </div>

          {/* day headers */}
          {daysWithNames.map(({ date, name }, i) => {
            const dateStr = `${date.getDate()} ${date.toLocaleDateString(locale, { month: 'short' })}`;
            const isToday = format(date, 'yyyy-MM-dd') === todayISO;
            const isSelected =
              selectedDates.length === 0 ||
              selectedDateKeys.has(date.toDateString());
            return (
              <div
                key={`${name}-${i}`}
                className={`day-header${isToday ? ' today-col' : ''}`}
                style={{
                  opacity: isSelected ? 1 : 0.4,
                  transition: 'opacity 120ms ease'
                }}
              >
                <div className="dayHeaderContent">
                  <input
                    className="dayHeaderCheckbox"
                    type="checkbox"
                    checked={selectedDateKeys.has(date.toDateString())}
                    onChange={() => toggleDateSelection(date)}
                    aria-label={`Select ${name} ${dateStr}`}
                  />
                  <div className="dayHeaderText">
                    <div className="dayHeaderDow">{name}</div>
                    <div className="dayHeaderDate">{dateStr}</div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Route × ShiftType rows */}
          {rows.map(({ route, shiftType }) => (
            <React.Fragment key={`${route}-${shiftType}`}>
              {/* row label */}
              {(() => {
                const rowKey = `${route}__${shiftType}`;
                const rowSelected = selectedRowKey === rowKey;

                return (
                  <div
                    className={`bus-label${rowSelected ? ' row-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Highlight row ${route} ${SHIFT_TYPE_LABELS[shiftType] || shiftType}`}
                    aria-pressed={rowSelected}
                    onClick={() => setSelectedRowKey((prev) => (prev === rowKey ? null : rowKey))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedRowKey((prev) => (prev === rowKey ? null : rowKey));
                      }
                    }}
                  >
                    <div className="bus-label__typePill">{SHIFT_TYPE_LABELS[shiftType]}</div>
                    <div className="bus-label__route">{route}</div>
                  </div>
                );
              })()}

              {/* cells for this route + shiftType */}
              {daysWithNames.map(({ date }) => {
                const rowKey = `${route}__${shiftType}`;
                const rowSelected = selectedRowKey === rowKey;
                const cellDate = format(date, 'yyyy-MM-dd');
                const isToday = cellDate === todayISO;
                const bucketKey = `${route}__${shiftType}__${cellDate}`;
                const dayShifts = shiftBuckets.get(bucketKey) || [];
                const isSelected =
                  selectedDates.length === 0 ||
                  selectedDateKeys.has(date.toDateString());

                return (
                  <div
                    key={`${route}-${date.toISOString()}`}
                    className={`cell${isToday ? ' today-col' : ''}${rowSelected ? ' row-selected' : ''}`}
                    style={{
                      opacity: isSelected ? 1 : 0.35,
                      transition: 'opacity 120ms ease'
                    }}
                  >
                    {dayShifts.length === 0 && (
                      <div className="cell__empty">{t('timeline.noShiftToday')}</div>
                    )}
                    {dayShifts.map((shift, i) => (
                      (() => {
                        const cardTitle = getShiftCardTitle(shift);
                        const shiftTypeLabel = SHIFT_TYPE_LABELS[shiftType] || String(shiftType || '');
                        const driverLabel = shift.driver === 'Unassigned' ? t('common.unassignedUpper') : shift.driver;
                        const ariaTitle = cardTitle ? ` — ${cardTitle}` : '';
                        return (
                      <div
                        key={shift.token || `${shift.route}-${shift.day}-${shift.name}-${i}`}
                        className="shift-card"
                        role="button"
                        tabIndex={0}
                        aria-label={`${shiftTypeLabel} shift${ariaTitle} from ${shift.time} for ${driverLabel}`}
                        onClick={() => {
                          setEditedDriverId(shift.driverId || null);
                          setAssignError('');
                          setEditedNote(shift.note || '');
                          setIsEditingNote(false);
                          setShowNotes(false);
                          setSelectedShiftToken(shift.token);
                          setAddMode(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setEditedDriverId(shift.driverId || null);
                            setAssignError('');
                            setEditedNote(shift.note || '');
                            setIsEditingNote(false);
                            setShowNotes(false);
                            setSelectedShiftToken(shift.token);
                            setAddMode(false);
                          }
                        }}
                      >
                        {cardTitle && (
                          <div className="shift-name" style={{ color: '#1a1a1a', fontWeight: 700 }}>{cardTitle}</div>
                        )}
                        <div className="shift-time" style={{ color: '#222' }}>{shift.time}</div>
                        <div className="shift-driver" style={{ color: shift.driver === 'Unassigned' ? '#b00020' : '#1a1a1a', fontWeight: 500 }}>
                          {shift.driver === 'Unassigned' ? t('common.unassignedUpper') : shift.driver}
                        </div>
                        {shift.confirmationStatus !== 'unassigned' && (
                          <div className="shift-status" style={{ color: shift.confirmationStatus === 'pending' ? '#b36a00' : shift.confirmationStatus === 'accepted' ? '#1971c2' : '#b00020', fontWeight: 600 }}>
                            {shift.confirmationStatus === 'pending' && 'Pending'}
                            {shift.confirmationStatus === 'accepted' && 'Accepted'}
                            {shift.confirmationStatus === 'declined' && 'Declined'}
                          </div>
                        )}

                      </div>
                        );
                      })()
                    ))}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* SINGLE DRAWER - handles both edit and add modes */}
      <Drawer
        opened={!!selectedShiftToken || addMode}
        onClose={() => {
          setSelectedShiftToken(null);
          setAddMode(false);
          setNewShift({
            route: '',
            shiftType: 'morning',
            date: '',
            name: '',
            startTime: '',
            endTime: '',
            defaultBus: '',
          });
          setFormError('');
        }}
        title={addMode ? "Add new shift" : "Shift details"}
        position="right"
        size={520}
        styles={{
          header: { paddingLeft: 24, paddingRight: 24 },
          body: { paddingLeft: 24, paddingRight: 24 },
        }}
      >
        {addMode ? (
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            onSubmit={e => {
              e.preventDefault();
              handleSaveNewShift();
            }}
            aria-labelledby="add-shift-heading"
          >
            <h2 id="add-shift-heading" style={{ fontSize: 22, color: '#222' }}>Add new shift</h2>
            <p style={{ fontSize: 14, color: '#444' }}>
              Manual shift outside of patterns
            </p>

            <Select
              aria-label="Route"
              data={routeOptions}
              value={newShift.route}
              onChange={(value) => setNewShift(prev => ({ ...prev, route: value || '' }))}
              placeholder="Route"
              required
            />

            <Select
              aria-label="Shift type"
              data={SHIFT_TYPES_ORDERED.map((t) => ({ value: t, label: SHIFT_TYPE_LABELS[t] }))}
              value={newShift.shiftType}
              onChange={(value) => setNewShift((prev) => ({ ...prev, shiftType: value || 'morning' }))}
              placeholder="Shift type"
              required
            />

            <Select
              aria-label="Default bus"
              data={busOptions}
              value={newShift.defaultBus}
              onChange={(value) =>
                setNewShift(prev => ({ ...prev, defaultBus: value || '' }))
              }
              placeholder="Default bus"
              required
            />


            <TextInput
              aria-label="Date"
              type="date"
              value={newShift.date}
              onChange={(e) => setNewShift(prev => ({ ...prev, date: e.target.value }))}
              required
            />

            <TextInput
              aria-label="Shift name"
              placeholder="Shift name"
              value={newShift.name}
              onChange={(e) => setNewShift(prev => ({ ...prev, name: e.target.value }))}
              required
            />

            <TextInput
              aria-label="Start time"
              placeholder="Start time"
              type="time"
              value={newShift.startTime}
              onChange={(e) => setNewShift(prev => ({ ...prev, startTime: e.target.value }))}
              required
            />

            <TextInput
              aria-label="End time"
              placeholder="End time"
              type="time"
              value={newShift.endTime}
              onChange={(e) => setNewShift(prev => ({ ...prev, endTime: e.target.value }))}
              required
            />

            {formError && (
              <div role="alert" style={{ color: '#b00020', fontWeight: 500, fontSize: 14 }}>
                {formError}
              </div>
            )}

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <Button type="submit">{t('timeline.saveShift')}</Button>
              <Button variant="default" onClick={handleCancelAdd}>{t('common.cancel')}</Button>
            </div>
          </form>
        ) : (
          /* EDIT EXISTING SHIFT */
          selectedShift && (
            <>
              <p><strong>Route:</strong> {selectedShift.route}</p>
              {selectedShift.routeName && selectedShift.routeName !== selectedShift.route && (
                <p><strong>Route name:</strong> {selectedShift.routeName}</p>
              )}
              <p><strong>Shift type:</strong> {SHIFT_TYPE_LABELS[selectedShift.shiftType] || selectedShift.shiftType}</p>
              <p><strong>Time:</strong> {selectedShift.time}</p>

              <details style={{ marginTop: 8, marginBottom: 8 }}>
                <summary style={{ cursor: 'pointer', color: '#666', fontSize: 13 }}>
                  IDs (for fixing data in Lists)
                </summary>
                <div style={{ marginTop: 6, fontSize: 12, color: '#444', lineHeight: 1.4 }}>
                  <div><strong>Shift instance ID:</strong> {selectedShift.id || '—'}</div>
                  <div><strong>Shift pattern ID:</strong> {selectedShift.patternId || '—'}</div>
                  <div><strong>Shift template ID:</strong> {selectedShift.templateId || '—'}</div>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: '#666', lineHeight: 1.35 }}>
                  <div>Pattern ID = row in ShiftPatterns (controls type/time/days).</div>
                  <div>Instance ID = row in ShiftInstances (what appears on the calendar/print).</div>
                </div>
              </details>

              <p>
                <strong>Driver:</strong>{' '}
                {selectedShift.driver === 'Unassigned' ? (
                  <>
                    <IconAlertCircle size={16} color="#868e96" />
                    <span style={{ marginLeft: 6 }}>{t('common.unassigned')}</span>
                  </>
                ) : (
                  selectedShift.driver
                )}
              </p>

<div style={{ marginBottom: 12 }}>
  <strong style={{ fontSize: 13 }}>Buses used</strong>
  <div style={{ fontSize: 13, color: '#333', marginTop: 4 }}>
    {busesUsed.length === 0 ? (
      <span style={{ color: '#777' }}>{t('timeline.noBusAssigned')}</span>
    ) : (
      busesUsed.join(', ')
    )}
  </div>
</div>



              <hr style={{ margin: '16px 0' }} />

              <div style={{ marginBottom: 12 }}>
                <Select
                  aria-label="Assign driver"
                  data={driverOptions.length ? driverOptions : fallbackDrivers}
                  value={editedDriverId}
                  onChange={setEditedDriverId}
                  placeholder="Assign driver"
                  clearable={false}
                  mt="sm"
                />

                <p style={{ fontSize: 13, color: '#555', marginTop: 12 }}>
                  Assigning will email the selected driver a confirmation link.
                </p>

                <div style={{ marginTop: 12 }}>
                  <Button
                    mt="md"
                    loading={isAssigning}
                    disabled={!selectedShiftToken || !editedDriverId || Boolean(selectedShift?.manual)}
                    onClick={async () => {
                      if (!selectedShiftToken || !editedDriverId) return;

                      setIsAssigning(true);
                      setAssignError('');
                      try {
                        const result = await assignWeekAndEmail({ shiftId: selectedShiftToken, driverId: editedDriverId });

                        const opt = driverById.get(String(editedDriverId));
                        const displayName = opt?.name || (opt?.label ? String(opt.label).split(' (')[0] : '') || 'Unassigned';

                        const mailOk = result?.mailOk !== false;
                        const mailedTo = result?.mailedTo || opt?.email || '';
                        const mailError = typeof result?.mailError === 'string' ? result.mailError : '';

                        const updatedCount = Array.isArray(result?.updatedIds) ? result.updatedIds.length : 1;

                        if (mailOk) {
                          notifications.show({
                            title: 'Email sent',
                            message: mailedTo
                              ? `Confirmation sent to ${mailedTo}`
                              : `Confirmation email sent to ${displayName}`,
                            color: 'blue',
                          });
                        } else {
                          notifications.show({
                            title: 'Assigned (email not sent)',
                            message:
                              mailError ||
                              'The shift was assigned, but email sending is not configured.',
                            color: 'yellow',
                          });
                        }

                        if (updatedCount > 1) {
                          notifications.show({
                            title: 'Assigned group',
                            message: `Updated ${updatedCount} shifts (weekdays/weekend group).`,
                            color: 'blue',
                          });
                        }

                        const updated = new Set(result?.updatedIds || [selectedShiftToken]);

                        setShifts((prev) =>
                          prev.map((s) =>
                            updated.has(s.token)
                              ? {
                                  ...s,
                                  driverId: String(editedDriverId),
                                  driver: displayName,
                                  confirmationStatus: 'pending',
                                }
                              : s
                          )
                        );

                        setSelectedShiftToken(null);
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : 'Failed to assign driver';
                        setAssignError(msg);
                        notifications.show({
                          title: 'Failed to send email',
                          message: msg,
                          color: 'red',
                        });
                      } finally {
                        setIsAssigning(false);
                      }
                    }}
                  >
                    Assign & email
                  </Button>

                  {selectedShift?.manual && (
                    <div style={{ marginTop: 8, fontSize: 13, color: '#777' }}>
                      Manual shifts can’t be emailed because they aren’t saved to SharePoint.
                    </div>
                  )}

                  {assignError && (
                    <div role="alert" style={{ marginTop: 8, fontSize: 13, color: '#b00020', fontWeight: 600 }}>
                      {assignError}
                    </div>
                  )}
                </div>
              </div>

              <hr style={{ margin: '16px 0' }} />

              {existingNote ? (
                <>
                  <div
                    style={{
                      background: '#fff3bf',
                      border: '1px solid #ffe066',
                      borderRadius: 6,
                      padding: '8px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                    onClick={() => setShowNotes((v) => !v)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 13 }}>⚠️ 1 note for this trip</strong>
                      <span style={{ display: 'inline-flex', alignItems: 'center', color: '#444' }}>
                        {showNotes ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                      </span>
                    </div>
                  </div>

                  {showNotes && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ padding: 8, background: '#fff', borderRadius: 6 }}>
                        <p style={{ margin: 0, fontSize: 13 }}>{existingNote}</p>
                      </div>

                      {!isEditingNote && (
                        <div style={{ marginTop: 8 }}>
                          <Button
                            size="xs"
                            variant="outline"
                            style={{ height: 24, padding: '0 8px' }}
                            onClick={() => { 
                              setIsEditingNote(true); 
                              setEditedNote(existingNote); 
                            }}
                          >
                            Edit
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <Button
                  variant="subtle"
                  onClick={() => { 
                    setIsEditingNote(true); 
                    setEditedNote(''); 
                  }}
                >
                  Add note
                </Button>
              )}

              {isEditingNote && (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    value={editedNote}
                    onChange={(e) => setEditedNote(e.target.value)}
                    placeholder="Describe what happened during this shift…"
                    style={{
                      width: '100%',
                      minHeight: 80,
                      padding: 8,
                      fontSize: 13,
                    }}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Button
                      mt="md"
                      onClick={() => {
                        setShifts(prev => {
                          const newShifts = prev.map(s =>
                            s.token === selectedShiftToken
                              ? { ...s, note: editedNote.trim() }
                              : s
                          );
                          // No need to update selectedShiftToken, just keep drawer open
                          return newShifts;
                        });
                        setIsEditingNote(false);
                        if (editedNote.trim()) setShowNotes(true);
                      }}
                    >
                      Save changes
                    </Button>
                  </div>
                </div>
              )}

              <h4 style={{ marginBottom: 8, marginTop: 24 }}>Trips</h4>

              {selectedTrips.length === 0 && (
                <p style={{ fontSize: 13, color: '#777' }}>
                  No trips defined for this shift.
                </p>
              )}

              <Accordion multiple chevronPosition="left">
                {selectedTrips.map((trip) => {
                  const tripKey = `${String(trip?.name || '').trim()}||${String(trip?.time || '').trim()}`;
                  return (
                  <Accordion.Item key={tripKey} value={tripKey}>
                    <Accordion.Control>
  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
    <div>
      <strong>{formatTripShortName(trip.name)}</strong>
      <span style={{ marginLeft: 8, fontWeight: 400 }}>
        ({trip.time})
      </span>
    </div>

    <Select
      size="xs"
      data={busOptions}
      value={getTripBusPlate(trip) || null}
      placeholder="Bus"
      clearable
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(value) => setTripBusPlate(trip.name, value)}
      style={{ width: 120 }}
    />
  </div>
</Accordion.Control>


                    <Accordion.Panel>
                      <ul style={{ paddingLeft: 16, margin: 0 }}>
                        {trip.events.map((ev, j) => (
                          <li key={j} style={{ fontSize: 13, marginBottom: 4 }}>
                            {ev.type === 'stop' ? (
                              <>
                                <strong>{ev.time}</strong> — {ev.label}
                              </>
                            ) : (
                              <em>
                                Break{ev.label ? ` (${ev.label})` : ''} — {ev.duration} min
                              </em>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Accordion.Panel>
                  </Accordion.Item>
                  );
                })}
              </Accordion>
            </>
          )
        )}
      </Drawer>
      </main>
    </div>
  );
}


