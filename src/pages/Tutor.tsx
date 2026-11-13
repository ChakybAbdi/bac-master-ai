import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import type { Conversation, TutorMessage, TutorMode, TutorSource } from '@shared/types.ts';
import { ProvenanceBadge, VerificationBadge, WatchBadge } from '@/components/badges.tsx';
import { IconAi, IconClose, IconDocument, IconPlus, IconSend, IconStop, IconTrash } from '@/components/icons.ts';
import { Markdown } from '@/components/Markdown.tsx';
import { Button, ErrorNotice, ExternalLink, Notice, PageHeader, Select, Skeleton, cx } from '@/components/ui.tsx';
import { api, askTutor } from '@/lib/api.ts';
import { useI18n } from '@/lib/i18n.tsx';
import { useMeta } from '@/lib/session.tsx';

interface Thread {
  conversation: Conversation;
  messages: TutorMessage[];
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

interface Pending {
  question: string;
  text: string;
  sources: TutorSource[];
  mode: TutorMode | null;
}

function Sources({ sources }: { sources: TutorSource[] }) {
  const { t, pick, date } = useI18n();
  if (sources.length === 0) return null;
  return (
    <details className="mt-4 rounded-xl border border-line" open>
      <summary className="cursor-pointer px-3.5 py-2.5 text-xs font-semibold text-muted">
        {t.tutor.sources} ({sources.length})
      </summary>
      <ol className="divide-y divide-line border-t border-line">
        {sources.map((s) => (
          <li key={s.n} className="flex gap-3 px-3.5 py-3 text-sm">
            <span className="tabular shrink-0 font-semibold text-muted">[{s.n}]</span>
            <div className="min-w-0 space-y-1.5">
              <p className="font-medium text-fg">{pick(s, 'title')}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                {s.kind === 'watch' ? <WatchBadge /> : <ProvenanceBadge value={s.provenance} />}
                {s.verification && s.kind !== 'claim' && <VerificationBadge level={s.verification} />}
                {s.date && <span className="text-xs text-muted">{date(s.date)}</span>}
                {s.url && (
                  <ExternalLink href={s.url} className="text-xs">
                    {/* A monitoring line points at the portal being watched, not at a document. */}
                    {s.kind === 'watch' ? <span dir="ltr">{hostOf(s.url)}</span> : t.common.officialDocument}
                  </ExternalLink>
                )}
              </p>
              {pick(s, 'excerpt') && <p className="line-clamp-2 text-xs leading-relaxed text-muted">{pick(s, 'excerpt')}</p>}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

function AssistantMessage({ text, mode, sources, streaming }: { text: string; mode: TutorMode | null; sources: TutorSource[]; streaming?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="max-w-[46rem]">
      <p className="mb-2 flex items-start gap-2 text-xs font-medium text-muted">
        {mode === 'RETRIEVAL_ONLY' ? (
          <IconDocument aria-hidden className="mt-px size-3.5 shrink-0" />
        ) : (
          <IconAi aria-hidden className="mt-px size-3.5 shrink-0 text-accent" />
        )}
        <span>{mode === 'RETRIEVAL_ONLY' ? t.tutor.retrievalLabel : t.tutor.aiLabel}</span>
      </p>
      {text ? (
        <Markdown source={text} />
      ) : streaming ? (
        <div role="status" className="space-y-2">
          <p className="animate-pulse-soft text-sm text-muted">{t.tutor.thinking}</p>
          <Skeleton lines={2} />
        </div>
      ) : null}
      <Sources sources={sources} />
    </div>
  );
}

export function TutorPage() {
  const { t } = useI18n();
  const meta = useMeta();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const conversationId = params.get('c') ? Number(params.get('c')) : null;
  const exerciseId = params.get('exercise') ? Number(params.get('exercise')) : null;

  const conversations = useQuery({
    queryKey: ['tutor', 'conversations'],
    queryFn: () => api<{ items: Conversation[] }>('/tutor/conversations'),
  });
  // The thread is appended to locally as answers arrive, so it is never refetched behind the reader's back.
  const thread = useQuery({
    queryKey: ['tutor', 'conversation', conversationId],
    queryFn: () => api<Thread>(`/tutor/conversations/${conversationId}`),
    enabled: conversationId !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const messages = thread.data?.messages ?? [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pending?.text, pending?.question]);
  useEffect(() => () => abort.current?.abort(), []);

  const remove = useMutation({
    mutationFn: (id: number) => api(`/tutor/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setParams({}, { replace: true });
      void client.invalidateQueries({ queryKey: ['tutor', 'conversations'] });
    },
  });

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || pending) return;
    setInput('');
    setError(null);
    setNotice(null);
    setTruncated(false);
    if (field.current) field.current.style.height = 'auto';
    const controller = new AbortController();
    abort.current = controller;
    let activeId = conversationId;
    let aborted = false;
    setPending({ question, text: '', sources: [], mode: null });
    try {
      await askTutor(
        { conversation_id: conversationId ?? undefined, question, exercise_id: exerciseId ?? undefined },
        {
          onMeta: (m) => {
            activeId = m.conversation_id;
            setPending((p) => p && { ...p, sources: m.sources, mode: m.mode });
          },
          onDelta: (text) => setPending((p) => p && { ...p, text: p.text + text }),
          onNotice: (code) => {
            // The AI call failed after starting: what was streamed is replaced by platform documents.
            setNotice(code);
            setPending((p) => p && { ...p, text: '', mode: 'RETRIEVAL_ONLY' });
          },
          onDone: (message, wasTruncated) => {
            setTruncated(wasTruncated);
            const asked: TutorMessage = {
              id: -Date.now(),
              role: 'user',
              content: question,
              sources: [],
              mode: null,
              created_at: new Date().toISOString(),
            };
            client.setQueryData<Thread>(['tutor', 'conversation', activeId], (prev) => ({
              conversation: prev?.conversation ?? { id: activeId!, title: question, updated_at: message.created_at },
              messages: [...(prev?.messages ?? []), asked, message],
            }));
          },
        },
        controller.signal,
      );
    } catch (err) {
      aborted = err instanceof DOMException && err.name === 'AbortError';
      if (!aborted) {
        setError(err);
        setInput(question); // keep what the student wrote, so nothing has to be retyped
      }
    } finally {
      abort.current = null;
      setPending(null);
      void client.invalidateQueries({ queryKey: ['tutor', 'conversations'] });
      if (aborted && activeId !== null) void client.invalidateQueries({ queryKey: ['tutor', 'conversation', activeId] });
      if (activeId !== null && activeId !== conversationId) setParams({ c: String(activeId) }, { replace: true });
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const empty = messages.length === 0 && !pending && !(conversationId !== null && thread.isPending);
  const list = conversations.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t.tutor.title}
        lead={t.tutor.lead}
        actions={
          <>
            {conversationId !== null && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t.tutor.delete}
                loading={remove.isPending}
                onClick={() => remove.mutate(conversationId)}
              >
                <IconTrash aria-hidden className="size-4" />
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={<IconPlus aria-hidden className="size-4" />} onClick={() => setParams({}, { replace: true })}>
              {t.tutor.newChat}
            </Button>
          </>
        }
      />

      {meta.data && !meta.data.ai.enabled && <Notice className="mb-5 max-w-3xl">{t.tutor.offline}</Notice>}

      <div className="grid gap-x-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="mb-5 lg:mb-0">
          {list.length > 0 && (
            <Select
              aria-label={t.tutor.conversations}
              className="lg:hidden"
              value={conversationId ?? ''}
              onChange={(e) => setParams(e.target.value ? { c: e.target.value } : {}, { replace: true })}
            >
              <option value="">{t.tutor.newChat}</option>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          )}
          <nav aria-label={t.tutor.conversations} className="hidden lg:block">
            <p className="mb-2 text-xs font-semibold text-muted">{t.tutor.conversations}</p>
            {list.length === 0 ? (
              <p className="text-sm text-muted">{t.tutor.noConversations}</p>
            ) : (
              <ul className="space-y-0.5">
                {list.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={c.id === conversationId || undefined}
                      onClick={() => setParams({ c: String(c.id) }, { replace: true })}
                      className={cx(
                        'block w-full truncate rounded-lg px-2.5 py-2 text-start text-sm transition-colors duration-150',
                        c.id === conversationId ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-panel hover:text-fg',
                      )}
                    >
                      <span dir="auto">{c.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col">
          <div className="flex-1 space-y-7 pb-4" aria-live="polite">
            {conversationId !== null && thread.isPending && <Skeleton lines={5} />}
            {empty && (
              <div>
                <p className="mb-2 text-xs font-semibold text-muted">{t.tutor.suggestionsTitle}</p>
                <ul className="flex flex-col items-start gap-2">
                  {t.tutor.suggestions.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => void send(s)}
                        className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-start text-sm text-fg transition-colors duration-150 hover:bg-panel"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <p dir="auto" className="max-w-[85%] rounded-2xl rounded-ee-md bg-panel px-4 py-2.5 text-sm whitespace-pre-wrap text-fg">
                    {m.content}
                  </p>
                </div>
              ) : (
                <AssistantMessage key={m.id} text={m.content} mode={m.mode} sources={m.sources} />
              ),
            )}
            {pending && (
              <>
                <div className="flex justify-end">
                  <p dir="auto" className="max-w-[85%] rounded-2xl rounded-ee-md bg-panel px-4 py-2.5 text-sm whitespace-pre-wrap text-fg">
                    {pending.question}
                  </p>
                </div>
                <AssistantMessage text={pending.text} mode={pending.mode} sources={pending.sources} streaming />
              </>
            )}
            {notice && (
              <Notice tone="warn" className="max-w-[46rem]">
                {t.tutor.notice[notice as keyof typeof t.tutor.notice] ?? t.tutor.notice.api}
              </Notice>
            )}
            {truncated && <Notice className="max-w-[46rem]">{t.tutor.truncated}</Notice>}
            <ErrorNotice error={error} />
            <div ref={end} />
          </div>

          <form onSubmit={onSubmit} className="sticky bottom-[3.75rem] -mx-4 border-t border-line bg-bg px-4 pt-3 pb-3 sm:mx-0 sm:px-0 lg:bottom-0">
            {exerciseId !== null && (
              <p className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-accent-line bg-accent-soft py-0.5 ps-2 pe-1 text-xs font-medium text-accent">
                {t.tutor.aboutExercise}
                <button
                  type="button"
                  aria-label={t.common.remove}
                  onClick={() => setParams(conversationId !== null ? { c: String(conversationId) } : {}, { replace: true })}
                  className="rounded p-0.5 hover:bg-accent-line/40"
                >
                  <IconClose aria-hidden className="size-3" />
                </button>
              </p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={field}
                dir="auto"
                rows={1}
                aria-label={t.tutor.placeholder}
                placeholder={t.tutor.placeholder}
                value={input}
                maxLength={4000}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 176)}px`;
                }}
                onKeyDown={onKeyDown}
                className="max-h-44 min-h-11 flex-1 resize-none rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-fg transition-colors duration-150 placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none"
              />
              {pending ? (
                <Button variant="secondary" aria-label={t.tutor.stop} onClick={() => abort.current?.abort()} className="px-3">
                  <IconStop aria-hidden className="size-4" />
                </Button>
              ) : (
                <Button type="submit" aria-label={t.tutor.send} disabled={!input.trim()} className="px-3">
                  <IconSend aria-hidden className="size-4 rtl:-scale-x-100" />
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
