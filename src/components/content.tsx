import { useState, type ReactNode } from 'react';
import type { Locale, Provenance } from '@shared/types.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { ProvenanceBadge } from './badges.tsx';
import { cx } from './ui.tsx';

/**
 * Lessons and exercises exist in French and in Arabic. The reader starts in the
 * interface language and can switch the content alone, since many students use
 * one language for the interface and study in the other.
 */
export function useContentLang(): [Locale, ReactNode] {
  const { t, locale } = useI18n();
  const [lang, setLang] = useState<Locale>(locale);
  const option = (value: Locale, label: string) => (
    <button
      type="button"
      lang={value}
      aria-pressed={lang === value}
      onClick={() => setLang(value)}
      className={cx(
        'h-8 rounded-md px-3 text-xs font-medium transition-colors duration-150',
        lang === value ? 'bg-surface text-fg shadow-[0_0_0_1px_var(--line-strong)]' : 'text-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );
  const control = (
    <div role="group" aria-label={t.settings.language} className="inline-flex gap-0.5 rounded-lg bg-panel p-0.5">
      {option('fr', t.common.french)}
      {option('ar', t.common.arabic)}
    </div>
  );
  return [lang, control];
}

/** Picks a bilingual field in a given content language. */
export function inLang<K extends string>(row: { [P in `${K}_fr` | `${K}_ar`]?: string | null }, key: K, lang: Locale): string {
  const data = row as Record<string, string | null | undefined>;
  return data[`${key}_${lang}`] || data[`${key}_${lang === 'ar' ? 'fr' : 'ar'}`] || '';
}

/** Says where a piece of teaching content comes from. Shown above every lesson and correction. */
export function ProvenanceLine({ value, children, className }: { value: Provenance; children: ReactNode; className?: string }) {
  return (
    <p className={cx('flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted', className)}>
      <ProvenanceBadge value={value} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
