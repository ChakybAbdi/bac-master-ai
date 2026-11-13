import type { FocusKind, PlanParams, PlanWeight } from '../shared/types.ts';
import { addDays, weekday } from './util.ts';

/** How much more (or less) time a subject gets depending on the student's self-assessed level. */
export const NEED_FACTOR: Record<number, number> = { 1: 1.6, 2: 1.3, 3: 1, 4: 0.8, 5: 0.6 };

const FOCUS_CYCLE: FocusKind[] = ['LESSON', 'EXERCISES', 'LESSON', 'EXERCISES', 'EXAM_PRACTICE', 'REVIEW'];

export interface PlanSubject {
  subject_id: number;
  coefficient: number | null;
  level: number | null;
  /** Chapters that still have lessons to do, in order. Used to give sessions a concrete target. */
  chapters: number[];
}

export interface PlannedSession {
  day: string;
  subject_id: number;
  minutes: number;
  focus: FocusKind;
  chapter_id: number | null;
}

/**
 * Splits `total` sessions between subjects in proportion to coefficient x need,
 * using the largest-remainder method. Every subject gets at least one session
 * when there are enough sessions to go round.
 */
export function allocate(subjects: PlanSubject[], total: number): PlanWeight[] {
  if (subjects.length === 0 || total <= 0) return [];
  const weights = subjects.map((s) => {
    const level = s.level ?? 3;
    return { subject: s, level, weight: (s.coefficient ?? 1) * (NEED_FACTOR[level] ?? 1) };
  });
  const sum = weights.reduce((acc, w) => acc + w.weight, 0) || 1;
  const floor = total >= subjects.length ? 1 : 0;
  const pool = total - floor * subjects.length;
  const shares = weights.map((w) => {
    const exact = (w.weight / sum) * pool;
    return { ...w, share: w.weight / sum, sessions: floor + Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = total - shares.reduce((acc, s) => acc + s.sessions, 0);
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || b.weight - a.weight);
  for (let i = 0; left > 0; i = (i + 1) % byRemainder.length, left--) byRemainder[i]!.sessions += 1;
  return shares.map((s) => ({
    subject_id: s.subject.subject_id,
    coefficient: s.subject.coefficient,
    level: s.level,
    share: Math.round(s.share * 1000) / 1000,
    sessions: s.sessions,
  }));
}

/** Smooth weighted round-robin: interleaves subjects so that none is bunched together. */
function interleave(weights: PlanWeight[]): number[] {
  const total = weights.reduce((acc, w) => acc + w.sessions, 0);
  const current = weights.map(() => 0);
  const order: number[] = [];
  for (let step = 0; step < total; step++) {
    let best = -1;
    for (let i = 0; i < weights.length; i++) {
      current[i]! += weights[i]!.sessions;
      if (best === -1 || current[i]! > current[best]!) best = i;
    }
    if (best === -1) break;
    current[best]! -= total;
    order.push(weights[best]!.subject_id);
  }
  return order;
}

/** The study slots of the plan: one entry per session, in date order. */
function slots(params: PlanParams): string[] {
  const days = [...new Set(params.days)].filter((d) => d >= 0 && d <= 6);
  if (days.length === 0) return [];
  const perWeek = Math.max(1, Math.round((params.hours_per_week * 60) / params.session_minutes));
  const base = Math.floor(perWeek / days.length);
  // Extra sessions go to the weekend first (Friday and Saturday in Algeria), then to the earliest days.
  const extraOrder = [...days].sort((a, b) => Number(b >= 5) - Number(a >= 5) || a - b);
  const extra = new Set(extraOrder.slice(0, perWeek - base * days.length));
  const out: string[] = [];
  for (let offset = 0; offset < params.weeks * 7; offset++) {
    const day = addDays(params.start, offset);
    const wd = weekday(day);
    if (!days.includes(wd)) continue;
    const count = base + (extra.has(wd) ? 1 : 0);
    for (let i = 0; i < count; i++) out.push(day);
  }
  return out;
}

export function buildPlan(
  params: PlanParams,
  subjects: PlanSubject[],
): { weights: PlanWeight[]; sessions: PlannedSession[] } {
  const days = slots(params);
  const weights = allocate(subjects, days.length);
  const order = interleave(weights);

  // Avoid the same subject twice on one day when a later slot can be swapped in.
  for (let i = 1; i < order.length; i++) {
    if (days[i] !== days[i - 1] || order[i] !== order[i - 1]) continue;
    for (let j = i + 1; j < order.length; j++) {
      const clashesHere = order[j] === order[i - 1];
      const clashesThere =
        (days[j - 1] === days[j] && order[j - 1] === order[i]) || (days[j + 1] === days[j] && order[j + 1] === order[i]);
      if (!clashesHere && !clashesThere) {
        [order[i], order[j]] = [order[j]!, order[i]!];
        break;
      }
    }
  }

  const bySubject = new Map(subjects.map((s) => [s.subject_id, s]));
  const seen = new Map<number, number>();
  const targetedSeen = new Map<number, number>();
  const sessions: PlannedSession[] = order.map((subjectId, i) => {
    const n = seen.get(subjectId) ?? 0;
    seen.set(subjectId, n + 1);
    const focus = FOCUS_CYCLE[n % FOCUS_CYCLE.length]!;
    const chapters = bySubject.get(subjectId)?.chapters ?? [];
    let chapterId: number | null = null;
    if ((focus === 'LESSON' || focus === 'EXERCISES') && chapters.length > 0) {
      // A lesson session and the exercise session that follows it share the same chapter.
      const t = targetedSeen.get(subjectId) ?? 0;
      targetedSeen.set(subjectId, t + 1);
      chapterId = chapters[Math.floor(t / 2) % chapters.length]!;
    }
    return { day: days[i]!, subject_id: subjectId, minutes: params.session_minutes, focus, chapter_id: chapterId };
  });
  return { weights, sessions };
}
