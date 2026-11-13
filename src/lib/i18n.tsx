import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '@shared/types.ts';
import { ar } from '@/i18n/ar.ts';
import { fr, type Dict } from '@/i18n/fr.ts';

const DICTS: Record<Locale, Dict> = { fr, ar };
const STORAGE_KEY = 'bm.locale';

type Localized<K extends string> = { [P in `${K}_fr` | `${K}_ar`]?: string | null };

interface I18n {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: Dict;
  setLocale: (locale: Locale) => void;
  /** Picks the field of the current language, falling back to the other one. */
  pick: <K extends string>(row: Localized<K>, key: K) => string;
  /** Formats an ISO date or timestamp for display (Algerian conventions, Western digits). */
  date: (iso: string | null | undefined, style?: 'long' | 'short' | 'weekday') => string;
  number: (n: number, digits?: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

function initialLocale(): Locale {
  const fromDom = document.documentElement.lang;
  return fromDom === 'ar' ? 'ar' : 'fr';
}

const DATE_STYLES: Record<'long' | 'short' | 'weekday', Intl.DateTimeFormatOptions> = {
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  short: { day: 'numeric', month: 'short' },
  weekday: { weekday: 'long', day: 'numeric', month: 'long' },
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.title = DICTS[locale].app.name;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Storage is optional.
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);

  const value = useMemo<I18n>(() => {
    // fr-DZ and ar-DZ both use Western digits; ar-DZ uses the month names used in Algeria (جانفي, فيفري...).
    const tag = locale === 'ar' ? 'ar-DZ' : 'fr-DZ';
    return {
      locale,
      dir: locale === 'ar' ? 'rtl' : 'ltr',
      t: DICTS[locale],
      setLocale,
      pick: (row, key) => {
        const data = row as Record<string, string | null | undefined>;
        const other = locale === 'ar' ? 'fr' : 'ar';
        return data[`${key}_${locale}`] || data[`${key}_${other}`] || '';
      },
      date: (iso, style = 'long') => {
        if (!iso) return '';
        // A bare date is anchored at noon UTC so that no time zone can shift the day.
        const value = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
        if (Number.isNaN(value.getTime())) return iso;
        return new Intl.DateTimeFormat(tag, { ...DATE_STYLES[style], timeZone: 'Africa/Algiers' }).format(value);
      },
      number: (n, digits = 2) =>
        new Intl.NumberFormat(tag, { maximumFractionDigits: digits, numberingSystem: 'latn' }).format(n),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
