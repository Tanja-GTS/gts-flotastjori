import { useEffect, useState } from 'react';
import { Popover } from '@mantine/core';
import { fetchClockAlerts } from './data/backendApi';
import { clockWhen } from './domain/clockFormat';
import { useI18n } from './i18n';

const POLL_MS = 60_000;

// Header bell: drivers still clocked in from an earlier day. Yellow dot when
// anyone is listed. "Check Tímon" is plain text for now, not a link.
export default function ClockAlertsBell({ className = '' }) {
  const { t } = useI18n();
  const [alerts, setAlerts] = useState([]);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchClockAlerts()
        .then((list) => {
          if (!cancelled) setAlerts(Array.isArray(list) ? list : []);
        })
        .catch((err) => {
          // Keep the last known list; a failure must still be inspectable.
          console.error('[clock-alerts] fetch failed, keeping last known list:', err);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const hasAlerts = alerts.length > 0;

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" shadow="md" radius={0} offset={0}>
      <Popover.Target>
        <button
          type="button"
          className={`clockBell${opened ? ' is-open' : ''} ${className}`.trim()}
          aria-label={hasAlerts ? t('timeline.clock.alerts.labelWithCount', { count: alerts.length }) : t('timeline.clock.alerts.label')}
          aria-expanded={opened}
          onClick={() => setOpened((o) => !o)}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M14.86 17.08a23.8 23.8 0 0 0 5.45-1.31A8.97 8.97 0 0 1 18 9.75V9a6 6 0 0 0-12 0v.75a8.97 8.97 0 0 1-2.31 6.02c1.73.64 3.56 1.08 5.45 1.31m5.72 0a24.3 24.3 0 0 1-5.72 0m5.72 0a3 3 0 1 1-5.72 0"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {hasAlerts && <span className="clockBell__dot" aria-hidden="true" />}
        </button>
      </Popover.Target>

      <Popover.Dropdown className="clockBell__panel">
        {hasAlerts ? (
          <ul className="clockBell__list">
            {alerts.map((a) => (
              <li key={a.driverId} className="clockBell__item">
                <div className="clockBell__text">{t('timeline.clock.alerts.hasntClockedOut', { name: a.driverName })}</div>
                <div className="clockBell__since">{t('timeline.clock.alerts.since', { when: clockWhen(a.clockInAt, t) })}</div>
                <div className="clockBell__action">→ {t('timeline.clock.alerts.checkTimon')}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="clockBell__empty">{t('timeline.clock.alerts.empty')}</div>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
