import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import type {
  Announcement,
  AnnouncementKind,
  AuditEntry,
  CalendarEvent,
  Claim,
  ClaimVerdict,
  DocType,
  EventKind,
  EventStatus,
  OfficialRecord,
  PastPaper,
  Priority,
  Provenance,
  Role,
  User,
  Verification,
} from '@shared/types.ts';
import { ANNOUNCEMENT_KINDS, DOC_TYPES, PRIORITIES, VERIFICATIONS } from '@shared/types.ts';
import { Badge, EventStatusBadge, PriorityBadge, ProvenanceBadge, VerdictBadge, VerificationBadge } from '@/components/badges.tsx';
import { Async, Button, ErrorNotice, ExternalLink, Field, Input, Notice, Section, Select, Textarea } from '@/components/ui.tsx';
import { api, apiForm } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMe, useMeta } from '@/lib/session.tsx';
import { DocTypeBadge } from '../Archive.tsx';
import { AdminLead } from './index.tsx';

/** French and Arabic versions of one field, side by side, each in its own direction. */
function Bilingual({
  labelFr,
  labelAr,
  fr,
  ar,
  onFr,
  onAr,
  rows,
}: {
  labelFr: string;
  labelAr: string;
  fr: string;
  ar: string;
  onFr: (value: string) => void;
  onAr: (value: string) => void;
  rows?: number;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={labelFr}>
        {(p) =>
          rows ? (
            <Textarea {...p} dir="ltr" lang="fr" rows={rows} value={fr} onChange={(e) => onFr(e.target.value)} />
          ) : (
            <Input {...p} dir="ltr" lang="fr" value={fr} onChange={(e) => onFr(e.target.value)} />
          )
        }
      </Field>
      <Field label={labelAr}>
        {(p) =>
          rows ? (
            <Textarea {...p} dir="rtl" lang="ar" rows={rows} value={ar} onChange={(e) => onAr(e.target.value)} />
          ) : (
            <Input {...p} dir="rtl" lang="ar" value={ar} onChange={(e) => onAr(e.target.value)} />
          )
        }
      </Field>
    </div>
  );
}

function RecordSelect({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  const { t } = useI18n();
  const records = useQuery({ queryKey: ['admin', 'records'], queryFn: () => api<{ items: OfficialRecord[] }>('/admin/records') });
  return (
    <Field label={label}>
      {(p) => (
        <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t.common.none}</option>
          {records.data?.items.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} · {t.verification[r.verification]} · {(r.title_fr ?? r.topic).slice(0, 50)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="mb-6 rounded-xl border border-line">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-fg">{label}</summary>
      <div className="border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}

// --- Content ------------------------------------------------------------------------

interface AdminLesson {
  id: number;
  chapter_fr: string;
  chapter_ar: string;
  subject_fr: string;
  subject_ar: string;
  title_fr: string;
  title_ar: string;
  body_fr: string;
  body_ar: string;
  provenance: Provenance;
  outdated: number;
  outdated_note: string | null;
  version: number;
  reviewed_by_name: string | null;
}

interface AdminExam {
  id: number;
  title_fr: string;
  title_ar: string;
  subject_fr: string;
  subject_ar: string;
  provenance: Provenance;
  total_points: number;
  exercise_count: number;
  reviewed_by_name: string | null;
}

function LessonRow({ lesson }: { lesson: AdminLesson }) {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const c = t.admin.content;
  const [mode, setMode] = useState<'edit' | 'flag' | null>(null);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState({ title_fr: lesson.title_fr, title_ar: lesson.title_ar, body_fr: lesson.body_fr, body_ar: lesson.body_ar });
  const done = () => {
    setMode(null);
    void client.invalidateQueries();
  };
  const review = useMutation({ mutationFn: () => api(`/admin/content/lessons/${lesson.id}/review`, { method: 'POST' }), onSuccess: done });
  const flag = useMutation({
    mutationFn: (outdated: boolean) => api(`/admin/content/lessons/${lesson.id}/outdated`, { body: { outdated, note: note || null } }),
    onSuccess: done,
  });
  const save = useMutation({ mutationFn: () => api(`/admin/content/lessons/${lesson.id}`, { method: 'PUT', body: draft }), onSuccess: done });
  const ar = locale === 'ar';

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted">
            {ar ? lesson.subject_ar : lesson.subject_fr} · {ar ? lesson.chapter_ar : lesson.chapter_fr}
          </p>
          <p className="font-medium text-fg">{ar ? lesson.title_ar : lesson.title_fr}</p>
          <p className="flex flex-wrap items-center gap-2">
            <ProvenanceBadge value={lesson.provenance} />
            {lesson.outdated === 1 && <Badge tone="warn">{c.outdated}</Badge>}
            <span className="tabular text-xs text-muted">{t.learn.version(lesson.version)}</span>
            {lesson.reviewed_by_name && <span className="text-xs text-muted">{c.reviewedBy(lesson.reviewed_by_name)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {lesson.provenance !== 'TEACHER_REVIEWED' && lesson.provenance !== 'OFFICIAL' && (
            <Button size="sm" variant="secondary" loading={review.isPending} onClick={() => review.mutate()}>
              {c.markReviewed}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setMode(mode === 'edit' ? null : 'edit')}>
            {c.edit}
          </Button>
          {lesson.outdated === 1 ? (
            <Button size="sm" variant="ghost" loading={flag.isPending} onClick={() => flag.mutate(false)}>
              {c.unflag}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setMode(mode === 'flag' ? null : 'flag')}>
              {c.flag}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-2">
        <ErrorNotice error={review.error ?? flag.error ?? save.error} />
        {mode === 'flag' && (
          <form
            className="flex animate-enter flex-wrap items-end gap-3 rounded-xl bg-panel px-4 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              flag.mutate(true);
            }}
          >
            <Field label={c.flagNote} className="min-w-64 flex-1">
              {(p) => <Input {...p} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <Button type="submit" size="sm" loading={flag.isPending}>
              {c.flag}
            </Button>
          </form>
        )}
        {mode === 'edit' && (
          <form
            className="animate-enter space-y-3 rounded-xl bg-panel px-4 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <p className="text-sm font-semibold text-fg">{c.editing}</p>
            <Bilingual
              labelFr={t.admin.records.titleFr}
              labelAr={t.admin.records.titleAr}
              fr={draft.title_fr}
              ar={draft.title_ar}
              onFr={(v) => setDraft({ ...draft, title_fr: v })}
              onAr={(v) => setDraft({ ...draft, title_ar: v })}
            />
            <Bilingual
              labelFr={c.bodyFr}
              labelAr={c.bodyAr}
              fr={draft.body_fr}
              ar={draft.body_ar}
              onFr={(v) => setDraft({ ...draft, body_fr: v })}
              onAr={(v) => setDraft({ ...draft, body_ar: v })}
              rows={14}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={save.isPending}>
                {c.saveVersion}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                {t.common.cancel}
              </Button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}

export function ContentPage() {
  const { t, locale, number } = useI18n();
  const client = useQueryClient();
  const c = t.admin.content;
  const query = useQuery({
    queryKey: ['admin', 'content'],
    queryFn: () => api<{ lessons: AdminLesson[]; exams: AdminExam[] }>('/admin/content'),
  });
  const reviewExam = useMutation({
    mutationFn: (id: number) => api(`/admin/content/exams/${id}/review`, { method: 'POST' }),
    onSuccess: () => void client.invalidateQueries(),
  });
  const ar = locale === 'ar';
  return (
    <>
      <AdminLead>{c.lead}</AdminLead>
      <Async query={query} lines={8}>
        {({ lessons, exams }) => (
          <div className="space-y-10">
            <Section title={c.lessons}>
              {lessons.length === 0 ? (
                <p className="text-sm text-muted">{c.empty}</p>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {lessons.map((l) => (
                    <LessonRow key={l.id} lesson={l} />
                  ))}
                </ul>
              )}
            </Section>
            <Section title={c.exams}>
              {exams.length === 0 ? (
                <p className="text-sm text-muted">{c.empty}</p>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {exams.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-fg">{ar ? x.title_ar : x.title_fr}</p>
                        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                          {ar ? x.subject_ar : x.subject_fr} · {t.sim.exercisesCount(x.exercise_count)} · {t.sim.total(number(x.total_points))}
                          <ProvenanceBadge value={x.provenance} />
                          {x.reviewed_by_name && <span className="text-xs">{c.reviewedBy(x.reviewed_by_name)}</span>}
                        </p>
                      </div>
                      {x.provenance !== 'TEACHER_REVIEWED' && x.provenance !== 'OFFICIAL' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={reviewExam.isPending && reviewExam.variables === x.id}
                          onClick={() => reviewExam.mutate(x.id)}
                        >
                          {c.markReviewed}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <ErrorNotice error={reviewExam.error} />
            </Section>
          </div>
        )}
      </Async>
    </>
  );
}

// --- Announcements ------------------------------------------------------------------

interface AnnouncementDraft {
  kind: AnnouncementKind;
  priority: Priority;
  edition_id: string;
  stream_id: string;
  title_fr: string;
  title_ar: string;
  body_fr: string;
  body_ar: string;
  record_id: string;
}

const HAS_PLACEHOLDER = /\[[^\]]*\]/;

export function AnnouncementsPage() {
  const { t, pick, date } = useI18n();
  const me = useMe();
  const meta = useMeta();
  const client = useQueryClient();
  const a = t.admin.announcements;
  const admin = me.data?.role === 'admin';
  const query = useQuery({ queryKey: ['admin', 'announcements'], queryFn: () => api<{ items: Announcement[] }>('/admin/announcements') });

  const blank = (): AnnouncementDraft => ({
    kind: 'DASHBOARD',
    priority: 'MEDIUM',
    edition_id: String(meta.data?.editions.find((e) => e.status === 'ACTIVE')?.id ?? ''),
    stream_id: '',
    title_fr: '',
    title_ar: '',
    body_fr: '',
    body_ar: '',
    record_id: '',
  });
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<AnnouncementDraft>(blank);
  const set = <K extends keyof AnnouncementDraft>(key: K, value: AnnouncementDraft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  const refresh = () => void client.invalidateQueries();
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...draft,
        edition_id: draft.edition_id ? Number(draft.edition_id) : null,
        stream_id: draft.stream_id ? Number(draft.stream_id) : null,
        record_id: draft.record_id || null,
      };
      return editing === 'new'
        ? api('/admin/announcements', { body })
        : api(`/admin/announcements/${editing}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const publish = useMutation({ mutationFn: (id: number) => api(`/admin/announcements/${id}/publish`, { method: 'POST' }), onSuccess: refresh });
  const archive = useMutation({ mutationFn: (id: number) => api(`/admin/announcements/${id}/archive`, { method: 'POST' }), onSuccess: refresh });

  const startEdit = (item: Announcement) => {
    setDraft({
      kind: item.kind,
      priority: item.priority,
      edition_id: String(item.edition_id ?? ''),
      stream_id: String(item.stream_id ?? ''),
      title_fr: item.title_fr,
      title_ar: item.title_ar,
      body_fr: item.body_fr,
      body_ar: item.body_ar,
      record_id: item.record_id ?? '',
    });
    setEditing(item.id);
  };
  const complete = draft.title_fr.trim() && draft.title_ar.trim() && draft.body_fr.trim() && draft.body_ar.trim();

  const readiness = (item: Announcement): { ok: boolean; text: string } => {
    if (!item.record_id) return { ok: false, text: a.blockedNoRecord };
    if (item.record_verification !== 'VERIFIED') return { ok: false, text: a.blockedUnverified };
    if ([item.title_fr, item.title_ar, item.body_fr, item.body_ar].some((part) => HAS_PLACEHOLDER.test(part))) {
      return { ok: false, text: a.blockedPlaceholder };
    }
    return { ok: true, text: a.ready };
  };

  return (
    <>
      <AdminLead>{a.lead}</AdminLead>
      {editing === null ? (
        <Button
          className="mb-6"
          onClick={() => {
            setDraft(blank());
            setEditing('new');
          }}
        >
          {a.new}
        </Button>
      ) : (
        <form
          className="mb-8 animate-enter space-y-4 rounded-xl bg-panel px-4 py-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (complete) save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={a.kind}>
              {(p) => (
                <Select {...p} value={draft.kind} onChange={(e) => set('kind', e.target.value as AnnouncementKind)}>
                  {ANNOUNCEMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t.announcementKind[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={a.priority}>
              {(p) => (
                <Select {...p} value={draft.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
                  {PRIORITIES.map((k) => (
                    <option key={k} value={k}>
                      {t.priority[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={a.edition}>
              {(p) => (
                <Select {...p} value={draft.edition_id} onChange={(e) => set('edition_id', e.target.value)}>
                  <option value="">{a.allEditions}</option>
                  {meta.data?.editions.map((e) => (
                    <option key={e.id} value={e.id}>
                      BAC {e.exam_year}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={a.stream}>
              {(p) => (
                <Select {...p} value={draft.stream_id} onChange={(e) => set('stream_id', e.target.value)}>
                  <option value="">{a.allStreams}</option>
                  {meta.data?.streams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {pick(s, 'name')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <RecordSelect label={a.record} value={draft.record_id} onChange={(id) => set('record_id', id)} />
          <Bilingual labelFr={a.titleFr} labelAr={a.titleAr} fr={draft.title_fr} ar={draft.title_ar} onFr={(v) => set('title_fr', v)} onAr={(v) => set('title_ar', v)} />
          <Bilingual labelFr={a.bodyFr} labelAr={a.bodyAr} fr={draft.body_fr} ar={draft.body_ar} onFr={(v) => set('body_fr', v)} onAr={(v) => set('body_ar', v)} rows={6} />
          <ErrorNotice error={save.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={!complete} loading={save.isPending}>
              {a.saveDraft}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t.common.cancel}
            </Button>
          </div>
        </form>
      )}

      <ErrorNotice error={publish.error ?? archive.error} />
      <Async query={query} lines={6}>
        {({ items }) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">{a.empty}</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {items.map((item) => {
                const state = readiness(item);
                return (
                  <li key={item.id} className="py-5">
                    <div className="max-w-3xl space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={item.status === 'PUBLISHED' ? 'ok' : item.status === 'DRAFT' ? 'warn' : 'dashed'}>{a.status[item.status]}</Badge>
                        <Badge tone="neutral">{t.announcementKind[item.kind]}</Badge>
                        <PriorityBadge priority={item.priority} />
                        {item.published_at && <span className="text-xs text-muted">{t.common.publishedOn(date(item.published_at))}</span>}
                      </div>
                      <h2 className="text-base font-semibold text-fg">{pick(item, 'title')}</h2>
                      <p className="text-sm leading-relaxed text-muted">{pick(item, 'body')}</p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        {item.record_id && <span dir="ltr">{item.record_id}</span>}
                        {item.record_verification && <VerificationBadge level={item.record_verification} />}
                        {item.status === 'DRAFT' && <span className={state.ok ? 'font-medium text-ok' : 'font-medium text-warn'}>{state.text}</span>}
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {item.status === 'DRAFT' && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => startEdit(item)}>
                              {t.common.edit}
                            </Button>
                            {admin && (
                              <Button
                                size="sm"
                                disabled={!state.ok}
                                loading={publish.isPending && publish.variables === item.id}
                                onClick={() => publish.mutate(item.id)}
                              >
                                {a.publish}
                              </Button>
                            )}
                          </>
                        )}
                        {admin && item.status !== 'ARCHIVED' && (
                          <Button size="sm" variant="ghost" loading={archive.isPending && archive.variables === item.id} onClick={() => archive.mutate(item.id)}>
                            {a.archive}
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Async>
    </>
  );
}

// --- Calendar and checked rumours -------------------------------------------------------

export function CalendarAdminPage() {
  const { t, pick, date } = useI18n();
  const meta = useMeta();
  const client = useQueryClient();
  const c = t.admin.calendar;
  const activeEdition = String(meta.data?.editions.find((e) => e.status === 'ACTIVE')?.id ?? '');
  const events = useQuery({ queryKey: ['admin', 'calendar'], queryFn: () => api<{ items: (CalendarEvent & { state: string })[] }>('/admin/calendar') });
  const claims = useQuery({ queryKey: ['admin', 'claims'], queryFn: () => api<{ items: (Claim & { state: string })[] }>('/admin/claims') });
  const refresh = () => void client.invalidateQueries();

  const [ev, setEv] = useState({
    kind: 'TEST' as EventKind, status: 'CONFIRMED' as EventStatus, concerns_3as: '2', starts_on: '', ends_on: '',
    dates_fr: '', dates_ar: '', title_fr: '', title_ar: '', audience_fr: '', audience_ar: '', note_fr: '', note_ar: '', record_id: '',
  });
  const [cl, setCl] = useState({
    claim_fr: '', claim_ar: '', finding_fr: '', finding_ar: '', verdict: 'UNVERIFIED' as ClaimVerdict, record_id: '',
    checked_on: new Date().toISOString().slice(0, 10),
  });

  const addEvent = useMutation({
    mutationFn: () =>
      api('/admin/calendar', {
        body: {
          ...ev,
          edition_id: Number(activeEdition),
          concerns_3as: Number(ev.concerns_3as),
          starts_on: ev.starts_on || null,
          ends_on: ev.ends_on || null,
          record_id: ev.record_id || null,
        },
      }),
    onSuccess: refresh,
  });
  const addClaim = useMutation({
    mutationFn: () => api('/admin/claims', { body: { ...cl, edition_id: Number(activeEdition) || null, record_id: cl.record_id || null } }),
    onSuccess: refresh,
  });
  const retireEvent = useMutation({ mutationFn: (id: number) => api(`/admin/calendar/${id}/retire`, { method: 'POST' }), onSuccess: refresh });
  const retireClaim = useMutation({ mutationFn: (id: number) => api(`/admin/claims/${id}/retire`, { method: 'POST' }), onSuccess: refresh });

  return (
    <>
      <AdminLead>{c.lead}</AdminLead>
      <div className="space-y-12">
        <Section title={c.events}>
          <Disclosure label={c.addEvent}>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                addEvent.mutate();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field label={c.kind}>
                  {(p) => (
                    <Select {...p} value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value as EventKind })}>
                      {(Object.keys(c.kinds) as EventKind[]).map((k) => (
                        <option key={k} value={k}>
                          {c.kinds[k]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={c.status}>
                  {(p) => (
                    <Select {...p} value={ev.status} onChange={(e) => setEv({ ...ev, status: e.target.value as EventStatus })}>
                      {(['CONFIRMED', 'PROVISIONAL', 'NOT_ANNOUNCED'] as EventStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {t.eventStatus[s]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={c.concerns}>
                  {(p) => (
                    <Select {...p} value={ev.concerns_3as} onChange={(e) => setEv({ ...ev, concerns_3as: e.target.value })}>
                      {c.concernsOptions.map((label, i) => (
                        <option key={label} value={i}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={c.startsOn}>{(p) => <Input {...p} type="date" value={ev.starts_on} onChange={(e) => setEv({ ...ev, starts_on: e.target.value })} />}</Field>
                <Field label={c.endsOn}>{(p) => <Input {...p} type="date" value={ev.ends_on} onChange={(e) => setEv({ ...ev, ends_on: e.target.value })} />}</Field>
              </div>
              <RecordSelect label={t.admin.announcements.record} value={ev.record_id} onChange={(id) => setEv({ ...ev, record_id: id })} />
              <Bilingual labelFr={c.titleFr} labelAr={c.titleAr} fr={ev.title_fr} ar={ev.title_ar} onFr={(v) => setEv({ ...ev, title_fr: v })} onAr={(v) => setEv({ ...ev, title_ar: v })} />
              <Bilingual labelFr={c.datesFr} labelAr={c.datesAr} fr={ev.dates_fr} ar={ev.dates_ar} onFr={(v) => setEv({ ...ev, dates_fr: v })} onAr={(v) => setEv({ ...ev, dates_ar: v })} />
              <Bilingual labelFr={c.audienceFr} labelAr={c.audienceAr} fr={ev.audience_fr} ar={ev.audience_ar} onFr={(v) => setEv({ ...ev, audience_fr: v })} onAr={(v) => setEv({ ...ev, audience_ar: v })} />
              <Bilingual labelFr={c.noteFr} labelAr={c.noteAr} fr={ev.note_fr} ar={ev.note_ar} onFr={(v) => setEv({ ...ev, note_fr: v })} onAr={(v) => setEv({ ...ev, note_ar: v })} rows={2} />
              <ErrorNotice error={addEvent.error} />
              <Button type="submit" disabled={!ev.title_fr.trim() || !ev.title_ar.trim() || !activeEdition} loading={addEvent.isPending}>
                {t.common.add}
              </Button>
            </form>
          </Disclosure>
          <ErrorNotice error={retireEvent.error} />
          <Async query={events} lines={6}>
            {({ items }) => (
              <ul className="divide-y divide-line border-y border-line">
                {items.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
                    <div className="min-w-0 space-y-1">
                      <p className={e.state === 'RETIRED' ? 'text-muted line-through' : 'font-medium text-fg'}>{pick(e, 'title')}</p>
                      <p className="flex flex-wrap items-center gap-2 text-muted">
                        {pick(e, 'dates') || t.dashboard.notAnnounced}
                        <EventStatusBadge status={e.status} />
                        {e.record_id && <span dir="ltr" className="text-xs">{e.record_id}</span>}
                        {e.state === 'RETIRED' && <Badge tone="dashed">{c.retired}</Badge>}
                      </p>
                    </div>
                    {e.state !== 'RETIRED' && (
                      <Button size="sm" variant="ghost" loading={retireEvent.isPending && retireEvent.variables === e.id} onClick={() => retireEvent.mutate(e.id)}>
                        {t.admin.academic.retire}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Async>
        </Section>

        <Section title={c.claims}>
          <Disclosure label={c.addClaim}>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                addClaim.mutate();
              }}
            >
              <Bilingual labelFr={c.claimFr} labelAr={c.claimAr} fr={cl.claim_fr} ar={cl.claim_ar} onFr={(v) => setCl({ ...cl, claim_fr: v })} onAr={(v) => setCl({ ...cl, claim_ar: v })} rows={2} />
              <Bilingual labelFr={c.findingFr} labelAr={c.findingAr} fr={cl.finding_fr} ar={cl.finding_ar} onFr={(v) => setCl({ ...cl, finding_fr: v })} onAr={(v) => setCl({ ...cl, finding_ar: v })} rows={3} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={c.verdict}>
                  {(p) => (
                    <Select {...p} value={cl.verdict} onChange={(e) => setCl({ ...cl, verdict: e.target.value as ClaimVerdict })}>
                      {(['UNVERIFIED', 'SUPERSEDED', 'CONTRADICTED'] as ClaimVerdict[]).map((v) => (
                        <option key={v} value={v}>
                          {t.verdict[v]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={c.checkedOn}>{(p) => <Input {...p} type="date" value={cl.checked_on} onChange={(e) => setCl({ ...cl, checked_on: e.target.value })} />}</Field>
                <RecordSelect label={t.admin.review.linkedRecord} value={cl.record_id} onChange={(id) => setCl({ ...cl, record_id: id })} />
              </div>
              <ErrorNotice error={addClaim.error} />
              <Button
                type="submit"
                disabled={!cl.claim_fr.trim() || !cl.claim_ar.trim() || !cl.finding_fr.trim() || !cl.finding_ar.trim()}
                loading={addClaim.isPending}
              >
                {t.common.add}
              </Button>
            </form>
          </Disclosure>
          <ErrorNotice error={retireClaim.error} />
          <Async query={claims} lines={4}>
            {({ items }) => (
              <ul className="divide-y divide-line border-y border-line">
                {items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3 text-sm">
                    <div className="min-w-0 max-w-3xl space-y-1">
                      <p className={item.state === 'RETIRED' ? 'text-muted line-through' : 'font-medium text-fg'}>{pick(item, 'claim')}</p>
                      <p className="text-muted">{pick(item, 'finding')}</p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <VerdictBadge verdict={item.verdict} />
                        {t.common.checkedOn(date(item.checked_on))}
                      </p>
                    </div>
                    {item.state !== 'RETIRED' && (
                      <Button size="sm" variant="ghost" loading={retireClaim.isPending && retireClaim.variables === item.id} onClick={() => retireClaim.mutate(item.id)}>
                        {t.admin.academic.retire}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Async>
        </Section>
      </div>
    </>
  );
}

// --- Past papers ------------------------------------------------------------------------

export function ArchiveAdminPage() {
  const { t, pick } = useI18n();
  const meta = useMeta();
  const client = useQueryClient();
  const a = t.admin.archive;
  const query = useQuery({ queryKey: ['admin', 'archive'], queryFn: () => api<{ items: (PastPaper & { state: string })[] }>('/admin/archive') });
  const [doc, setDoc] = useState({
    exam_year: '2026', stream_id: '', subject_id: '', language: 'ar' as PastPaper['language'], doc_type: 'SUBJECT' as DocType,
    title: '', source_authority: '', publication_date: '', url: '', verification: 'UNVERIFIED' as Verification, note: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const refresh = () => void client.invalidateQueries();
  const add = useMutation({
    mutationFn: () => {
      if (file) {
        const form = new FormData();
        const { url: _url, ...fields } = doc;
        for (const [key, value] of Object.entries(fields)) form.append(key, value);
        form.append('file', file);
        return apiForm('/admin/archive/upload', form);
      }
      return api('/admin/archive', {
        body: {
          ...doc,
          exam_year: Number(doc.exam_year),
          stream_id: doc.stream_id ? Number(doc.stream_id) : null,
          subject_id: doc.subject_id ? Number(doc.subject_id) : null,
          publication_date: doc.publication_date || null,
          note: doc.note || null,
        },
      });
    },
    onSuccess: () => {
      // Keep the year, stream, source and level: uploads usually come in batches.
      setDoc((prev) => ({ ...prev, title: '', url: '', note: '' }));
      setFile(null);
      setFileKey((k) => k + 1);
      refresh();
    },
  });
  const retire = useMutation({ mutationFn: (id: number) => api(`/admin/archive/${id}/retire`, { method: 'POST' }), onSuccess: refresh });

  return (
    <>
      <AdminLead>{a.lead}</AdminLead>
      <Disclosure label={a.add}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t.archive.year}>{(p) => <Input {...p} inputMode="numeric" dir="ltr" value={doc.exam_year} onChange={(e) => setDoc({ ...doc, exam_year: e.target.value })} />}</Field>
            <Field label={t.archive.type}>
              {(p) => (
                <Select {...p} value={doc.doc_type} onChange={(e) => setDoc({ ...doc, doc_type: e.target.value as DocType })}>
                  {DOC_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {t.docType[d]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t.admin.review.verificationLevel}>
              {(p) => (
                <Select {...p} value={doc.verification} onChange={(e) => setDoc({ ...doc, verification: e.target.value as Verification })}>
                  {VERIFICATIONS.map((v) => (
                    <option key={v} value={v}>
                      {t.verification[v]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={a.language}>
              {(p) => (
                <Select {...p} value={doc.language} onChange={(e) => setDoc({ ...doc, language: e.target.value as PastPaper['language'] })}>
                  {(['ar', 'fr', 'other'] as const).map((l) => (
                    <option key={l} value={l}>
                      {t.archive.languages[l]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t.settings.stream}>
              {(p) => (
                <Select {...p} value={doc.stream_id} onChange={(e) => setDoc({ ...doc, stream_id: e.target.value })}>
                  <option value="">{a.allStreams}</option>
                  {meta.data?.streams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {pick(s, 'name')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t.subjects.subject}>
              {(p) => (
                <Select {...p} value={doc.subject_id} onChange={(e) => setDoc({ ...doc, subject_id: e.target.value })}>
                  <option value="">{a.anySubject}</option>
                  {meta.data?.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {pick(s, 'name')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={a.authority}>{(p) => <Input {...p} dir="auto" value={doc.source_authority} onChange={(e) => setDoc({ ...doc, source_authority: e.target.value })} />}</Field>
            <Field label={a.publication}>{(p) => <Input {...p} type="date" value={doc.publication_date} onChange={(e) => setDoc({ ...doc, publication_date: e.target.value })} />}</Field>
          </div>
          <Field label={a.docTitle}>{(p) => <Input {...p} dir="auto" value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />}</Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={a.file} hint={a.fileHint}>
              {(p) => (
                <Input
                  {...p}
                  key={fileKey}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="h-auto py-2 file:me-3 file:rounded-md file:border-0 file:bg-panel file:px-3 file:py-1 file:text-sm file:font-medium file:text-fg"
                  onChange={(e) => {
                    const chosen = e.target.files?.[0] ?? null;
                    setFile(chosen);
                    if (chosen && !doc.title.trim()) setDoc((prev) => ({ ...prev, title: chosen.name.replace(/.pdf$/i, '') }));
                  }}
                />
              )}
            </Field>
            <Field label={a.url} hint={a.urlHint}>
              {(p) => (
                <Input {...p} type="url" dir="ltr" placeholder="https://" disabled={file !== null} value={doc.url} onChange={(e) => setDoc({ ...doc, url: e.target.value })} />
              )}
            </Field>
          </div>
          <Field label={a.note}>{(p) => <Input {...p} dir="auto" value={doc.note} onChange={(e) => setDoc({ ...doc, note: e.target.value })} />}</Field>
          <ErrorNotice error={add.error} />
          <Button type="submit" disabled={!doc.title.trim() || !doc.source_authority.trim() || (!file && !doc.url.trim())} loading={add.isPending}>
            {t.common.add}
          </Button>
        </form>
      </Disclosure>
      <ErrorNotice error={retire.error} />
      <Async query={query} lines={4}>
        {({ items }) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">{a.empty}</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {items.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
                  <div className="min-w-0 space-y-1">
                    <p className={p.state === 'RETIRED' ? 'text-muted line-through' : 'font-medium text-fg'} dir="auto">
                      {p.title}
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-muted">
                      <span className="tabular">BAC {p.exam_year}</span>
                      <DocTypeBadge type={p.doc_type} />
                      <VerificationBadge level={p.verification} />
                      <ExternalLink href={p.url} className="text-xs">
                        {p.file_name ? `PDF · ${p.source_authority}` : p.source_authority}
                      </ExternalLink>
                    </p>
                  </div>
                  {p.state !== 'RETIRED' && (
                    <Button size="sm" variant="ghost" loading={retire.isPending && retire.variables === p.id} onClick={() => retire.mutate(p.id)}>
                      {t.admin.academic.retire}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </>
  );
}

// --- Users and audit log -----------------------------------------------------------------

export function UsersPage() {
  const { t, date } = useI18n();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<{ items: User[] }>('/admin/users') });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api(`/admin/users/${id}/role`, { method: 'PATCH', body: { role } }),
    onSettled: () => void client.invalidateQueries({ queryKey: ['admin'] }),
  });
  const [issued, setIssued] = useState<{ name: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const resetLink = useMutation({
    mutationFn: (u: User) => api<{ token: string }>(`/admin/users/${u.id}/reset-link`, { method: 'POST' }),
    onSuccess: ({ token }, u) => {
      setCopied(false);
      setIssued({ name: u.name, link: `${window.location.origin}/reset#${token}` });
    },
  });
  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <AdminLead>{t.admin.users.lead}</AdminLead>
      <ErrorNotice error={setRole.error ?? resetLink.error} />
      {issued && (
        <Notice tone="ok" role="status" className="mb-4 max-w-3xl">
          <p>{t.admin.users.resetIssued(issued.name)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code dir="ltr" className="min-w-0 flex-1 break-all rounded bg-panel px-2 py-1 text-xs text-fg">
              {issued.link}
            </code>
            <Button size="sm" variant="secondary" onClick={() => void copy(issued.link)}>
              {copied ? t.admin.users.copied : t.admin.users.copy}
            </Button>
          </div>
        </Notice>
      )}
      <Async query={query} lines={5}>
        {({ items }) => (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t.settings.name}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t.settings.email}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t.admin.users.joined}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t.settings.role}</th>
                  <th scope="col" className="py-2 ps-3 text-start font-medium">
                    <span className="sr-only">{t.admin.users.resetLink}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((u) => (
                  <tr key={u.id}>
                    <th scope="row" className="py-2.5 pe-3 text-start font-medium text-fg">{u.name}</th>
                    <td className="px-3 py-2.5 text-muted" dir="ltr">{u.email}</td>
                    <td className="px-3 py-2.5 text-muted">{date(u.created_at)}</td>
                    <td className="px-3 py-2">
                      <Select
                        aria-label={`${t.settings.role} : ${u.name}`}
                        className="h-9 w-40"
                        value={u.role}
                        onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value as Role })}
                      >
                        {(['student', 'teacher', 'admin'] as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {t.roles[r]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 ps-3 text-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={resetLink.isPending && resetLink.variables?.id === u.id}
                        onClick={() => resetLink.mutate(u)}
                      >
                        {t.admin.users.resetLink}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </>
  );
}

export function AuditPage() {
  const { t } = useI18n();
  const a = t.admin.audit;
  const query = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api<{ items: AuditEntry[] }>('/admin/audit') });
  const stamp = (iso: string) =>
    new Intl.DateTimeFormat('fr-DZ', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Algiers', numberingSystem: 'latn' }).format(new Date(iso));
  return (
    <>
      <AdminLead>{a.lead}</AdminLead>
      <Async query={query} lines={8}>
        {({ items }) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">{a.empty}</p>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-muted">
                    <th scope="col" className="py-2 pe-3 text-start font-medium">{a.when}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{a.who}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{a.action}</th>
                    <th scope="col" className="py-2 ps-3 text-start font-medium">{a.target}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((e) => (
                    <tr key={e.id} className="align-top">
                      <td className="tabular py-2.5 pe-3 whitespace-nowrap text-muted" dir="ltr">{stamp(e.at)}</td>
                      <td className="px-3 py-2.5 text-fg">{e.actor_name}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-fg" dir="ltr">{e.action}</td>
                      <td className="py-2.5 ps-3 text-muted" dir="ltr">
                        {e.entity}
                        {e.entity_id ? ` #${e.entity_id}` : ''}
                        {e.detail && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-accent">JSON</summary>
                            <pre className="mt-1 max-w-md overflow-x-auto text-xs whitespace-pre-wrap">{JSON.stringify(e.detail, null, 2)}</pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
    </>
  );
}
