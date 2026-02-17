import { Button, Stack, Text, Group } from '@mantine/core';
import { useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { confirmShift, fetchShiftById } from './data/backendApi';
import { notifications } from '@mantine/notifications';
import { useI18n } from './i18n';

export default function ConfirmShift({ shifts, setShifts }) {
  const { lang, setLang, t, locale } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token');
  const localShift = useMemo(() => shifts.find((s) => s.token === token), [shifts, token]);
  const [shift, setShift] = useState(localShift || null);
  const isWeekToken = Boolean(token && token.startsWith('week:'));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setShift(localShift || null);
  }, [localShift]);

  useEffect(() => {
    let cancelled = false;
    if (!token) return () => undefined;

    setIsLoading(true);
    setError('');
    fetchShiftById(token)
      .then((apiShift) => {
        if (cancelled) return;
        if (!apiShift) {
          setShift(null);
          return;
        }
        if (apiShift.kind === 'week') {
          setShift({
            ...apiShift,
            token: apiShift.id,
            driver: apiShift.driverName || 'Unassigned',
            note: '',
          });
          return;
        }

        setShift({
          ...apiShift,
          token: apiShift.id,
          driver: apiShift.driverName || 'Unassigned',
          note: apiShift.notes || '',
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : t('errors.failedLoadShift'));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, t]);

  // Helper: get week range string for the shift's date
  function getWeekRange(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    // Find Monday of the week
    const day = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((day + 6) % 7));
    // Find Sunday of the week
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    // Format as 11–18 Jan
    const options = { day: '2-digit', month: 'short' };
    const start = monday.toLocaleDateString(locale, options);
    const end = sunday.toLocaleDateString(locale, options);
    return `${start} – ${end}`;
  }

  function formatWeekPartLabel(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return '';
    if (s === 'weekdays' || s === 'weekday' || s === 'workdays' || s === 'workday' || s === 'work days') return 'Work days';
    if (s === 'weekend' || s === 'weekends') return 'Weekend';
    return String(raw).trim();
  }

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <h3>{t('confirm.loadingShift')}</h3>
      </div>
    );
  }

  if (!shift) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label={t('lang.label')}
            style={{ padding: '6px 8px' }}
          >
            <option value="en">EN</option>
            <option value="is">ÍS</option>
          </select>
        </div>

        <h3>{t('confirm.invalidLink')}</h3>
        {error && <div style={{ marginTop: 8, color: '#b00020' }}>{error}</div>}
      </div>
    );
  }

  const displayRouteName = shift.routeName || shift.route || '';
  const displayRoute = shift.route || '';

  const updateStatus = async (nextStatus) => {
    if (!token) return;
    setIsSaving(true);
    setError('');
    try {
      const res = await confirmShift({ shiftId: token, status: nextStatus });
      const updated = res?.shift
        ? {
            ...res.shift,
            token: res.shift.id,
            driver: res.shift.driverName || 'Unassigned',
            note: res.shift.notes || '',
          }
        : { ...shift, confirmationStatus: nextStatus };

      setShift(updated);

      const updatedIds = new Set(res?.updatedIds || [token]);
      setShifts((prev) =>
        prev.map((s) => (updatedIds.has(s.token) ? { ...s, confirmationStatus: nextStatus } : s))
      );

      notifications.show({
        title:
          nextStatus === 'accepted'
            ? isWeekToken
              ? t('confirm.weekAccepted')
              : t('confirm.shiftAccepted')
            : isWeekToken
              ? t('confirm.weekDeclined')
              : t('confirm.shiftDeclined'),
        message: t('confirm.responseSaved'),
        color: nextStatus === 'accepted' ? 'green' : 'red',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('confirm.failedToUpdate'));
      notifications.show({
        title: t('confirm.couldNotUpdate'),
        message: e instanceof Error ? e.message : t('confirm.failedToUpdate'),
        color: 'red',
      });
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <Stack
      align="center"
      justify="center"
      style={{ minHeight: '100vh', padding: 24 }}
      gap="lg"
    >
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', justifyContent: 'flex-end' }}>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          aria-label={t('lang.label')}
          style={{ padding: '6px 8px' }}
        >
          <option value="en">EN</option>
          <option value="is">ÍS</option>
        </select>
      </div>

      <Text size="xl" fw={600}>
        {t('confirm.title')}
      </Text>

      {/* Assignment summary */}
      <Text size="md" fw={500}>
        {t('confirm.greeting', { name: shift.driver === 'Unassigned' ? t('common.driver') : shift.driver })}
        <br />
        {shift.kind === 'week' ? (
          <>
            {(() => {
              const weekPartLabel = formatWeekPartLabel(shift.weekPart);
              const weekPartPart = weekPartLabel ? ` ${weekPartLabel}` : '';
              return t('confirm.assignedWeek', {
                routeName: displayRouteName,
                routeCodePart:
                  displayRouteName && displayRoute && displayRouteName !== displayRoute
                    ? ` (${displayRoute})`
                    : displayRoute
                      ? ` (${displayRoute})`
                      : '',
                shiftType: shift.shiftType,
                weekRange: getWeekRange(shift.weekStart || shift.date),
                weekPartPart,
              });
            })()}
          </>
        ) : (
          <>
            {(() => {
              const weekPartLabel = formatWeekPartLabel(shift.weekPart);
              const weekPartPart = weekPartLabel ? ` ${weekPartLabel}` : '';
              return t('confirm.assignedShift', {
                routeName: displayRouteName,
                routeCodePart:
                  displayRouteName && displayRoute && displayRouteName !== displayRoute
                    ? ` (${displayRoute})`
                    : displayRoute
                      ? ` (${displayRoute})`
                      : '',
                time: shift.time,
                weekRange: getWeekRange(shift.date),
                weekPartPart,
              });
            })()}
          </>
        )}
      </Text>

      <Text size="sm" c="dimmed">
        {shift.kind === 'week' ? t('confirm.promptWeek') : t('confirm.promptShift')}
      </Text>

      {shift.kind === 'week' && Array.isArray(shift.shifts) && shift.shifts.length > 0 && (
        <div style={{ width: '100%', maxWidth: 720, border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
          <Text size="sm" fw={600} style={{ marginBottom: 8 }}>
            {t('confirm.shiftsInWeek')}
          </Text>
          <div style={{ fontSize: 13, color: '#333' }}>
            {shift.shifts.map((s) => (
              <div key={s.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid #f2f2f2' }}>
                <div style={{ width: 110 }}>{s.date}</div>
                <div style={{ width: 160 }}>{s.routeName || s.route}</div>
                <div style={{ width: 90 }}>{s.shiftType}</div>
                <div style={{ flex: 1 }}>{s.time}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Group grow style={{ width: '100%', maxWidth: 400 }}>
        <Button
          size="xl"
          color="green"
          loading={isSaving}
          onClick={() => updateStatus('accepted')}
        >
          {shift.kind === 'week' ? t('confirm.acceptWeek') : t('confirm.acceptShift')}
        </Button>

        <Button
          size="xl"
          color="red"
          loading={isSaving}
          onClick={() => updateStatus('declined')}
        >
          {shift.kind === 'week' ? t('confirm.declineWeek') : t('confirm.declineShift')}
        </Button>
      </Group>

      {error && (
        <Text size="sm" c="red" style={{ maxWidth: 520, textAlign: 'center' }}>
          {error}
        </Text>
      )}

      <Text size="sm" c="dimmed">
        {t('confirm.currentStatus')} <strong>{shift.confirmationStatus}</strong>
      </Text>

      <Text size="xs" c="dimmed">
        {t('confirm.tokenLabel')} {token}
      </Text>
    </Stack>
  );
}
