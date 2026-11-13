import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { CalendarEvent, Plan, PlanSession, SubjectsView } from '@shared/types.ts';
import { Badge } from '@/components/badges.tsx';
import { IconPlanner } from '@/components/icons.ts';
import { Async, Button, ButtonLink, Empty, ErrorNotice, Field, Input, Notice, PageHeader, Section, Select, cx } from '@/components/ui.tsx';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMeta } from '@/lib/session.tsx';

interface PlannerData {
  plan: Plan | null;
  subjects: SubjectsView;
  events: CalendarEvent[];
  today: string;
}

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

function Agenda({ data }: { data: PlannerData & { plan: Plan } }) {
  const { t, pick, date } = useI18n();
  const meta = useMeta();
  const client = useQueryClient();
  const { plan, events, today } = data;
  const toggle = useMutation({
    mutationFn: (id: number) => api<{ id: number; done_at: string | null }>(`/planner/sessions/${id}/toggle`, { method: 'POST' }),
    onSuccess: (result) => {
      client.setQueryData<PlannerData>(['planner'], (prev) =>
        prev?.plan
          ? { ...prev, plan: { ...prev.plan, sessions: prev.plan.sessions.map((s) => (s.id === result.id ? { ...s, done_at: result.done_at } : s)) } }
          : prev,
      );
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const subjectName = (id: number): string => {
    const subject = meta.data?.subjects.find((s) => s.id === id);
    return subject ? pick(subject, 'name') : '';
  };
  const start = dayNumber(plan.params.start);
  const weeks = new Map<number, Map<string, PlanSession[]>>();
  for (const session of plan.sessions) {
    const week = Math.floor((dayNumber(session.day) - start) / 7) + 1;
    const days = weeks.get(week) ?? new Map<string, PlanSession[]>();
    days.set(session.day, [...(days.get(session.day) ?? []), session]);
    weeks.set(week, days);
  }
  const done = plan.sessions.filter((s) => s.done_at).length;
  const maxSessions = Math.max(1, ...plan.weights.map((w) => w.sessions));

  return (
    <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="order-2 space-y-8 lg:order-1">
        {[...weeks.entries()].map(([week, days]) => (
          <section key={week} aria-labelledby={`week-${week}`}>
            <h2 id={`week-${week}`} className="mb-1 text-sm font-semibold text-fg">
              {t.planner.week(week)}
            </h2>
            <ul className="divide-y divide-line border-y border-line">
              {[...days.entries()].map(([day, sessions]) => {
                const overlapping = events.filter((e) => e.starts_on && e.starts_on <= day && (e.ends_on ?? e.starts_on) >= day);
                return (
                  <li key={day} className="grid gap-x-6 gap-y-1.5 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                    <div className="space-y-1">
                      <p className={cx('text-sm', day === today ? 'font-semibold text-accent' : 'font-medium text-fg')}>
                        {date(day, 'weekday')}
                        {day === today && <span className="block text-xs font-medium">{t.planner.today}</span>}
                      </p>
                      {overlapping.map((e) => (
                        <Badge key={e.id} tone="neutral" className="max-w-full whitespace-normal">
                          {pick(e, 'title')}
                        </Badge>
                      ))}
                    </div>
                    <ul className="space-y-0.5">
                      {sessions.map((s) => (
                        <li key={s.id}>
                          <label className="flex cursor-pointer items-start gap-3 rounded-lg py-1.5 text-sm">
                            <input
                              type="checkbox"
                              aria-label={t.planner.markDone}
                              className="mt-0.5 size-4 shrink-0 accent-(--accent)"
                              checked={Boolean(s.done_at)}
                              onChange={() => toggle.mutate(s.id)}
                            />
                            <span className={cx('min-w-0', s.done_at && 'text-muted line-through')}>
                              <span className="font-medium">{subjectName(s.subject_id)}</span>
                              <span className="text-muted">
                                {' '}
                                · {t.focus[s.focus]} · {t.common.minutes(s.minutes)}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <aside className="order-1 space-y-4 lg:order-2">
        <Section title={t.planner.distribution}>
          <p className="mb-3 text-xs text-muted">{plan.official_weights ? t.planner.weightsOfficial : t.planner.weightsCustom}</p>
          <ul className="space-y-2.5">
            {[...plan.weights]
              .sort((a, b) => b.sessions - a.sessions)
              .map((w) => (
                <li key={w.subject_id} className="text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-fg">{subjectName(w.subject_id)}</span>
                    <span className="tabular shrink-0 text-muted">{w.sessions}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel" aria-hidden>
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(w.sessions / maxSessions) * 100}%` }} />
                  </div>
                </li>
              ))}
          </ul>
          <p className="tabular mt-4 text-sm font-medium text-fg">{t.planner.doneCount(done, plan.sessions.length)}</p>
        </Section>
      </aside>
    </div>
  );
}

export function PlannerPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['planner'], queryFn: () => api<PlannerData>('/planner') });
  const [hours, setHours] = useState('10');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [session, setSession] = useState(60);
  const [weeks, setWeeks] = useState(4);
  const [editing, setEditing] = useState(false);

  // Start the form from the current plan's settings.
  const params = query.data?.plan?.params;
  useEffect(() => {
    if (!params) return;
    setHours(String(params.hours_per_week));
    setDays(params.days);
    setSession(params.session_minutes);
    setWeeks(params.weeks);
  }, [params]);

  const generate = useMutation({
    mutationFn: () =>
      api<{ plan: Plan }>('/planner', {
        body: { hours_per_week: Number(hours.replace(',', '.')), days, session_minutes: session, weeks },
      }),
    onSuccess: () => {
      setEditing(false);
      void client.invalidateQueries({ queryKey: ['planner'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const hoursValue = Number(hours.replace(',', '.'));
  const valid = Number.isFinite(hoursValue) && hoursValue >= 1 && hoursValue <= 70 && days.length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) generate.mutate();
  };

  return (
    <>
      <PageHeader title={t.planner.title} lead={t.planner.lead} />
      <Async query={query} lines={10}>
        {(data) => {
          if (data.subjects.items.length === 0) {
            return (
              <Empty icon={<IconPlanner aria-hidden />} title={t.planner.needSubjects} action={<ButtonLink to="/subjects">{t.planner.goSubjects}</ButtonLink>} />
            );
          }
          const showForm = !data.plan || editing;
          return (
            <div className="space-y-8">
              <Notice className="max-w-3xl">
                {t.planner.noExamDate}{' '}
                <Link to="/official" className="font-medium text-accent underline-offset-4 hover:underline">
                  {t.nav.official}
                </Link>
              </Notice>

              {showForm ? (
                <Section title={t.planner.settingsTitle}>
                  <form onSubmit={submit} className="max-w-2xl space-y-5">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label={t.planner.hoursPerWeek}>
                        {(p) => <Input {...p} inputMode="decimal" dir="ltr" className="tabular" value={hours} onChange={(e) => setHours(e.target.value)} />}
                      </Field>
                      <Field label={t.planner.sessionLength}>
                        {(p) => (
                          <Select {...p} value={session} onChange={(e) => setSession(Number(e.target.value))}>
                            {[45, 60, 90, 120].map((m) => (
                              <option key={m} value={m}>
                                {t.common.minutes(m)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field label={t.planner.weeks}>
                        {(p) => (
                          <Select {...p} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                            {[2, 4, 6, 8].map((n) => (
                              <option key={n} value={n}>
                                {t.planner.weeksValue(n)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </div>
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium text-fg">{t.planner.days}</legend>
                      <div className="flex flex-wrap gap-2">
                        {t.weekdays.map((label, index) => (
                          <label
                            key={label}
                            className="cursor-pointer rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm transition-colors duration-150 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-semibold has-[:checked]:text-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={days.includes(index)}
                              onChange={() => setDays((prev) => (prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index]))}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <p className="text-sm text-muted">
                      {data.subjects.mode === 'official' ? t.planner.weightsOfficial : t.planner.weightsCustom}
                      {data.plan && ` ${t.planner.regenerateNote}`}
                    </p>
                    <ErrorNotice error={generate.error} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={!valid} loading={generate.isPending}>
                        {data.plan ? t.planner.regenerate : t.planner.generate}
                      </Button>
                      {data.plan && (
                        <Button variant="ghost" onClick={() => setEditing(false)}>
                          {t.common.cancel}
                        </Button>
                      )}
                    </div>
                  </form>
                </Section>
              ) : (
                <div>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                    {t.planner.regenerate}
                  </Button>
                </div>
              )}

              {data.plan && !editing && <Agenda data={{ ...data, plan: data.plan }} />}
            </div>
          );
        }}
      </Async>
    </>
  );
}
