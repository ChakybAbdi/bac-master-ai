import type { ApiError, TutorMessage, TutorMode, TutorSource } from '@shared/types.ts';

/** A failed API call, with the server's stable error code. */
export class ApiFailure extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  try {
    return await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiFailure(0, 'network', 'The server could not be reached.');
  }
}

async function failure(res: Response): Promise<ApiFailure> {
  try {
    const data = (await res.json()) as ApiError;
    return new ApiFailure(res.status, data.error.code, data.error.message, data.error.details);
  } catch {
    return new ApiFailure(res.status, res.status >= 500 ? 'internal' : 'unknown', res.statusText);
  }
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await send(path, opts);
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

/** Sends a multipart form (file uploads). */
export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    throw new ApiFailure(0, 'network', 'The server could not be reached.');
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

export interface TutorHandlers {
  onMeta: (meta: { conversation_id: number; sources: TutorSource[]; mode: TutorMode }) => void;
  onDelta: (text: string) => void;
  onNotice: (code: string) => void;
  onDone: (message: TutorMessage, truncated: boolean) => void;
}

/** Sends a question to the tutor and reads the answer as a stream of server-sent events. */
export async function askTutor(
  body: { conversation_id?: number; question: string; exercise_id?: number },
  handlers: TutorHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await send('/tutor/ask', { method: 'POST', body, signal });
  if (!res.ok || !res.body) throw await failure(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (chunk: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) return;
    const payload = JSON.parse(data.join('\n'));
    if (event === 'meta') handlers.onMeta(payload);
    else if (event === 'delta') handlers.onDelta(payload.text);
    else if (event === 'notice') handlers.onNotice(payload.code);
    else if (event === 'done') handlers.onDone(payload.message, Boolean(payload.truncated));
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let cut = buffer.indexOf('\n\n');
    while (cut !== -1) {
      dispatch(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) dispatch(buffer);
}
