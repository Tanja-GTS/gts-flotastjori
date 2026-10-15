import { useState } from 'react';
import { Popover } from '@mantine/core';
import { useI18n } from './i18n';

// Header bell. Nothing feeds it yet - it is kept for future notifications,
// and shows a yellow dot only when `items` is non-empty.
export default function NotificationsBell({ items = [], className = '' }) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  const hasItems = items.length > 0;

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" shadow="md" radius={0} offset={0}>
      <Popover.Target>
        <button
          type="button"
          className={`clockBell${opened ? ' is-open' : ''} ${className}`.trim()}
          aria-label={t('notifications.label')}
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
          {hasItems && <span className="clockBell__dot" aria-hidden="true" />}
        </button>
      </Popover.Target>

      <Popover.Dropdown className="clockBell__panel">
        {hasItems ? (
          <ul className="clockBell__list">
            {items.map((item) => (
              <li key={item.id} className="clockBell__item">
                <div className="clockBell__text">{item.text}</div>
                {item.detail ? <div className="clockBell__since">{item.detail}</div> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="clockBell__empty">{t('notifications.empty')}</div>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
