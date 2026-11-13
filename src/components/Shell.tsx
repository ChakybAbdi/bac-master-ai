import { useQuery } from '@tanstack/react-query';
import type { ComponentType, SVGProps } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import type { Announcement } from '@shared/types.ts';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMe, useMeta, useSignOut, useTheme, useUpdateProfile } from '@/lib/session.tsx';
import {
  IconAdmin,
  IconArchive,
  IconBell,
  IconHome,
  IconLanguages,
  IconLearn,
  IconMoon,
  IconMore,
  IconOfficial,
  IconPlanner,
  IconSettings,
  IconSignOut,
  IconSimulator,
  IconSubjects,
  IconSun,
  IconTutor,
  IconUser,
} from './icons.ts';
import { Popover, cx } from './ui.tsx';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
type NavKey = 'home' | 'official' | 'subjects' | 'learn' | 'simulator' | 'planner' | 'tutor' | 'archive';

export const DESTINATIONS: { to: string; key: NavKey; icon: Icon; end?: boolean }[] = [
  { to: '/', key: 'home', icon: IconHome, end: true },
  { to: '/official', key: 'official', icon: IconOfficial },
  { to: '/subjects', key: 'subjects', icon: IconSubjects },
  { to: '/learn', key: 'learn', icon: IconLearn },
  { to: '/simulator', key: 'simulator', icon: IconSimulator },
  { to: '/planner', key: 'planner', icon: IconPlanner },
  { to: '/tutor', key: 'tutor', icon: IconTutor },
  { to: '/archive', key: 'archive', icon: IconArchive },
];
const MOBILE_TABS: NavKey[] = ['home', 'official', 'learn', 'simulator', 'tutor'];

/** The product mark: a dashed seal with a check, the shape of a verification stamp. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={cx('inline-flex items-center gap-2 font-semibold tracking-tight text-fg', className)}>
      <svg viewBox="0 0 24 24" aria-hidden className="size-6 shrink-0">
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="1.6 2.4" strokeLinecap="round" />
        <path d="M7.8 12.3l2.9 2.9 5.6-6.3" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>BAC MASTER AI</span>
    </span>
  );
}

export function LanguageButton({ className }: { className?: string }) {
  const { t, locale, setLocale } = useI18n();
  const me = useMe();
  const update = useUpdateProfile();
  const next = locale === 'fr' ? 'ar' : 'fr';
  return (
    <button
      type="button"
      lang={next}
      aria-label={t.nav.switchLanguage}
      onClick={() => {
        setLocale(next);
        if (me.data) update.mutate({ locale: next });
      }}
      className={cx(
        'inline-flex h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-panel hover:text-fg',
        className,
      )}
    >
      <IconLanguages aria-hidden className="size-4" />
      {next === 'ar' ? t.common.arabic : t.common.french}
    </button>
  );
}

export function ThemeButton() {
  const { t } = useI18n();
  const { resolved, setChoice } = useTheme();
  const dark = resolved === 'dark';
  return (
    <button
      type="button"
      aria-label={dark ? t.nav.themeToLight : t.nav.themeToDark}
      onClick={() => setChoice(dark ? 'light' : 'dark')}
      className="inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-panel hover:text-fg"
    >
      {dark ? <IconSun aria-hidden className="size-[1.125rem]" /> : <IconMoon aria-hidden className="size-[1.125rem]" />}
    </button>
  );
}

function Notifications() {
  const { t, pick, date } = useI18n();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ unread: number; items: Announcement[] }>('/notifications'),
    refetchInterval: 5 * 60_000,
  });
  const unread = query.data?.unread ?? 0;
  return (
    <Popover
      label={unread > 0 ? `${t.nav.notifications} (${t.nav.unread(unread)})` : t.nav.notifications}
      trigger={
        <>
          <IconBell aria-hidden className="size-[1.125rem]" />
          {unread > 0 && (
            <span className="tabular absolute end-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] leading-4 font-semibold text-accent-fg">
              {unread}
            </span>
          )}
        </>
      }
    >
      {(close) => (
        <div>
          <p className="px-2 pt-1 pb-2 text-xs font-semibold text-muted">{t.nav.notifications}</p>
          {(query.data?.items.length ?? 0) === 0 ? (
            <p className="px-2 pb-2 text-sm text-muted">{t.nav.noNotifications}</p>
          ) : (
            <ul>
              {query.data!.items.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <Link
                    to="/official?tab=announcements"
                    onClick={close}
                    className="flex gap-2 rounded-lg px-2 py-2 text-sm transition-colors duration-150 hover:bg-panel"
                  >
                    <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', a.read_at ? 'bg-transparent' : 'bg-accent')} />
                    <span className="min-w-0">
                      <span className={cx('block', a.read_at ? 'text-fg' : 'font-semibold text-fg')}>{pick(a, 'title')}</span>
                      <span className="block text-xs text-muted">{date(a.published_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/official?tab=announcements"
            onClick={close}
            className="mt-1 block rounded-lg px-2 py-2 text-sm font-medium text-accent hover:bg-panel"
          >
            {t.nav.seeAll}
          </Link>
        </div>
      )}
    </Popover>
  );
}

function UserMenu() {
  const { t } = useI18n();
  const me = useMe();
  const signOut = useSignOut();
  const user = me.data;
  if (!user) return null;
  const staff = user.role !== 'student';
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-fg transition-colors duration-150 hover:bg-panel';
  return (
    <Popover label={user.name} trigger={<IconUser aria-hidden className="size-[1.125rem]" />} className="w-64">
      {(close) => (
        <div>
          <div className="border-b border-line px-2 pt-1 pb-3">
            <p className="truncate text-sm font-semibold text-fg">{user.name}</p>
            <p dir="ltr" className="truncate text-start text-xs text-muted">
              {user.email}
            </p>
            {staff && <p className="mt-1 text-xs font-medium text-accent">{t.roles[user.role]}</p>}
          </div>
          <div className="pt-2">
            <Link to="/settings" onClick={close} className={item}>
              <IconSettings aria-hidden className="size-4 text-muted" />
              {t.nav.settings}
            </Link>
            {staff && (
              <Link to="/admin" onClick={close} className={item}>
                <IconAdmin aria-hidden className="size-4 text-muted" />
                {t.nav.admin}
              </Link>
            )}
            <button type="button" className={item} onClick={() => signOut.mutate()}>
              <IconSignOut aria-hidden className="size-4 text-muted rtl:-scale-x-100" />
              {t.nav.signOut}
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

export function Shell() {
  const { t, pick } = useI18n();
  const me = useMe();
  const meta = useMeta();
  const user = me.data;
  const staff = user ? user.role !== 'student' : false;
  const edition = meta.data?.editions.find((e) => e.id === user?.edition_id);
  const stream = meta.data?.streams.find((s) => s.id === user?.stream_id);

  const sideLink = ({ isActive }: { isActive: boolean }) =>
    cx(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
      isActive ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-surface hover:text-fg',
    );

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {t.app.skip}
      </a>

      <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 flex-col border-e border-line bg-panel lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link to="/" aria-label={t.app.name}>
            <Wordmark />
          </Link>
        </div>
        <nav aria-label={t.nav.primary} className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {DESTINATIONS.map(({ to, key, icon: Icon, end }) => (
            <NavLink key={key} to={to} end={end} className={sideLink}>
              <Icon aria-hidden className="size-[1.125rem] shrink-0" />
              {t.nav[key]}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-0.5 border-t border-line px-3 py-3">
          {staff && (
            <NavLink to="/admin" className={sideLink}>
              <IconAdmin aria-hidden className="size-[1.125rem] shrink-0" />
              {t.nav.admin}
            </NavLink>
          )}
          <NavLink to="/settings" className={sideLink}>
            <IconSettings aria-hidden className="size-[1.125rem] shrink-0" />
            {t.nav.settings}
          </NavLink>
        </div>
      </aside>

      <div className="lg:ps-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg px-4 sm:px-6 lg:h-16 lg:px-8">
          <Link to="/" aria-label={t.app.name} className="lg:hidden">
            <Wordmark className="text-[0.9375rem]" />
          </Link>
          <p className="hidden min-w-0 truncate text-sm text-muted lg:block">
            {edition ? t.dashboard.context(edition.exam_year, stream ? pick(stream, 'name') : t.dashboard.noStream) : ''}
          </p>
          <div className="flex items-center gap-0.5">
            <LanguageButton className="hidden sm:inline-flex" />
            <ThemeButton />
            <Notifications />
            <UserMenu />
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-5xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-12">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label={t.nav.primary}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-6">
          {DESTINATIONS.filter((d) => MOBILE_TABS.includes(d.key)).map(({ to, key, icon: Icon, end }) => (
            <li key={key}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx(
                    'flex h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] leading-tight transition-colors duration-150',
                    isActive ? 'font-semibold text-accent' : 'text-muted',
                  )
                }
              >
                <Icon aria-hidden className="size-5" />
                <span className="max-w-full truncate px-0.5">{key === 'official' ? t.nav.officialShort : t.nav[key]}</span>
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink
              to="/more"
              className={({ isActive }) =>
                cx(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] leading-tight transition-colors duration-150',
                  isActive ? 'font-semibold text-accent' : 'text-muted',
                )
              }
            >
              <IconMore aria-hidden className="size-5" />
              <span>{t.nav.more}</span>
            </NavLink>
          </li>
        </ul>
      </nav>
    </div>
  );
}
