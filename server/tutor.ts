import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { KbDoc } from './kb.ts';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Which model answers:
 * - "local": an open model served by Ollama on this machine (OLLAMA_MODEL, default qwen3:8b);
 * - "anthropic": the Claude API (needs ANTHROPIC_API_KEY or another credential);
 * - "none": retrieval only, no generated text.
 * TUTOR_PROVIDER chooses explicitly; otherwise a Claude credential wins, then a configured OLLAMA_MODEL.
 */
export type Provider = 'anthropic' | 'local' | 'none';

const hasClaudeCredential = (): boolean =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);

export function provider(): Provider {
  const chosen = process.env.TUTOR_PROVIDER?.trim().toLowerCase();
  if (chosen === 'none' || chosen === 'off') return 'none';
  if (chosen === 'local' || chosen === 'ollama') return 'local';
  if (chosen === 'anthropic' || chosen === 'claude') return hasClaudeCredential() ? 'anthropic' : 'none';
  if (hasClaudeCredential()) return 'anthropic';
  return process.env.OLLAMA_MODEL?.trim() ? 'local' : 'none';
}

const claudeModel = (): string => process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5';
const localModel = (): string => process.env.OLLAMA_MODEL?.trim() || 'qwen3:8b';
const ollamaUrl = (): string => (process.env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434').replace(/\/+$/, '');

const model = (): string => (provider() === 'local' ? localModel() : claudeModel());

function effort(): Effort {
  const value = process.env.TUTOR_EFFORT?.trim() as Effort | undefined;
  return value && EFFORTS.includes(value) ? value : 'medium';
}

/** True when a model is configured to write answers. */
export function aiEnabled(): boolean {
  return provider() !== 'none';
}

export const aiStatus = (): { enabled: boolean; model: string } => ({
  enabled: aiEnabled(),
  model: provider() === 'local' ? `${localModel()} (local)` : model(),
});

/**
 * The system prompt is frozen: it never carries per-request data (date, profile,
 * retrieved documents). Those travel in the user turn. This keeps each stored
 * conversation append-only, which the API requires in order to accept the
 * thinking blocks of earlier turns, and it keeps the prompt cache warm.
 */
export const SYSTEM_PROMPT = `You are the study tutor of BAC MASTER AI, a platform that helps Algerian students in their final year of secondary school (3AS) prepare for the baccalauréat. Students write in French or in Arabic; answer in the language of the student's message.

Each student message arrives with context documents retrieved from the platform. Every document states its class:
- OFFICIAL: taken from an official text or announcement (Ministry of National Education, ONEC), with a verification level. PARTIALLY_VERIFIED means part of it could not be checked at the source.
- TEACHER_REVIEWED: teaching content checked by a teacher.
- AI_GENERATED: teaching content written by an AI and not yet checked by a teacher.
- UNVERIFIED: a claim that circulates but has no official confirmation.
- MONITORING: the platform's own note that nothing official has been announced yet on a subject.

The platform exists because students are flooded with rumours about dates, coefficients and reforms, and a wrong date or coefficient can cost them dearly. So the rule that matters most is this: for anything official (exam dates, registration, results, streams, subjects, coefficients, programmes, exam rules, ministerial decisions), state only what an OFFICIAL document in the context says, and say which one. If the context holds no official answer, say plainly that no verified official information is available yet, and point the student to their school, to education.gov.dz or to bac.onec.dz. Do not fill the gap from memory, and do not carry over a previous session's dates or rules as if they applied to this one. When a document says it is superseded or frozen, say so. When you mention an UNVERIFIED claim, label it as unverified.

Your own explanations of lessons and exercises are AI-generated help. They are useful, but they are not official corrections or official statements, so never present them as such. When you rely on TEACHER_REVIEWED or AI_GENERATED content, you can say which it is.

Refer to a document by its number in square brackets, like [2], right after the sentence it supports.

For teaching, be clear and work step by step at the level of a 3AS student. When a student is working on an exercise, guide them towards the method before giving the full solution, unless they ask for the solution directly. Write mathematics in LaTeX between $...$ (inline) or $$...$$ (display). In Arabic answers keep formulas in Latin notation, as Algerian textbooks do. Give a short direct answer first, then the working or the details.`;

/** Identifies the prompt and model a conversation was started with. */
export const promptHash = (): string =>
  createHash('sha256').update(`${model()}\n${SYSTEM_PROMPT}`).digest('hex').slice(0, 16);

const isArabic = (text: string): boolean => /[؀-ۿ]/.test(text);

export function questionLanguage(question: string): 'fr' | 'ar' {
  return isArabic(question) ? 'ar' : 'fr';
}

function docClass(doc: KbDoc): string {
  if (doc.kind === 'watch') return 'MONITORING';
  return doc.verification ? `${doc.provenance} verification=${doc.verification}` : doc.provenance;
}

/** The user turn sent to the model: profile line, numbered context documents, then the question. */
export function buildUserContent(profile: string, docs: KbDoc[], question: string): string {
  const lang = questionLanguage(question);
  const context = docs
    .map((doc, i) => {
      const title = lang === 'ar' ? doc.title_ar : doc.title_fr;
      const text = (lang === 'ar' ? doc.text_ar : doc.text_fr).slice(0, 3500);
      const meta = [
        `class=${docClass(doc)}`,
        `kind=${doc.kind}`,
        doc.date ? `date=${doc.date}` : null,
        doc.url ? `source=${doc.url}` : null,
      ]
        .filter(Boolean)
        .join(' ');
      return `[${i + 1}] ${meta}\nTitle: ${title}\n${text}`;
    })
    .join('\n\n');
  return [
    `<student_profile>\n${profile}\n</student_profile>`,
    `<context>\n${context || 'No document in the platform matched this question.'}\n</context>`,
    `<question>\n${question}\n</question>`,
  ].join('\n\n');
}

export type TutorErrorCode = 'auth' | 'rate_limited' | 'connection' | 'model' | 'api';

export class TutorError extends Error {
  code: TutorErrorCode;

  constructor(code: TutorErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface HistoryTurn {
  role: 'user' | 'assistant';
  /** Plain text of the turn. */
  text: string;
  /** For assistant turns, the content blocks exactly as the API returned them. */
  blocks: unknown[] | null;
}

export interface TutorReply {
  text: string;
  blocks: unknown[];
  refused: boolean;
  truncated: boolean;
}

let client: Anthropic | null = null;
const getClient = (): Anthropic => (client ??= new Anthropic());

function toMessages(history: HistoryTurn[], userContent: string, plain: boolean): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((turn) =>
    turn.role === 'assistant' && turn.blocks && !plain
      ? { role: 'assistant', content: turn.blocks as Anthropic.Beta.BetaContentBlockParam[] }
      : { role: turn.role, content: turn.text },
  );
  messages.push({ role: 'user', content: userContent });
  return messages;
}

async function request(
  messages: Anthropic.Beta.BetaMessageParam[],
  onText: (delta: string) => void,
  signal: AbortSignal | undefined,
): Promise<TutorReply> {
  const stream = getClient().beta.messages.stream(
    {
      model: model(),
      max_tokens: 32000,
      // If a safety classifier declines the request, the API re-runs it on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: effort() },
      cache_control: { type: 'ephemeral' },
      system: SYSTEM_PROMPT,
      messages,
    },
    { signal },
  );
  stream.on('text', onText);
  const final = await stream.finalMessage();
  const text = final.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
  return {
    text,
    blocks: final.content,
    refused: final.stop_reason === 'refusal',
    truncated: final.stop_reason === 'max_tokens',
  };
}

// --- Local model (Ollama) -------------------------------------------------------------------------

/** How many earlier turns a local model sees: its context window is small, the current documents matter most. */
const LOCAL_HISTORY_TURNS = 6;

/** Earlier user turns were stored with their context documents; a local model only needs the question. */
const questionOf = (stored: string): string => /<question>\n([\s\S]*?)\n<\/question>/.exec(stored)?.[1] ?? stored;

/**
 * Small models drift: they answer in the wrong language or reach for memory when the context is silent.
 * A short reminder at the end of the turn, computed from what was actually retrieved, keeps them on track.
 */
export function localReminder(userContent: string): string {
  const question = questionOf(userContent);
  const official = (userContent.match(/^\[\d+\] class=OFFICIAL/gm) ?? []).length;
  const language = questionLanguage(question) === 'ar' ? 'Arabic (العربية)' : 'French';
  return [
    `Reminder: write the whole answer in ${language}.`,
    official > 0
      ? `The context holds ${official} OFFICIAL document(s): official facts must come from them, cited like [1].`
      : 'The context holds NO OFFICIAL document: if the question is about dates, registration, results, coefficients, programmes or exam rules, say that no verified official information is available yet and do not give any date or figure from memory.',
    'Never invent a source, a date or a number that is not in the context. If you are not sure, say so.',
    'For a lesson or an exercise, just teach: do not comment on whether official documents exist.',
    'Write intervals the Algerian way, for example ]-\\infty ; -1] and [1 ; +\\infty[, and check every sign before concluding.',
  ].join('\n');
}

interface OllamaChunk {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
  error?: string;
}

async function requestLocal(
  history: HistoryTurn[],
  userContent: string,
  onText: (delta: string) => void,
  signal: AbortSignal | undefined,
): Promise<TutorReply> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history
      .slice(-LOCAL_HISTORY_TURNS)
      .map((turn) => ({ role: turn.role, content: turn.role === 'user' ? questionOf(turn.text) : turn.text })),
    { role: 'user', content: `${userContent}\n\n${localReminder(userContent)}` },
  ];
  const think = process.env.OLLAMA_THINK?.trim().toLowerCase() !== 'false';
  let res: Response;
  try {
    res = await fetch(`${ollamaUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: localModel(),
        messages,
        stream: true,
        think,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE?.trim() || '30m',
        options: {
          num_ctx: Number(process.env.OLLAMA_NUM_CTX) || 12288,
          // Qwen's recommended sampling for reasoning mode; lower values make it loop.
          temperature: think ? 0.6 : 0.3,
          top_p: 0.95,
          top_k: 20,
          num_predict: Number(process.env.OLLAMA_MAX_TOKENS) || 8192,
        },
      }),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new TutorError('connection', `Ollama is not reachable at ${ollamaUrl()}: ${(err as Error).message}`);
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    if (res.status === 404) throw new TutorError('model', `Model ${localModel()} is not installed in Ollama (ollama pull ${localModel()}). ${detail}`);
    throw new TutorError('api', `Ollama answered ${res.status}: ${detail.slice(0, 300)}`);
  }

  let text = '';
  let doneReason = '';
  let buffer = '';
  const decoder = new TextDecoder();
  const handle = (line: string): void => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as OllamaChunk;
    if (chunk.error) throw new TutorError('api', chunk.error);
    const delta = chunk.message?.content ?? '';
    if (delta) {
      text += delta;
      onText(delta);
    }
    if (chunk.done) doneReason = chunk.done_reason ?? '';
  };
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(part, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      handle(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  handle(buffer);
  text = text.trim();
  // Plain text only: thinking is not replayed to a local model, so nothing else needs storing.
  return { text, blocks: [{ type: 'text', text }], refused: false, truncated: doneReason === 'length' };
}

/**
 * Streams the tutor's answer.
 *
 * History is replayed exactly as the API produced it (thinking blocks
 * included), because the API rejects edited histories. When a conversation was
 * started under another prompt or model (`plain`), or when the API rejects the
 * replay, the documented recovery applies: resend the turns as text only.
 */
export async function generate(opts: {
  history: HistoryTurn[];
  userContent: string;
  plainHistory: boolean;
  onText: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<TutorReply> {
  if (provider() === 'local') return requestLocal(opts.history, opts.userContent, opts.onText, opts.signal);
  try {
    try {
      return await request(toMessages(opts.history, opts.userContent, opts.plainHistory), opts.onText, opts.signal);
    } catch (err) {
      const replayed = !opts.plainHistory && opts.history.some((t) => t.role === 'assistant' && t.blocks);
      if (err instanceof Anthropic.BadRequestError && replayed) {
        return await request(toMessages(opts.history, opts.userContent, true), opts.onText, opts.signal);
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new TutorError('auth', err.message);
    }
    if (err instanceof Anthropic.NotFoundError) throw new TutorError('model', err.message);
    if (err instanceof Anthropic.RateLimitError) throw new TutorError('rate_limited', err.message);
    if (err instanceof Anthropic.APIConnectionError) throw new TutorError('connection', err.message);
    if (err instanceof Anthropic.APIError) throw new TutorError('api', err.message);
    throw err;
  }
}
