import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ChapterView, Exercise, LearnSubject, Lesson, Locale } from '@shared/types.ts';
import { Badge, ProvenanceBadge } from '@/components/badges.tsx';
import { ProvenanceLine, inLang, useContentLang } from '@/components/content.tsx';
import { IconCheck, IconChevron, IconLearn, IconTutor } from '@/components/icons.ts';
import { Markdown } from '@/components/Markdown.tsx';
import { Async, Button, ButtonLink, Empty, Notice, PageHeader, cx } from '@/components/ui.tsx';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';

const CRUMB = 'inline-flex items-center gap-1 text-sm text-muted transition-colors duration-150 hover:text-fg';

export function LearnIndexPage() {
  const { t, pick } = useI18n();
  const query = useQuery({ queryKey: ['learn', 'subjects'], queryFn: () => api<{ items: LearnSubject[] }>('/learn/subjects') });
  return (
    <>
      <PageHeader title={t.learn.title} lead={t.learn.lead} />
      <Async query={query}>
        {({ items }) =>
          items.length === 0 ? (
            <Empty icon={<IconLearn aria-hidden />} title={t.learn.empty}>
              {t.learn.emptyHint}
            </Empty>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {items.map((s) => (
                <li key={s.subject_id}>
                  <Link
                    to={`/learn/${s.subject_id}`}
                    className="group flex items-center justify-between gap-4 py-4 transition-colors duration-150"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-fg group-hover:text-accent">{pick(s, 'name')}</span>
                      <span className="block text-sm text-muted">
                        {t.learn.chapters(s.chapters)} · {t.learn.lessonsProgress(s.lessons_done, s.lessons)}
                      </span>
                    </span>
                    <IconChevron aria-hidden className="size-4 shrink-0 text-subtle group-hover:text-accent rtl:-scale-x-100" />
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </>
  );
}

function ExerciseBlock({ exercise, lang }: { exercise: Exercise; lang: Locale }) {
  const { t, number } = useI18n();
  const [solution, setSolution] = useState(false);
  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
          <IconChevron aria-hidden className="size-4 shrink-0 text-subtle transition-transform duration-150 group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:-rotate-90" />
          <span dir="auto">{inLang(exercise, 'title', lang)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="tabular text-xs text-muted">{t.sim.total(number(exercise.points))}</span>
          <ProvenanceBadge value={exercise.provenance} />
        </span>
      </summary>
      <div className="space-y-4 border-t border-line px-4 py-4">
        <Markdown source={inLang(exercise, 'statement', lang)} lang={lang} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" aria-expanded={solution} onClick={() => setSolution((v) => !v)}>
            {solution ? t.learn.hideSolution : t.learn.showSolution}
          </Button>
          <ButtonLink to={`/tutor?exercise=${exercise.id}`} variant="ghost" size="sm">
            <IconTutor aria-hidden className="size-4" />
            {t.learn.askTutor}
          </ButtonLink>
        </div>
        {solution && (
          <div className="animate-enter space-y-3 rounded-lg bg-panel px-4 py-4">
            <ProvenanceLine value={exercise.solution_provenance}>{t.learn.solutionNote[exercise.solution_provenance]}</ProvenanceLine>
            <Markdown source={inLang(exercise, 'solution', lang)} lang={lang} />
          </div>
        )}
      </div>
    </details>
  );
}

export function LearnSubjectPage() {
  const { t, pick } = useI18n();
  const { subjectId } = useParams();
  const [lang, langControl] = useContentLang();
  const query = useQuery({
    queryKey: ['learn', 'subject', subjectId],
    queryFn: () =>
      api<{ subject: { id: number; name_fr: string; name_ar: string }; chapters: ChapterView[] }>(`/learn/subjects/${subjectId}`),
  });
  return (
    <>
      <Link to="/learn" className={cx(CRUMB, 'mb-3')}>
        <IconChevron aria-hidden className="size-4 rotate-180 rtl:rotate-0" />
        {t.learn.allSubjects}
      </Link>
      <Async query={query} lines={8}>
        {({ subject, chapters }) => (
          <>
            <PageHeader title={pick(subject, 'name')} actions={langControl} />
            {chapters.length === 0 ? (
              <Empty icon={<IconLearn aria-hidden />} title={t.learn.empty}>
                {t.learn.emptyHint}
              </Empty>
            ) : (
              <div className="space-y-10">
                {chapters.map((ch, index) => (
                  <section key={ch.id} aria-labelledby={`chapter-${ch.id}`}>
                    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <h2 id={`chapter-${ch.id}`} className="text-lg font-semibold text-fg" dir="auto">
                        <span className="tabular text-subtle">{index + 1}.</span> {inLang(ch, 'title', lang)}
                      </h2>
                      {ch.verification !== 'VERIFIED' && <Badge tone="dashed">{t.learn.structureUnverified}</Badge>}
                    </div>
                    {pick(ch, 'note') && <p className="mb-4 max-w-prose text-sm text-muted">{pick(ch, 'note')}</p>}

                    <h3 className="mb-1 text-xs font-semibold text-muted">{t.learn.lessons}</h3>
                    <ul className="mb-5 divide-y divide-line border-y border-line">
                      {ch.lessons.map((l) => (
                        <li key={l.id}>
                          <Link to={`/learn/lesson/${l.id}`} className="group flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3">
                            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg group-hover:text-accent">
                              <span
                                aria-hidden
                                className={cx(
                                  'flex size-5 shrink-0 items-center justify-center rounded-full border',
                                  l.done ? 'border-ok-line bg-ok-soft text-ok' : 'border-line-strong text-transparent',
                                )}
                              >
                                <IconCheck className="size-3" />
                              </span>
                              <span dir="auto">{inLang(l, 'title', lang)}</span>
                              {l.done && <span className="sr-only">({t.learn.done})</span>}
                            </span>
                            <span className="flex items-center gap-2">
                              {l.outdated && <Badge tone="warn">{t.admin.content.outdated}</Badge>}
                              <ProvenanceBadge value={l.provenance} />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>

                    {ch.exercises.length > 0 && (
                      <>
                        <h3 className="mb-2 text-xs font-semibold text-muted">{t.learn.exercises}</h3>
                        <div className="space-y-2">
                          {ch.exercises.map((ex) => (
                            <ExerciseBlock key={ex.id} exercise={ex} lang={lang} />
                          ))}
                        </div>
                      </>
                    )}
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </Async>
    </>
  );
}

export function LessonPage() {
  const { t, date } = useI18n();
  const { lessonId } = useParams();
  const client = useQueryClient();
  const [lang, langControl] = useContentLang();
  const query = useQuery({
    queryKey: ['learn', 'lesson', lessonId],
    queryFn: () => api<{ lesson: Lesson }>(`/learn/lessons/${lessonId}`),
  });
  const progress = useMutation({
    mutationFn: (done: boolean) => api(`/learn/lessons/${lessonId}/progress`, { body: { done } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['learn'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return (
    <Async query={query} lines={12}>
      {({ lesson }) => {
        const origin =
          lesson.provenance === 'AI_GENERATED'
            ? t.learn.aiNotice
            : lesson.provenance === 'TEACHER_REVIEWED'
              ? lesson.reviewed_by_name && lesson.reviewed_at
                ? t.learn.reviewedNotice(lesson.reviewed_by_name, date(lesson.reviewed_at))
                : t.learn.reviewedNoticeAnon
              : lesson.provenance === 'OFFICIAL'
                ? t.learn.officialNotice
                : t.learn.unverifiedNotice;
        return (
          <article>
            <Link to={`/learn/${lesson.subject_id}`} className={cx(CRUMB, 'mb-3')}>
              <IconChevron aria-hidden className="size-4 rotate-180 rtl:rotate-0" />
              {t.learn.backToChapters}
            </Link>
            <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <p className="text-sm text-muted" dir="auto">
                  {inLang(lesson, 'chapter_title', lang)}
                </p>
                <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-fg" dir="auto">
                  {inLang(lesson, 'title', lang)}
                </h1>
              </div>
              {langControl}
            </header>

            <ProvenanceLine value={lesson.provenance} className="mb-4">
              {origin} {lesson.version > 1 && <span className="text-subtle">({t.learn.version(lesson.version)})</span>}
            </ProvenanceLine>
            {lesson.outdated && (
              <Notice tone="warn" className="mb-4 max-w-prose">
                <p>{t.learn.outdated}</p>
                {lesson.outdated_note && <p className="mt-1 text-muted">{lesson.outdated_note}</p>}
              </Notice>
            )}

            <div className="border-t border-line pt-6">
              <Markdown source={inLang(lesson, 'body', lang)} lang={lang} />
            </div>

            <footer className="mt-8 flex flex-wrap items-center gap-2 border-t border-line pt-5">
              <Button
                variant={lesson.done ? 'secondary' : 'primary'}
                loading={progress.isPending}
                icon={lesson.done ? <IconCheck aria-hidden className="size-4 text-ok" /> : undefined}
                onClick={() => progress.mutate(!lesson.done)}
              >
                {lesson.done ? t.learn.markUndone : t.learn.markDone}
              </Button>
              <ButtonLink to="/tutor" variant="ghost">
                <IconTutor aria-hidden className="size-4" />
                {t.learn.askTutor}
              </ButtonLink>
            </footer>
          </article>
        );
      }}
    </Async>
  );
}
