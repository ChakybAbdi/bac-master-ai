import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import type { Announcement, CalendarEvent, Claim, OfficialRecord } from '@shared/types.ts';
import { Badge, ChangeBadge, EventStatusBadge, VerdictBadge, VerificationBadge } from '@/components/badges.tsx';
import { Async, Button, Empty, ExternalLink, Notice, PageHeader, Tabs, cx } from '@/components/ui.tsx';
import { IconAnnouncement, IconOfficial } from '@/components/icons.ts';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';

const TAB_IDS = ['calendar', 'announcements', 'records', 'claims'] as const;
type TabId = (typeof TAB_IDS)[number];

const hostname = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function Announcements() {
  const { t, pick, date } = useI18n();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['official', 'announcements'],
    queryFn: () => api<{ items: Announcement[] }>('/official/announcements'),
  });
  const markRead = useMutation({
    mutationFn: (ids: number[]) => api('/official/announcements/read', { body: { ids } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['official', 'announcements'] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  return (
    <Async query={query}>
      {({ items }) => {
        const unread = items.filter((a) => !a.read_at).map((a) => a.id);
        if (items.length === 0) {
          return <Empty icon={<IconAnnouncement aria-hidden />} title={t.official.noAnnouncements} />;
        }
        return (
          <div>
            {unread.length > 0 && (
              <div className="mb-4 flex justify-end">
                <Button variant="secondary" size="sm" loading={markRead.isPending} onClick={() => markRead.mutate(unread)}>
                  {t.official.markAllRead}
                </Button>
              </div>
            )}
            <ul className="divide-y divide-line border-y border-line">
              {items.map((a) => (
                <li key={a.id} className="py-5">
                  <article className="max-w-prose space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{t.announcementKind[a.kind]}</Badge>
                      {!a.read_at && <Badge tone="accent">{t.dashboard.unreadBadge}</Badge>}
                      <span className="text-xs text-muted">{t.common.publishedOn(date(a.published_at))}</span>
                    </div>
                    <h3 className="text-base font-semibold text-fg">{pick(a, 'title')}</h3>
                    <p className="text-sm leading-relaxed whitespace-pre-line text-fg">{pick(a, 'body')}</p>
                    {a.record_url && (
                      <p className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted">
                        <span>{t.official.basedOn}</span>
                        {a.record_verification && <VerificationBadge level={a.record_verification} />}
                        <ExternalLink href={a.record_url} className="text-xs">
                          {t.common.officialDocument}
                        </ExternalLink>
                      </p>
                    )}
                  </article>
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </Async>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const { t, pick, date } = useI18n();
  const announced = event.status !== 'NOT_ANNOUNCED';
  return (
    <li className="grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="space-y-1.5">
        <p className={cx('text-sm', announced ? 'font-semibold text-fg' : 'text-muted')}>
          {announced ? pick(event, 'dates') : t.dashboard.notAnnounced}
        </p>
        <EventStatusBadge status={event.status} />
      </div>
      <div className="min-w-0 space-y-1 text-sm">
        <h3 className="font-medium text-fg">{pick(event, 'title')}</h3>
        {pick(event, 'audience') && <p className="text-muted">{pick(event, 'audience')}</p>}
        {pick(event, 'note') && <p className="max-w-prose text-muted">{pick(event, 'note')}</p>}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-muted">
          {event.last_verified && <span>{t.common.lastVerified(date(event.last_verified))}</span>}
          {event.source_url && announced && (
            <ExternalLink href={event.source_url} className="text-xs">
              {t.common.officialDocument}
            </ExternalLink>
          )}
        </p>
      </div>
    </li>
  );
}

function Calendar() {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['official', 'calendar'],
    queryFn: () => api<{ items: CalendarEvent[]; today: string }>('/official/calendar'),
  });
  return (
    <Async query={query} lines={8}>
      {({ items, today }) => {
        if (items.length === 0) return <Empty title={t.official.noEvents} />;
        const pending = items.filter((e) => e.status === 'NOT_ANNOUNCED');
        const dated = items.filter((e) => e.status !== 'NOT_ANNOUNCED');
        const upcoming = dated.filter((e) => (e.ends_on ?? e.starts_on ?? '') >= today);
        const past = dated.filter((e) => (e.ends_on ?? e.starts_on ?? '') < today);
        const heading = 'text-sm font-semibold text-fg';
        return (
          <div className="space-y-8">
            {pending.length > 0 && (
              <section aria-labelledby="cal-pending">
                <h2 id="cal-pending" className={heading}>
                  {t.official.notAnnouncedTitle}
                </h2>
                <Notice tone="warn" className="mt-3">
                  {t.official.notAnnouncedLead}
                </Notice>
                <ul className="mt-1 divide-y divide-line">
                  {pending.map((e) => (
                    <EventRow key={e.id} event={e} />
                  ))}
                </ul>
              </section>
            )}
            {upcoming.length > 0 && (
              <section aria-labelledby="cal-upcoming">
                <h2 id="cal-upcoming" className={heading}>
                  {t.official.upcoming}
                </h2>
                <ul className="mt-1 divide-y divide-line border-b border-line">
                  {upcoming.map((e) => (
                    <EventRow key={e.id} event={e} />
                  ))}
                </ul>
              </section>
            )}
            {past.length > 0 && (
              <details className="group">
                <summary className={cx(heading, 'list-none text-muted hover:text-fg [&::-webkit-details-marker]:hidden')}>
                  {t.official.past} ({past.length})
                </summary>
                <ul className="mt-1 divide-y divide-line opacity-80">
                  {past.map((e) => (
                    <EventRow key={e.id} event={e} />
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      }}
    </Async>
  );
}

function Records() {
  const { t, pick, date } = useI18n();
  const query = useQuery({
    queryKey: ['official', 'records'],
    queryFn: () => api<{ items: OfficialRecord[] }>('/official/records'),
  });
  return (
    <Async query={query} lines={8}>
      {({ items }) => {
        if (items.length === 0) return <Empty icon={<IconOfficial aria-hidden />} title={t.official.noRecords} />;
        const titles = new Map(items.map((r) => [r.id, pick(r, 'title')]));
        return (
          <div>
            <Notice className="mb-2">{t.official.recordsNote}</Notice>
            <ul className="divide-y divide-line border-b border-line">
              {items.map((r) => {
                const superseded = r.change_status === 'SUPERSEDED';
                return (
                  <li key={r.id} id={r.id} className="scroll-mt-20 py-6">
                    <article className="max-w-prose space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <VerificationBadge level={r.verification} />
                        <ChangeBadge status={r.change_status} />
                        {r.publication_date && (
                          <span className="text-xs text-muted">
                            {t.official.published} : {date(r.publication_date)}
                          </span>
                        )}
                      </div>
                      <h3 className={cx('text-base leading-snug font-semibold', superseded ? 'text-muted' : 'text-fg')}>
                        {pick(r, 'title')}
                      </h3>
                      <p className="text-sm leading-relaxed text-fg">{pick(r, 'summary')}</p>
                      {pick(r, 'impact') && (
                        <p className="text-sm leading-relaxed text-fg">
                          <span className="font-semibold">{t.official.forYou} : </span>
                          {pick(r, 'impact')}
                        </p>
                      )}
                      {r.superseded_by.length > 0 && (
                        <p className="text-sm text-muted">
                          {t.official.supersededBy} :{' '}
                          {r.superseded_by.map((id, i) => (
                            <span key={id}>
                              {i > 0 && ' ; '}
                              {titles.has(id) ? (
                                <a href={`#${id}`} className="text-accent underline-offset-4 hover:underline">
                                  {titles.get(id)}
                                </a>
                              ) : (
                                id
                              )}
                            </span>
                          ))}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
                        {r.original_url && <ExternalLink href={r.original_url}>{t.common.officialDocument}</ExternalLink>}
                        {r.scan_url && r.scan_url !== r.original_url && (
                          <ExternalLink href={r.scan_url}>{t.official.scan}</ExternalLink>
                        )}
                        {r.related_urls.map((url) => (
                          <ExternalLink key={url} href={url} className="font-normal">
                            <span dir="ltr">{hostname(url)}</span>
                          </ExternalLink>
                        ))}
                      </div>
                      {r.last_verified && <p className="text-xs text-muted">{t.common.lastVerified(date(r.last_verified))}</p>}
                    </article>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      }}
    </Async>
  );
}

function Claims() {
  const { t, pick, date } = useI18n();
  const query = useQuery({
    queryKey: ['official', 'claims'],
    queryFn: () => api<{ items: Claim[] }>('/official/claims'),
  });
  return (
    <Async query={query} lines={6}>
      {({ items }) => {
        if (items.length === 0) return <Empty title={t.official.noClaims} />;
        return (
          <div>
            <p className="mb-2 max-w-prose text-sm text-muted">{t.official.claimsLead}</p>
            <ul className="divide-y divide-line border-y border-line">
              {items.map((cl) => (
                <li key={cl.id} className="py-5">
                  <article className="max-w-prose space-y-3">
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted">{t.official.claimLabel}</p>
                      <p className="text-base text-fg">« {pick(cl, 'claim')} »</p>
                    </div>
                    <div>
                      <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
                        {t.official.findingLabel}
                        <VerdictBadge verdict={cl.verdict} />
                      </p>
                      <p className="text-sm leading-relaxed text-fg">{pick(cl, 'finding')}</p>
                    </div>
                    <p className="text-xs text-muted">{t.common.checkedOn(date(cl.checked_on))}</p>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </Async>
  );
}

export function OfficialPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TAB_IDS.find((id) => id === params.get('tab')) ?? 'calendar';
  const unread = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ unread: number; items: Announcement[] }>('/notifications'),
  });

  return (
    <>
      <PageHeader title={t.official.title} lead={t.official.lead} />
      <Tabs
        label={t.official.title}
        value={tab}
        onChange={(id) => setParams(id === 'calendar' ? {} : { tab: id }, { replace: true })}
        tabs={[
          { id: 'calendar', label: t.official.tabs.calendar },
          { id: 'announcements', label: t.official.tabs.announcements, count: unread.data?.unread },
          { id: 'records', label: t.official.tabs.records },
          { id: 'claims', label: t.official.tabs.claims },
        ]}
      />
      <div role="tabpanel">
        {tab === 'calendar' && <Calendar />}
        {tab === 'announcements' && <Announcements />}
        {tab === 'records' && <Records />}
        {tab === 'claims' && <Claims />}
      </div>
    </>
  );
}
