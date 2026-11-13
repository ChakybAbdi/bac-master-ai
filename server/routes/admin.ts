import { Hono } from 'hono';
import { z } from 'zod';
import type {
  AdminOverview,
  Announcement,
  AuditEntry,
  CalendarEvent,
  Claim,
  CoefficientRow,
  MonitoringRun,
  PastPaper,
  Proposal,
  RecordHistoryEntry,
  User,
} from '../../shared/types.ts';
import { publishTable, retireRow, setRow, tableHistory } from '../academic.ts';
import { createPasswordReset, currentUser, listUsers, requireRole, type AppEnv } from '../auth.ts';
import { all, audit, get, run, tx, type Actor, type DB } from '../db.ts';
import { importMonitoring, listRecords, rowToRecord } from '../monitoring.ts';
import { addPaper, isPdf, MAX_PAPER_BYTES } from '../papers.ts';
import { aiStatus } from '../tutor.ts';
import { HttpError, intParam, nowIso, parseJson, readBody } from '../util.ts';

const verification = z.enum(['VERIFIED', 'PARTIALLY_VERIFIED', 'UNVERIFIED', 'CONTRADICTED']);
const priority = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface ProposalRow extends Omit<Proposal, 'payload' | 'mandatory' | 'teacher_verification'> {
  payload: string;
  mandatory: number;
  teacher_verification: number;
}

const toProposal = (row: ProposalRow): Proposal => ({
  ...row,
  payload: parseJson<Record<string, unknown>>(row.payload, {}),
  mandatory: row.mandatory === 1,
  teacher_verification: row.teacher_verification === 1,
});

const PROPOSAL_SELECT = `SELECT p.id, p.kind, p.title_fr, p.title_ar, p.detail_fr, p.detail_ar, p.payload, p.source,
    p.record_id, p.priority, p.mandatory, p.teacher_verification, p.edition_id, p.status, p.created_at,
    u.name AS decided_by_name, p.decided_at, p.decision_note
  FROM proposals p LEFT JOIN users u ON u.id = p.decided_by`;

const ANNOUNCEMENT_SELECT = `SELECT a.id, a.kind, a.priority, a.edition_id, a.stream_id, a.title_fr, a.title_ar,
    a.body_fr, a.body_ar, a.record_id, a.status, a.created_at, a.published_at,
    r.verification AS record_verification, r.original_url AS record_url, r.document_title AS record_title
  FROM announcements a LEFT JOIN official_records r ON r.id = a.record_id`;

/**
 * Publishes an announcement to students. This is the gate that keeps
 * unsupported information out of student communications: the announcement must
 * cite an official record whose verification level is VERIFIED, and must not
 * contain unfilled placeholders.
 */
export function publishAnnouncement(db: DB, actor: Actor, id: number): void {
  const a = get<{
    id: number;
    status: string;
    record_id: string | null;
    title_fr: string;
    title_ar: string;
    body_fr: string;
    body_ar: string;
  }>(db, 'SELECT id, status, record_id, title_fr, title_ar, body_fr, body_ar FROM announcements WHERE id = ?', id);
  if (!a) throw new HttpError(404, 'not_found', 'Announcement not found.');
  if (a.status !== 'DRAFT') throw new HttpError(409, 'not_a_draft', 'Only a draft can be published.');
  const record = a.record_id
    ? get<{ verification: string }>(db, 'SELECT verification FROM official_records WHERE id = ?', a.record_id)
    : undefined;
  if (!record || record.verification !== 'VERIFIED') {
    throw new HttpError(
      409,
      'unverified_source',
      'An announcement can only be published when it cites an official record that is fully verified.',
    );
  }
  if ([a.title_fr, a.title_ar, a.body_fr, a.body_ar].some((part) => /\[[^\]]*\]/.test(part))) {
    throw new HttpError(409, 'placeholder_left', 'Fill in every [placeholder] before publishing.');
  }
  const now = nowIso();
  run(db, "UPDATE announcements SET status = 'PUBLISHED', published_by = ?, published_at = ? WHERE id = ?", actor.id, now, id);
  audit(db, actor, 'announcement.publish', 'announcement', id, { record_id: a.record_id });
}

function reviewContent(db: DB, actor: Actor, chapterIds: number[], examIds: number[]): { lessons: number; exercises: number } {
  const now = nowIso();
  let lessons = 0;
  let exercises = 0;
  for (const chapterId of chapterIds) {
    lessons += run(
      db,
      "UPDATE lessons SET provenance = 'TEACHER_REVIEWED', reviewed_by = ?, reviewed_at = ? WHERE chapter_id = ? AND state = 'ACTIVE' AND provenance IN ('AI_GENERATED','UNVERIFIED')",
      actor.id, now, chapterId,
    ).changes;
    exercises += run(
      db,
      "UPDATE exercises SET provenance = 'TEACHER_REVIEWED', solution_provenance = 'TEACHER_REVIEWED', reviewed_by = ?, reviewed_at = ? WHERE chapter_id = ? AND provenance IN ('AI_GENERATED','UNVERIFIED')",
      actor.id, now, chapterId,
    ).changes;
  }
  for (const examId of examIds) {
    run(
      db,
      "UPDATE exams SET provenance = 'TEACHER_REVIEWED', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND provenance IN ('AI_GENERATED','UNVERIFIED')",
      actor.id, now, examId,
    );
    exercises += run(
      db,
      "UPDATE exercises SET provenance = 'TEACHER_REVIEWED', solution_provenance = 'TEACHER_REVIEWED', reviewed_by = ?, reviewed_at = ? WHERE exam_id = ? AND provenance IN ('AI_GENERATED','UNVERIFIED')",
      actor.id, now, examId,
    ).changes;
  }
  audit(db, actor, 'content.review', 'content', null, { chapterIds, examIds, lessons, exercises });
  return { lessons, exercises };
}

const numbers = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : [];

export function adminRoutes(db: DB): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const staff = requireRole('teacher', 'admin');
  const adminOnly = requireRole('admin');
  app.use('*', staff);

  // --- Overview ------------------------------------------------------------------

  app.get('/overview', (c) => {
    const count = (sql: string): number => get<{ n: number }>(db, sql)?.n ?? 0;
    const runRow = get<Omit<MonitoringRun, 'summary'> & { summary: string }>(
      db,
      'SELECT id, checked_at, previous_check, coverage, summary, report_file, imported_at FROM monitoring_runs ORDER BY checked_at DESC LIMIT 1',
    );
    const overview: AdminOverview = {
      pending_proposals: count("SELECT COUNT(*) AS n FROM proposals WHERE status = 'PENDING'"),
      mandatory_pending: count("SELECT COUNT(*) AS n FROM proposals WHERE status = 'PENDING' AND mandatory = 1"),
      draft_announcements: count("SELECT COUNT(*) AS n FROM announcements WHERE status = 'DRAFT'"),
      provisional_tables: count(
        "SELECT COUNT(*) AS n FROM (SELECT DISTINCT edition_id, stream_id FROM stream_subjects WHERE state = 'PROVISIONAL')",
      ),
      unreviewed_content:
        count("SELECT COUNT(*) AS n FROM lessons WHERE state = 'ACTIVE' AND provenance IN ('AI_GENERATED','UNVERIFIED')") +
        count("SELECT COUNT(*) AS n FROM exams WHERE state = 'ACTIVE' AND provenance IN ('AI_GENERATED','UNVERIFIED')"),
      records: {
        total: count('SELECT COUNT(*) AS n FROM official_records'),
        verified: count("SELECT COUNT(*) AS n FROM official_records WHERE verification = 'VERIFIED'"),
        partial: count("SELECT COUNT(*) AS n FROM official_records WHERE verification = 'PARTIALLY_VERIFIED'"),
        unverified: count("SELECT COUNT(*) AS n FROM official_records WHERE verification IN ('UNVERIFIED','CONTRADICTED')"),
      },
      users: {
        students: count("SELECT COUNT(*) AS n FROM users WHERE role = 'student'"),
        staff: count("SELECT COUNT(*) AS n FROM users WHERE role <> 'student'"),
      },
      last_run: runRow ? { ...runRow, summary: parseJson<Record<string, unknown>>(runRow.summary, {}) } : null,
      ai: aiStatus(),
    };
    return c.json(overview);
  });

  // --- Review queue ----------------------------------------------------------------

  app.get('/proposals', (c) => {
    const status = c.req.query('status') === 'ALL' ? null : 'PENDING';
    const rows = all<ProposalRow>(
      db,
      `${PROPOSAL_SELECT} ${status ? "WHERE p.status = 'PENDING'" : ''}
        ORDER BY CASE p.status WHEN 'PENDING' THEN 0 ELSE 1 END, p.mandatory DESC,
                 CASE p.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, p.id`,
    );
    return c.json({ items: rows.map(toProposal) });
  });

  app.post('/proposals', async (c) => {
    const actor = currentUser(c);
    const input = await readBody(
      c,
      z.object({
        title_fr: text(300),
        title_ar: text(300),
        detail_fr: optionalText(4000),
        detail_ar: optionalText(4000),
        priority,
        record_id: z.string().max(40).nullable().optional(),
      }),
    );
    const created = run(
      db,
      `INSERT INTO proposals (kind, title_fr, title_ar, detail_fr, detail_ar, payload, source, record_id, priority, status, created_at)
       VALUES ('TASK', ?, ?, ?, ?, '{}', 'MANUAL', ?, ?, 'PENDING', ?)`,
      input.title_fr, input.title_ar, input.detail_fr ?? null, input.detail_ar ?? null, input.record_id ?? null,
      input.priority, nowIso(),
    );
    audit(db, actor, 'proposal.create', 'proposal', created.id);
    return c.json({ id: created.id }, 201);
  });

  app.post('/proposals/:id/decide', async (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    const input = await readBody(
      c,
      z.object({
        decision: z.enum(['APPROVE', 'REJECT']),
        note: z.string().trim().max(2000).default(''),
        verification: verification.optional(),
        evidence: z.string().trim().max(2000).optional(),
        record_id: z.string().max(40).nullable().optional(),
      }),
    );
    const row = get<ProposalRow>(db, `${PROPOSAL_SELECT} WHERE p.id = ?`, id);
    if (!row) throw new HttpError(404, 'not_found', 'Review task not found.');
    if (row.status !== 'PENDING') throw new HttpError(409, 'already_decided', 'This task has already been decided.');
    const proposal = toProposal(row);

    if (input.decision === 'REJECT' && input.note.length < 3) {
      throw new HttpError(400, 'note_required', 'Say why the task is rejected.');
    }
    if (input.decision === 'APPROVE' && proposal.kind === 'PUBLISH_ANNOUNCEMENT' && actor.role !== 'admin') {
      throw new HttpError(403, 'forbidden', 'Only an administrator publishes announcements.');
    }

    let outcome: Record<string, unknown> = {};
    tx(db, () => {
      if (input.decision === 'APPROVE') {
        switch (proposal.kind) {
          case 'PUBLISH_COEFFICIENT_TABLE': {
            if (!input.verification) {
              throw new HttpError(400, 'verification_required', 'Choose the verification level of the table.');
            }
            const rows = publishTable(
              db,
              actor,
              Number(proposal.payload.edition_id),
              Number(proposal.payload.stream_id),
              input.verification,
              input.evidence ?? '',
              input.record_id ?? null,
            );
            outcome = { rows_published: rows, verification: input.verification };
            break;
          }
          case 'PUBLISH_ANNOUNCEMENT':
            publishAnnouncement(db, actor, Number(proposal.payload.announcement_id));
            break;
          case 'PUBLISH_RECORD': {
            const recordId = String(proposal.payload.record_id ?? proposal.record_id);
            const record = get<{ title_fr: string | null; title_ar: string | null; summary_fr: string | null; summary_ar: string | null }>(
              db,
              'SELECT title_fr, title_ar, summary_fr, summary_ar FROM official_records WHERE id = ?',
              recordId,
            );
            if (!record) throw new HttpError(404, 'not_found', 'Record not found.');
            if (!record.title_fr || !record.title_ar || !record.summary_fr || !record.summary_ar) {
              throw new HttpError(409, 'summary_required', 'Write the French and Arabic title and summary of the record first.');
            }
            run(db, "UPDATE official_records SET visibility = 'PUBLISHED', updated_at = ? WHERE id = ?", nowIso(), recordId);
            audit(db, actor, 'record.publish', 'official_record', recordId);
            break;
          }
          case 'REVIEW_CONTENT':
            outcome = reviewContent(db, actor, numbers(proposal.payload.chapter_ids), numbers(proposal.payload.exam_ids));
            break;
          case 'TASK':
            break;
        }
      }
      run(
        db,
        'UPDATE proposals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?',
        input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        actor.id,
        nowIso(),
        [input.note, input.evidence].filter(Boolean).join(' | ') || null,
        id,
      );
      audit(db, actor, `proposal.${input.decision.toLowerCase()}`, 'proposal', id, { kind: proposal.kind, ...outcome });
    });
    return c.json({ ok: true, outcome });
  });

  // --- Official records and monitoring ------------------------------------------------

  app.get('/records', (c) => c.json({ items: listRecords(db, false) }));

  app.get('/records/:id', (c) => {
    const id = c.req.param('id');
    const row = get<Record<string, string | number | null>>(db, 'SELECT * FROM official_records WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'not_found', 'Record not found.');
    const history: RecordHistoryEntry[] = all<{
      id: number;
      record_id: string;
      snapshot: string;
      replaced_at: string;
      replaced_by_name: string | null;
      reason: string | null;
    }>(
      db,
      `SELECT h.id, h.record_id, h.snapshot, h.replaced_at, u.name AS replaced_by_name, h.reason
         FROM record_history h LEFT JOIN users u ON u.id = h.replaced_by WHERE h.record_id = ? ORDER BY h.id DESC`,
      id,
    ).map((h) => ({ ...h, snapshot: parseJson<Record<string, unknown>>(h.snapshot, {}) }));
    return c.json({ record: rowToRecord(row), history });
  });

  app.patch('/records/:id', async (c) => {
    const actor = currentUser(c);
    const id = c.req.param('id');
    const input = await readBody(
      c,
      z.object({
        title_fr: optionalText(400),
        title_ar: optionalText(400),
        summary_fr: optionalText(4000),
        summary_ar: optionalText(4000),
        impact_fr: optionalText(2000),
        impact_ar: optionalText(2000),
        visibility: z.enum(['PUBLISHED', 'INTERNAL']).optional(),
      }),
    );
    const row = get<Record<string, string | number | null>>(db, 'SELECT * FROM official_records WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'not_found', 'Record not found.');
    const next = {
      title_fr: input.title_fr === undefined ? row.title_fr : input.title_fr || null,
      title_ar: input.title_ar === undefined ? row.title_ar : input.title_ar || null,
      summary_fr: input.summary_fr === undefined ? row.summary_fr : input.summary_fr || null,
      summary_ar: input.summary_ar === undefined ? row.summary_ar : input.summary_ar || null,
      impact_fr: input.impact_fr === undefined ? row.impact_fr : input.impact_fr || null,
      impact_ar: input.impact_ar === undefined ? row.impact_ar : input.impact_ar || null,
      visibility: input.visibility ?? row.visibility,
    };
    if (next.visibility === 'PUBLISHED' && (!next.title_fr || !next.title_ar || !next.summary_fr || !next.summary_ar)) {
      throw new HttpError(409, 'summary_required', 'A published record needs a French and an Arabic title and summary.');
    }
    tx(db, () => {
      run(
        db,
        'INSERT INTO record_history (record_id, snapshot, replaced_at, replaced_by, reason) VALUES (?, ?, ?, ?, ?)',
        id, JSON.stringify(row), nowIso(), actor.id, 'Student-facing wording or visibility edited',
      );
      run(
        db,
        `UPDATE official_records SET title_fr = ?, title_ar = ?, summary_fr = ?, summary_ar = ?, impact_fr = ?, impact_ar = ?,
                visibility = ?, updated_at = ? WHERE id = ?`,
        next.title_fr, next.title_ar, next.summary_fr, next.summary_ar, next.impact_fr, next.impact_ar,
        next.visibility, nowIso(), id,
      );
      audit(db, actor, 'record.edit', 'official_record', id, { visibility: next.visibility });
    });
    return c.json({ ok: true });
  });

  app.post('/monitoring/import', adminOnly, (c) => {
    const result = importMonitoring(db, currentUser(c), { createProposals: true });
    if (!result.available) throw new HttpError(404, 'no_monitoring_file', 'No records.json was found in the monitoring folder.');
    return c.json(result);
  });

  app.get('/monitoring/runs', (c) => {
    const items = all<Omit<MonitoringRun, 'summary'> & { summary: string }>(
      db,
      'SELECT id, checked_at, previous_check, coverage, summary, report_file, imported_at FROM monitoring_runs ORDER BY checked_at DESC',
    ).map((r) => ({ ...r, summary: parseJson<Record<string, unknown>>(r.summary, {}) }));
    return c.json({ items });
  });

  app.get('/monitoring/runs/:id', (c) => {
    const row = get<Omit<MonitoringRun, 'summary'> & { summary: string }>(
      db,
      'SELECT id, checked_at, previous_check, coverage, summary, report_file, report_markdown, imported_at FROM monitoring_runs WHERE id = ?',
      intParam(c, 'id'),
    );
    if (!row) throw new HttpError(404, 'not_found', 'Monitoring run not found.');
    return c.json({ run: { ...row, summary: parseJson<Record<string, unknown>>(row.summary, {}) } });
  });

  // --- Academic database -----------------------------------------------------------------

  app.get('/academic', (c) => {
    const editionId = Number(c.req.query('edition_id'));
    if (!Number.isInteger(editionId)) throw new HttpError(400, 'invalid_id', 'edition_id is required.');
    const streams = all<{ id: number }>(db, 'SELECT id FROM streams ORDER BY sort');
    const tables = streams.map((s) => {
      const rows = tableHistory(db, editionId, s.id);
      return {
        stream_id: s.id,
        current: rows.filter((r) => r.state === 'PROVISIONAL' || r.state === 'PUBLISHED'),
        history: rows.filter((r) => r.state === 'SUPERSEDED' || r.state === 'RETIRED'),
      };
    });
    return c.json({ tables } satisfies { tables: { stream_id: number; current: CoefficientRow[]; history: CoefficientRow[] }[] });
  });

  app.put('/academic/row', async (c) => {
    const actor = currentUser(c);
    const input = await readBody(
      c,
      z.object({
        edition_id: z.number().int().positive(),
        stream_id: z.number().int().positive(),
        subject_id: z.number().int().positive(),
        coefficient: z.number().min(0.5).max(20).nullable(),
        duration_minutes: z.number().int().min(15).max(480).nullable(),
        is_optional: z.boolean(),
        verification,
        source_record_id: z.string().max(40).nullable(),
        source_note: text(1000),
      }),
    );
    for (const [table, id] of [['editions', input.edition_id], ['streams', input.stream_id], ['subjects', input.subject_id]] as const) {
      if (!get(db, `SELECT 1 FROM ${table} WHERE id = ?`, id)) throw new HttpError(400, 'unknown_reference', `Unknown ${table} id.`);
    }
    if (input.source_record_id && !get(db, 'SELECT 1 FROM official_records WHERE id = ?', input.source_record_id)) {
      throw new HttpError(400, 'unknown_record', 'Unknown source record.');
    }
    const id = setRow(db, actor, input);
    return c.json({ id });
  });

  app.post('/academic/row/:id/retire', async (c) => {
    const { note } = await readBody(c, z.object({ note: text(1000) }));
    retireRow(db, currentUser(c), intParam(c, 'id'), note);
    return c.json({ ok: true });
  });

  app.post('/academic/publish', async (c) => {
    const actor = currentUser(c);
    const input = await readBody(
      c,
      z.object({
        edition_id: z.number().int().positive(),
        stream_id: z.number().int().positive(),
        verification,
        evidence: z.string().trim().max(2000).default(''),
        record_id: z.string().max(40).nullable().optional(),
      }),
    );
    const rows = tx(db, () => {
      const published = publishTable(db, actor, input.edition_id, input.stream_id, input.verification, input.evidence, input.record_id ?? null);
      // Close the matching review task so the queue reflects what was done.
      const open = all<{ id: number; payload: string }>(
        db,
        "SELECT id, payload FROM proposals WHERE kind = 'PUBLISH_COEFFICIENT_TABLE' AND status = 'PENDING'",
      );
      for (const p of open) {
        const payload = parseJson<{ edition_id?: number; stream_id?: number }>(p.payload, {});
        if (payload.edition_id === input.edition_id && payload.stream_id === input.stream_id) {
          run(
            db,
            "UPDATE proposals SET status = 'APPROVED', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?",
            actor.id, nowIso(), input.evidence || 'Published from the academic database.', p.id,
          );
        }
      }
      return published;
    });
    return c.json({ rows_published: rows });
  });

  // --- Content ---------------------------------------------------------------------------

  app.get('/content', (c) => {
    const lessons = all(
      db,
      `SELECT l.id, l.chapter_id, c.title_fr AS chapter_fr, c.title_ar AS chapter_ar, s.name_fr AS subject_fr,
              s.name_ar AS subject_ar, c.verification AS chapter_verification, l.title_fr, l.title_ar, l.body_fr, l.body_ar,
              l.provenance, l.outdated, l.outdated_note, l.version, u.name AS reviewed_by_name, l.reviewed_at
         FROM lessons l JOIN chapters c ON c.id = l.chapter_id JOIN subjects s ON s.id = c.subject_id
         LEFT JOIN users u ON u.id = l.reviewed_by
        WHERE l.state = 'ACTIVE' ORDER BY s.sort, c.sort, l.sort`,
    );
    const exams = all(
      db,
      `SELECT x.id, x.title_fr, x.title_ar, s.name_fr AS subject_fr, s.name_ar AS subject_ar, x.provenance, x.outdated,
              x.total_points, u.name AS reviewed_by_name, x.reviewed_at,
              (SELECT COUNT(*) FROM exercises e WHERE e.exam_id = x.id) AS exercise_count
         FROM exams x JOIN subjects s ON s.id = x.subject_id LEFT JOIN users u ON u.id = x.reviewed_by
        WHERE x.state = 'ACTIVE' ORDER BY s.sort, x.id`,
    );
    return c.json({ lessons, exams });
  });

  app.post('/content/lessons/:id/review', (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    const lesson = get<{ chapter_id: number }>(db, "SELECT chapter_id FROM lessons WHERE id = ? AND state = 'ACTIVE'", id);
    if (!lesson) throw new HttpError(404, 'not_found', 'Lesson not found.');
    run(
      db,
      "UPDATE lessons SET provenance = 'TEACHER_REVIEWED', reviewed_by = ?, reviewed_at = ? WHERE id = ?",
      actor.id, nowIso(), id,
    );
    audit(db, actor, 'lesson.review', 'lesson', id);
    return c.json({ ok: true });
  });

  app.post('/content/lessons/:id/outdated', async (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    const input = await readBody(c, z.object({ outdated: z.boolean(), note: optionalText(1000) }));
    const result = run(
      db,
      "UPDATE lessons SET outdated = ?, outdated_note = ? WHERE id = ? AND state = 'ACTIVE'",
      input.outdated ? 1 : 0, input.outdated ? (input.note ?? null) : null, id,
    );
    if (result.changes === 0) throw new HttpError(404, 'not_found', 'Lesson not found.');
    audit(db, actor, input.outdated ? 'lesson.flag_outdated' : 'lesson.clear_outdated', 'lesson', id, { note: input.note ?? null });
    return c.json({ ok: true });
  });

  app.put('/content/lessons/:id', async (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    const input = await readBody(
      c,
      z.object({ title_fr: text(300), title_ar: text(300), body_fr: text(60_000), body_ar: text(60_000) }),
    );
    const current = get<{ chapter_id: number; sort: number; version: number }>(
      db,
      "SELECT chapter_id, sort, version FROM lessons WHERE id = ? AND state = 'ACTIVE'",
      id,
    );
    if (!current) throw new HttpError(404, 'not_found', 'Lesson not found.');
    // An edit creates a new version written by a member of staff; the old one is kept as SUPERSEDED.
    const newId = tx(db, () => {
      const now = nowIso();
      const created = run(
        db,
        `INSERT INTO lessons (chapter_id, sort, title_fr, title_ar, body_fr, body_ar, provenance, version, reviewed_by, reviewed_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'TEACHER_REVIEWED', ?, ?, ?, ?, ?)`,
        current.chapter_id, current.sort, input.title_fr, input.title_ar, input.body_fr, input.body_ar,
        current.version + 1, actor.id, now, actor.id, now,
      );
      run(db, "UPDATE lessons SET state = 'SUPERSEDED', superseded_by = ? WHERE id = ?", created.id, id);
      run(db, 'UPDATE OR IGNORE lesson_progress SET lesson_id = ? WHERE lesson_id = ?', created.id, id);
      audit(db, actor, 'lesson.new_version', 'lesson', created.id, { replaces: id, version: current.version + 1 });
      return created.id;
    });
    return c.json({ id: newId });
  });

  app.post('/content/exams/:id/review', (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    if (!get(db, "SELECT 1 FROM exams WHERE id = ? AND state = 'ACTIVE'", id)) throw new HttpError(404, 'not_found', 'Exam not found.');
    return c.json(tx(db, () => reviewContent(db, actor, [], [id])));
  });

  // --- Announcements ------------------------------------------------------------------------

  const announcementSchema = z.object({
    kind: z.enum(['DASHBOARD', 'REGISTRATION_REMINDER', 'REVISION_PLAN_UPDATE', 'CURRICULUM_UPDATE', 'EXAM_ALERT']),
    priority,
    edition_id: z.number().int().positive().nullable(),
    stream_id: z.number().int().positive().nullable(),
    title_fr: text(300),
    title_ar: text(300),
    body_fr: text(6000),
    body_ar: text(6000),
    record_id: z.string().max(40).nullable(),
  });

  app.get('/announcements', (c) =>
    c.json({ items: all<Announcement>(db, `${ANNOUNCEMENT_SELECT} ORDER BY a.status = 'DRAFT' DESC, a.created_at DESC`) }),
  );

  app.post('/announcements', async (c) => {
    const actor = currentUser(c);
    const input = await readBody(c, announcementSchema);
    if (input.record_id && !get(db, 'SELECT 1 FROM official_records WHERE id = ?', input.record_id)) {
      throw new HttpError(400, 'unknown_record', 'Unknown source record.');
    }
    const created = run(
      db,
      `INSERT INTO announcements (kind, priority, edition_id, stream_id, title_fr, title_ar, body_fr, body_ar, record_id, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
      input.kind, input.priority, input.edition_id, input.stream_id, input.title_fr, input.title_ar, input.body_fr,
      input.body_ar, input.record_id, actor.id, nowIso(),
    );
    audit(db, actor, 'announcement.create', 'announcement', created.id);
    return c.json({ id: created.id }, 201);
  });

  app.put('/announcements/:id', async (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    const input = await readBody(c, announcementSchema);
    const current = get<{ status: string }>(db, 'SELECT status FROM announcements WHERE id = ?', id);
    if (!current) throw new HttpError(404, 'not_found', 'Announcement not found.');
    if (current.status !== 'DRAFT') {
      throw new HttpError(409, 'not_a_draft', 'A published announcement is not edited: archive it and publish a corrected one.');
    }
    if (input.record_id && !get(db, 'SELECT 1 FROM official_records WHERE id = ?', input.record_id)) {
      throw new HttpError(400, 'unknown_record', 'Unknown source record.');
    }
    run(
      db,
      `UPDATE announcements SET kind = ?, priority = ?, edition_id = ?, stream_id = ?, title_fr = ?, title_ar = ?,
              body_fr = ?, body_ar = ?, record_id = ? WHERE id = ?`,
      input.kind, input.priority, input.edition_id, input.stream_id, input.title_fr, input.title_ar, input.body_fr,
      input.body_ar, input.record_id, id,
    );
    audit(db, actor, 'announcement.edit', 'announcement', id);
    return c.json({ ok: true });
  });

  app.post('/announcements/:id/publish', adminOnly, (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    tx(db, () => {
      publishAnnouncement(db, actor, id);
      const open = all<{ id: number; payload: string }>(
        db,
        "SELECT id, payload FROM proposals WHERE kind = 'PUBLISH_ANNOUNCEMENT' AND status = 'PENDING'",
      );
      for (const p of open) {
        if (parseJson<{ announcement_id?: number }>(p.payload, {}).announcement_id === id) {
          run(
            db,
            "UPDATE proposals SET status = 'APPROVED', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?",
            actor.id, nowIso(), 'Published from the announcements page.', p.id,
          );
        }
      }
    });
    return c.json({ ok: true });
  });

  app.post('/announcements/:id/archive', adminOnly, (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    const result = run(db, "UPDATE announcements SET status = 'ARCHIVED' WHERE id = ? AND status <> 'ARCHIVED'", id);
    if (result.changes === 0) throw new HttpError(404, 'not_found', 'Announcement not found.');
    audit(db, actor, 'announcement.archive', 'announcement', id);
    return c.json({ ok: true });
  });

  // --- Calendar and checked rumours -------------------------------------------------------------

  app.get('/calendar', (c) =>
    c.json({
      items: all<CalendarEvent & { state: string }>(
        db,
        `SELECT e.*, r.original_url AS source_url, r.last_verified FROM calendar_events e
           LEFT JOIN official_records r ON r.id = e.record_id ORDER BY e.state, e.starts_on IS NULL, e.starts_on`,
      ),
    }),
  );

  app.post('/calendar', async (c) => {
    const actor = currentUser(c);
    const input = await readBody(
      c,
      z.object({
        edition_id: z.number().int().positive(),
        kind: z.enum(['TEST', 'HOLIDAY', 'REGISTRATION', 'EXAM', 'RESULTS', 'OTHER']),
        starts_on: day.nullable(),
        ends_on: day.nullable(),
        dates_fr: optionalText(300),
        dates_ar: optionalText(300),
        title_fr: text(300),
        title_ar: text(300),
        audience_fr: optionalText(300),
        audience_ar: optionalText(300),
        note_fr: optionalText(1000),
        note_ar: optionalText(1000),
        status: z.enum(['CONFIRMED', 'PROVISIONAL', 'NOT_ANNOUNCED']),
        concerns_3as: z.number().int().min(0).max(2),
        record_id: z.string().max(40).nullable(),
      }),
    );
    // A date is only shown as confirmed when an official record supports it.
    if (input.status === 'CONFIRMED') {
      const record = input.record_id
        ? get<{ verification: string }>(db, 'SELECT verification FROM official_records WHERE id = ?', input.record_id)
        : undefined;
      if (!record || record.verification !== 'VERIFIED') {
        throw new HttpError(409, 'unverified_source', 'A confirmed date must cite a fully verified official record.');
      }
      if (!input.starts_on || !input.dates_fr || !input.dates_ar) {
        throw new HttpError(400, 'dates_required', 'A confirmed event needs its dates in both languages.');
      }
    }
    const created = run(
      db,
      `INSERT INTO calendar_events (edition_id, kind, starts_on, ends_on, dates_fr, dates_ar, title_fr, title_ar, audience_fr,
                                    audience_ar, note_fr, note_ar, status, concerns_3as, record_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.edition_id, input.kind, input.starts_on, input.ends_on ?? input.starts_on, input.dates_fr ?? null,
      input.dates_ar ?? null, input.title_fr, input.title_ar, input.audience_fr ?? null, input.audience_ar ?? null,
      input.note_fr ?? null, input.note_ar ?? null, input.status, input.concerns_3as, input.record_id, nowIso(),
    );
    audit(db, actor, 'calendar.create', 'calendar_event', created.id, { status: input.status, record_id: input.record_id });
    return c.json({ id: created.id }, 201);
  });

  app.post('/calendar/:id/retire', (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    const result = run(db, "UPDATE calendar_events SET state = 'RETIRED' WHERE id = ? AND state = 'PUBLISHED'", id);
    if (result.changes === 0) throw new HttpError(404, 'not_found', 'Event not found.');
    audit(db, actor, 'calendar.retire', 'calendar_event', id);
    return c.json({ ok: true });
  });

  app.get('/claims', (c) => c.json({ items: all<Claim & { state: string }>(db, 'SELECT * FROM claims ORDER BY state, id') }));

  app.post('/claims', async (c) => {
    const actor = currentUser(c);
    const input = await readBody(
      c,
      z.object({
        edition_id: z.number().int().positive().nullable(),
        claim_fr: text(600),
        claim_ar: text(600),
        finding_fr: text(2000),
        finding_ar: text(2000),
        verdict: z.enum(['UNVERIFIED', 'SUPERSEDED', 'CONTRADICTED']),
        record_id: z.string().max(40).nullable(),
        checked_on: day,
      }),
    );
    const created = run(
      db,
      'INSERT INTO claims (edition_id, claim_fr, claim_ar, finding_fr, finding_ar, verdict, record_id, checked_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      input.edition_id, input.claim_fr, input.claim_ar, input.finding_fr, input.finding_ar, input.verdict,
      input.record_id, input.checked_on,
    );
    audit(db, actor, 'claim.create', 'claim', created.id);
    return c.json({ id: created.id }, 201);
  });

  app.post('/claims/:id/retire', (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    const result = run(db, "UPDATE claims SET state = 'RETIRED' WHERE id = ? AND state = 'PUBLISHED'", id);
    if (result.changes === 0) throw new HttpError(404, 'not_found', 'Claim not found.');
    audit(db, actor, 'claim.retire', 'claim', id);
    return c.json({ ok: true });
  });

  // --- Past papers ------------------------------------------------------------------------------

  const paperSchema = z.object({
    exam_year: z.number().int().min(1990).max(2100),
    stream_id: z.number().int().positive().nullable(),
    subject_id: z.number().int().positive().nullable(),
    language: z.enum(['fr', 'ar', 'other']),
    doc_type: z.enum(['SUBJECT', 'OFFICIAL_CORRECTION', 'MARKING_SCHEME', 'TEACHER_CORRECTION', 'AI_CORRECTION', 'OTHER']),
    title: text(300),
    source_authority: text(200),
    publication_date: day.nullable(),
    verification,
    note: optionalText(1000),
  });

  app.post('/archive', async (c) => {
    const input = await readBody(c, paperSchema.extend({ url: z.url().max(1000) }));
    return c.json({ id: addPaper(db, currentUser(c), input, { url: input.url }) }, 201);
  });

  // Multipart upload of a PDF the platform will host. Metadata travels as form fields.
  app.post('/archive/upload', async (c) => {
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_PAPER_BYTES + 64 * 1024) throw new HttpError(413, 'file_too_large', 'The file is larger than 25 MB.');
    let form: Record<string, string | File>;
    try {
      form = (await c.req.parseBody()) as Record<string, string | File>;
    } catch {
      throw new HttpError(400, 'invalid_input', 'The upload could not be read.');
    }
    const file = form.file;
    if (!(file instanceof File) || file.size === 0) throw new HttpError(400, 'file_required', 'Choose a PDF file.');
    if (file.size > MAX_PAPER_BYTES) throw new HttpError(413, 'file_too_large', 'The file is larger than 25 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Only real PDFs are accepted, whatever the file name says.
    if (!isPdf(bytes)) throw new HttpError(400, 'not_a_pdf', 'Only PDF files are accepted.');
    const str = (key: string): string => (typeof form[key] === 'string' ? (form[key] as string).trim() : '');
    const optionalId = (key: string): number | null => (str(key) ? Number(str(key)) : null);
    const parsed = paperSchema.safeParse({
      exam_year: Number(str('exam_year')),
      stream_id: optionalId('stream_id'),
      subject_id: optionalId('subject_id'),
      language: str('language'),
      doc_type: str('doc_type'),
      title: str('title'),
      source_authority: str('source_authority'),
      publication_date: str('publication_date') || null,
      verification: str('verification'),
      note: str('note') || null,
    });
    if (!parsed.success) throw new HttpError(400, 'invalid_input', 'Some fields are missing or invalid.', parsed.error.issues);
    const name = file.name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 200) || 'document.pdf';
    return c.json({ id: addPaper(db, currentUser(c), parsed.data, { file: { name, bytes } }) }, 201);
  });

  app.get('/archive', (c) =>
    c.json({
      items: all<PastPaper & { state: string }>(db, 'SELECT * FROM past_papers ORDER BY state, exam_year DESC, id DESC'),
    }),
  );

  app.post('/archive/:id/retire', (c) => {
    const actor = currentUser(c);
    const id = intParam(c, 'id');
    const result = run(db, "UPDATE past_papers SET state = 'RETIRED' WHERE id = ? AND state = 'ACTIVE'", id);
    if (result.changes === 0) throw new HttpError(404, 'not_found', 'Document not found.');
    audit(db, actor, 'archive.retire', 'past_paper', id);
    return c.json({ ok: true });
  });

  // --- Audit log and users ------------------------------------------------------------------------

  app.get('/audit', (c) => {
    const items: AuditEntry[] = all<Omit<AuditEntry, 'detail'> & { detail: string | null }>(
      db,
      'SELECT id, at, actor_name, action, entity, entity_id, detail FROM audit_log ORDER BY id DESC LIMIT 300',
    ).map((e) => ({ ...e, detail: e.detail ? parseJson<Record<string, unknown>>(e.detail, {}) : null }));
    return c.json({ items });
  });

  app.get('/users', adminOnly, (c) => c.json({ items: listUsers(db) }));

  app.patch('/users/:id/role', adminOnly, async (c) => {
    const actor = currentUser(c);
    const id = c.req.param('id');
    const { role } = await readBody(c, z.object({ role: z.enum(['student', 'teacher', 'admin']) }));
    const target = get<User>(db, 'SELECT id, role FROM users WHERE id = ?', id);
    if (!target) throw new HttpError(404, 'not_found', 'User not found.');
    if (target.role === 'admin' && role !== 'admin') {
      const admins = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")?.n ?? 0;
      if (admins <= 1) throw new HttpError(409, 'last_admin', 'The platform needs at least one administrator.');
    }
    run(db, 'UPDATE users SET role = ? WHERE id = ?', role, id);
    audit(db, actor, 'user.set_role', 'user', id, { from: target.role, to: role });
    return c.json({ ok: true });
  });

  // A one-time link the administrator hands to the user (in person, by message): there is no e-mail service.
  app.post('/users/:id/reset-link', adminOnly, (c) => {
    const actor = currentUser(c);
    const id = c.req.param('id');
    if (!get(db, 'SELECT 1 FROM users WHERE id = ?', id)) throw new HttpError(404, 'not_found', 'User not found.');
    const reset = createPasswordReset(db, id, actor.id);
    audit(db, actor, 'user.reset_link', 'user', id, { expires_at: reset.expires_at });
    return c.json(reset, 201);
  });

  return app;
}
