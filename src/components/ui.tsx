import type { UseQueryResult } from '@tanstack/react-query';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link, type LinkProps } from 'react-router';
import { useI18n } from '@/lib/i18n.tsx';
import { useErrorMessage } from '@/lib/session.tsx';
import { IconAlert, IconCircleCheck, IconExternal, IconInfo, IconLoader, IconWarning } from './icons.ts';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// --- Buttons -------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap select-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SIZE: Record<Size, { box: string; pad: string }> = {
  md: { box: 'h-11 text-sm sm:h-10', pad: 'px-4' },
  sm: { box: 'h-9 text-[0.8125rem] sm:h-8', pad: 'px-3' },
};

/**
 * Tailwind resolves two utilities for the same property by stylesheet order,
 * not by their order in the class attribute. Defaults are therefore only added
 * when the caller did not set that property itself.
 */
const tokens = (className?: string): string[] => (className ?? '').split(/\s+/).filter(Boolean);
const sets = (own: string[], prefix: RegExp): boolean => own.some((t) => prefix.test(t));
const BUTTON_VARIANT: Record<Variant, string> = {
  primary: 'bg-ink text-ink-fg hover:bg-ink-hover',
  secondary: 'border border-line-strong bg-surface text-fg hover:bg-panel',
  ghost: 'text-muted hover:bg-panel hover:text-fg',
  danger: 'border border-bad-line bg-surface text-bad hover:bg-bad-soft',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string): string {
  const own = tokens(extra);
  return cx(BUTTON_BASE, BUTTON_SIZE[size].box, !sets(own, /^px-/) && BUTTON_SIZE[size].pad, BUTTON_VARIANT[variant], extra);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant, size, loading, icon, children, className, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <IconLoader aria-hidden className={cx('size-4 animate-spin-slow', className)} />;
}

// --- Form controls ---------------------------------------------------------------

const CONTROL =
  'rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none disabled:bg-panel disabled:text-muted aria-[invalid=true]:border-bad';

function controlClass(className: string | undefined, defaults: { height?: string; minHeight?: string }): string {
  const own = tokens(className);
  return cx(
    CONTROL,
    !sets(own, /^w-/) && 'w-full',
    defaults.height && !sets(own, /^h-/) && defaults.height,
    defaults.minHeight && !sets(own, /^min-h-/) && defaults.minHeight,
    className,
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={controlClass(className, { height: 'h-11 sm:h-10' })} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(controlClass(className, { minHeight: 'min-h-24' }), 'py-2 leading-relaxed')} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(controlClass(className, { height: 'h-11 sm:h-10' }), 'pe-8')} {...rest}>
      {children}
    </select>
  );
}

/** "a / b", kept left-to-right so that it does not read backwards inside Arabic text. */
export function Ratio({ value, total, className }: { value: ReactNode; total: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cx('tabular', className)}>
      {value} / {total}
    </span>
  );
}

/** A labelled control. `children` receives the ids to wire the label, hint and error. */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

// --- Feedback ---------------------------------------------------------------------

type Tone = 'info' | 'ok' | 'warn' | 'bad';

const NOTICE_TONE: Record<Tone, string> = {
  info: 'border-line bg-panel',
  ok: 'border-ok-line bg-ok-soft',
  warn: 'border-warn-line bg-warn-soft',
  bad: 'border-bad-line bg-bad-soft',
};
const NOTICE_ICON: Record<Tone, ReactNode> = {
  info: <IconInfo aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />,
  ok: <IconCircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />,
  warn: <IconWarning aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />,
  bad: <IconAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-bad" />,
};

export function Notice({
  tone = 'info',
  title,
  children,
  className,
  role,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}) {
  return (
    <div role={role} className={cx('flex gap-3 rounded-xl border px-4 py-3 text-sm', NOTICE_TONE[tone], className)}>
      {NOTICE_ICON[tone]}
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold text-fg">{title}</p>}
        {children && <div className="text-fg/90">{children}</div>}
      </div>
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const message = useErrorMessage();
  if (!error) return null;
  return (
    <Notice tone="bad" role="alert">
      <p>{message(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          {t.common.retry}
        </Button>
      )}
    </Notice>
  );
}

export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t.common.loading} className={cx('space-y-3', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse-soft rounded bg-panel"
          style={{ width: `${[92, 78, 85, 60, 88, 70][i % 6]}%` }}
        />
      ))}
    </div>
  );
}

/** Renders a query's loading and error states, then its data. */
export function Async<T>({
  query,
  lines,
  children,
}: {
  query: UseQueryResult<T>;
  lines?: number;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Skeleton lines={lines ?? 4} />;
  if (query.isError) return <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line-strong px-5 py-6">
      {icon && <div className="text-subtle [&>svg]:size-5">{icon}</div>}
      <p className="font-medium text-fg">{title}</p>
      {children && <div className="max-w-prose text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// --- Layout pieces ------------------------------------------------------------------

export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {lead && <p className="mt-1.5 max-w-prose text-sm text-muted">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  lead,
  action,
  children,
  className,
}: {
  title: string;
  lead?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-base font-semibold text-fg">
          {title}
        </h2>
        {action}
      </div>
      {lead && <p className="mb-3 max-w-prose text-sm text-muted">{lead}</p>}
      {children}
    </section>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cx(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors duration-150',
              selected ? 'border-ink font-semibold text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="tabular rounded-full bg-accent-soft px-1.5 text-xs font-semibold text-accent">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cx('inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline', className)}
    >
      {children}
      <IconExternal aria-hidden className="size-3.5 shrink-0" />
      <span className="sr-only">({t.common.newTab})</span>
    </a>
  );
}

/** A small anchored panel that closes on outside click or Escape. */
export function Popover({
  label,
  trigger,
  children,
  className,
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-panel hover:text-fg"
      >
        {trigger}
      </button>
      {open && (
        <div
          className={cx(
            'absolute end-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-enter rounded-xl border border-line bg-surface p-2 shadow-pop',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Label and value on one line, used for record and document metadata. */
export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}
