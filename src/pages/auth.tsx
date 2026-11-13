import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { User } from '@shared/types.ts';
import { Link, useNavigate } from 'react-router';
import { ProvenanceBadge, VerificationBadge } from '@/components/badges.tsx';
import { LanguageButton, ThemeButton, Wordmark } from '@/components/Shell.tsx';
import { Async, Button, ErrorNotice, Field, Input, Notice, cx } from '@/components/ui.tsx';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMe, useMeta, useSignIn, useUpdateProfile } from '@/lib/session.tsx';

function AuthLayout({ title, lead, children, footer }: { title: string; lead: string; children: ReactNode; footer: ReactNode }) {
  const { t } = useI18n();
  const examples = [
    <VerificationBadge key="v" level="VERIFIED" />,
    <VerificationBadge key="u" level="UNVERIFIED" />,
    <ProvenanceBadge key="a" value="AI_GENERATED" />,
  ];
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      <div className="flex flex-col px-5 py-5 sm:px-10">
        <div className="flex items-center justify-between">
          <Wordmark />
          <div className="flex items-center">
            <LanguageButton />
            <ThemeButton />
          </div>
        </div>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{lead}</p>
          <div className="mt-7">{children}</div>
          <p className="mt-6 text-sm text-muted">{footer}</p>
        </main>
      </div>
      <aside className="hidden flex-col justify-center border-s border-line bg-panel px-12 lg:flex">
        <h2 className="max-w-xs text-xl leading-snug font-semibold text-fg">{t.auth.promiseTitle}</h2>
        <ul className="mt-8 space-y-6">
          {t.auth.promise.map((line, i) => (
            <li key={line} className="space-y-2">
              {examples[i]}
              <p className="max-w-sm text-sm leading-relaxed text-muted">{line}</p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const signIn = useSignIn('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate({ email, password }, { onSuccess: () => navigate('/', { replace: true }) });
  };

  return (
    <AuthLayout
      title={t.auth.signInTitle}
      lead={t.auth.signInLead}
      footer={
        <>
          {t.auth.noAccount}{' '}
          <Link to="/register" className="font-medium text-accent underline-offset-4 hover:underline">
            {t.auth.registerTitle}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t.auth.email}>
          {(p) => (
            <Input {...p} type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label={t.auth.password}>
          {(p) => (
            <Input
              {...p}
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <ErrorNotice error={signIn.error} />
        <Button type="submit" className="w-full" loading={signIn.isPending} disabled={!email || !password}>
          {t.auth.signIn}
        </Button>
        <p className="text-xs leading-relaxed text-muted">{t.auth.forgot}</p>
      </form>
    </AuthLayout>
  );
}

/** Sets a new password from a one-time link (/reset#<token>) issued by an administrator. */
export function ResetPasswordPage() {
  const { t, setLocale } = useI18n();
  const navigate = useNavigate();
  const client = useQueryClient();
  // The token travels in the fragment, so it never reaches server logs or a Referer header.
  const [token] = useState(() => window.location.hash.slice(1));
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => api<{ user: User }>('/auth/reset', { body: { token, password } }),
    onSuccess: ({ user }) => {
      client.clear();
      client.setQueryData(['me'], user);
      setLocale(user.locale);
      window.history.replaceState(null, '', '/reset');
      navigate('/', { replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    reset.mutate();
  };

  return (
    <AuthLayout
      title={t.auth.resetTitle}
      lead={t.auth.resetLead}
      footer={
        <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          {t.auth.backToLogin}
        </Link>
      }
    >
      {token.length < 20 ? (
        <Notice tone="warn">{t.auth.resetMissing}</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label={t.auth.newPassword} hint={t.auth.passwordHint}>
            {(p) => (
              <Input
                {...p}
                type="password"
                dir="ltr"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <ErrorNotice error={reset.error} />
          <Button type="submit" className="w-full" loading={reset.isPending} disabled={password.length < 8}>
            {t.auth.resetSubmit}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const signUp = useSignIn('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signUp.mutate({ name, email, password, locale }, { onSuccess: () => navigate('/onboarding', { replace: true }) });
  };

  return (
    <AuthLayout
      title={t.auth.registerTitle}
      lead={t.auth.registerLead}
      footer={
        <>
          {t.auth.haveAccount}{' '}
          <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
            {t.auth.signInTitle}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t.auth.name}>
          {(p) => <Input {...p} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t.auth.email}>
          {(p) => (
            <Input {...p} type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label={t.auth.password} hint={t.auth.passwordHint}>
          {(p) => (
            <Input
              {...p}
              type="password"
              dir="ltr"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <ErrorNotice error={signUp.error} />
        <Button
          type="submit"
          className="w-full"
          loading={signUp.isPending}
          disabled={name.trim().length < 2 || !email || password.length < 8}
        >
          {t.auth.register}
        </Button>
      </form>
    </AuthLayout>
  );
}

const CHOICE =
  'flex cursor-pointer items-center gap-3 rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm transition-colors duration-150 hover:bg-panel has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent';

export function OnboardingPage() {
  const { t, pick, locale } = useI18n();
  const navigate = useNavigate();
  const me = useMe();
  const meta = useMeta();
  const update = useUpdateProfile();
  const [editionId, setEditionId] = useState<number | null>(me.data?.edition_id ?? null);
  const [streamId, setStreamId] = useState<number | null>(me.data?.stream_id ?? null);
  // Until the student picks one, the session being prepared this year is preselected.
  const chosenEdition = editionId ?? meta.data?.editions.find((e) => e.status === 'ACTIVE')?.id ?? null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!chosenEdition || !streamId) return;
    update.mutate({ edition_id: chosenEdition, stream_id: streamId }, { onSuccess: () => navigate('/', { replace: true }) });
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 py-5">
      <div className="flex items-center justify-between">
        <Wordmark />
        <LanguageButton />
      </div>
      <main className="flex-1 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{t.onboarding.title}</h1>
        <p className="mt-1.5 text-sm text-muted">{t.onboarding.lead}</p>
        <Async query={meta} lines={8}>
          {(data) => {
            const editions = data.editions.filter((e) => e.status !== 'ARCHIVED');
            return (
              <form onSubmit={submit} className="mt-8 space-y-8">
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-fg">{t.onboarding.session}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {editions.map((e) => (
                      <label key={e.id} className={CHOICE}>
                        <input
                          type="radio"
                          name="edition"
                          className="size-4 accent-(--accent)"
                          checked={chosenEdition === e.id}
                          onChange={() => setEditionId(e.id)}
                        />
                        <span>
                          <span className="block font-medium text-fg">BAC {e.exam_year}</span>
                          <span className="block text-xs text-muted">{t.editionStatus[e.status]}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-1 text-sm font-semibold text-fg">{t.onboarding.stream}</legend>
                  <p className="mb-3 text-xs text-muted">{t.onboarding.streamNote}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {data.streams.map((s) => (
                      <label key={s.id} className={CHOICE}>
                        <input
                          type="radio"
                          name="stream"
                          className="size-4 accent-(--accent)"
                          checked={streamId === s.id}
                          onChange={() => setStreamId(s.id)}
                        />
                        <span>
                          <span className="block font-medium text-fg">{pick(s, 'name')}</span>
                          <span lang={locale === 'ar' ? 'fr' : 'ar'} className={cx('block text-xs text-muted')}>
                            {locale === 'ar' ? s.name_fr : s.name_ar}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <ErrorNotice error={update.error} />
                <Button type="submit" loading={update.isPending} disabled={!chosenEdition || !streamId}>
                  {t.onboarding.continue}
                </Button>
              </form>
            );
          }}
        </Async>
      </main>
    </div>
  );
}
