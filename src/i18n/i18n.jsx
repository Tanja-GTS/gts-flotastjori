import React, { useCallback, useMemo, useState } from 'react';
import { translations } from './translations';
import { I18nContext } from './i18nContext.js';

const STORAGE_KEY = 'fleetScheduler.lang';

function getInitialLang() {
  const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
  if (stored === 'en' || stored === 'is') return stored;

  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  if (String(nav).toLowerCase().startsWith('is')) return 'is';
  return 'en';
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
    const normalized = next === 'is' ? 'is' : 'en';
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

      if (typeof raw === 'string') return interpolate(raw, vars);
      return raw;
    },
    [lang]
  );

  const locale = lang === 'is' ? 'is-IS' : 'en-US';

  const value = useMemo(() => ({ lang, setLang, t, locale }), [lang, setLang, t, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
