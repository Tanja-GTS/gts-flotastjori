import React, { useCallback, useMemo, useState } from 'react';
import { translations } from './translations';
import { I18nContext } from './i18nContext.js';

const STORAGE_KEY = 'fleetScheduler.lang';

function normalizeLang(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'is' || raw.startsWith('is-') || raw.startsWith('í')) return 'is';
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  return 'en';
}

function getInitialLang() {
  const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
  if (stored) return normalizeLang(stored);

  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return normalizeLang(nav);
}

function interpolate(template, vars) {
  if (!vars) return template;
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}

function getByPath(obj, path) {
  if (!obj) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(getInitialLang);

  const setLang = useCallback((next) => {
    const normalized = normalizeLang(next);
    setLangState(normalized);
    try {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key, vars) => {
      const langTable = translations[lang] || {};
      const enTable = translations.en || {};

      const raw = getByPath(langTable, key) ?? getByPath(enTable, key) ?? key;

      // Minimal plural support: allow translation leaf values to be
      // { one: '...', other: '...' } and select based on vars.count.
      if (
        raw &&
        typeof raw === 'object' &&
        Array.isArray(raw) === false &&
        (Object.prototype.hasOwnProperty.call(raw, 'one') || Object.prototype.hasOwnProperty.call(raw, 'other'))
      ) {
        const count = Number(vars?.count);
        const form = count === 1 ? raw.one : raw.other;
        if (typeof form === 'string') return interpolate(form, vars);
      }

      if (typeof raw === 'string') return interpolate(raw, vars);
      return raw;
    },
    [lang]
  );

  const locale = lang === 'is' ? 'is-IS' : 'en-US';

  const value = useMemo(() => ({ lang, setLang, t, locale }), [lang, setLang, t, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
