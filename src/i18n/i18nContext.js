import { createContext, useContext } from 'react';

export const I18nContext = createContext({
  lang: 'en',
  setLang: () => undefined,
  t: (key) => key,
  locale: 'en-US',
});

export function useI18n() {
  return useContext(I18nContext);
}
