import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import type { AdminOverview, Proposal, Verification } from '@shared/types.ts';
import { VERIFICATIONS } from '@shared/types.ts';
import { Badge, PriorityBadge } from '@/components/badges.tsx';
import { IconArrow } from '@/components/icons.ts';
import { Async, Button, ErrorNotice, Field, Input, Select, Textarea, cx } from '@/components/ui.tsx';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMe } from '@/lib/session.tsx';

export function AdminLayout() {
  const { t } = useI18n();
  const me = useMe();
  const admin = me.data?.role === 'admin';
  const nav = t.admin.nav;
  const items: [string, string, boolean?][] = [
    ['/admin', nav.overview, true],
    ['/admin/review', nav.review],
    ['/admin/monitoring', nav.monitoring],
    ['/admin/records', nav.records],
    ['/admin/academic', nav.academic],
    ['/admin/content', nav.content],
    ['/admin/announcements', nav.announcements],
    ['/admin/calendar', nav.calendar],
    ['/admin/archive', nav.archive],
    ...(admin ? ([['/admin/users', nav.users]] as [string, string][]) : []),
    ['/admin/audit', nav.audit],
  ];
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-fg">{t.admin.title}</h1>
      <nav aria-label={t.admin.title} className="-mx-4 mb-7 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {items.map(([to, label, end]) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors duration-150',
                isActive ? 'border-ink font-semibold text-fg' : 'border-transparent text-muted hover:text-fg',
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

/** Lead paragraph shared by the admin pages. */
export function AdminLead({ children }: { children: ReactNode }) {
  return <p className="mb-6 max-w-prose text-sm text-muted">{children}</p>;
}

export function OverviewPage() {
  const { t, date } = useI18n();
  const me = useMe();
  const query = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<AdminOverview>('/admin/overview') });
  const o = t.admin.overview;
  return (
    <>
      <AdminLead>{o.lead}</AdminLead>
      <Async query={query} lines={8}>
        {(data) => {
          const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
          const rows: { label: string; value: ReactNode; hint?: ReactNode; to?: string; attention?: boolean }[] = [
            {
              label: o.pending,
              value: data.pending_proposals,
              hint: data.mandatory_pending > 0 ? o.mandatory(data.mandatory_pending) : undefined,
              to: '/admin/review',
              attention: data.pending_proposals > 0,
            },
            {
              label: o.provisional,
              value: data.provisional_tables,
              hint: data.provisional_tables > 0 ? o.provisionalHint : undefined,
              to: '/admin/academic',
              attention: data.provisional_tables > 0,
            },
            { label: o.drafts, value: data.draft_announcements, to: '/admin/announcements' },
            { label: o.unreviewed, value: data.unreviewed_content, to: '/admin/content' },
            {
              label: o.records,
              value: data.records.total,
              hint: o.recordsDetail(data.records.verified, data.records.partial, data.records.unverified),
              to: '/admin/records',
            },
            {
              label: o.lastRun,
              value: data.last_run ? date(data.last_run.checked_at) : o.noRun,
              hint: data.last_run ? (
                <span className="space-y-1">
                  {strings(data.last_run.summary.unreachable).length > 0 && (
                    <span className="block" dir="auto">
                      {o.unreachable} : {strings(data.last_run.summary.unreachable).join(' ; ')}
                    </span>
                  )}
                  {strings(data.last_run.summary.not_opened).length > 0 && (
                    <span className="block" dir="auto">
                      {o.notOpened} : {strings(data.last_run.summary.not_opened).join(' ; ')}
                    </span>
                  )}
                </span>
              ) : undefined,
              to: '/admin/monitoring',
            },
            { label: o.ai, value: data.ai.enabled ? o.aiOn(data.ai.model) : o.aiOff },
            {
              label: o.users,
              value: o.usersDetail(data.users.students, data.users.staff),
              to: me.data?.role === 'admin' ? '/admin/users' : undefined,
            },
          ];
          return (
            <dl className="max-w-3xl divide-y divide-line border-y border-line">
              {rows.map((row) => (
                <div key={row.label} className="grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_auto] sm:items-start">
                  <dt className="text-sm font-medium text-fg">{row.label}</dt>
                  <dd className="min-w-0 text-sm">
                    <span className={cx('tabular', row.attention ? 'font-semibold text-warn' : 'text-fg')}>{row.value}</span>
                    {row.hint && <span className="mt-0.5 block text-xs text-muted">{row.hint}</span>}
                  </dd>
                  {row.to ? (
                    <Link to={row.to} className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline">
                      {o.open}
                      <IconArrow aria-hidden className="size-3.5 rtl:-scale-x-100" />
                    </Link>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </dl>
          );
        }}
      </Async>
    </>
  );
}

function ProposalItem({ proposal }: { proposal: Proposal }) {
  const { t, pick, date } = useI18n();
  const me = useMe();
  const client = useQueryClient();
  const r = t.admin.review;
  const [note, setNote] = useState('');
  const [level, setLevel] = useState<Verification>('VERIFIED');
  const [evidence, setEvidence] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') =>
      api(`/admin/proposals/${proposal.id}/decide`, {
        body: {
          decision,
          note,
          ...(proposal.kind === 'PUBLISH_COEFFICIENT_TABLE' && decision === 'APPROVE' ? { verification: level, evidence } : {}),
        },
      }),
    // A decision can change what every student sees: drop all cached data.
    onSuccess: () => void client.invalidateQueries(),
  });

  const pending = proposal.status === 'PENDING';
  const isTable = proposal.kind === 'PUBLISH_COEFFICIENT_TABLE';
  const blocked = proposal.kind === 'PUBLISH_ANNOUNCEMENT' && me.data?.role !== 'admin';
  const view: Record<Proposal['kind'], string> = {
    PUBLISH_COEFFICIENT_TABLE: `/admin/academic?stream=${String(proposal.payload.stream_id ?? '')}`,
    PUBLISH_ANNOUNCEMENT: '/admin/announcements',
    PUBLISH_RECORD: `/admin/records?id=${proposal.record_id ?? ''}`,
    REVIEW_CONTENT: '/admin/content',
    TASK: '',
  };

  return (
    <li className="py-6">
      <div className="max-w-3xl space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={proposal.priority} />
          <Badge tone="neutral">{r.kind[proposal.kind]}</Badge>
          <Badge tone={proposal.mandatory ? 'warn' : 'dashed'}>{proposal.mandatory ? r.mandatory : r.recommended}</Badge>
          {proposal.teacher_verification && <Badge tone="teach">{r.teacher}</Badge>}
          {!pending && <Badge tone={proposal.status === 'APPROVED' ? 'ok' : 'dashed'}>{r.status[proposal.status]}</Badge>}
        </div>
        <h2 className="text-base leading-snug font-semibold text-fg" dir="auto">
          {pick(proposal, 'title')}
        </h2>
        {pick(proposal, 'detail') && (
          <p className="text-sm leading-relaxed text-muted" dir="auto">
            {pick(proposal, 'detail')}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {proposal.record_id && (
            <Link to={`/admin/records?id=${proposal.record_id}`} className="text-muted underline-offset-4 hover:text-fg hover:underline">
              {r.linkedRecord} : <span dir="ltr">{proposal.record_id}</span>
            </Link>
          )}
          {view[proposal.kind] && (
            <Link to={view[proposal.kind]} className="font-medium text-accent underline-offset-4 hover:underline">
              {r.view[proposal.kind]}
            </Link>
          )}
        </p>

        {pending ? (
          <div className="space-y-3 pt-1">
            {isTable && (
              <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
                <Field label={r.verificationLevel}>
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
                <Field label={r.evidence} hint={r.evidenceHint}>
                  {(p) => <Textarea {...p} rows={2} className="min-h-0" value={evidence} onChange={(e) => setEvidence(e.target.value)} />}
                </Field>
              </div>
            )}
            <Field label={r.note} hint={r.noteHint}>
              {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            {blocked && <p className="text-sm text-muted">{r.adminOnly}</p>}
            <ErrorNotice error={decide.error} />
            <div className="flex flex-wrap gap-2">
              <Button
                loading={decide.isPending && decide.variables === 'APPROVE'}
                disabled={blocked || decide.isPending}
                onClick={() => decide.mutate('APPROVE')}
              >
                {r.approve[proposal.kind]}
              </Button>
              <Button
                variant="secondary"
                loading={decide.isPending && decide.variables === 'REJECT'}
                disabled={decide.isPending || note.trim().length < 3}
                onClick={() => decide.mutate('REJECT')}
              >
                {r.reject}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">
            {r.decided(r.status[proposal.status], proposal.decided_by_name ?? '', date(proposal.decided_at))}
            {proposal.decision_note && <span dir="auto"> : {proposal.decision_note}</span>}
          </p>
        )}
      </div>
    </li>
  );
}

export function ReviewPage() {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const query = useQuery({
    queryKey: ['admin', 'proposals', all],
    queryFn: () => api<{ items: Proposal[] }>(`/admin/proposals${all ? '?status=ALL' : ''}`),
  });
  return (
    <>
      <AdminLead>{t.admin.review.lead}</AdminLead>
      <label className="mb-2 inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input type="checkbox" className="size-4 accent-(--accent)" checked={all} onChange={(e) => setAll(e.target.checked)} />
        {t.admin.review.showDone}
      </label>
      <Async query={query} lines={8}>
        {({ items }) =>
          items.length === 0 ? (
            <p className="py-6 text-sm text-muted">{t.admin.review.empty}</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {items.map((p) => (
                <ProposalItem key={p.id} proposal={p} />
              ))}
            </ul>
          )
        }
      </Async>
    </>
  );
}
