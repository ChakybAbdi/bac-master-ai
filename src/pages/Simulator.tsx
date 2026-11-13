import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Attempt, Exam, Exercise, Locale } from '@shared/types.ts';
import { Badge, ProvenanceBadge } from '@/components/badges.tsx';
import { ProvenanceLine, inLang, useContentLang } from '@/components/content.tsx';
import { IconChevron, IconSimulator, IconTutor } from '@/components/icons.ts';
import { Markdown } from '@/components/Markdown.tsx';
import { Async, Button, ButtonLink, Empty, ErrorNotice, Input, Notice, PageHeader, Ratio, Section, Textarea, cx } from '@/components/ui.tsx';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';

const DURATIONS = [60, 90, 120, 150, 180, 210, 240, 270];

function useDuration(): (minutes: number) => string {
  const { locale } = useI18n();
  const tag = locale === 'ar' ? 'ar-DZ' : 'fr-DZ';
  const hours = new Intl.NumberFormat(tag, { style: 'unit', unit: 'hour', unitDisplay: 'short', numberingSystem: 'latn' });
  const mins = new Intl.NumberFormat(tag, { style: 'unit', unit: 'minute', unitDisplay: 'short', numberingSystem: 'latn' });
  return (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return [h > 0 ? hours.format(h) : '', m > 0 ? mins.format(m) : ''].filter(Boolean).join(' ');
  };
}

function StatusBadge({ status }: { status: Attempt['status'] }) {
  const { t } = useI18n();
  return <Badge tone={status === 'GRADED' ? 'ok' : status === 'SUBMITTED' ? 'warn' : 'accent'}>{t.sim.status[status]}</Badge>;
}

export function SimulatorPage() {
  const { t, pick, date, number } = useI18n();
  const navigate = useNavigate();
  const formatDuration = useDuration();
  const exams = useQuery({ queryKey: ['sim', 'exams'], queryFn: () => api<{ items: Exam[] }>('/sim/exams') });
  const attempts = useQuery({ queryKey: ['sim', 'attempts'], queryFn: () => api<{ items: Attempt[] }>('/sim/attempts') });
  const [choosing, setChoosing] = useState<number | null>(null);
  const [duration, setDuration] = useState(210);
  const start = useMutation({
    mutationFn: (examId: number) => api<{ attempt: Attempt }>('/sim/attempts', { body: { exam_id: examId, duration_minutes: duration } }),
    onSuccess: ({ attempt }) => navigate(`/simulator/attempt/${attempt.id}`),
  });

  return (
    <>
      <PageHeader title={t.sim.title} lead={t.sim.lead} />
      <div className="space-y-10">
        <Notice title={t.sim.conditionsTitle} className="max-w-3xl">
          <p>{t.sim.conditionsText}</p>
          <Link to="/official?tab=records" className="mt-1.5 inline-block font-medium text-accent underline-offset-4 hover:underline">
            {t.sim.seeBaseline}
          </Link>
        </Notice>

        <Section title={t.sim.examsTitle}>
          <Async query={exams}>
            {({ items }) =>
              items.length === 0 ? (
                <Empty icon={<IconSimulator aria-hidden />} title={t.sim.noExams}>
                  {t.learn.emptyHint}
                </Empty>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {items.map((exam) => {
                    const open = attempts.data?.items.find((a) => a.exam_id === exam.id && a.status === 'IN_PROGRESS');
                    return (
                      <li key={exam.id} className="py-4">
                        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                          <div className="min-w-0 space-y-1">
                            <p className="font-medium text-fg">{pick(exam, 'title')}</p>
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                              <span>{pick(exam, 'subject_name')}</span>
                              <span aria-hidden>·</span>
                              <span>{t.sim.exercisesCount(exam.exercise_count)}</span>
                              <span aria-hidden>·</span>
                              <span>{t.sim.total(number(exam.total_points))}</span>
                              <ProvenanceBadge value={exam.provenance} />
                            </p>
                          </div>
                          {open ? (
                            <ButtonLink to={`/simulator/attempt/${open.id}`}>{t.sim.resume}</ButtonLink>
                          ) : (
                            <Button
                              variant={choosing === exam.id ? 'secondary' : 'primary'}
                              aria-expanded={choosing === exam.id}
                              onClick={() => setChoosing(choosing === exam.id ? null : exam.id)}
                            >
                              {choosing === exam.id ? t.common.cancel : t.sim.start}
                            </Button>
                          )}
                        </div>
                        {choosing === exam.id && !open && (
                          <fieldset className="mt-4 animate-enter rounded-xl bg-panel px-4 py-4">
                            <legend className="float-start mb-1 text-sm font-semibold text-fg">{t.sim.durationTitle}</legend>
                            <p className="clear-both mb-3 max-w-prose text-sm text-muted">{t.sim.durationNote}</p>
                            <div className="flex flex-wrap gap-2">
                              {DURATIONS.map((d) => (
                                <label
                                  key={d}
                                  className="tabular cursor-pointer rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm transition-colors duration-150 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-semibold has-[:checked]:text-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
                                >
                                  <input type="radio" name="duration" className="sr-only" checked={duration === d} onChange={() => setDuration(d)} />
                                  {formatDuration(d)}
                                </label>
                              ))}
                            </div>
                            <div className="mt-4 space-y-3">
                              <ErrorNotice error={start.error} />
                              <Button loading={start.isPending} onClick={() => start.mutate(exam.id)}>
                                {t.sim.begin}
                              </Button>
                            </div>
                          </fieldset>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </Async>
        </Section>

        <Section title={t.sim.historyTitle}>
          <Async query={attempts} lines={3}>
            {({ items }) =>
              items.length === 0 ? (
                <p className="text-sm text-muted">{t.sim.noHistory}</p>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {items.map((a) => (
                    <li key={a.id}>
                      <Link to={`/simulator/attempt/${a.id}`} className="group flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-3 text-sm">
                        <span className="min-w-0">
                          <span className="block font-medium text-fg group-hover:text-accent">{pick(a, 'exam_title')}</span>
                          <span className="block text-xs text-muted">{date(a.started_at)}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          {a.status === 'GRADED' && a.score !== null && a.max_score ? (
                            <Ratio value={number((a.score / a.max_score) * 20)} total={20} className="font-semibold text-fg" />
                          ) : null}
                          <StatusBadge status={a.status} />
                          <IconChevron aria-hidden className="size-4 text-subtle group-hover:text-accent rtl:-scale-x-100" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            }
          </Async>
        </Section>
      </div>
    </>
  );
}

// --- One attempt: composing, self-correction, result ------------------------------------

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function ExerciseHeading({ exercise, lang }: { exercise: Exercise; lang: Locale }) {
  const { t, number } = useI18n();
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-lg font-semibold text-fg" dir="auto">
        {inLang(exercise, 'title', lang)}
      </h2>
      <span className="tabular text-sm text-muted">{t.sim.total(number(exercise.points))}</span>
    </div>
  );
}

function Composing({ attempt, exam, serverNow, lang }: { attempt: Attempt; exam: Exam; serverNow: string; lang: Locale }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>(attempt.answers);
  const [confirming, setConfirming] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const dirty = useRef(false);
  const latest = useRef(answers);
  latest.current = answers;

  // The deadline is computed against the server clock, so a wrong device clock cannot add time.
  const skew = useRef(Date.parse(serverNow) - Date.now());
  const deadline = Date.parse(attempt.started_at) + attempt.duration_minutes * 60_000;
  const [left, setLeft] = useState(deadline - (Date.now() + skew.current));
  useEffect(() => {
    const timer = setInterval(() => setLeft(deadline - (Date.now() + skew.current)), 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const draft = useMutation({
    mutationFn: (body: Record<string, string>) => api(`/sim/attempts/${attempt.id}/answers`, { method: 'PUT', body: { answers: body } }),
    onSuccess: () => setSavedAt(Date.now()),
  });
  const saveDraft = () => {
    if (!dirty.current) return;
    dirty.current = false;
    draft.mutate(latest.current);
  };
  useEffect(() => {
    const timer = setInterval(saveDraft, 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useMutation({
    mutationFn: () => api(`/sim/attempts/${attempt.id}/submit`, { body: { answers: latest.current } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['sim'] });
    },
  });

  const over = left <= 0;
  return (
    <>
      <div className="sticky top-14 z-10 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-bg px-4 py-3 sm:-mx-6 sm:px-6 lg:top-16 lg:-mx-8 lg:px-8">
        <div role="timer" aria-live="off" className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-muted">{over ? t.sim.timeUp : t.sim.timeLeft}</span>
          <span dir="ltr" className={cx('tabular text-xl font-semibold', over ? 'text-bad' : left < 10 * 60_000 ? 'text-warn' : 'text-fg')}>
            {clock(left)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {savedAt && !confirming && <span className="text-xs text-muted">{t.sim.draftSaved}</span>}
          {confirming ? (
            <>
              <span className="text-sm text-fg">{t.sim.submitConfirm}</span>
              <Button size="sm" loading={submit.isPending} onClick={() => submit.mutate()}>
                {t.sim.submitYes}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                {t.common.cancel}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)}>
              {t.sim.submit}
            </Button>
          )}
        </div>
      </div>

      {over && (
        <Notice tone="warn" role="alert" className="mb-6">
          {t.sim.timeUpText}
        </Notice>
      )}
      <ErrorNotice error={submit.error} />

      {inLang(exam, 'instructions', lang) && (
        <Notice title={t.sim.instructions} className="mb-8 max-w-3xl">
          <p dir="auto">{inLang(exam, 'instructions', lang)}</p>
        </Notice>
      )}

      <div className="space-y-10">
        {exam.exercises?.map((ex) => (
          <section key={ex.id}>
            <ExerciseHeading exercise={ex} lang={lang} />
            <Markdown source={inLang(ex, 'statement', lang)} lang={lang} />
            <label className="mt-4 block max-w-[70ch]">
              <span className="mb-1.5 block text-sm font-medium text-fg">
                {t.sim.yourAnswer} <span className="font-normal text-muted">({t.sim.answerHint})</span>
              </span>
              <Textarea
                dir="auto"
                rows={5}
                value={answers[String(ex.id)] ?? ''}
                onChange={(e) => {
                  dirty.current = true;
                  setAnswers((prev) => ({ ...prev, [String(ex.id)]: e.target.value }));
                }}
                onBlur={saveDraft}
              />
            </label>
          </section>
        ))}
      </div>
    </>
  );
}

function Correcting({ attempt, exam, lang }: { attempt: Attempt; exam: Exam; lang: Locale }) {
  const { t, number } = useI18n();
  const client = useQueryClient();
  const [marks, setMarks] = useState<Record<string, string>>({});
  const exercises = exam.exercises ?? [];
  const parsed = exercises.map((ex) => {
    const raw = (marks[String(ex.id)] ?? '').trim().replace(',', '.');
    const value = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
    return { ex, value, invalid: raw !== '' && (value === null || value > ex.points) };
  });
  const complete = parsed.every((p) => p.value !== null && !p.invalid);
  const grade = useMutation({
    mutationFn: () =>
      api(`/sim/attempts/${attempt.id}/grade`, {
        body: { scores: Object.fromEntries(parsed.map((p) => [String(p.ex.id), p.value ?? 0])) },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['sim'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return (
    <>
      <Notice title={t.sim.correctionTitle} className="mb-8 max-w-3xl">
        {t.sim.correctionLead}
      </Notice>
      <div className="space-y-12">
        {parsed.map(({ ex, invalid }) => (
          <section key={ex.id}>
            <ExerciseHeading exercise={ex} lang={lang} />
            <Markdown source={inLang(ex, 'statement', lang)} lang={lang} />

            <h3 className="mt-5 mb-1.5 text-sm font-semibold text-fg">{t.sim.yourAnswer}</h3>
            {attempt.answers[String(ex.id)]?.trim() ? (
              <p dir="auto" className="max-w-[70ch] rounded-lg border border-line bg-surface px-3 py-2 text-sm whitespace-pre-wrap text-fg">
                {attempt.answers[String(ex.id)]}
              </p>
            ) : (
              <p className="text-sm text-muted">{t.sim.noAnswer}</p>
            )}

            <div className="mt-5 space-y-3 rounded-xl bg-panel px-4 py-4">
              <h3 className="text-sm font-semibold text-fg">{t.sim.solution}</h3>
              <ProvenanceLine value={ex.solution_provenance}>{t.learn.solutionNote[ex.solution_provenance]}</ProvenanceLine>
              <Markdown source={inLang(ex, 'solution', lang)} lang={lang} />
            </div>

            <label className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium text-fg">{t.sim.yourMark}</span>
              <Input
                inputMode="decimal"
                dir="ltr"
                aria-invalid={invalid || undefined}
                className="tabular h-9 w-20 text-center"
                value={marks[String(ex.id)] ?? ''}
                onChange={(e) => setMarks((prev) => ({ ...prev, [String(ex.id)]: e.target.value }))}
              />
              <span className="tabular text-muted">{t.sim.outOfPoints(number(ex.points))}</span>
            </label>
          </section>
        ))}
      </div>
      <div className="mt-10 space-y-3 border-t border-line pt-5">
        <ErrorNotice error={grade.error} />
        <Button disabled={!complete} loading={grade.isPending} onClick={() => grade.mutate()}>
          {t.sim.saveMarks}
        </Button>
      </div>
    </>
  );
}

function Result({ attempt, exam, lang }: { attempt: Attempt; exam: Exam; lang: Locale }) {
  const { t, number } = useI18n();
  const exercises = exam.exercises ?? [];
  const scores = attempt.scores ?? {};
  const on20 = attempt.max_score ? ((attempt.score ?? 0) / attempt.max_score) * 20 : 0;
  return (
    <>
      <Section title={t.sim.resultTitle}>
        <p className="text-sm text-muted">{t.sim.scoreOn20}</p>
        <p className="text-4xl font-semibold tracking-tight text-fg">
          <span dir="ltr" className="tabular">
            {number(on20)} <span className="text-xl font-normal text-muted">/ 20</span>
          </span>
        </p>

        <ul className="mt-6 max-w-2xl divide-y divide-line border-y border-line">
          {exercises.map((ex) => {
            const earned = scores[String(ex.id)] ?? 0;
            const ratio = ex.points > 0 ? earned / ex.points : 0;
            const level = ratio >= 0.8 ? 'good' : ratio >= 0.5 ? 'medium' : 'low';
            return (
              <li key={ex.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                  <p className="text-sm font-medium text-fg" dir="auto">
                    {inLang(ex, 'title', lang)}
                  </p>
                  <p className="flex items-center gap-3 text-sm">
                    <Ratio value={number(earned)} total={number(ex.points)} className="font-semibold text-fg" />
                    <Badge tone={level === 'good' ? 'ok' : level === 'medium' ? 'warn' : 'bad'}>{t.sim.mastery[level]}</Badge>
                  </p>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-panel" aria-hidden>
                  <div
                    className={cx('h-full rounded-full', level === 'good' ? 'bg-ok' : level === 'medium' ? 'bg-warn-fill' : 'bg-bad')}
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
                {level !== 'good' && (
                  <Link
                    to={`/tutor?exercise=${ex.id}`}
                    className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
                  >
                    <IconTutor aria-hidden className="size-4" />
                    {t.sim.explain}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <ButtonLink to="/simulator">{t.sim.retry}</ButtonLink>
          <ButtonLink to="/planner" variant="secondary">
            {t.dashboard.openPlanner}
          </ButtonLink>
        </div>
      </Section>

      <details className="mt-10">
        <summary className="text-sm font-semibold text-fg">{t.sim.correctionTitle}</summary>
        <div className="mt-5 space-y-10">
          {exercises.map((ex) => (
            <section key={ex.id}>
              <ExerciseHeading exercise={ex} lang={lang} />
              <Markdown source={inLang(ex, 'statement', lang)} lang={lang} />
              <div className="mt-4 space-y-3 rounded-xl bg-panel px-4 py-4">
                <ProvenanceLine value={ex.solution_provenance}>{t.learn.solutionNote[ex.solution_provenance]}</ProvenanceLine>
                <Markdown source={inLang(ex, 'solution', lang)} lang={lang} />
              </div>
            </section>
          ))}
        </div>
      </details>
    </>
  );
}

export function AttemptPage() {
  const { t } = useI18n();
  const { attemptId } = useParams();
  const [lang, langControl] = useContentLang();
  const query = useQuery({
    queryKey: ['sim', 'attempt', attemptId],
    queryFn: () => api<{ attempt: Attempt; exam: Exam; now: string }>(`/sim/attempts/${attemptId}`),
  });
  return (
    <>
      <Link to="/simulator" className="mb-3 inline-flex items-center gap-1 text-sm text-muted transition-colors duration-150 hover:text-fg">
        <IconChevron aria-hidden className="size-4 rotate-180 rtl:rotate-0" />
        {t.sim.backToList}
      </Link>
      <Async query={query} lines={12}>
        {({ attempt, exam, now }) => (
          <>
            <PageHeader
              title={inLang(exam, 'title', lang)}
              lead={
                <span className="flex flex-wrap items-center gap-2">
                  {inLang(exam, 'subject_name', lang)}
                  <ProvenanceBadge value={exam.provenance} />
                  <StatusBadge status={attempt.status} />
                </span>
              }
              actions={langControl}
            />
            {attempt.status === 'IN_PROGRESS' && <Composing key={attempt.id} attempt={attempt} exam={exam} serverNow={now} lang={lang} />}
            {attempt.status === 'SUBMITTED' && <Correcting attempt={attempt} exam={exam} lang={lang} />}
            {attempt.status === 'GRADED' && <Result attempt={attempt} exam={exam} lang={lang} />}
          </>
        )}
      </Async>
    </>
  );
}
