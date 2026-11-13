import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type {
  Announcement,
  Attempt,
  CalendarEvent,
  ChapterView,
  Claim,
  Conversation,
  Dashboard,
  Exam,
  Exercise,
  LearnSubject,
  Lesson,
  OfficialStatusLine,
  PastPaper,
  Plan,
  PlanParams,
  PlanSession,
  PlanWeight,
  Recommendation,
  TutorMessage,
  TutorMode,
  User,
} from '../../shared/types.ts';
import { frameworkRef, saveSubjectPrefs, subjectsView } from '../academic.ts';
import { currentUser, getUser, requireAuth, verifyPassword, type AppEnv } from '../auth.ts';
import { all, audit, get, run, tx, type DB } from '../db.ts';
import { buildKb, exerciseDoc, parseSources, search, toSources, type KbDoc } from '../kb.ts';
import { listRecords } from '../monitoring.ts';
import { readPaperFile } from '../papers.ts';
import { NEED_FACTOR, buildPlan, type PlanSubject } from '../planner.ts';
import {
  TutorError,
  aiEnabled,
  buildUserContent,
  generate,
  promptHash,
  questionLanguage,
  type HistoryTurn,
} from '../tutor.ts';
import { HttpError, addDays, daysBetween, intParam, nowIso, parseJson, rateLimit, readBody, round, todayInAlgiers } from '../util.ts';

const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// --- Shared queries -----------------------------------------------------------

function calendar(db: DB, editionId: number | null): CalendarEvent[] {
  if (!editionId) return [];
  return all<CalendarEvent>(
    db,
    `SELECT e.id, e.edition_id, e.kind, e.starts_on, e.ends_on, e.dates_fr, e.dates_ar, e.title_fr, e.title_ar,
            e.audience_fr, e.audience_ar, e.note_fr, e.note_ar, e.status, e.concerns_3as, e.record_id,
            r.original_url AS source_url, r.last_verified
       FROM calendar_events e LEFT JOIN official_records r ON r.id = e.record_id
      WHERE e.edition_id = ? AND e.state = 'PUBLISHED'
      ORDER BY e.starts_on IS NULL, e.starts_on, e.id`,
    editionId,
  );
}

function announcements(db: DB, user: User): Announcement[] {
  return all<Announcement>(
    db,
    `SELECT a.id, a.kind, a.priority, a.edition_id, a.stream_id, a.title_fr, a.title_ar, a.body_fr, a.body_ar,
            a.record_id, a.status, a.created_at, a.published_at, ar.read_at,
            r.verification AS record_verification, r.original_url AS record_url, r.document_title AS record_title
       FROM announcements a
       LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = ?
       LEFT JOIN official_records r ON r.id = a.record_id
      WHERE a.status = 'PUBLISHED'
        AND (a.edition_id IS NULL OR a.edition_id = ?)
        AND (a.stream_id IS NULL OR a.stream_id = ?)
      ORDER BY a.published_at DESC`,
    user.id,
    user.edition_id,
    user.stream_id,
  );
}

/** Chapters the student can see: the edition's chapters mapped to their stream (all of them when no stream is set). */
const CHAPTER_SCOPE = `c.state = 'ACTIVE' AND c.edition_id = ?
  AND (? IS NULL OR EXISTS (SELECT 1 FROM chapter_streams cs WHERE cs.chapter_id = c.id AND cs.stream_id = ?))`;

// Official past papers serve every session; practice papers belong to one session.
const EXAM_SCOPE = `x.state = 'ACTIVE' AND (x.edition_id = ? OR x.kind = 'OFFICIAL_PAST')
  AND (? IS NULL OR EXISTS (SELECT 1 FROM exam_streams xs WHERE xs.exam_id = x.id AND xs.stream_id = ?))`;

const EXAM_COLUMNS = `x.id, x.edition_id, x.subject_id, s.name_fr AS subject_name_fr, s.name_ar AS subject_name_ar,
  x.title_fr, x.title_ar, x.kind, x.default_duration, x.instructions_fr, x.instructions_ar, x.provenance,
  x.total_points, x.outdated,
  (SELECT COUNT(*) FROM exercises e WHERE e.exam_id = x.id) AS exercise_count`;

type ExamRow = Omit<Exam, 'outdated'> & { outdated: number };
const toExam = (row: ExamRow): Exam => ({ ...row, outdated: row.outdated === 1 });

function examExercises(db: DB, examId: number, withSolutions: boolean): Exercise[] {
  const rows = all<Exercise>(
    db,
    `SELECT id, exam_id, chapter_id, sort, title_fr, title_ar, statement_fr, statement_ar, solution_fr, solution_ar,
            points, provenance, solution_provenance
       FROM exercises WHERE exam_id = ? ORDER BY sort, id`,
    examId,
  );
  if (withSolutions) return rows;
  return rows.map(({ solution_fr: _fr, solution_ar: _ar, ...rest }) => rest);
}

interface AttemptRow {
  id: number;
  user_id: string;
  exam_id: number;
  duration_minutes: number;
  started_at: string;
  finished_at: string | null;
  status: Attempt['status'];
  answers: string;
  scores: string | null;
  score: number | null;
  max_score: number | null;
  exam_title_fr?: string;
  exam_title_ar?: string;
  subject_id?: number;
  subject_name_fr?: string;
  subject_name_ar?: string;
}

function toAttempt(row: AttemptRow): Attempt {
  const { user_id: _user, ...rest } = row;
  return {
    ...rest,
    answers: parseJson<Record<string, string>>(row.answers, {}),
    scores: row.scores ? parseJson<Record<string, number>>(row.scores, {}) : null,
  };
}

function ownAttempt(db: DB, user: User, id: number): AttemptRow {
  const row = get<AttemptRow>(db, 'SELECT * FROM attempts WHERE id = ? AND user_id = ?', id, user.id);
  if (!row) throw new HttpError(404, 'not_found', 'Attempt not found.');
  return row;
}

function activePlan(db: DB, user: User): Plan | null {
  const row = get<{ id: number; created_at: string; params: string; weights: string; official_weights: number }>(
    db,
    'SELECT id, created_at, params, weights, official_weights FROM plans WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 1',
    user.id,
  );
  if (!row) return null;
  return {
    id: row.id,
    created_at: row.created_at,
    params: parseJson<PlanParams>(row.params, { hours_per_week: 0, days: [], session_minutes: 60, weeks: 0, start: '' }),
    official_weights: row.official_weights === 1,
    weights: parseJson<PlanWeight[]>(row.weights, []),
    sessions: all<PlanSession>(
      db,
      'SELECT id, day, subject_id, minutes, focus, chapter_id, done_at FROM plan_sessions WHERE plan_id = ? ORDER BY day, id',
      row.id,
    ),
  };
}

function lessonCounts(db: DB, user: User): { total: number; done: number } {
  if (!user.edition_id) return { total: 0, done: 0 };
  const row = get<{ total: number; done: number }>(
    db,
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN lp.lesson_id IS NULL THEN 0 ELSE 1 END), 0) AS done
       FROM lessons l JOIN chapters c ON c.id = l.chapter_id
       LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
      WHERE l.state = 'ACTIVE' AND ${CHAPTER_SCOPE}`,
    user.id,
    user.edition_id,
    user.stream_id,
    user.stream_id,
  );
  return { total: row?.total ?? 0, done: row?.done ?? 0 };
}

// --- Dashboard ------------------------------------------------------------------

function buildDashboard(db: DB, user: User): Dashboard {
  const today = todayInAlgiers();
  const events = calendar(db, user.edition_id);
  const anns = announcements(db, user);
  const unread = anns.filter((a) => !a.read_at);
  const view = subjectsView(db, user);
  const plan = activePlan(db, user);
  const lessons = lessonCounts(db, user);
  const attempts = get<{ n: number; best: number | null }>(
    db,
    "SELECT COUNT(*) AS n, MAX(CASE WHEN max_score > 0 THEN score * 20.0 / max_score END) AS best FROM attempts WHERE user_id = ? AND status = 'GRADED'",
    user.id,
  );
  const examsAvailable = user.edition_id
    ? (get<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM exams x WHERE ${EXAM_SCOPE}`,
        user.edition_id,
        user.stream_id,
        user.stream_id,
      )?.n ?? 0)
    : 0;

  const official: OfficialStatusLine[] = [];
  for (const key of ['REGISTRATION', 'EXAM', 'RESULTS'] as const) {
    const event = events.find((e) => e.kind === key);
    if (!event) continue;
    official.push({
      key,
      status: event.status,
      dates_fr: event.dates_fr,
      dates_ar: event.dates_ar,
      record_id: event.record_id,
      source_url: event.source_url,
      last_verified: event.last_verified,
    });
  }
  const framework = frameworkRef(db);
  if (framework) {
    official.push({
      key: 'FRAMEWORK',
      status: framework.verification,
      dates_fr: framework.title_fr,
      dates_ar: framework.title_ar,
      record_id: framework.record_id,
      source_url: framework.url,
      last_verified: framework.last_verified,
    });
  }

  const upcoming = events
    .filter((e) => e.status !== 'NOT_ANNOUNCED' && e.ends_on !== null && e.ends_on >= today)
    .slice(0, 4);
  const todaySessions = plan?.sessions.filter((s) => s.day === today) ?? [];

  const recs: Recommendation[] = [];
  if (!user.stream_id || !user.edition_id) {
    recs.push({ kind: 'COMPLETE_PROFILE', priority: 'HIGH', params: {}, href: '/settings' });
  }
  if (view.mode === 'custom' && view.items.length === 0 && user.stream_id) {
    recs.push({ kind: 'SUBJECTS_PENDING', priority: 'HIGH', params: { pending: view.pending ? 1 : 0 }, href: '/subjects' });
  }
  const urgent = [...unread].sort((a, b) => PRIORITY_ORDER[a.priority]! - PRIORITY_ORDER[b.priority]!)[0];
  if (urgent) {
    recs.push({
      kind: 'READ_ANNOUNCEMENT',
      priority: urgent.priority,
      params: { title_fr: urgent.title_fr, title_ar: urgent.title_ar },
      href: '/official?tab=announcements',
    });
  }
  const next = events.find(
    (e) => e.status === 'CONFIRMED' && e.concerns_3as >= 1 && e.starts_on !== null && e.starts_on >= today,
  );
  if (next?.starts_on && daysBetween(today, next.starts_on) <= 21) {
    recs.push({
      kind: 'UPCOMING_EVENT',
      priority: 'MEDIUM',
      params: {
        title_fr: next.title_fr,
        title_ar: next.title_ar,
        dates_fr: next.dates_fr,
        dates_ar: next.dates_ar,
        days: daysBetween(today, next.starts_on),
      },
      href: '/official?tab=calendar',
    });
  }
  const registration = events.find((e) => e.kind === 'REGISTRATION');
  if (registration?.status === 'NOT_ANNOUNCED') {
    recs.push({
      kind: 'REGISTRATION_WATCH',
      priority: 'MEDIUM',
      params: { last_verified: registration.last_verified },
      href: '/official?tab=calendar',
    });
  }
  if (view.items.length > 0) {
    if (view.items.some((i) => i.level === null)) {
      recs.push({ kind: 'SET_LEVELS', priority: 'MEDIUM', params: {}, href: '/subjects' });
    }
    const weak = view.items
      .filter((i) => i.level !== null && i.level <= 2 && i.coefficient !== null)
      .sort((a, b) => b.coefficient! * NEED_FACTOR[b.level!]! - a.coefficient! * NEED_FACTOR[a.level!]!)[0];
    if (weak) {
      recs.push({
        kind: 'PRIORITISE_SUBJECT',
        priority: 'MEDIUM',
        params: { name_fr: weak.name_fr, name_ar: weak.name_ar, coefficient: weak.coefficient },
        href: '/planner',
      });
    }
    if (!plan) recs.push({ kind: 'CREATE_PLAN', priority: 'MEDIUM', params: {}, href: '/planner' });
  }
  const pendingToday = todaySessions.filter((s) => !s.done_at).length;
  if (pendingToday > 0) {
    recs.push({ kind: 'TODAY_SESSIONS', priority: 'MEDIUM', params: { count: pendingToday }, href: '/planner' });
  }
  if (examsAvailable > 0 && (attempts?.n ?? 0) === 0) {
    recs.push({ kind: 'TRY_SIMULATOR', priority: 'LOW', params: {}, href: '/simulator' });
  }
  if (lessons.total > lessons.done) {
    recs.push({
      kind: 'CONTINUE_LESSONS',
      priority: 'LOW',
      params: { done: lessons.done, total: lessons.total },
      href: '/learn',
    });
  }
  recs.sort((a, b) => PRIORITY_ORDER[a.priority]! - PRIORITY_ORDER[b.priority]!);

  return {
    official,
    upcoming,
    announcements: [...unread, ...anns.filter((a) => a.read_at)].slice(0, 3),
    unread: unread.length,
    recommendations: recs.slice(0, 6),
    today: todaySessions,
    progress: {
      lessons_done: lessons.done,
      lessons_total: lessons.total,
      attempts: attempts?.n ?? 0,
      best_score: attempts?.best === null || attempts?.best === undefined ? null : round(attempts.best),
    },
  };
}

// --- Validation schemas ---------------------------------------------------------

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  locale: z.enum(['fr', 'ar']).optional(),
  edition_id: z.number().int().positive().optional(),
  stream_id: z.number().int().positive().nullable().optional(),
});

const prefsSchema = z.object({
  items: z
    .array(
      z.object({
        subject_id: z.number().int().positive(),
        in_custom: z.boolean().optional(),
        custom_coefficient: z.number().min(0.5).max(20).nullable().optional(),
        level: z.number().int().min(1).max(5).nullable().optional(),
        grade: z.number().min(0).max(20).nullable().optional(),
      }),
    )
    .max(40),
});

const planSchema = z.object({
  hours_per_week: z.number().min(1).max(70),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  session_minutes: z.number().int().min(30).max(180),
  weeks: z.number().int().min(1).max(12),
});

const answersSchema = z.object({ answers: z.record(z.string(), z.string().max(20_000)) });
const gradeSchema = z.object({ scores: z.record(z.string(), z.number().min(0).max(40)) });
const askSchema = z.object({
  conversation_id: z.number().int().positive().optional(),
  question: z.string().trim().min(1).max(4000),
  exercise_id: z.number().int().positive().optional(),
});

const OFFLINE_TEXT = {
  fr: "Le tuteur IA n'est pas activé sur ce serveur. Les documents ci-dessous, tirés de la base de la plateforme, correspondent à votre question.",
  ar: 'المساعد الذكي غير مفعل على هذا الخادم. الوثائق أدناه، المأخوذة من قاعدة المنصة، توافق سؤالك.',
};
const NO_MATCH_TEXT = {
  fr: 'Aucun document de la plateforme ne correspond à cette question. Reformulez-la, ou consultez la page Infos officielles.',
  ar: 'لا توجد في المنصة وثيقة توافق هذا السؤال. أعد صياغته أو راجع صفحة المعلومات الرسمية.',
};
const UNAVAILABLE_TEXT = {
  fr: "Le tuteur IA est indisponible pour le moment. Voici les documents de la plateforme qui correspondent à votre question.",
  ar: 'المساعد الذكي غير متاح حاليا. إليك وثائق المنصة التي توافق سؤالك.',
};
const REFUSED_TEXT = {
  fr: "Le tuteur n'a pas pu répondre à cette demande. Reformulez votre question en lien avec vos révisions.",
  ar: 'لم يتمكن المساعد من الإجابة عن هذا الطلب. أعد صياغة سؤالك بما يتعلق بمراجعتك.',
};

export function studentRoutes(db: DB): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth);

  // --- Profile ---------------------------------------------------------------

  app.patch('/me', async (c) => {
    const user = currentUser(c);
    const input = await readBody(c, profileSchema);
    if (input.edition_id !== undefined && !get(db, 'SELECT 1 FROM editions WHERE id = ?', input.edition_id)) {
      throw new HttpError(400, 'unknown_edition', 'Unknown session.');
    }
    if (input.stream_id && !get(db, 'SELECT 1 FROM streams WHERE id = ?', input.stream_id)) {
      throw new HttpError(400, 'unknown_stream', 'Unknown stream.');
    }
    run(
      db,
      'UPDATE users SET name = ?, locale = ?, edition_id = ?, stream_id = ? WHERE id = ?',
      input.name ?? user.name,
      input.locale ?? user.locale,
      input.edition_id ?? user.edition_id,
      input.stream_id === undefined ? user.stream_id : input.stream_id,
      user.id,
    );
    return c.json({ user: getUser(db, user.id) });
  });

  app.post('/me/delete', async (c) => {
    const user = currentUser(c);
    const { password } = await readBody(c, z.object({ password: z.string().min(1).max(200) }));
    if (user.role !== 'student') {
      throw new HttpError(403, 'staff_account', 'Staff accounts are removed by an administrator.');
    }
    const row = get<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = ?', user.id);
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      throw new HttpError(401, 'invalid_credentials', 'Wrong password.');
    }
    tx(db, () => {
      // Tables without ON DELETE CASCADE on users are cleared explicitly.
      run(db, 'DELETE FROM users WHERE id = ?', user.id);
      audit(db, null, 'user.delete_self', 'user', user.id);
    });
    return c.json({ ok: true });
  });

  // --- Dashboard and notifications ---------------------------------------------

  app.get('/dashboard', (c) => c.json(buildDashboard(db, currentUser(c))));

  app.get('/notifications', (c) => {
    const items = announcements(db, currentUser(c));
    return c.json({ unread: items.filter((a) => !a.read_at).length, items: items.slice(0, 10) });
  });

  // --- Official information ------------------------------------------------------

  app.get('/official/announcements', (c) => c.json({ items: announcements(db, currentUser(c)) }));

  app.post('/official/announcements/read', async (c) => {
    const user = currentUser(c);
    const { ids } = await readBody(c, z.object({ ids: z.array(z.number().int().positive()).max(200) }));
    const visible = new Set(announcements(db, user).map((a) => a.id));
    const now = nowIso();
    for (const id of ids) {
      if (!visible.has(id)) continue;
      run(
        db,
        'INSERT INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        id,
        user.id,
        now,
      );
    }
    return c.json({ ok: true });
  });

  app.get('/official/calendar', (c) => c.json({ items: calendar(db, currentUser(c).edition_id), today: todayInAlgiers() }));

  app.get('/official/claims', (c) => {
    const user = currentUser(c);
    const items = all<Claim>(
      db,
      `SELECT id, edition_id, claim_fr, claim_ar, finding_fr, finding_ar, verdict, record_id, checked_on
         FROM claims WHERE state = 'PUBLISHED' AND (edition_id IS NULL OR edition_id = ?) ORDER BY id`,
      user.edition_id,
    );
    return c.json({ items });
  });

  app.get('/official/records', (c) => c.json({ items: listRecords(db, true) }));

  // --- Subjects, coefficients, calculator -----------------------------------------

  app.get('/subjects', (c) => c.json(subjectsView(db, currentUser(c))));

  app.put('/subjects/prefs', async (c) => {
    const user = currentUser(c);
    const { items } = await readBody(c, prefsSchema);
    saveSubjectPrefs(db, user, items);
    return c.json(subjectsView(db, user));
  });

  // --- Lessons ---------------------------------------------------------------------

  app.get('/learn/subjects', (c) => {
    const user = currentUser(c);
    if (!user.edition_id) return c.json({ items: [] });
    const items = all<LearnSubject>(
      db,
      `SELECT s.id AS subject_id, s.name_fr, s.name_ar,
              COUNT(DISTINCT c.id) AS chapters,
              COUNT(DISTINCT l.id) AS lessons,
              COUNT(DISTINCT lp.lesson_id) AS lessons_done
         FROM chapters c
         JOIN subjects s ON s.id = c.subject_id
         LEFT JOIN lessons l ON l.chapter_id = c.id AND l.state = 'ACTIVE'
         LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
        WHERE ${CHAPTER_SCOPE}
        GROUP BY s.id ORDER BY s.sort`,
      user.id,
      user.edition_id,
      user.stream_id,
      user.stream_id,
    );
    return c.json({ items });
  });

  app.get('/learn/subjects/:subjectId', (c) => {
    const user = currentUser(c);
    const subjectId = intParam(c, 'subjectId');
    const subject = get<{ id: number; name_fr: string; name_ar: string }>(
      db,
      'SELECT id, name_fr, name_ar FROM subjects WHERE id = ?',
      subjectId,
    );
    if (!subject) throw new HttpError(404, 'not_found', 'Subject not found.');
    if (!user.edition_id) return c.json({ subject, chapters: [] });
    const chapters = all<Omit<ChapterView, 'lessons' | 'exercises'>>(
      db,
      `SELECT c.id, c.subject_id, c.title_fr, c.title_ar, c.sort, c.verification, c.note_fr, c.note_ar
         FROM chapters c WHERE c.subject_id = ? AND ${CHAPTER_SCOPE} ORDER BY c.sort, c.id`,
      subjectId,
      user.edition_id,
      user.stream_id,
      user.stream_id,
    );
    const result: ChapterView[] = chapters.map((ch) => ({
      ...ch,
      lessons: all<{ id: number; title_fr: string; title_ar: string; provenance: Lesson['provenance']; outdated: number; done: number }>(
        db,
        `SELECT l.id, l.title_fr, l.title_ar, l.provenance, l.outdated,
                CASE WHEN lp.lesson_id IS NULL THEN 0 ELSE 1 END AS done
           FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
          WHERE l.chapter_id = ? AND l.state = 'ACTIVE' ORDER BY l.sort, l.id`,
        user.id,
        ch.id,
      ).map((l) => ({ ...l, outdated: l.outdated === 1, done: l.done === 1 })),
      exercises: all<Exercise>(
        db,
        `SELECT id, exam_id, chapter_id, sort, title_fr, title_ar, statement_fr, statement_ar, solution_fr, solution_ar,
                points, provenance, solution_provenance
           FROM exercises WHERE chapter_id = ? ORDER BY sort, id`,
        ch.id,
      ),
    }));
    return c.json({ subject, chapters: result });
  });

  app.get('/learn/lessons/:id', (c) => {
    const user = currentUser(c);
    const row = get<Omit<Lesson, 'outdated' | 'done'> & { outdated: number; done: number }>(
      db,
      `SELECT l.id, l.chapter_id, c.subject_id, c.title_fr AS chapter_title_fr, c.title_ar AS chapter_title_ar,
              l.title_fr, l.title_ar, l.body_fr, l.body_ar, l.provenance, l.outdated, l.outdated_note, l.version,
              u.name AS reviewed_by_name, l.reviewed_at,
              CASE WHEN lp.lesson_id IS NULL THEN 0 ELSE 1 END AS done
         FROM lessons l
         JOIN chapters c ON c.id = l.chapter_id
         LEFT JOIN users u ON u.id = l.reviewed_by
         LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
        WHERE l.id = ? AND l.state = 'ACTIVE'`,
      user.id,
      intParam(c, 'id'),
    );
    if (!row) throw new HttpError(404, 'not_found', 'Lesson not found.');
    const lesson: Lesson = { ...row, outdated: row.outdated === 1, done: row.done === 1 };
    return c.json({ lesson });
  });

  app.post('/learn/lessons/:id/progress', async (c) => {
    const user = currentUser(c);
    const id = intParam(c, 'id');
    const { done } = await readBody(c, z.object({ done: z.boolean() }));
    if (!get(db, "SELECT 1 FROM lessons WHERE id = ? AND state = 'ACTIVE'", id)) {
      throw new HttpError(404, 'not_found', 'Lesson not found.');
    }
    if (done) {
      run(
        db,
        'INSERT INTO lesson_progress (user_id, lesson_id, done_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        user.id,
        id,
        nowIso(),
      );
    } else {
      run(db, 'DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id = ?', user.id, id);
    }
    return c.json({ ok: true, done });
  });

  // --- Examination simulator ---------------------------------------------------------

  app.get('/sim/exams', (c) => {
    const user = currentUser(c);
    if (!user.edition_id) return c.json({ items: [] });
    const items = all<ExamRow>(
      db,
      `SELECT ${EXAM_COLUMNS} FROM exams x JOIN subjects s ON s.id = x.subject_id WHERE ${EXAM_SCOPE} ORDER BY s.sort, x.id`,
      user.edition_id,
      user.stream_id,
      user.stream_id,
    ).map(toExam);
    return c.json({ items });
  });

  app.get('/sim/exams/:id', (c) => {
    const row = get<ExamRow>(
      db,
      `SELECT ${EXAM_COLUMNS} FROM exams x JOIN subjects s ON s.id = x.subject_id WHERE x.id = ? AND x.state = 'ACTIVE'`,
      intParam(c, 'id'),
    );
    if (!row) throw new HttpError(404, 'not_found', 'Exam not found.');
    return c.json({ exam: { ...toExam(row), exercises: examExercises(db, row.id, false) } });
  });

  app.get('/sim/attempts', (c) => {
    const user = currentUser(c);
    const items = all<AttemptRow>(
      db,
      `SELECT a.*, x.title_fr AS exam_title_fr, x.title_ar AS exam_title_ar, x.subject_id,
              s.name_fr AS subject_name_fr, s.name_ar AS subject_name_ar
         FROM attempts a JOIN exams x ON x.id = a.exam_id JOIN subjects s ON s.id = x.subject_id
        WHERE a.user_id = ? ORDER BY a.started_at DESC LIMIT 50`,
      user.id,
    ).map(toAttempt);
    return c.json({ items });
  });

  app.post('/sim/attempts', async (c) => {
    const user = currentUser(c);
    const input = await readBody(
      c,
      z.object({ exam_id: z.number().int().positive(), duration_minutes: z.number().int().min(10).max(300) }),
    );
    if (!get(db, "SELECT 1 FROM exams WHERE id = ? AND state = 'ACTIVE'", input.exam_id)) {
      throw new HttpError(404, 'not_found', 'Exam not found.');
    }
    const open = get<AttemptRow>(
      db,
      "SELECT * FROM attempts WHERE user_id = ? AND exam_id = ? AND status = 'IN_PROGRESS' ORDER BY id DESC LIMIT 1",
      user.id,
      input.exam_id,
    );
    if (open) return c.json({ attempt: toAttempt(open), resumed: true });
    const created = run(
      db,
      'INSERT INTO attempts (user_id, exam_id, duration_minutes, started_at) VALUES (?, ?, ?, ?)',
      user.id,
      input.exam_id,
      input.duration_minutes,
      nowIso(),
    );
    return c.json({ attempt: toAttempt(ownAttempt(db, user, created.id)), resumed: false }, 201);
  });

  app.get('/sim/attempts/:id', (c) => {
    const user = currentUser(c);
    const attempt = ownAttempt(db, user, intParam(c, 'id'));
    const row = get<ExamRow>(
      db,
      `SELECT ${EXAM_COLUMNS} FROM exams x JOIN subjects s ON s.id = x.subject_id WHERE x.id = ?`,
      attempt.exam_id,
    )!;
    // The corrections stay hidden while the paper is being written.
    const exam: Exam = { ...toExam(row), exercises: examExercises(db, row.id, attempt.status !== 'IN_PROGRESS') };
    return c.json({ attempt: toAttempt(attempt), exam, now: nowIso() });
  });

  app.put('/sim/attempts/:id/answers', async (c) => {
    const user = currentUser(c);
    const attempt = ownAttempt(db, user, intParam(c, 'id'));
    if (attempt.status !== 'IN_PROGRESS') throw new HttpError(409, 'already_submitted', 'This attempt is closed.');
    const { answers } = await readBody(c, answersSchema);
    run(db, 'UPDATE attempts SET answers = ? WHERE id = ?', JSON.stringify(answers), attempt.id);
    return c.json({ ok: true });
  });

  app.post('/sim/attempts/:id/submit', async (c) => {
    const user = currentUser(c);
    const attempt = ownAttempt(db, user, intParam(c, 'id'));
    if (attempt.status !== 'IN_PROGRESS') throw new HttpError(409, 'already_submitted', 'This attempt is closed.');
    const { answers } = await readBody(c, answersSchema);
    run(
      db,
      "UPDATE attempts SET answers = ?, status = 'SUBMITTED', finished_at = ? WHERE id = ?",
      JSON.stringify(answers),
      nowIso(),
      attempt.id,
    );
    return c.json({ attempt: toAttempt(ownAttempt(db, user, attempt.id)) });
  });

  app.post('/sim/attempts/:id/grade', async (c) => {
    const user = currentUser(c);
    const attempt = ownAttempt(db, user, intParam(c, 'id'));
    if (attempt.status === 'IN_PROGRESS') throw new HttpError(409, 'not_submitted', 'Hand the paper in first.');
    const { scores } = await readBody(c, gradeSchema);
    const exercises = all<{ id: number; points: number }>(db, 'SELECT id, points FROM exercises WHERE exam_id = ?', attempt.exam_id);
    const clean: Record<string, number> = {};
    let score = 0;
    let max = 0;
    for (const ex of exercises) {
      const given = scores[String(ex.id)];
      if (given === undefined) throw new HttpError(400, 'missing_score', `Give yourself a mark for every exercise.`);
      if (given > ex.points) throw new HttpError(400, 'score_too_high', 'A mark is higher than the exercise is worth.');
      clean[String(ex.id)] = given;
      score += given;
      max += ex.points;
    }
    run(
      db,
      "UPDATE attempts SET scores = ?, score = ?, max_score = ?, status = 'GRADED' WHERE id = ?",
      JSON.stringify(clean),
      round(score),
      max,
      attempt.id,
    );
    return c.json({ attempt: toAttempt(ownAttempt(db, user, attempt.id)) });
  });

  // --- Revision planner ----------------------------------------------------------------

  app.get('/planner', (c) => {
    const user = currentUser(c);
    return c.json({
      plan: activePlan(db, user),
      subjects: subjectsView(db, user),
      events: calendar(db, user.edition_id).filter((e) => e.status !== 'NOT_ANNOUNCED'),
      today: todayInAlgiers(),
    });
  });

  app.post('/planner', async (c) => {
    const user = currentUser(c);
    const input = await readBody(c, planSchema);
    const view = subjectsView(db, user);
    const items = view.items.filter((i) => !i.is_optional || i.level !== null);
    if (items.length === 0) {
      throw new HttpError(409, 'no_subjects', 'Add your subjects before creating a plan.');
    }
    const subjects: PlanSubject[] = items.map((item) => {
      const chapters = user.edition_id
        ? all<{ id: number; remaining: number }>(
            db,
            `SELECT c.id,
                    (SELECT COUNT(*) FROM lessons l
                      WHERE l.chapter_id = c.id AND l.state = 'ACTIVE'
                        AND NOT EXISTS (SELECT 1 FROM lesson_progress lp WHERE lp.lesson_id = l.id AND lp.user_id = ?)) AS remaining
               FROM chapters c WHERE c.subject_id = ? AND ${CHAPTER_SCOPE} ORDER BY c.sort, c.id`,
            user.id,
            item.subject_id,
            user.edition_id,
            user.stream_id,
            user.stream_id,
          )
        : [];
      const open = chapters.filter((ch) => ch.remaining > 0);
      return {
        subject_id: item.subject_id,
        coefficient: item.coefficient,
        level: item.level,
        chapters: (open.length > 0 ? open : chapters).map((ch) => ch.id),
      };
    });
    const params: PlanParams = { ...input, days: [...new Set(input.days)].sort(), start: todayInAlgiers() };
    const built = buildPlan(params, subjects);
    if (built.sessions.length === 0) throw new HttpError(400, 'empty_plan', 'These settings produce no study session.');
    tx(db, () => {
      // Earlier plans are kept for history; only one is active.
      run(db, 'UPDATE plans SET active = 0 WHERE user_id = ?', user.id);
      const plan = run(
        db,
        'INSERT INTO plans (user_id, created_at, params, weights, official_weights, active) VALUES (?, ?, ?, ?, ?, 1)',
        user.id,
        nowIso(),
        JSON.stringify(params),
        JSON.stringify(built.weights),
        view.mode === 'official' ? 1 : 0,
      );
      for (const s of built.sessions) {
        run(
          db,
          'INSERT INTO plan_sessions (plan_id, day, subject_id, minutes, focus, chapter_id) VALUES (?, ?, ?, ?, ?, ?)',
          plan.id,
          s.day,
          s.subject_id,
          s.minutes,
          s.focus,
          s.chapter_id,
        );
      }
    });
    return c.json({ plan: activePlan(db, user) }, 201);
  });

  app.post('/planner/sessions/:id/toggle', (c) => {
    const user = currentUser(c);
    const id = intParam(c, 'id');
    const session = get<{ id: number; done_at: string | null }>(
      db,
      'SELECT ps.id, ps.done_at FROM plan_sessions ps JOIN plans p ON p.id = ps.plan_id WHERE ps.id = ? AND p.user_id = ?',
      id,
      user.id,
    );
    if (!session) throw new HttpError(404, 'not_found', 'Session not found.');
    const doneAt = session.done_at ? null : nowIso();
    run(db, 'UPDATE plan_sessions SET done_at = ? WHERE id = ?', doneAt, id);
    return c.json({ id, done_at: doneAt });
  });

  // --- Past papers --------------------------------------------------------------------

  app.get('/archive', (c) => {
    const items = all<PastPaper>(
      db,
      `SELECT id, exam_year, stream_id, subject_id, language, doc_type, title, source_authority, publication_date,
              url, verification, note, file_name, file_size, added_at
         FROM past_papers WHERE state = 'ACTIVE' ORDER BY exam_year DESC, subject_id, doc_type, id`,
    );
    return c.json({ items });
  });

  app.get('/archive/:id/file', (c) => {
    const id = intParam(c, 'id');
    const row = get<{ file_name: string | null }>(db, "SELECT file_name FROM past_papers WHERE id = ? AND state = 'ACTIVE'", id);
    const bytes = row?.file_name ? readPaperFile(id) : null;
    if (!row?.file_name || !bytes) throw new HttpError(404, 'not_found', 'Document not found.');
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    });
  });

  // --- AI tutor -----------------------------------------------------------------------

  const toMessage = (m: {
    id: number;
    role: 'user' | 'assistant';
    content: string;
    sources: string;
    mode: string | null;
    created_at: string;
  }): TutorMessage => ({
    id: m.id,
    role: m.role,
    content: m.content,
    sources: parseSources(m.sources),
    mode: (m.mode as TutorMode | null) ?? null,
    created_at: m.created_at,
  });

  app.get('/tutor/conversations', (c) => {
    const items = all<Conversation>(
      db,
      'SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
      currentUser(c).id,
    );
    return c.json({ items });
  });

  app.get('/tutor/conversations/:id', (c) => {
    const user = currentUser(c);
    const id = intParam(c, 'id');
    const conversation = get<Conversation>(
      db,
      'SELECT id, title, updated_at FROM conversations WHERE id = ? AND user_id = ?',
      id,
      user.id,
    );
    if (!conversation) throw new HttpError(404, 'not_found', 'Conversation not found.');
    const messages = all<Parameters<typeof toMessage>[0]>(
      db,
      'SELECT id, role, content, sources, mode, created_at FROM messages WHERE conversation_id = ? ORDER BY id',
      id,
    ).map(toMessage);
    return c.json({ conversation, messages });
  });

  app.delete('/tutor/conversations/:id', (c) => {
    const result = run(db, 'DELETE FROM conversations WHERE id = ? AND user_id = ?', intParam(c, 'id'), currentUser(c).id);
    if (result.changes === 0) throw new HttpError(404, 'not_found', 'Conversation not found.');
    return c.json({ ok: true });
  });

  app.post('/tutor/ask', async (c) => {
    const user = currentUser(c);
    rateLimit(`tutor:${user.id}`, 20, 60_000);
    // A daily cap per student keeps a shared GPU (or an API budget) available to everyone.
    const dailyLimit = Number(process.env.TUTOR_DAILY_LIMIT ?? 40);
    if (dailyLimit > 0 && user.role === 'student') {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const asked = get<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.user_id = ? AND m.role = 'user' AND m.created_at >= ?`,
        user.id,
        since,
      )!.n;
      if (asked >= dailyLimit) {
        throw new HttpError(429, 'daily_limit', `The tutor answers ${dailyLimit} questions per student per 24 hours.`);
      }
    }
    const input = await readBody(c, askSchema);
    const lang = questionLanguage(input.question);
    const now = nowIso();

    let conversation = input.conversation_id
      ? get<{ id: number; prompt_hash: string | null }>(
          db,
          'SELECT id, prompt_hash FROM conversations WHERE id = ? AND user_id = ?',
          input.conversation_id,
          user.id,
        )
      : undefined;
    if (input.conversation_id && !conversation) throw new HttpError(404, 'not_found', 'Conversation not found.');
    if (!conversation) {
      const title = input.question.length > 70 ? `${input.question.slice(0, 67)}...` : input.question;
      const created = run(
        db,
        'INSERT INTO conversations (user_id, title, prompt_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        user.id,
        title,
        promptHash(),
        now,
        now,
      );
      conversation = { id: created.id, prompt_hash: promptHash() };
    }
    const conversationId = conversation.id;

    // Retrieval: the documents that will back the answer, with their provenance.
    const docs: KbDoc[] = [];
    if (input.exercise_id) {
      const doc = exerciseDoc(db, input.exercise_id);
      if (doc) docs.push(doc);
    }
    for (const hit of search(buildKb(db, user), input.question, 6)) docs.push(hit.doc);
    const sources = toSources(docs);

    const edition = user.edition_id
      ? get<{ exam_year: number }>(db, 'SELECT exam_year FROM editions WHERE id = ?', user.edition_id)
      : undefined;
    const stream = user.stream_id
      ? get<{ name_fr: string; name_ar: string }>(db, 'SELECT name_fr, name_ar FROM streams WHERE id = ?', user.stream_id)
      : undefined;
    const profile = [
      `Session: ${edition ? `BAC ${edition.exam_year}` : 'not set'}`,
      `Stream: ${stream ? `${stream.name_fr} (${stream.name_ar})` : 'not set'}`,
      `Interface language: ${user.locale}`,
      `Today: ${todayInAlgiers()}`,
    ].join(' | ');
    const userContent = buildUserContent(profile, docs, input.question);

    const history: HistoryTurn[] = all<{ role: 'user' | 'assistant'; content: string; api_content: string | null }>(
      db,
      'SELECT role, content, api_content FROM messages WHERE conversation_id = ? ORDER BY id',
      conversationId,
    ).map((m) =>
      m.role === 'user'
        ? { role: 'user', text: m.api_content ?? m.content, blocks: null }
        : { role: 'assistant', text: m.content, blocks: parseJson<unknown[] | null>(m.api_content, null) },
    );

    run(
      db,
      "INSERT INTO messages (conversation_id, role, content, api_content, created_at) VALUES (?, 'user', ?, ?, ?)",
      conversationId,
      input.question,
      userContent,
      now,
    );

    const saveReply = (text: string, mode: TutorMode, blocks: unknown[] | null): TutorMessage => {
      const at = nowIso();
      const created = run(
        db,
        "INSERT INTO messages (conversation_id, role, content, api_content, sources, mode, created_at) VALUES (?, 'assistant', ?, ?, ?, ?, ?)",
        conversationId,
        text,
        blocks ? JSON.stringify(blocks) : null,
        JSON.stringify(sources),
        mode,
        at,
      );
      run(db, 'UPDATE conversations SET updated_at = ? WHERE id = ?', at, conversationId);
      return { id: created.id, role: 'assistant', content: text, sources, mode, created_at: at };
    };

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());

      const useAi = aiEnabled();
      await send('meta', { conversation_id: conversationId, sources, mode: useAi ? 'AI' : 'RETRIEVAL_ONLY' });

      const retrievalOnly = async (intro: { fr: string; ar: string }, notice?: string) => {
        const text = docs.length > 0 ? intro[lang] : NO_MATCH_TEXT[lang];
        if (notice) await send('notice', { code: notice });
        await send('delta', { text });
        await send('done', { message: saveReply(text, 'RETRIEVAL_ONLY', null) });
      };

      if (!useAi) {
        await retrievalOnly(OFFLINE_TEXT);
        return;
      }
      try {
        let streamed = '';
        const reply = await generate({
          history,
          userContent,
          plainHistory: conversation.prompt_hash !== promptHash(),
          onText: (delta) => {
            streamed += delta;
            void send('delta', { text: delta });
          },
          signal: controller.signal,
        });
        if (reply.refused && !reply.text) {
          await send('delta', { text: REFUSED_TEXT[lang] });
          await send('done', { message: saveReply(REFUSED_TEXT[lang], 'AI', null) });
          return;
        }
        const text = reply.text || streamed;
        await send('done', { message: saveReply(text, 'AI', reply.blocks), truncated: reply.truncated });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof TutorError) {
          console.error(`[tutor] ${err.code}: ${err.message}`);
          await retrievalOnly(UNAVAILABLE_TEXT, err.code);
          return;
        }
        console.error('[tutor] unexpected error', err);
        await retrievalOnly(UNAVAILABLE_TEXT, 'api');
      }
    });
  });

  return app;
}

/** Dates of the plan window, used by the planner view to overlay official events. */
export function planWindow(params: PlanParams): { from: string; to: string } {
  return { from: params.start, to: addDays(params.start, params.weeks * 7 - 1) };
}
