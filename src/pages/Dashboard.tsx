import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { Dashboard, OfficialStatusLine, Recommendation } from '@shared/types.ts';
import { Badge, EventStatusBadge, VerificationBadge } from '@/components/badges.tsx';
import { IconArrow } from '@/components/icons.ts';
import { Async, ButtonLink, ExternalLink, Ratio, Section, cx } from '@/components/ui.tsx';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMe, useMeta } from '@/lib/session.tsx';

const MORE_LINK = 'text-sm font-medium text-accent underline-offset-4 hover:underline';

function OfficialLine({ line }: { line: OfficialStatusLine }) {
  const { t, pick, date } = useI18n();
  const isFramework = line.key === 'FRAMEWORK';
  const detail = line.status === 'NOT_ANNOUNCED' ? t.dashboard.notAnnounced : pick(line, 'dates');
  return (
    <li className="grid gap-x-4 gap-y-1.5 px-4 py-3.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex items-center justify-between gap-3 sm:block sm:space-y-1.5">
        <p className="text-sm font-semibold text-fg">{t.dashboard.line[line.key]}</p>
        {isFramework ? (
          <VerificationBadge level={line.status as 'VERIFIED'} />
        ) : (
          <EventStatusBadge status={line.status as 'NOT_ANNOUNCED'} />
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-fg">{detail}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {line.last_verified && <span>{t.common.lastVerified(date(line.last_verified))}</span>}
          {line.source_url && isFramework && (
            <ExternalLink href={line.source_url} className="text-xs">
              {t.common.officialDocument}
            </ExternalLink>
          )}
        </p>
      </div>
    </li>
  );
}

export function DashboardPage() {
  const { t, pick, date, number, locale } = useI18n();
  const me = useMe();
  const meta = useMeta();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });
  const toggle = useMutation({
    mutationFn: (id: number) => api(`/planner/sessions/${id}/toggle`, { method: 'POST' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['planner'] });
    },
  });

  const user = me.data;
  const edition = meta.data?.editions.find((e) => e.id === user?.edition_id);
  const stream = meta.data?.streams.find((s) => s.id === user?.stream_id);
  const subjectName = (id: number): string => {
    const subject = meta.data?.subjects.find((s) => s.id === id);
    return subject ? pick(subject, 'name') : '';
  };

  const recommendation = (r: Recommendation): string => {
    const p = r.params;
    const localized = (key: string) => String((locale === 'ar' ? p[`${key}_ar`] : p[`${key}_fr`]) ?? '');
    const rec = t.dashboard.rec;
    switch (r.kind) {
      case 'COMPLETE_PROFILE':
        return rec.COMPLETE_PROFILE;
      case 'SUBJECTS_PENDING':
        return rec.SUBJECTS_PENDING(p.pending === 1);
      case 'SET_LEVELS':
        return rec.SET_LEVELS;
      case 'READ_ANNOUNCEMENT':
        return rec.READ_ANNOUNCEMENT(localized('title'));
      case 'UPCOMING_EVENT':
        return rec.UPCOMING_EVENT(localized('title'), localized('dates'), Number(p.days));
      case 'REGISTRATION_WATCH':
        return rec.REGISTRATION_WATCH(p.last_verified ? date(String(p.last_verified)) : null);
      case 'PRIORITISE_SUBJECT':
        return rec.PRIORITISE_SUBJECT(localized('name'), number(Number(p.coefficient)));
      case 'CREATE_PLAN':
        return rec.CREATE_PLAN;
      case 'TODAY_SESSIONS':
        return rec.TODAY_SESSIONS(Number(p.count));
      case 'TRY_SIMULATOR':
        return rec.TRY_SIMULATOR;
      case 'CONTINUE_LESSONS':
        return rec.CONTINUE_LESSONS(Number(p.done), Number(p.total));
    }
  };

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{t.dashboard.hello(user?.name.split(' ')[0] ?? '')}</h1>
        {edition && (
          <p className="mt-1 text-sm text-muted">
            {t.dashboard.context(edition.exam_year, stream ? pick(stream, 'name') : t.dashboard.noStream)}
          </p>
        )}
      </header>

      <Async query={query} lines={10}>
        {(data) => (
          <div className="grid gap-x-10 gap-y-9 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <div className="space-y-9">
              <Section
                title={t.dashboard.officialTitle}
                lead={
                  meta.data?.last_check
                    ? t.dashboard.officialLead(date(meta.data.last_check))
                    : t.dashboard.officialLeadNoDate
                }
                action={
                  <Link to="/official" className={MORE_LINK}>
                    {t.nav.official}
                  </Link>
                }
              >
                <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                  {data.official.map((line) => (
                    <OfficialLine key={line.key} line={line} />
                  ))}
                </ul>
              </Section>

              <Section title={t.dashboard.todoTitle}>
                {data.recommendations.length === 0 ? (
                  <p className="text-sm text-muted">{t.dashboard.todoEmpty}</p>
                ) : (
                  <ul className="divide-y divide-line border-y border-line">
                    {data.recommendations.map((r) => (
                      <li key={r.kind}>
                        <Link
                          to={r.href}
                          className="group flex items-center justify-between gap-4 py-3 text-sm text-fg transition-colors duration-150 hover:text-accent"
                        >
                          <span className="min-w-0">{recommendation(r)}</span>
                          <IconArrow aria-hidden className="size-4 shrink-0 text-subtle group-hover:text-accent rtl:-scale-x-100" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

            <div className="space-y-9">
              <Section
                title={t.dashboard.upcomingTitle}
                action={
                  <Link to="/official?tab=calendar" className={MORE_LINK}>
                    {t.dashboard.fullCalendar}
                  </Link>
                }
              >
                {data.upcoming.length === 0 ? (
                  <p className="text-sm text-muted">{t.dashboard.upcomingEmpty}</p>
                ) : (
                  <ul className="space-y-3.5">
                    {data.upcoming.map((e) => (
                      <li key={e.id} className="text-sm">
                        <p className="font-medium text-fg">{pick(e, 'title')}</p>
                        <p className="text-fg">{pick(e, 'dates')}</p>
                        <p className="text-xs text-muted">{pick(e, 'audience')}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section
                title={t.dashboard.announcementsTitle}
                action={
                  data.announcements.length > 0 ? (
                    <Link to="/official?tab=announcements" className={MORE_LINK}>
                      {t.dashboard.allAnnouncements}
                    </Link>
                  ) : undefined
                }
              >
                {data.announcements.length === 0 ? (
                  <p className="text-sm text-muted">{t.dashboard.announcementsEmpty}</p>
                ) : (
                  <ul className="space-y-3.5">
                    {data.announcements.map((a) => (
                      <li key={a.id} className="text-sm">
                        <Link to="/official?tab=announcements" className="font-medium text-fg underline-offset-4 hover:underline">
                          {pick(a, 'title')}
                        </Link>{' '}
                        {!a.read_at && <Badge tone="accent">{t.dashboard.unreadBadge}</Badge>}
                        <p className="text-xs text-muted">{t.common.publishedOn(date(a.published_at))}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={t.dashboard.todayTitle}>
                {data.today.length === 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted">{t.dashboard.todayEmpty}</p>
                    <ButtonLink to="/planner" variant="secondary" size="sm">
                      {t.dashboard.openPlanner}
                    </ButtonLink>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {data.today.map((s) => (
                      <li key={s.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-lg py-1.5 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 accent-(--accent)"
                            checked={Boolean(s.done_at)}
                            onChange={() => toggle.mutate(s.id)}
                          />
                          <span className={cx('min-w-0', s.done_at && 'text-muted line-through')}>
                            {subjectName(s.subject_id)} · {t.focus[s.focus]} · {t.common.minutes(s.minutes)}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={t.dashboard.progressTitle}>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">{t.dashboard.lessonsDone}</dt>
                    <dd className="font-medium text-fg">
                      <Ratio value={data.progress.lessons_done} total={data.progress.lessons_total} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">{t.dashboard.examsGraded}</dt>
                    <dd className="tabular font-medium text-fg">{data.progress.attempts}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">{t.dashboard.bestScore}</dt>
                    <dd className="tabular font-medium text-fg">
                      {data.progress.best_score === null ? (
                        t.dashboard.noScore
                      ) : (
                        <Ratio value={number(data.progress.best_score)} total={20} />
                      )}
                    </dd>
                  </div>
                </dl>
              </Section>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
