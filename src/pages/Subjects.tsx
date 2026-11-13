import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { SubjectItem, SubjectsView } from '@shared/types.ts';
import { Badge, VerificationBadge } from '@/components/badges.tsx';
import { IconPlus, IconTrash } from '@/components/icons.ts';
import { Async, Button, ButtonLink, ErrorNotice, ExternalLink, Field, Input, Notice, PageHeader, Section, Select } from '@/components/ui.tsx';
import { api } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMe, useMeta } from '@/lib/session.tsx';

interface PrefPatch {
  subject_id: number;
  in_custom?: boolean;
  custom_coefficient?: number | null;
  level?: number | null;
  grade?: number | null;
}

/** Reads a decimal typed with a comma or a point. Returns null for an empty field, NaN for garbage. */
function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** A numeric field that keeps what the student types and saves a valid value when they leave it. */
function NumberCell({
  value,
  max,
  label,
  onCommit,
}: {
  value: number | null;
  max: number;
  label: string;
  onCommit: (next: number | null) => void;
}) {
  const { number } = useI18n();
  const [text, setText] = useState(value === null ? '' : number(value));
  useEffect(() => setText(value === null ? '' : number(value)), [value, number]);
  const parsed = parseDecimal(text);
  const invalid = parsed !== null && (Number.isNaN(parsed) || parsed < 0 || parsed > max);
  return (
    <Input
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode="decimal"
      dir="ltr"
      className="tabular h-9 w-20 text-center"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (invalid) return;
        if (parsed !== value) onCommit(parsed);
      }}
    />
  );
}

export function SubjectsPage() {
  const { t, pick, date, number } = useI18n();
  const me = useMe();
  const meta = useMeta();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['subjects'], queryFn: () => api<SubjectsView>('/subjects') });
  const save = useMutation({
    mutationFn: (items: PrefPatch[]) => api<SubjectsView>('/subjects/prefs', { method: 'PUT', body: { items } }),
    onSuccess: (data) => {
      client.setQueryData(['subjects'], data);
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['planner'] });
    },
  });

  const [newSubject, setNewSubject] = useState('');
  const [newCoefficient, setNewCoefficient] = useState('');
  const [target, setTarget] = useState('');
  const [targetSubject, setTargetSubject] = useState('');

  const items = query.data?.items ?? [];
  const counted = useMemo(() => items.filter((i) => !i.is_optional && i.coefficient !== null), [items]);
  const graded = counted.filter((i) => i.grade !== null);
  const coefficientSum = graded.reduce((sum, i) => sum + i.coefficient!, 0);
  const average = coefficientSum > 0 ? graded.reduce((sum, i) => sum + i.grade! * i.coefficient!, 0) / coefficientSum : null;

  const targetValue = parseDecimal(target);
  const targetItem = counted.find((i) => String(i.subject_id) === targetSubject);
  let targetMessage: string | null = null;
  if (targetItem && targetValue !== null && !Number.isNaN(targetValue) && targetValue >= 0 && targetValue <= 20) {
    const others = counted.filter((i) => i.subject_id !== targetItem.subject_id);
    if (others.some((i) => i.grade === null)) {
      targetMessage = t.subjects.targetNeedGrades;
    } else {
      const totalCoefficient = counted.reduce((sum, i) => sum + i.coefficient!, 0);
      const othersPoints = others.reduce((sum, i) => sum + i.grade! * i.coefficient!, 0);
      const needed = (targetValue * totalCoefficient - othersPoints) / targetItem.coefficient!;
      if (needed <= 0) targetMessage = t.subjects.targetReached;
      else if (needed > 20) targetMessage = t.subjects.targetOut;
      else targetMessage = t.subjects.targetResult(number(Math.ceil(needed * 4) / 4), pick(targetItem, 'name'), number(targetValue));
    }
  }

  const levelSelect = (item: SubjectItem) => (
    <Select
      aria-label={`${t.subjects.level} : ${pick(item, 'name')}`}
      className="h-9 w-36"
      value={item.level ?? ''}
      onChange={(e) => save.mutate([{ subject_id: item.subject_id, level: e.target.value ? Number(e.target.value) : null }])}
    >
      <option value="">{t.subjects.levelUnset}</option>
      {t.subjects.levels.map((label, i) => (
        <option key={label} value={i + 1}>
          {label}
        </option>
      ))}
    </Select>
  );

  return (
    <>
      <PageHeader title={t.subjects.title} lead={t.subjects.lead} />
      <Async query={query} lines={10}>
        {(view) => {
          const custom = view.mode === 'custom';
          const available = (meta.data?.subjects ?? []).filter((s) => !view.items.some((i) => i.subject_id === s.id));
          const coefficientToAdd = parseDecimal(newCoefficient);
          const canAdd =
            newSubject !== '' && coefficientToAdd !== null && !Number.isNaN(coefficientToAdd) && coefficientToAdd >= 0.5 && coefficientToAdd <= 20;
          const tableVerification = view.items.find((i) => i.verification)?.verification ?? null;
          const tableNote = view.items.find((i) => i.source_note)?.source_note ?? null;
          const verifiedAt = view.items.find((i) => i.verified_at)?.verified_at ?? null;

          return (
            <div className="space-y-10">
              {view.framework && (
                <Section title={t.subjects.frameworkTitle}>
                  <div className="max-w-prose space-y-2 text-sm">
                    <p className="text-fg">{pick(view.framework, 'title')}</p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <VerificationBadge level={view.framework.verification} />
                      {view.framework.url && <ExternalLink href={view.framework.url}>{t.common.officialDocument}</ExternalLink>}
                      {view.framework.last_verified && (
                        <span className="text-xs text-muted">{t.common.lastVerified(date(view.framework.last_verified))}</span>
                      )}
                    </p>
                  </div>
                </Section>
              )}

              <Section title={custom ? t.subjects.listTitle : t.subjects.officialTable}>
                {custom &&
                  (me.data?.stream_id ? (
                    <Notice tone={view.pending ? 'warn' : 'info'} title={view.pending ? t.subjects.pendingTitle : undefined} className="mb-4">
                      {view.pending ? t.subjects.pendingText : t.subjects.customText}
                    </Notice>
                  ) : (
                    <Notice className="mb-4">
                      <p>{t.subjects.noStreamText}</p>
                      <ButtonLink to="/settings" variant="secondary" size="sm" className="mt-2">
                        {t.nav.settings}
                      </ButtonLink>
                    </Notice>
                  ))}

                {!custom && tableVerification && (
                  <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                    <VerificationBadge level={tableVerification} />
                    {verifiedAt && <span className="text-xs text-muted">{t.common.checkedOn(date(verifiedAt))}</span>}
                    {tableNote && (
                      <span className="text-xs text-muted">
                        {t.subjects.tableSource} : {tableNote}
                      </span>
                    )}
                  </p>
                )}

                {view.items.length === 0 ? (
                  <p className="text-sm text-muted">{t.subjects.emptyList}</p>
                ) : (
                  <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                    <table className="w-full min-w-[34rem] text-sm">
                      <thead>
                        <tr className="border-b border-line text-start text-xs text-muted">
                          <th scope="col" className="py-2 pe-3 text-start font-medium">{t.subjects.subject}</th>
                          <th scope="col" className="px-3 py-2 text-start font-medium">{t.subjects.coefficient}</th>
                          <th scope="col" className="px-3 py-2 text-start font-medium">{t.subjects.level}</th>
                          <th scope="col" className="px-3 py-2 text-start font-medium">{t.subjects.grade}</th>
                          {custom && <th scope="col" className="w-10 py-2" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {view.items.map((item) => (
                          <tr key={item.subject_id}>
                            <th scope="row" className="py-2.5 pe-3 text-start font-medium text-fg">
                              {pick(item, 'name')}{' '}
                              {item.is_optional && <Badge tone="neutral">{t.subjects.optionalTag}</Badge>}
                            </th>
                            <td className="px-3 py-2.5">
                              {custom ? (
                                <NumberCell
                                  label={`${t.subjects.coefficient} : ${pick(item, 'name')}`}
                                  value={item.coefficient}
                                  max={20}
                                  onCommit={(next) => save.mutate([{ subject_id: item.subject_id, custom_coefficient: next }])}
                                />
                              ) : (
                                <span className="tabular font-semibold text-fg">
                                  {item.coefficient === null ? t.common.notSet : number(item.coefficient)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">{levelSelect(item)}</td>
                            <td className="px-3 py-2.5">
                              <NumberCell
                                label={`${t.subjects.grade} : ${pick(item, 'name')}`}
                                value={item.grade}
                                max={20}
                                onCommit={(next) => save.mutate([{ subject_id: item.subject_id, grade: next }])}
                              />
                            </td>
                            {custom && (
                              <td className="py-2.5 text-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`${t.common.remove} : ${pick(item, 'name')}`}
                                  className="px-2"
                                  onClick={() => save.mutate([{ subject_id: item.subject_id, in_custom: false }])}
                                >
                                  <IconTrash aria-hidden className="size-4" />
                                </Button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {custom && (
                  <form
                    className="mt-5 flex flex-wrap items-end gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!canAdd) return;
                      save.mutate([{ subject_id: Number(newSubject), in_custom: true, custom_coefficient: coefficientToAdd }], {
                        onSuccess: () => {
                          setNewSubject('');
                          setNewCoefficient('');
                        },
                      });
                    }}
                  >
                    <Field label={t.subjects.addSubject} className="min-w-52 flex-1 sm:flex-none">
                      {(p) => (
                        <Select {...p} value={newSubject} onChange={(e) => setNewSubject(e.target.value)}>
                          <option value="">{t.subjects.chooseSubject}</option>
                          {available.map((s) => (
                            <option key={s.id} value={s.id}>
                              {pick(s, 'name')}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label={t.subjects.coefficient} className="w-28">
                      {(p) => (
                        <Input {...p} inputMode="decimal" dir="ltr" className="tabular text-center" value={newCoefficient} onChange={(e) => setNewCoefficient(e.target.value)} />
                      )}
                    </Field>
                    <Button type="submit" variant="secondary" disabled={!canAdd} loading={save.isPending} icon={<IconPlus aria-hidden className="size-4" />}>
                      {t.common.add}
                    </Button>
                  </form>
                )}
                <div className="mt-3">
                  <ErrorNotice error={save.error} />
                </div>
              </Section>

              {counted.length > 0 && (
                <div className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
                  <Section title={t.subjects.calcTitle} lead={t.subjects.calcLead}>
                    <div aria-live="polite" className="rounded-xl border border-line bg-surface px-4 py-4">
                      <p className="text-xs font-medium text-muted">{t.subjects.average}</p>
                      {average === null ? (
                        <p className="mt-1 text-sm text-muted">{t.subjects.averageEmpty}</p>
                      ) : (
                        <>
                          <p className="mt-0.5 text-2xl font-semibold text-fg">
                            <span dir="ltr" className="tabular">
                              {number(average)} <span className="text-base font-normal text-muted">/ 20</span>
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-muted">{t.subjects.averageHint(graded.length, number(coefficientSum))}</p>
                        </>
                      )}
                    </div>
                    {view.items.some((i) => i.is_optional) && <p className="mt-3 max-w-prose text-xs text-muted">{t.subjects.optionalNote}</p>}
                  </Section>

                  <Section title={t.subjects.targetTitle} lead={t.subjects.targetLead}>
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label={t.subjects.target} className="w-28">
                        {(p) => (
                          <Input {...p} inputMode="decimal" dir="ltr" className="tabular text-center" placeholder="12" value={target} onChange={(e) => setTarget(e.target.value)} />
                        )}
                      </Field>
                      <Field label={t.subjects.inSubject} className="min-w-52 flex-1">
                        {(p) => (
                          <Select {...p} value={targetSubject} onChange={(e) => setTargetSubject(e.target.value)}>
                            <option value="">{t.subjects.chooseSubject}</option>
                            {counted.map((i) => (
                              <option key={i.subject_id} value={i.subject_id}>
                                {pick(i, 'name')}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </div>
                    <p aria-live="polite" className="mt-3 min-h-5 max-w-prose text-sm font-medium text-fg">
                      {targetMessage}
                    </p>
                  </Section>
                </div>
              )}
            </div>
          );
        }}
      </Async>
    </>
  );
}
