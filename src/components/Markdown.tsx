import { Suspense, lazy } from 'react';
import { Skeleton, cx } from './ui.tsx';

// The Markdown and KaTeX code is heavy and only needed on content pages: load it on demand.
const Renderer = lazy(() => import('./MarkdownRenderer.tsx'));

/**
 * Long-form content. `dir` follows the language of the text, not of the
 * interface, so an Arabic lesson stays right-to-left for a reader using French.
 */
export function Markdown({ source, lang, className }: { source: string; lang?: 'fr' | 'ar'; className?: string }) {
  const arabic = lang ? lang === 'ar' : /[؀-ۿ]/.test(source.slice(0, 400));
  return (
    <div className={cx('prose-bm', className)} dir={arabic ? 'rtl' : 'ltr'} lang={arabic ? 'ar' : 'fr'}>
      <Suspense fallback={<Skeleton lines={5} />}>
        <Renderer source={source} />
      </Suspense>
    </div>
  );
}
