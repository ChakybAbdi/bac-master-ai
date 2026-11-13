import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { IconAdmin, IconArchive, IconChevron, IconPlanner, IconSettings, IconSignOut, IconSubjects } from '@/components/icons.ts';
import { LanguageButton } from '@/components/Shell.tsx';
import { Button, ErrorNotice, Field, Input, PageHeader, Section, Select, cx } from '@/components/ui.tsx';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMe, useMeta, useSignOut, useTheme, useUpdateProfile, type ThemeChoice } from '@/lib/session.tsx';

export function SettingsPage() {
  const { t, pick, locale, setLocale } = useI18n();
  const me = useMe();
  const meta = useMeta();
  const client = useQueryClient();
  const update = useUpdateProfile();
  const signOut = useSignOut();
  const theme = useTheme();
  const user = me.data;

  const [name, setName] = useState(user?.name ?? '');
  const [editionId, setEditionId] = useState(String(user?.edition_id ?? ''));
  const [streamId, setStreamId] = useState(String(user?.stream_id ?? ''));
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  const remove = useMutation({
    mutationFn: () => api('/me/delete', { body: { password } }),
    onSuccess: () => {
      client.clear();
      client.setQueryData(['me'], null);
    },
  });

  if (!user) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      { name: name.trim(), edition_id: editionId ? Number(editionId) : undefined, stream_id: streamId ? Number(streamId) : null },
      { onSuccess: () => setSaved(true) },
    );
  };

  const themes: [ThemeChoice, string][] = [
    ['system', t.settings.themeSystem],
    ['light', t.settings.themeLight],
    ['dark', t.settings.themeDark],
  ];

  return (
    <>
      <PageHeader title={t.settings.title} />
      <div className="max-w-xl space-y-10">
        <Section title={t.settings.profile}>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t.settings.name}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.settings.session}>
                {(p) => (
                  <Select {...p} value={editionId} onChange={(e) => setEditionId(e.target.value)}>
                    {meta.data?.editions.map((e) => (
                      <option key={e.id} value={e.id}>
                        BAC {e.exam_year} ({t.editionStatus[e.status]})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t.settings.stream}>
                {(p) => (
                  <Select {...p} value={streamId} onChange={(e) => setStreamId(e.target.value)}>
                    <option value="">{t.settings.noStream}</option>
                    {meta.data?.streams.map((s) => (
                      <option key={s.id} value={s.id}>
                        {pick(s, 'name')}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <ErrorNotice error={update.error} />
            <div className="flex items-center gap-3">
              <Button type="submit" loading={update.isPending} disabled={name.trim().length < 2}>
                {t.common.save}
              </Button>
              <span aria-live="polite" className="text-sm text-ok">
                {saved ? t.common.saved : ''}
              </span>
            </div>
          </form>
        </Section>

        <Section title={t.settings.language}>
          <div role="group" aria-label={t.settings.language} className="inline-flex gap-0.5 rounded-lg bg-panel p-0.5">
            {(['fr', 'ar'] as const).map((code) => (
              <button
                key={code}
                type="button"
                lang={code}
                aria-pressed={locale === code}
                onClick={() => {
                  setLocale(code);
                  update.mutate({ locale: code });
                }}
                className={cx(
                  'h-9 rounded-md px-4 text-sm font-medium transition-colors duration-150',
                  locale === code ? 'bg-surface text-fg shadow-[0_0_0_1px_var(--line-strong)]' : 'text-muted hover:text-fg',
                )}
              >
                {code === 'fr' ? t.common.french : t.common.arabic}
              </button>
            ))}
          </div>
        </Section>

        <Section title={t.settings.theme}>
          <div role="group" aria-label={t.settings.theme} className="inline-flex gap-0.5 rounded-lg bg-panel p-0.5">
            {themes.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme.choice === value}
                onClick={() => theme.setChoice(value)}
                className={cx(
                  'h-9 rounded-md px-4 text-sm font-medium transition-colors duration-150',
                  theme.choice === value ? 'bg-surface text-fg shadow-[0_0_0_1px_var(--line-strong)]' : 'text-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section title={t.settings.account}>
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted">{t.settings.email} :</dt>
              <dd dir="ltr" className="text-fg">
                {user.email}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">{t.settings.role} :</dt>
              <dd className="text-fg">{t.roles[user.role]}</dd>
            </div>
          </dl>
          <Button variant="secondary" className="mt-4" loading={signOut.isPending} onClick={() => signOut.mutate()}>
            {t.nav.signOut}
          </Button>
        </Section>

        {user.role === 'student' && (
          <Section title={t.settings.deleteTitle} lead={t.settings.deleteText}>
            {deleting ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  remove.mutate();
                }}
              >
                <Field label={t.settings.deleteConfirm}>
                  {(p) => (
                    <Input {...p} type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  )}
                </Field>
                <ErrorNotice error={remove.error} />
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" disabled={!password} loading={remove.isPending}>
                    {t.settings.deleteButton}
                  </Button>
                  <Button variant="ghost" onClick={() => setDeleting(false)}>
                    {t.common.cancel}
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                {t.settings.deleteTitle}
              </Button>
            )}
          </Section>
        )}
      </div>
    </>
  );
}

/** Small screens: the destinations that do not fit in the bottom bar. */
export function MorePage() {
  const { t } = useI18n();
  const me = useMe();
  const signOut = useSignOut();
  const staff = me.data ? me.data.role !== 'student' : false;
  const links = [
    { to: '/subjects', label: t.nav.subjects, icon: IconSubjects },
    { to: '/planner', label: t.nav.planner, icon: IconPlanner },
    { to: '/archive', label: t.nav.archive, icon: IconArchive },
    { to: '/settings', label: t.nav.settings, icon: IconSettings },
    ...(staff ? [{ to: '/admin', label: t.nav.admin, icon: IconAdmin }] : []),
  ];
  return (
    <>
      <PageHeader title={t.nav.more} />
      <ul className="divide-y divide-line border-y border-line">
        {links.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="flex items-center justify-between gap-4 py-4 text-fg">
              <span className="flex items-center gap-3 font-medium">
                <Icon aria-hidden className="size-5 text-muted" />
                {label}
              </span>
              <IconChevron aria-hidden className="size-4 text-subtle rtl:-scale-x-100" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <LanguageButton className="border border-line-strong bg-surface" />
        <Button variant="secondary" icon={<IconSignOut aria-hidden className="size-4 rtl:-scale-x-100" />} onClick={() => signOut.mutate()}>
          {t.nav.signOut}
        </Button>
      </div>
    </>
  );
}
