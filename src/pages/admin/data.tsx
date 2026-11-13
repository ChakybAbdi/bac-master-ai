import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import type { CoefficientRow, MonitoringRun, OfficialRecord, RecordHistoryEntry, Verification } from '@shared/types.ts';
import { VERIFICATIONS } from '@shared/types.ts';
import { Badge, ChangeBadge, PriorityBadge, RowStateBadge, VerificationBadge } from '@/components/badges.tsx';
import { Markdown } from '@/components/Markdown.tsx';
import { Async, Button, ErrorNotice, ExternalLink, Field, Input, Notice, Section, Select, Textarea, cx } from '@/components/ui.tsx';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMe, useMeta } from '@/lib/session.tsx';
import { AdminLead } from './index.tsx';

// --- Monitoring ------------------------------------------------------------------

interface ImportResult {
  created: string[];
  changed: string[];
  refreshed: string[];
  unchanged: number;
}

export function MonitoringPage() {
  const { t, date } = useI18n();
  const me = useMe();
  const client = useQueryClient();
  const m = t.admin.monitoring;
  const runs = useQuery({ queryKey: ['admin', 'runs'], queryFn: () => api<{ items: MonitoringRun[] }>('/admin/monitoring/runs') });
  const [selected, setSelected] = useState<number | null>(null);
  const runId = selected ?? runs.data?.items[0]?.id ?? null;
  const report = useQuery({
    queryKey: ['admin', 'run', runId],
    queryFn: () => api<{ run: MonitoringRun }>(`/admin/monitoring/runs/${runId}`),
    enabled: runId !== null,
  });
  const importRun = useMutation({
    mutationFn: () => api<ImportResult>('/admin/monitoring/import', { method: 'POST' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin'] }),
  });

  return (
    <>
      <AdminLead>{m.lead}</AdminLead>
      <div className="mb-8 space-y-3">
        <p className="text-xs text-muted" dir="ltr">
          {m.folder}
        </p>
        {me.data?.role === 'admin' && (
          <Button variant="secondary" loading={importRun.isPending} onClick={() => importRun.mutate()}>
            {m.import}
          </Button>
        )}
        <ErrorNotice error={importRun.error} />
        {importRun.data && (
          <Notice tone="ok" role="status" className="max-w-3xl">
            {m.imported(importRun.data.created.length, importRun.data.changed.length, importRun.data.refreshed.length, importRun.data.unchanged)}
          </Notice>
        )}
      </div>

      <Async query={runs}>
        {({ items }) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">{m.noRuns}</p>
          ) : (
            <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
              <Section title={m.runs}>
                <ul className="space-y-0.5">
                  {items.map((run) => (
                    <li key={run.id}>
                      <button
                        type="button"
                        aria-current={run.id === runId || undefined}
                        onClick={() => setSelected(run.id)}
                        className={cx(
                          'block w-full rounded-lg px-2.5 py-2 text-start text-sm transition-colors duration-150',
                          run.id === runId ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-panel hover:text-fg',
                        )}
                      >
                        {m.checkedAt} {date(run.checked_at)}
                        <span className="block text-xs font-normal opacity-80">
                          {m.previous} : {run.previous_check ? date(run.previous_check) : t.common.none}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title={m.report}>
                <Async query={report} lines={12}>
                  {({ run }) =>
                    run.report_markdown ? (
                      <div className="rounded-xl border border-line bg-surface px-5 py-5">
                        <Markdown source={run.report_markdown} lang="fr" className="max-w-none" />
                      </div>
                    ) : (
                      <p className="text-sm text-muted">{m.noReport}</p>
                    )
                  }
                </Async>
              </Section>
            </div>
          )
        }
      </Async>
    </>
  );
}

// --- Official records ----------------------------------------------------------------

function RecordDetail({ id }: { id: string }) {
  const { t, date } = useI18n();
  const client = useQueryClient();
  const r = t.admin.records;
  const query = useQuery({
    queryKey: ['admin', 'record', id],
    queryFn: () => api<{ record: OfficialRecord; history: RecordHistoryEntry[] }>(`/admin/records/${id}`),
  });
  const [form, setForm] = useState({ title_fr: '', title_ar: '', summary_fr: '', summary_ar: '', impact_fr: '', impact_ar: '', published: false });
  const record = query.data?.record;
  useEffect(() => {
    if (!record) return;
    setForm({
      title_fr: record.title_fr ?? '',
      title_ar: record.title_ar ?? '',
      summary_fr: record.summary_fr ?? '',
      summary_ar: record.summary_ar ?? '',
      impact_fr: record.impact_fr ?? '',
      impact_ar: record.impact_ar ?? '',
      published: record.visibility === 'PUBLISHED',
    });
  }, [record]);
  const save = useMutation({
    mutationFn: () => {
      const { published, ...wording } = form;
      return api(`/admin/records/${id}`, { method: 'PATCH', body: { ...wording, visibility: published ? 'PUBLISHED' : 'INTERNAL' } });
    },
    onSuccess: () => void client.invalidateQueries(),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Async query={query} lines={12}>
      {({ record: rec, history }) => {
        const rows: [string, string | null][] = [
          [r.fields.topic, rec.topic],
          [r.fields.authority, rec.authority],
          [r.fields.document, rec.document_title],
          [r.fields.publication, rec.publication_date],
          [r.fields.session, rec.examination_year],
          [r.fields.stream, rec.applicable_stream],
          [r.fields.subject, rec.applicable_subject],
          [r.fields.previous, rec.previous_value],
          [r.fields.next, rec.new_value],
          [r.fields.studentImpact, rec.student_impact],
          [r.fields.productImpact, rec.product_impact],
          [r.fields.action, rec.required_action],
          [r.fields.supersededBy, rec.superseded_by.join(', ') || null],
          [r.fields.claims, rec.unverified_claims.join(' ; ') || null],
          [r.fields.firstDetected, rec.first_detected],
          [r.fields.lastVerified, rec.last_verified],
        ];
        return (
          <div className="space-y-8">
            <div className="space-y-2">
              <p className="flex flex-wrap items-center gap-2">
                <span dir="ltr" className="text-sm font-semibold text-muted">
                  {rec.id}
                </span>
                <VerificationBadge level={rec.verification} />
                <ChangeBadge status={rec.change_status} />
                <PriorityBadge priority={rec.priority} />
                <Badge tone={rec.visibility === 'PUBLISHED' ? 'ok' : 'dashed'}>{r.visibility[rec.visibility]}</Badge>
              </p>
              {(rec.verification_note || rec.change_note) && (
                <p className="text-xs text-muted" dir="ltr" lang="en">
                  {[rec.verification_note, rec.change_note].filter(Boolean).join(' | ')}
                </p>
              )}
              {rec.original_url && <ExternalLink href={rec.original_url}>{r.fields.url}</ExternalLink>}
            </div>

            <dl className="divide-y divide-line border-y border-line text-sm">
              {rows
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
                    <dt className="text-muted">{label}</dt>
                    <dd className="min-w-0 whitespace-pre-wrap text-fg" dir="ltr" lang="en">
                      {value}
                    </dd>
                  </div>
                ))}
            </dl>

            <Section title={r.wording}>
              <form
                className="space-y-4"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={r.titleFr}>{(p) => <Input {...p} dir="ltr" lang="fr" value={form.title_fr} onChange={set('title_fr')} />}</Field>
                  <Field label={r.titleAr}>{(p) => <Input {...p} dir="rtl" lang="ar" value={form.title_ar} onChange={set('title_ar')} />}</Field>
                  <Field label={r.summaryFr}>
                    {(p) => <Textarea {...p} dir="ltr" lang="fr" rows={6} value={form.summary_fr} onChange={set('summary_fr')} />}
                  </Field>
                  <Field label={r.summaryAr}>
                    {(p) => <Textarea {...p} dir="rtl" lang="ar" rows={6} value={form.summary_ar} onChange={set('summary_ar')} />}
                  </Field>
                  <Field label={r.impactFr}>
                    {(p) => <Textarea {...p} dir="ltr" lang="fr" rows={2} value={form.impact_fr} onChange={set('impact_fr')} />}
                  </Field>
                  <Field label={r.impactAr}>
                    {(p) => <Textarea {...p} dir="rtl" lang="ar" rows={2} value={form.impact_ar} onChange={set('impact_ar')} />}
                  </Field>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    className="size-4 accent-(--accent)"
                    checked={form.published}
                    onChange={(e) => setForm((prev) => ({ ...prev, published: e.target.checked }))}
                  />
                  {r.visibleToStudents}
                </label>
                <ErrorNotice error={save.error} />
                <Button type="submit" loading={save.isPending}>
                  {t.common.save}
                </Button>
              </form>
            </Section>

            <Section title={r.history}>
              {history.length === 0 ? (
                <p className="text-sm text-muted">{r.noHistory}</p>
              ) : (
                <ul className="space-y-2">
                  {history.map((h) => (
                    <li key={h.id}>
                      <details className="rounded-lg border border-line">
                        <summary className="cursor-pointer px-3 py-2 text-sm text-fg">
                          {r.replacedOn(date(h.replaced_at))}
                          {h.replaced_by_name && ` · ${h.replaced_by_name}`}
                          {h.reason && <span className="block text-xs text-muted" dir="ltr">{h.reason}</span>}
                        </summary>
                        <pre dir="ltr" className="overflow-x-auto border-t border-line px-3 py-2 text-xs whitespace-pre-wrap text-muted">
                          {JSON.stringify(
                            Object.fromEntries(Object.entries(h.snapshot).filter(([key]) => key !== 'raw')),
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        );
      }}
    </Async>
  );
}

export function RecordsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const selected = params.get('id');
  const query = useQuery({ queryKey: ['admin', 'records'], queryFn: () => api<{ items: OfficialRecord[] }>('/admin/records') });
  return (
    <>
      <AdminLead>{t.admin.records.lead}</AdminLead>
      <Async query={query} lines={10}>
        {({ items }) => (
          <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[19rem_minmax(0,1fr)]">
            <ul className="space-y-0.5 lg:max-h-[75vh] lg:overflow-y-auto">
              {items.map((rec) => (
                <li key={rec.id}>
                  <button
                    type="button"
                    aria-current={rec.id === selected || undefined}
                    onClick={() => setParams({ id: rec.id }, { replace: true })}
                    className={cx(
                      'block w-full rounded-lg px-2.5 py-2.5 text-start transition-colors duration-150',
                      rec.id === selected ? 'bg-accent-soft' : 'hover:bg-panel',
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span dir="ltr" className="text-xs font-semibold text-muted">
                        {rec.id}
                      </span>
                      <VerificationBadge level={rec.verification} />
                      {rec.visibility === 'INTERNAL' && <Badge tone="dashed">{t.admin.records.visibility.INTERNAL}</Badge>}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm text-fg" dir="auto">
                      {rec.title_fr ?? rec.topic}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-w-0">
              {selected ? <RecordDetail key={selected} id={selected} /> : <p className="text-sm text-muted">{t.admin.records.select}</p>}
            </div>
          </div>
        )}
      </Async>
    </>
  );
}

// --- Academic database ---------------------------------------------------------------

interface Table {
  stream_id: number;
  current: CoefficientRow[];
  history: CoefficientRow[];
}

interface RowDraft {
  subject_id: string;
  coefficient: string;
  duration: string;
  optional: boolean;
  verification: Verification;
  record: string;
  note: string;
}

const emptyDraft: RowDraft = { subject_id: '', coefficient: '', duration: '', optional: false, verification: 'UNVERIFIED', record: '', note: '' };

function RowForm({
  editionId,
  streamId,
  row,
  taken,
  records,
  onDone,
}: {
  editionId: number;
  streamId: number;
  row: CoefficientRow | null;
  taken: number[];
  records: OfficialRecord[];
  onDone: () => void;
}) {
  const { t, pick } = useI18n();
  const meta = useMeta();
  const client = useQueryClient();
  const a = t.admin.academic;
  const [draft, setDraft] = useState<RowDraft>(
    row
      ? {
          subject_id: String(row.subject_id),
          coefficient: row.coefficient === null ? '' : String(row.coefficient),
          duration: row.duration_minutes === null ? '' : String(row.duration_minutes),
          optional: row.is_optional === 1,
          verification: row.verification,
          record: row.source_record_id ?? '',
          note: '',
        }
      : emptyDraft,
  );
  const coefficient = draft.coefficient.trim() === '' ? null : Number(draft.coefficient.replace(',', '.'));
  const duration = draft.duration.trim() === '' ? null : Number(draft.duration);
  const valid =
    draft.subject_id !== '' &&
    draft.note.trim().length > 0 &&
    (coefficient === null || (Number.isFinite(coefficient) && coefficient >= 0.5 && coefficient <= 20)) &&
    (duration === null || (Number.isInteger(duration) && duration >= 15 && duration <= 480));
  const save = useMutation({
    mutationFn: () =>
      api('/admin/academic/row', {
        method: 'PUT',
        body: {
          edition_id: editionId,
          stream_id: streamId,
          subject_id: Number(draft.subject_id),
          coefficient,
          duration_minutes: duration,
          is_optional: draft.optional,
          verification: draft.verification,
          source_record_id: draft.record || null,
          source_note: draft.note.trim(),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries();
      onDone();
    },
  });
  const subjects = (meta.data?.subjects ?? []).filter((s) => row !== null || !taken.includes(s.id));

  return (
    <form
      className="animate-enter space-y-3 rounded-xl bg-panel px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t.subjects.subject}>
          {(p) => (
            <Select {...p} disabled={row !== null} value={draft.subject_id} onChange={(e) => setDraft({ ...draft, subject_id: e.target.value })}>
              <option value="">{t.subjects.chooseSubject}</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {pick(s, 'name')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t.subjects.coefficient}>
          {(p) => <Input {...p} inputMode="decimal" dir="ltr" value={draft.coefficient} onChange={(e) => setDraft({ ...draft, coefficient: e.target.value })} />}
        </Field>
        <Field label={a.duration}>
          {(p) => <Input {...p} inputMode="numeric" dir="ltr" value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value })} />}
        </Field>
        <Field label={t.admin.review.verificationLevel}>
          {(p) => (
            <Select {...p} value={draft.verification} onChange={(e) => setDraft({ ...draft, verification: e.target.value as Verification })}>
              {VERIFICATIONS.map((v) => (
                <option key={v} value={v}>
                  {t.verification[v]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={a.sourceRecord}>
          {(p) => (
            <Select {...p} value={draft.record} onChange={(e) => setDraft({ ...draft, record: e.target.value })}>
              <option value="">{t.common.none}</option>
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} · {(r.title_fr ?? r.topic).slice(0, 60)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={a.note}>{(p) => <Input {...p} dir="auto" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />}</Field>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input type="checkbox" className="size-4 accent-(--accent)" checked={draft.optional} onChange={(e) => setDraft({ ...draft, optional: e.target.checked })} />
        {a.optional}
      </label>
      <ErrorNotice error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!valid} loading={save.isPending}>
          {a.saveRow}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function StreamTable({ table, editionId, records, focused }: { table: Table; editionId: number; records: OfficialRecord[]; focused: boolean }) {
  const { t, pick, date, number } = useI18n();
  const meta = useMeta();
  const client = useQueryClient();
  const a = t.admin.academic;
  const stream = meta.data?.streams.find((s) => s.id === table.stream_id);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [retiring, setRetiring] = useState<number | null>(null);
  const [retireNote, setRetireNote] = useState('');
  const [level, setLevel] = useState<Verification>('VERIFIED');
  const [evidence, setEvidence] = useState('');
  const [record, setRecord] = useState('');

  const subjectName = (id: number): string => {
    const subject = meta.data?.subjects.find((s) => s.id === id);
    return subject ? pick(subject, 'name') : String(id);
  };
  const provisional = table.current.some((r) => r.state === 'PROVISIONAL');
  const published = table.current.some((r) => r.state === 'PUBLISHED');

  const retire = useMutation({
    mutationFn: (id: number) => api(`/admin/academic/row/${id}/retire`, { body: { note: retireNote } }),
    onSuccess: () => {
      setRetiring(null);
      setRetireNote('');
      void client.invalidateQueries();
    },
  });
  const publish = useMutation({
    mutationFn: () =>
      api('/admin/academic/publish', {
        body: { edition_id: editionId, stream_id: table.stream_id, verification: level, evidence, record_id: record || null },
      }),
    onSuccess: () => void client.invalidateQueries(),
  });

  return (
    <section id={`stream-${table.stream_id}`} aria-labelledby={`stream-title-${table.stream_id}`} className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 id={`stream-title-${table.stream_id}`} className={cx('text-lg font-semibold', focused ? 'text-accent' : 'text-fg')}>
          {stream ? pick(stream, 'name') : table.stream_id}
        </h2>
        {table.current.length > 0 && (
          <span className="text-sm text-muted">{published && !provisional ? a.visibleToStudents : a.hiddenFromStudents}</span>
        )}
      </div>

      {table.current.length === 0 ? (
        <p className="text-sm text-muted">{a.noTable}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="py-2 pe-3 text-start font-medium">{t.subjects.subject}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t.subjects.coefficient}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{a.duration}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t.admin.calendar.status}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{a.version}</th>
                <th scope="col" className="py-2 ps-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {table.current.map((row) => (
                <tr key={row.id} className="align-top">
                  <th scope="row" className="py-2.5 pe-3 text-start font-medium text-fg">
                    {subjectName(row.subject_id)} {row.is_optional === 1 && <Badge tone="neutral">{a.optional}</Badge>}
                    {row.source_note && <span className="mt-0.5 block max-w-xs text-xs font-normal text-muted" dir="auto">{row.source_note}</span>}
                  </th>
                  <td className="tabular px-3 py-2.5 font-semibold text-fg">{row.coefficient === null ? t.common.notSet : number(row.coefficient)}</td>
                  <td className="tabular px-3 py-2.5 text-muted">{row.duration_minutes ?? t.common.notSet}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-col items-start gap-1">
                      <RowStateBadge state={row.state} />
                      <VerificationBadge level={row.verification} />
                    </span>
                  </td>
                  <td className="tabular px-3 py-2.5 text-muted">
                    {row.version}
                    {row.verified_by_name && (
                      <span className="block text-xs">
                        {row.verified_by_name}, {date(row.verified_at)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 ps-3 text-end whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(editing === row.id ? null : row.id)}>
                      {t.common.edit}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRetiring(retiring === row.id ? null : row.id)}>
                      {a.retire}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {typeof editing === 'number' && (
          <RowForm
            key={editing}
            editionId={editionId}
            streamId={table.stream_id}
            row={table.current.find((r) => r.id === editing) ?? null}
            taken={[]}
            records={records}
            onDone={() => setEditing(null)}
          />
        )}
        {retiring !== null && (
          <form
            className="flex animate-enter flex-wrap items-end gap-3 rounded-xl bg-panel px-4 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              retire.mutate(retiring);
            }}
          >
            <Field label={`${a.retireNote} (${subjectName(table.current.find((r) => r.id === retiring)?.subject_id ?? 0)})`} className="min-w-64 flex-1">
              {(p) => <Input {...p} dir="auto" value={retireNote} onChange={(e) => setRetireNote(e.target.value)} />}
            </Field>
            <Button type="submit" size="sm" variant="danger" disabled={retireNote.trim().length === 0} loading={retire.isPending}>
              {a.retire}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRetiring(null)}>
              {t.common.cancel}
            </Button>
          </form>
        )}
        {editing === 'new' ? (
          <RowForm
            editionId={editionId}
            streamId={table.stream_id}
            row={null}
            taken={table.current.map((r) => r.subject_id)}
            records={records}
            onDone={() => setEditing(null)}
          />
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            {a.addRow}
          </Button>
        )}
        <ErrorNotice error={retire.error} />
      </div>

      {provisional && (
        <form
          className="mt-5 max-w-3xl space-y-3 rounded-xl border border-warn-line bg-warn-soft px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            publish.mutate();
          }}
        >
          <div>
            <h3 className="text-sm font-semibold text-fg">{a.publishTitle}</h3>
            <p className="mt-0.5 text-sm text-fg/80">{a.publishLead}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.admin.review.verificationLevel}>
              {(p) => (
                <Select {...p} value={level} onChange={(e) => setLevel(e.target.value as Verification)}>
                  {VERIFICATIONS.map((v) => (
                    <option key={v} value={v}>
                      {t.verification[v]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={a.sourceRecord}>
              {(p) => (
                <Select {...p} value={record} onChange={(e) => setRecord(e.target.value)}>
                  <option value="">{t.common.none}</option>
                  {records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id} · {(r.title_fr ?? r.topic).slice(0, 60)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label={t.admin.review.evidence} hint={t.admin.review.evidenceHint}>
            {(p) => <Textarea {...p} rows={2} className="min-h-0" dir="auto" value={evidence} onChange={(e) => setEvidence(e.target.value)} />}
          </Field>
          <ErrorNotice error={publish.error} />
          <Button type="submit" loading={publish.isPending}>
            {a.publish}
          </Button>
        </form>
      )}

      {table.history.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-muted hover:text-fg">{a.history(table.history.length)}</summary>
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {table.history.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <span className="font-medium text-fg">{subjectName(row.subject_id)}</span>
                <span className="tabular text-muted">
                  {t.subjects.coefficient} {row.coefficient === null ? t.common.notSet : number(row.coefficient)} · {a.version} {row.version}
                </span>
                <RowStateBadge state={row.state} />
                <span className="text-xs text-muted">{date(row.created_at)}</span>
                {row.source_note && <span className="text-xs text-muted" dir="auto">{row.source_note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function AcademicPage() {
  const { t } = useI18n();
  const meta = useMeta();
  const [params] = useSearchParams();
  const focus = params.get('stream') ? Number(params.get('stream')) : null;
  const [edition, setEdition] = useState<number | null>(null);
  const editionId = edition ?? meta.data?.editions.find((e) => e.status === 'ACTIVE')?.id ?? null;
  const tables = useQuery({
    queryKey: ['admin', 'academic', editionId],
    queryFn: () => api<{ tables: Table[] }>(`/admin/academic?edition_id=${editionId}`),
    enabled: editionId !== null,
  });
  const records = useQuery({ queryKey: ['admin', 'records'], queryFn: () => api<{ items: OfficialRecord[] }>('/admin/records') });

  useEffect(() => {
    if (focus && tables.data) document.getElementById(`stream-${focus}`)?.scrollIntoView({ block: 'start' });
  }, [focus, tables.data]);

  return (
    <>
      <AdminLead>{t.admin.academic.lead}</AdminLead>
      <Field label={t.admin.academic.edition} className="mb-8 max-w-xs">
        {(p) => (
          <Select {...p} value={editionId ?? ''} onChange={(e) => setEdition(Number(e.target.value))}>
            {meta.data?.editions.map((e) => (
              <option key={e.id} value={e.id}>
                BAC {e.exam_year} ({t.editionStatus[e.status]})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Async query={tables} lines={12}>
        {(data) => (
          <div className="space-y-12">
            {data.tables.map((table) => (
              <StreamTable
                key={`${editionId}-${table.stream_id}`}
                table={table}
                editionId={editionId!}
                records={records.data?.items ?? []}
                focused={focus === table.stream_id}
              />
            ))}
          </div>
        )}
      </Async>
    </>
  );
}
