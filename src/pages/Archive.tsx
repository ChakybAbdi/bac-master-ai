import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { DocType, PastPaper } from '@shared/types.ts';
import { DOC_TYPES } from '@shared/types.ts';
import { Badge, VerificationBadge } from '@/components/badges.tsx';
import { IconArchive } from '@/components/icons.ts';
import { Async, Empty, ExternalLink, PageHeader, Select } from '@/components/ui.tsx';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMe, useMeta } from '@/lib/session.tsx';

/** Official document types are green; teacher and AI corrections are visibly something else. */
export function DocTypeBadge({ type }: { type: DocType }) {
  const { t } = useI18n();
  const tone =
    type === 'OFFICIAL_CORRECTION' || type === 'MARKING_SCHEME'
      ? 'ok'
      : type === 'TEACHER_CORRECTION'
        ? 'teach'
        : type === 'AI_CORRECTION'
          ? 'accent'
          : 'neutral';
  return <Badge tone={tone}>{t.docType[type]}</Badge>;
}

export function ArchivePage() {
  const { t, pick, date, number } = useI18n();
  const meta = useMeta();
  const me = useMe();
  const query = useQuery({ queryKey: ['archive'], queryFn: () => api<{ items: PastPaper[] }>('/archive') });
  // Start on the student's own stream: with every stream's papers, the full list is long.
  const [stream, setStream] = useState<string | null>(null);
  const streamFilter = stream ?? (me.data?.stream_id ? String(me.data.stream_id) : '');
  const [year, setYear] = useState('');
  const [type, setType] = useState('');
  const [subject, setSubject] = useState('');

  const named = (list: { id: number; name_fr: string; name_ar: string }[] | undefined, id: number | null): string => {
    const row = list?.find((x) => x.id === id);
    return row ? pick(row, 'name') : '';
  };

  return (
    <>
      <PageHeader title={t.archive.title} lead={t.archive.lead} />
      <Async query={query}>
        {({ items }) => {
          if (items.length === 0) {
            return (
              <Empty icon={<IconArchive aria-hidden />} title={t.archive.empty}>
                {t.archive.emptyHint}
              </Empty>
            );
          }
          const years = [...new Set(items.map((p) => p.exam_year))].sort((a, b) => b - a);
          const subjects = [...new Set(items.map((p) => p.subject_id).filter((id): id is number => id !== null))];
          const streams = [...new Set(items.map((p) => p.stream_id).filter((id): id is number => id !== null))];
          const shown = items.filter(
            (p) =>
              // Documents without a stream concern every stream, so they stay visible.
              (streamFilter === '' || p.stream_id === null || String(p.stream_id) === streamFilter) &&
              (year === '' || String(p.exam_year) === year) &&
              (type === '' || p.doc_type === type) &&
              (subject === '' || String(p.subject_id) === subject),
          );
          return (
            <>
              <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Select aria-label={t.archive.stream} value={streamFilter} onChange={(e) => setStream(e.target.value)}>
                  <option value="">{t.archive.allStreams}</option>
                  {streams.map((id) => (
                    <option key={id} value={id}>
                      {named(meta.data?.streams, id)}
                    </option>
                  ))}
                </Select>
                <Select aria-label={t.archive.year} value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="">{t.archive.allYears}</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
                <Select aria-label={t.archive.type} value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">{t.archive.allTypes}</option>
                  {DOC_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {t.docType[d]}
                    </option>
                  ))}
                </Select>
                <Select aria-label={t.subjects.subject} value={subject} onChange={(e) => setSubject(e.target.value)}>
                  <option value="">{t.archive.allSubjects}</option>
                  {subjects.map((id) => (
                    <option key={id} value={id}>
                      {named(meta.data?.subjects, id)}
                    </option>
                  ))}
                </Select>
              </div>
              {shown.length === 0 ? (
                <p className="text-sm text-muted">{t.archive.noMatch}</p>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {shown.map((p) => (
                    <li key={p.id} className="space-y-2 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <DocTypeBadge type={p.doc_type} />
                        <VerificationBadge level={p.verification} />
                        <span className="tabular text-xs text-muted">BAC {p.exam_year}</span>
                      </div>
                      <p className="font-medium text-fg" dir="auto">
                        {p.title}
                      </p>
                      <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted">
                        {[named(meta.data?.streams, p.stream_id), named(meta.data?.subjects, p.subject_id), t.archive.languages[p.language]]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="text-sm text-muted">
                        {t.archive.sourceAuthority} : <span className="text-fg">{p.source_authority}</span>
                        {p.publication_date && ` · ${date(p.publication_date)}`}
                      </p>
                      {p.note && <p className="max-w-prose text-sm text-muted">{p.note}</p>}
                      <ExternalLink href={p.url}>
                        {t.archive.open}
                        {p.file_size ? ` (PDF, ${number(p.file_size / 1048576, 1)} Mo)` : ''}
                      </ExternalLink>
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </Async>
    </>
  );
}
