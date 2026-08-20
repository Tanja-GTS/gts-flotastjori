
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Select, Checkbox, Accordion, TextInput, Drawer, Popover, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconChevronDown, IconChevronUp, IconChevronLeft, IconChevronRight, IconPrinter, IconUser } from '@tabler/icons-react';
import { addDays, format, parseISO } from 'date-fns';
import './timeline.css';
import { selectRoutesForWorkspace, selectVisibleShifts } from './domain/selectors';
import { SHIFT_TYPES_ORDERED, SHIFT_TYPE_LABELS, isShiftType } from './domain/shiftTypes';
import { getTripsForShift } from './domain/tripsTemplate';
import { assignDriverAndEmail, assignDriverOnly, assignWeekAndEmail, assignWeekOnly } from './data/backendApi';
import { notifications } from '@mantine/notifications';
import { useI18n } from './i18n';

const fallbackDrivers = ['Ahmed', 'Jon', 'Maria', 'Sara'].map((name) => ({ value: name, label: name, name }));

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function weekdayKeyFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const jsDay = d.getDay();
  const mondayFirstIndex = (jsDay + 6) % 7; // Mon=0 ... Sun=6
  return WEEKDAY_KEYS[mondayFirstIndex] || 'mon';
}

function monthKeyFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return MONTH_KEYS[d.getMonth()] || 'jan';
}

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
  workspaceOptions: workspaceOptionsProp,
  busOptions = [],
  driverOptions = [],
  onRangeChange,
  onGenerate,
  isLoading = false,
  isGenerating = false,
  generatingElapsedMs = 0,
  generatingAvgMs = 0,
  generateResultSummary = '',
  loadError = '',
  backendAuthEnabled = false,
  authStatus = 'disabled',
  authError = '',
  onSignIn,
  onSignOut,
}) {
  const navigate = useNavigate();
  const { lang, setLang, t } = useI18n();

  const langToggleLabel = lang === 'is' ? 'EN' : 'ÍS';
  const monthLong = useCallback((d) => t(`date.months.${monthKeyFromDate(d)}`), [t]);
  const monthShort = useCallback((d) => t(`date.monthsShort.${monthKeyFromDate(d)}`), [t]);
  const weekdayShort = useCallback((d) => t(`date.weekdaysShort.${weekdayKeyFromDate(d)}`), [t]);

  const workspaceOptions = useMemo(() => {
    const list = Array.isArray(workspaceOptionsProp) ? workspaceOptionsProp : [];
    if (list.length) return list;
    return [
      { value: 'south', label: 'South Iceland' },
      { value: 'school', label: 'School Transport' },
      { value: 'airport', label: 'Airport Transfers' },
    ];
  }, [workspaceOptionsProp]);

  const isMobile = useIsMobile();

  // Computed once at mount — used to set initial state correctly so we don't
  // fire onRangeChange twice (once with viewDays=7, then again after the effect).
  const isMobileInit =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

  const routes = selectRoutesForWorkspace(shifts, workspaceId);
  const routeOptions = routes.map((route) => ({ value: route, label: route }));
  const [selectedShiftToken, setSelectedShiftToken] = useState(null);
  const [selectedRowKey, setSelectedRowKey] = useState(null);
  const [editedDriverId, setEditedDriverId] = useState(null);
  const [assignOnlyThisShift, setAssignOnlyThisShift] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assigningMode, setAssigningMode] = useState(null);
  const [assignError, setAssignError] = useState('');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [viewDays, setViewDays] = useState(isMobileInit ? 1 : 7);
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

  useEffect(() => {
    // Default workflow: selecting a shift applies to the whole week (same route + shift type).
    // Managers can opt into single-shift assignment via the checkbox.
    if (selectedShiftToken) setAssignOnlyThisShift(false);
  }, [selectedShiftToken]);

  const visibleShifts = selectVisibleShifts(shifts, workspaceId, routes);

  const isDinnerShift = useCallback((shift) => {
    const raw = [shift?.route, shift?.routeName, shift?.name]
      .filter(Boolean)
      .map((x) => String(x))
      .join(' ');

    const s = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ð/g, 'd');

    const timeRaw = String(shift?.time || '').trim();
    const time = timeRaw
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[–—−]/g, '-')
      .replace(/[^0-9:-]/g, '');

    const has51a = /\b51a\b/i.test(raw) || s.includes('51a');
    const hasKveldWord = s.includes('kvold') || s.includes('kveld');

    // Targeted workaround: the 51A dinner shift is the evening run 19:29–21:30.
    const looksLikeDinnerTime = time.includes('19:29') && time.includes('21:30');

    return has51a && (hasKveldWord || looksLikeDinnerTime);
  }, []);

  const getShiftTypeLabel = useCallback(
    (shift, shiftTypeKey) => {
      const key = String(shiftTypeKey || '').trim().toLowerCase();
      if (key === 'evening' && isDinnerShift(shift)) return 'Dinner';
      return SHIFT_TYPE_LABELS[key] || String(shiftTypeKey || '').trim();
    },
    [isDinnerShift]
  );

  const getShiftCardTitle = useCallback(
    (shift, rowShiftType) => {
      const route = String(shift?.route || '').trim();
      const typeLabel = getShiftTypeLabel(shift, rowShiftType) || '';
      const typeLabelForCard =
        String(rowShiftType || '').trim().toLowerCase() === 'evening' && isDinnerShift(shift)
          ? 'Dinner shift'
          : typeLabel;
      return [route, typeLabelForCard].filter(Boolean).join(' ').trim();
    },
    [getShiftTypeLabel, isDinnerShift]
  );

  const unassignOption = useMemo(
    () => ({
      value: 'unassigned',
      label: t('common.unassigned'),
      name: t('common.unassigned'),
      email: '',
      phone: '',
    }),
    [t]
  );

  const driverSelectOptions = useMemo(() => {
    // Some workspaces have a placeholder Drivers-list entry like "🤷🏻‍♂️ Unassigned".
    // We hide that and instead offer a real unassign action via value "unassigned".
    const getDisplayName = (o) => String(o?.name || o?.label || o?.value || '').trim();
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    const real = (driverOptions || [])
      .filter((o) => !/unassigned/i.test(getDisplayName(o)))
      .slice()
      .sort((a, b) => {
        const byName = collator.compare(getDisplayName(a), getDisplayName(b));
        if (byName !== 0) return byName;
        return collator.compare(String(a?.value || ''), String(b?.value || ''));
      });

    return [unassignOption, ...real];
  }, [driverOptions, unassignOption]);

  const getEditedDriverIdForShift = useCallback((shift) => {
    const status = String(shift?.confirmationStatus || '').trim().toLowerCase();
    const driverLabel = String(shift?.driver || '').trim();
    const looksUnassigned = status === 'unassigned' || /unassigned/i.test(driverLabel);
    if (looksUnassigned) return 'unassigned';
    return shift?.driverId ? String(shift.driverId) : null;
  }, []);

  const driverById = useMemo(() => {
    const m = new Map();
    (driverSelectOptions || []).forEach((o) => {
      if (!o?.value) return;
      m.set(String(o.value), o);
    });
    return m;
  }, [driverSelectOptions]);

  const runAssignment = useCallback(
    async ({ withEmail }) => {
      if (!selectedShiftToken || !editedDriverId) return;

      const isUnassign = String(editedDriverId || '').trim() === 'unassigned';
      if (withEmail && isUnassign) {
        const msg = 'Cannot send a request when unassigning.';
        setAssignError(msg);
        notifications.show({ title: 'Cannot send request', message: msg, color: 'yellow' });
        return;
      }

      const mode = withEmail ? 'request' : 'assign';
      setAssigningMode(mode);
      setIsAssigning(true);
      setAssignError('');

      try {
        const result = withEmail
          ? assignOnlyThisShift
            ? await assignDriverAndEmail({ shiftId: selectedShiftToken, driverId: editedDriverId })
            : await assignWeekAndEmail({ shiftId: selectedShiftToken, driverId: editedDriverId })
          : assignOnlyThisShift
            ? await assignDriverOnly({ shiftId: selectedShiftToken, driverId: editedDriverId })
            : await assignWeekOnly({ shiftId: selectedShiftToken, driverId: editedDriverId });

        const opt = driverById.get(String(editedDriverId));
        const displayName = isUnassign
          ? 'Unassigned'
          : opt?.name || (opt?.label ? String(opt.label).split(' (')[0] : '') || 'Unassigned';

        const updatedIds = Array.isArray(result?.updatedIds) ? result.updatedIds : [selectedShiftToken];
        const updatedCount = updatedIds.length;

        if (isUnassign) {
          notifications.show({
            title: 'Unassigned',
            message: updatedCount > 1 ? `Unassigned ${updatedCount} shifts.` : 'Shift unassigned.',
            color: 'gray',
          });
        } else if (!withEmail) {
          notifications.show({
            title: 'Assigned',
            message: updatedCount > 1 ? `Assigned ${updatedCount} shifts.` : `Assigned ${displayName}.`,
            color: 'blue',
          });
        } else {
          const mailOk = result?.mailOk !== false;
          const mailedTo = result?.mailedTo || opt?.email || '';
          const mailError = typeof result?.mailError === 'string' ? result.mailError : '';

          if (mailOk) {
            notifications.show({
              title: 'Request sent',
              message: mailedTo ? `Sent to ${mailedTo}` : `Sent to ${displayName}`,
              color: 'blue',
            });
          } else {
            notifications.show({
              title: 'Assigned (request not sent)',
              message: mailError || 'The shift was assigned, but email sending is not configured.',
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
        }

        const updated = new Set(updatedIds);
        setShifts((prev) =>
          prev.map((s) =>
            updated.has(s.token)
              ? {
                  ...s,
                  driverId: isUnassign ? null : String(editedDriverId),
                  driver: isUnassign ? 'Unassigned' : displayName,
                  confirmationStatus: isUnassign ? 'unassigned' : withEmail ? 'pending' : 'assigned',
                }
              : s
          )
        );

        setSelectedShiftToken(null);
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : withEmail
              ? 'Failed to send request'
              : 'Failed to assign driver';
        setAssignError(msg);
        notifications.show({
          title: withEmail ? 'Failed to send request' : 'Failed to assign',
          message: msg,
          color: 'red',
        });
      } finally {
        setIsAssigning(false);
        setAssigningMode(null);
      }
    },
    [assignOnlyThisShift, editedDriverId, driverById, selectedShiftToken, setShifts]
  );

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

  // Plate string → bus ID lookup (template busOverride may store a plate, not an ID)
  const busIdByPlate = useMemo(
    () => new Map(busOptions.map((b) => [b.title, b.value])),
    [busOptions]
  );

  const getTripBusPlate = useCallback(
    (trip) => {
      // User-set per-trip override (stored as bus ID by the Select onChange)
      const perTrip = selectedShift?.tripBusOverrides?.[trip.name];
      if (perTrip) return perTrip;

      // Template-defined override — may be a bus ID or a plate string
      const templateOverride = trip.busOverride;
      if (templateOverride && templateOverride !== 'null') {
        // Already a valid bus ID?
        if (busOptions.some((b) => b.value === templateOverride)) return templateOverride;
        // Treat as plate string and resolve to bus ID
        return busIdByPlate.get(templateOverride) || null;
      }

      // Fall back to the shift's assigned bus ID so the Select can match and show the plate label
      return selectedShift?.busId || null;
    },
    [selectedShift, busOptions, busIdByPlate]
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

  const busLabelById = useMemo(
    () => new Map(busOptions.map((b) => [b.value, b.title])),
    [busOptions]
  );

  const busesUsed = selectedShift
    ? Array.from(
        new Set(
          selectedTrips
            .map((trip) => getTripBusPlate(trip))
            .filter(Boolean)
            .map((id) => busLabelById.get(id) || id)
        )
      )
    : [];
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    if (isMobileInit) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  });

  const viewedMonthStart = useMemo(
    () => new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), 1),
    [currentWeekStart]
  );
  const currentMonthStart = useMemo(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }, []);
  const isRecordMonth = viewedMonthStart.getTime() < currentMonthStart.getTime();

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
        label: t(`date.months.${MONTH_KEYS[monthIndex]}`),
      })),
    [t]
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

  useEffect(() => {
    if (!isRecordMonth) return;
    setAddMode(false);
  }, [isRecordMonth]);

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

  const timelineGridColumns = useMemo(() => {
    const labelColWidthPx = 90;

    // 1 week: fit all days on screen (Mon–Sun), no horizontal scroll.
    // 2 weeks: prefer readability via horizontal scroll (fixed column widths).
    if (viewDays <= 7) {
      return `${labelColWidthPx}px repeat(${viewDays}, minmax(0, 1fr))`;
    }

    const dayColWidthPx = 180;
    return `${labelColWidthPx}px repeat(${viewDays}, ${dayColWidthPx}px)`;
  }, [viewDays]);

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
    name: weekdayShort(date),
  }));

  return (
    <div className="timelinePage">

      <header className="appHeader">
        <div className="appHeader__inner">
          <div className="appHeader__left">
            <div className="appHeader__brand" aria-label="Fleet Scheduler">
              <img className="appHeader__logo" src="/logo.svg" alt="GTS" />
            </div>

            <div className="appHeader__separator" aria-hidden="true" />

            <Popover
              opened={workspaceOpened}
              onChange={setWorkspaceOpened}
              position="bottom-start"
              withArrow
              shadow="md"
            >
              <Popover.Target>
                <button
                  className="workspaceControl"
                  type="button"
                  aria-label={t('common.workspace')}
                  aria-expanded={workspaceOpened}
                  aria-controls="workspace-menu"
                  onClick={() => setWorkspaceOpened((o) => !o)}
                >
                  <div className="workspaceControl__text">
                    <div className="workspaceControl__label">{t('common.workspace')}</div>
                    <div className="workspaceControl__value">
                      {workspaceOptions.find((w) => w.value === workspaceId)?.label || t('common.selectWorkspace')}
                    </div>
                  </div>
                  <svg
                    className={`workspaceControl__chevron${workspaceOpened ? ' is-open' : ''}`}
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path
                      d="M6 9l6 6 6-6"
                      stroke="#151922"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </Popover.Target>

              <Popover.Dropdown>
                <div className="viewbar__menu" id="workspace-menu" role="menu" aria-label="Workspaces">
                  {workspaceOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`viewbar__option${opt.value === workspaceId ? ' is-selected' : ''}`}
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

            <div className="appHeader__separator" aria-hidden="true" />
          </div>

          {/* Mobile only: day navigation replaces the spacer links */}
          <div className="mobileNav" aria-label="Day navigation">
            <button
              className="mobileNav__btn"
              type="button"
              onClick={handlePrevious}
              aria-label="Previous day"
            >
              <IconChevronLeft size={20} aria-hidden="true" />
            </button>
            <span className="mobileNav__date">
              <span className="mobileNav__dow">{weekdayShort(currentWeekStart)}</span>
              {' '}
              <span className="mobileNav__day">{currentWeekStart.getDate()}</span>
              {' '}
              <span className="mobileNav__month">{monthShort(currentWeekStart)}</span>
            </span>
            <button
              className="mobileNav__btn"
              type="button"
              onClick={handleNext}
              aria-label="Next day"
            >
              <IconChevronRight size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="appHeader__spacer">
            <button
              className="appHeader__navLink"
              type="button"
              onClick={() => navigate('/drivers')}
              aria-label={t('nav.drivers')}
            >
              {t('nav.drivers')}
            </button>
            <a
              className="appHeader__navLink appHeader__navLink--secondary"
              href="https://meowing-lark-f0c.notion.site/38f80c3e1d318020af0dd5af7928f1b5?v=38f80c3e1d3180398d6d000cf070b664"
              target="_blank"
              rel="noopener noreferrer"
            >
              Go to Notion
            </a>
          </div>

          <div className="appHeader__right">
            <div className="appHeader__separator" aria-hidden="true" />
            <div className="appHeader__actions">
              {!isRecordMonth && (
                <button
                  className="appHeader__addShift"
                  type="button"
                  onClick={() => setAddMode(true)}
                  aria-label={t('timeline.addShift')}
                >
                  <span className="appHeader__addShiftIcon" aria-hidden="true">
                    +
                  </span>
                  {t('timeline.addShift')}
                </button>
              )}
              <button
                className="appHeader__lang"
                type="button"
                aria-label={t('lang.label')}
                onClick={() => setLang(lang === 'is' ? 'en' : 'is')}
              >
                {langToggleLabel}
              </button>
              {backendAuthEnabled && authStatus !== 'disabled' && (
                <>
                  <div className="appHeader__separator" aria-hidden="true" />
                  <button
                    className="appHeader__addShift"
                    type="button"
                    onClick={() => {
                      const action = authStatus === 'signed-in' ? onSignOut : onSignIn;
                      if (typeof action === 'function') action().catch(() => {});
                    }}
                    aria-label={authStatus === 'signed-in' ? t('common.signOut') : t('common.signIn')}
                    title={authStatus === 'signed-in' ? '' : authError || t('common.signInHint')}
                  >
                    {authStatus === 'signed-in' ? t('common.signOut') : t('common.signIn')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
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
                  className={`monthbar__dropdown${monthYearOpened ? ' is-open' : ''}`}
                  type="button"
                  aria-label={t('timeline.selectMonthYear')}
                  onClick={() => setMonthYearOpened((o) => !o)}
                >
                  <IconChevronDown className="monthbar__chev" size={18} aria-hidden="true" />
                  <span className="monthbar__text">
                    {monthLong(currentWeekStart)} {currentWeekStart.getFullYear()}
                  </span>
                </button>

                <div className="monthbar__nav" aria-label={t('timeline.changeWeek')}>
                  <button
                    className="monthbar__navBtn"
                    type="button"
                    onClick={handlePrevious}
                    aria-label={t('timeline.previousWeek')}
                  >
                    <IconChevronLeft size={22} aria-hidden="true" />
                  </button>

                  <button
                    className="monthbar__navBtn"
                    type="button"
                    onClick={handleNext}
                    aria-label={t('timeline.nextWeek')}
                  >
                    <IconChevronRight size={22} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </Popover.Target>

            <Popover.Dropdown>
                <div className="monthPickerGrid">
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
            onClick={handleToday}
            aria-label={t('timeline.goToCurrentWeek')}
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
              <button
                className={`viewDropdown${viewOpened ? ' is-open' : ''}`}
                type="button"
                aria-label="Select view"
                aria-expanded={viewOpened}
                aria-controls="view-menu"
                onClick={() => setViewOpened((o) => !o)}
              >
                <span className="viewDropdown__text">
                  {viewDays === 7
                    ? t('timeline.view1Week')
                    : viewDays === 14
                      ? t('timeline.view2Weeks')
                      : `${viewDays} days`}
                </span>
                <IconChevronDown className="viewDropdown__chev" size={18} aria-hidden="true" />
              </button>
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
          {!isRecordMonth && !hasShiftsInMonth && (
            <Button
              variant="default"
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
        </div>
      </div>

      <main className="timelineMain">
      <div className="timelineViewport">
        {isLoading && (
          <div style={{ padding: 12, fontSize: 13, color: '#666' }}>{t('timeline.loadingShifts')}</div>
        )}
        <div className="timelineWrap">
          {/* Sticky header row (top-left corner + day headers) */}
          <div
            className={`timeline timelineHeader${viewDays > 7 ? ' is-wide' : ''}`}
            style={{
              gridTemplateColumns: timelineGridColumns,
            }}
          >
            {/* top-left corner */}
            <div className="corner">
            <Tooltip
              label={selectedDates.length === 0 ? t('timeline.selectDaysToPrint') : t('timeline.printSelectedDays')}
              withArrow
              position="bottom"
              openDelay={250}
            >
              <span style={{ display: 'inline-flex' }}>
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
              </span>
            </Tooltip>
            </div>

            {/* day headers */}
            {daysWithNames.map(({ date, name }, i) => {
              const dateStr = `${date.getDate()} ${monthShort(date)}`;
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
                    transition: 'opacity 120ms ease',
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
          </div>

          {/* Body grid (row labels + cells) */}
          <div
            className={`timeline timelineBody${viewDays > 7 ? ' is-wide' : ''}`}
            style={{
              gridTemplateColumns: timelineGridColumns,
            }}
          >

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
                const bucketKey = `${route}__${shiftType}__${cellDate}`;
                const dayShifts = shiftBuckets.get(bucketKey) || [];
                const isSelected =
                  selectedDates.length === 0 ||
                  selectedDateKeys.has(date.toDateString());

                return (
                  <div
                    key={`${route}-${date.toISOString()}`}
                    className={`cell${rowSelected ? ' row-selected' : ''}${dayShifts.length === 1 ? ' cell--single' : ''}`}
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
                        const cardTitle = getShiftCardTitle(shift, shiftType);
                        const shiftTypeLabel = getShiftTypeLabel(shift, shiftType) || String(shiftType || '');
                        const driverLabel = shift.driver === 'Unassigned' ? t('common.unassignedUpper') : shift.driver;
                        const ariaTitle = cardTitle ? ` — ${cardTitle}` : '';

                        const rawStatus = String(shift.confirmationStatus || '').trim().toLowerCase();
                        const normalizedStatus = rawStatus === 'accepted' ? 'assigned' : rawStatus;
                        const effectiveStatus = normalizedStatus || (shift.driver === 'Unassigned' ? 'unassigned' : '');
                        const statusLabel =
                          effectiveStatus === 'pending'
                            ? 'Pending'
                            : effectiveStatus === 'assigned'
                              ? 'Assigned'
                              : effectiveStatus === 'unassigned'
                                ? t('common.unassigned')
                                : effectiveStatus
                                  ? effectiveStatus
                                  : '';

                        const driverText = shift.driver && shift.driver !== 'Unassigned' ? shift.driver : '';

                        return (
                      <div
                        key={shift.token || `${shift.route}-${shift.day}-${shift.name}-${i}`}
                        className="shift-card"
                        role="button"
                        tabIndex={0}
                        aria-label={`${shiftTypeLabel} shift${ariaTitle} from ${shift.time} for ${driverLabel}`}
                        onClick={() => {
                          setEditedDriverId(getEditedDriverIdForShift(shift));
                          setAssignError('');
                          setAssignOnlyThisShift(false);

                          setSelectedShiftToken(shift.token);
                          setAddMode(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setEditedDriverId(getEditedDriverIdForShift(shift));
                            setAssignError('');
                            setAssignOnlyThisShift(false);
                            setEditedNote(shift.note || '');
                            setIsEditingNote(false);
                            setShowNotes(false);
                            setSelectedShiftToken(shift.token);
                            setAddMode(false);
                          }
                        }}
                      >
                        {cardTitle && (
                          <div className="shift-name" title={String(shift.routeName || '').trim() || undefined}>
                            {cardTitle}
                          </div>
                        )}
                        <div className="shift-time">{shift.time}</div>

                        <div className="shift-footer">
                          <div className="shift-driver">{driverText}</div>
                          {statusLabel ? (
                            <div
                              className={`shift-status${effectiveStatus ? ` shift-status--${effectiveStatus}` : ''}`}
                            >
                              {statusLabel}
                            </div>
                          ) : null}
                        </div>

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
        title={addMode ? t('timeline.drawer.addNewShiftTitle') : t('timeline.drawer.shiftDetailsTitle')}
        position={isMobile ? 'bottom' : 'right'}
        size={isMobile ? '100dvh' : 520}
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
            <h2 id="add-shift-heading" style={{ fontSize: 22, color: '#222' }}>{t('timeline.drawer.addNewShiftTitle')}</h2>
            <p style={{ fontSize: 14, color: '#444' }}>
              {t('timeline.drawer.manualShiftOutsidePatterns')}
            </p>

            <Select
              aria-label={t('timeline.drawer.route')}
              data={routeOptions}
              value={newShift.route}
              onChange={(value) => setNewShift(prev => ({ ...prev, route: value || '' }))}
              placeholder={t('timeline.drawer.route')}
              required
            />

            <Select
              aria-label={t('timeline.drawer.shiftType')}
              data={SHIFT_TYPES_ORDERED.map((t) => ({ value: t, label: SHIFT_TYPE_LABELS[t] }))}
              value={newShift.shiftType}
              onChange={(value) => setNewShift((prev) => ({ ...prev, shiftType: value || 'morning' }))}
              placeholder={t('timeline.drawer.shiftType')}
              required
            />

            <Select
              aria-label={t('timeline.drawer.defaultBus')}
              data={busOptions}
              value={newShift.defaultBus}
              onChange={(value) =>
                setNewShift(prev => ({ ...prev, defaultBus: value || '' }))
              }
              placeholder={t('timeline.drawer.defaultBus')}
              required
            />


            <TextInput
              aria-label={t('timeline.drawer.date')}
              type="date"
              value={newShift.date}
              onChange={(e) => setNewShift(prev => ({ ...prev, date: e.target.value }))}
              required
            />

            <TextInput
              aria-label={t('timeline.drawer.shiftName')}
              placeholder={t('timeline.drawer.shiftName')}
              value={newShift.name}
              onChange={(e) => setNewShift(prev => ({ ...prev, name: e.target.value }))}
              required
            />

            <TextInput
              aria-label={t('timeline.drawer.startTime')}
              placeholder={t('timeline.drawer.startTime')}
              type="time"
              value={newShift.startTime}
              onChange={(e) => setNewShift(prev => ({ ...prev, startTime: e.target.value }))}
              required
            />

            <TextInput
              aria-label={t('timeline.drawer.endTime')}
              placeholder={t('timeline.drawer.endTime')}
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
              {isRecordMonth && (
                <div className="timelineDrawerNotice" role="note">
                  {t('timeline.drawer.recordReadOnly')}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      minWidth: 56,
                      borderRadius: 16,
                      border: '1px solid #d8d8d8',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 18,
                      fontWeight: 700,
                      color: '#111',
                      background: '#fff',
                    }}
                  >
                    {selectedShift.route}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedShift.routeName || selectedShift.route}
                    </div>
                  </div>
                </div>
                {selectedShift.season ? (
                  <div
                    style={{
                      alignSelf: 'flex-start',
                      background: /summer|sumar/i.test(selectedShift.season) ? '#fff3bf' : '#dbe4ff',
                      color: '#343a40',
                      borderRadius: 999,
                      padding: '8px 14px',
                      fontWeight: 700,
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {`${selectedShift.season} Schedule`}
                  </div>
                ) : null}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: 16,
                  margin: '18px 0 16px',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('timeline.drawer.date')}</div>
                  <div style={{ fontWeight: 700 }}>
                    {selectedShift.date ? format(parseISO(selectedShift.date), 'dd.MM.yyyy') : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('timeline.drawer.duration')}</div>
                  <div style={{ fontWeight: 700 }}>{selectedShift.time || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('timeline.drawer.shiftType')}</div>
                  <div style={{ fontWeight: 700 }}>
                    {(() => {
                      const normalized = selectedShift ? normalizeShiftType(selectedShift) : '';
                      const base = normalized
                        ? getShiftTypeLabel(selectedShift, normalized)
                        : String(SHIFT_TYPE_LABELS[selectedShift?.shiftType] || selectedShift?.shiftType || '').trim();

                      return normalized === 'evening' && isDinnerShift(selectedShift) ? `${base} shift` : base;
                    })()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('timeline.drawer.licensePlate')}</div>
                  <div style={{ fontWeight: 700, color: busesUsed.length ? '#111' : '#777' }}>
                    {busesUsed.length ? busesUsed.join(', ') : '—'}
                  </div>
                </div>
              </div>

              {(() => {
                const driverLabel = String(selectedShift.driver || '').trim();
                const isUnassigned =
                  selectedShift.confirmationStatus === 'unassigned' || /unassigned/i.test(driverLabel);

                const driverIdKey = selectedShift.driverId ? String(selectedShift.driverId).trim() : '';
                const byId = driverIdKey ? driverById.get(driverIdKey) : null;
                const byName =
                  !byId && selectedShift.driver
                    ? (driverOptions || []).find(
                        (o) => String(o?.name || o?.label || '').trim().toLowerCase() ===
                          String(selectedShift.driver || '').trim().toLowerCase()
                      )
                    : null;
                const driverOpt = byId || byName;
                const phone = String(driverOpt?.phone || '').trim();

                return (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <strong>{t('timeline.drawer.driver')}:</strong>
                      {isUnassigned ? (
                        <>
                          <IconAlertCircle size={16} color="#868e96" />
                          <span>{t('common.unassigned')}</span>
                        </>
                      ) : (
                        <span>{selectedShift.driver}</span>
                      )}
                    </div>
                    {!isUnassigned ? (
                      phone ? (
                        <div style={{ marginTop: 4, fontSize: 13, color: '#444' }}>{phone}</div>
                      ) : (
                        <div style={{ marginTop: 4, fontSize: 13, color: '#868e96' }}>
                          {driverOpt
                            ? t('timeline.drawer.noPhoneInDriversList')
                            : t('timeline.drawer.driverNotFoundNoPhone')}
                        </div>
                      )
                    ) : null}
                  </div>
                );
              })()}


              <hr style={{ margin: '16px 0' }} />

              {!isRecordMonth && (
                <div style={{ marginBottom: 12 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px 0' }}>
                    {t('timeline.drawer.assignDriverHeading')}
                  </h3>
                  <p style={{ fontSize: 13, color: '#444', margin: '0 0 14px 0' }}>
                    {t('timeline.drawer.assignmentHelpLine1')}
                  </p>

                  <Checkbox
                    style={{ marginBottom: 12 }}
                    label={t('timeline.drawer.assignOnlyThisShift')}
                    checked={assignOnlyThisShift}
                    onChange={(e) => setAssignOnlyThisShift(e.currentTarget.checked)}
                  />

                  <div style={{ fontSize: 13, color: '#444', marginBottom: 6 }}>
                    {t('timeline.drawer.driver')}
                  </div>

                  <Select
                    aria-label={t('timeline.drawer.assignDriver')}
                    data={driverSelectOptions.length ? driverSelectOptions : fallbackDrivers}
                    value={editedDriverId}
                    onChange={setEditedDriverId}
                    placeholder={t('common.unassigned')}
                    clearable={false}
                    leftSection={<IconUser size={16} />}
                    renderOption={({ option, checked }) => {
                      const full = driverById.get(String(option.value)) || option;
                      const name = String(full?.name || full?.label || option.label || '').trim();
                      const email = String(full?.email || '').trim();
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div
                              style={{
                                fontSize: 15,
                                lineHeight: 1.25,
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {name}
                            </div>
                            {email ? (
                              <div
                                style={{
                                  fontSize: 11,
                                  lineHeight: 1.1,
                                  color: '#868e96',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {email}
                              </div>
                            ) : null}
                          </div>
                          {checked ? (
                            <div style={{ marginLeft: 12, color: '#1c7ed6', fontSize: 14, fontWeight: 700 }}>✓</div>
                          ) : null}
                        </div>
                      );
                    }}
                    styles={{
                      option: { paddingTop: 10, paddingBottom: 10 },
                    }}
                  />

                  <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                    {(() => {
                      const isUnassign = String(editedDriverId || '').trim() === 'unassigned';
                      const opt = editedDriverId ? driverById.get(String(editedDriverId)) : null;
                      const driverName = opt?.name || (opt?.label ? String(opt.label).split(' (')[0] : '') || '';
                      const assignLabel = isUnassign
                        ? t('timeline.drawer.unassign')
                        : driverName
                        ? `${t('timeline.drawer.assignButton')} ${driverName}`
                        : t('timeline.drawer.assignButton');
                      return (
                        <>
                          <Button
                            loading={isAssigning && assigningMode === 'assign'}
                            disabled={isAssigning || !selectedShiftToken || !editedDriverId || Boolean(selectedShift?.manual)}
                            onClick={() => runAssignment({ withEmail: false })}
                          >
                            {assignLabel}
                          </Button>
                          <Button
                            variant="outline"
                            loading={isAssigning && assigningMode === 'request'}
                            disabled={isAssigning || !editedDriverId || isUnassign || Boolean(selectedShift?.manual)}
                            onClick={() => runAssignment({ withEmail: true })}
                          >
                            {t('timeline.drawer.sendConfirmationEmail')}
                          </Button>
                        </>
                      );
                    })()}
                  </div>

                  {selectedShift?.manual && (
                    <div style={{ marginTop: 8, fontSize: 13, color: '#777' }}>
                      {t('timeline.drawer.manualCannotAssign')}
                    </div>
                  )}

                  {assignError && (
                    <div role="alert" style={{ marginTop: 8, fontSize: 13, color: '#b00020', fontWeight: 600 }}>
                      {assignError}
                    </div>
                  )}
                </div>
              )}

              <hr style={{ margin: '16px 0' }} />

              <h4 style={{ marginBottom: 8, marginTop: 24 }}>{t('timeline.drawer.trips')}</h4>

              {selectedTrips.length === 0 && (
                <p style={{ fontSize: 13, color: '#777' }}>
                  {t('timeline.drawer.noTripsDefined')}
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
      placeholder={t('timeline.drawer.bus')}
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
                                <strong>{ev.time}</strong> — {ev.label}{ev.route ? <span style={{ marginLeft: 6, color: '#888', fontSize: 12 }}>({ev.route})</span> : null}
                              </>
                            ) : (
                              <em>
                                {t('timeline.drawer.break')}{ev.label ? ` (${ev.label})` : ''} — {ev.duration} min
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


