import type {
  CoefficientRow,
  FrameworkRef,
  SubjectItem,
  SubjectsView,
  User,
  Verification,
} from '../shared/types.ts';
import { all, audit, get, getSetting, run, tx, type Actor, type DB } from './db.ts';
import { HttpError, nowIso } from './util.ts';

interface TableRow {
  id: number;
  subject_id: number;
  code: string;
  name_fr: string;
  name_ar: string;
  coefficient: number | null;
  duration_minutes: number | null;
  is_optional: number;
  verification: Verification;
  source_note: string | null;
  source_record_id: string | null;
  verified_at: string | null;
}

interface PrefRow {
  subject_id: number;
  in_custom: number;
  custom_coefficient: number | null;
  level: number | null;
  grade: number | null;
}

/** Rows of a stream's table in one state, compulsory subjects first, heaviest coefficient first. */
export function tableRows(
  db: DB,
  editionId: number,
  streamId: number,
  state: 'PUBLISHED' | 'PROVISIONAL',
): TableRow[] {
  return all<TableRow>(
    db,
    `SELECT ss.id, ss.subject_id, s.code, s.name_fr, s.name_ar, ss.coefficient, ss.duration_minutes,
            ss.is_optional, ss.verification, ss.source_note, ss.source_record_id, ss.verified_at
       FROM stream_subjects ss JOIN subjects s ON s.id = ss.subject_id
      WHERE ss.edition_id = ? AND ss.stream_id = ? AND ss.state = ?
      ORDER BY ss.is_optional, ss.coefficient DESC, s.sort`,
    editionId,
    streamId,
    state,
  );
}

/** The official record that says which hours-and-coefficients framework is in force. */
export function frameworkRef(db: DB): FrameworkRef | null {
  const id = getSetting(db, 'framework_record_id');
  if (!id) return null;
  const row = get<{
    id: string;
    verification: Verification;
    title_fr: string | null;
    title_ar: string | null;
    original_url: string | null;
    last_verified: string | null;
  }>(
    db,
    "SELECT id, verification, title_fr, title_ar, original_url, last_verified FROM official_records WHERE id = ? AND visibility = 'PUBLISHED'",
    id,
  );
  if (!row) return null;
  return {
    record_id: row.id,
    verification: row.verification,
    title_fr: row.title_fr,
    title_ar: row.title_ar,
    url: row.original_url,
    last_verified: row.last_verified,
  };
}

/**
 * What a student sees as "my subjects".
 * A published table wins. Until a teacher has verified and published one, the
 * student keeps a personal list with the coefficients given by their school:
 * provisional, unverified values are never shown to students.
 */
export function subjectsView(db: DB, user: User): SubjectsView {
  const prefs = new Map(
    all<PrefRow>(
      db,
      'SELECT subject_id, in_custom, custom_coefficient, level, grade FROM user_subjects WHERE user_id = ?',
      user.id,
    ).map((p) => [p.subject_id, p]),
  );
  const framework = frameworkRef(db);

  if (user.edition_id && user.stream_id) {
    const published = tableRows(db, user.edition_id, user.stream_id, 'PUBLISHED');
    if (published.length > 0) {
      const items: SubjectItem[] = published.map((row) => ({
        subject_id: row.subject_id,
        code: row.code,
        name_fr: row.name_fr,
        name_ar: row.name_ar,
        coefficient: row.coefficient,
        is_optional: row.is_optional === 1,
        duration_minutes: row.duration_minutes,
        verification: row.verification,
        source_note: row.source_note,
        source_record_id: row.source_record_id,
        verified_at: row.verified_at,
        level: prefs.get(row.subject_id)?.level ?? null,
        grade: prefs.get(row.subject_id)?.grade ?? null,
      }));
      return { mode: 'official', pending: false, items, framework };
    }
  }

  const pending =
    user.edition_id && user.stream_id
      ? tableRows(db, user.edition_id, user.stream_id, 'PROVISIONAL').length > 0
      : false;
  const subjects = all<{ id: number; code: string; name_fr: string; name_ar: string }>(
    db,
    'SELECT id, code, name_fr, name_ar FROM subjects ORDER BY sort',
  );
  const items: SubjectItem[] = subjects
    .filter((s) => prefs.get(s.id)?.in_custom === 1)
    .map((s) => {
      const pref = prefs.get(s.id)!;
      return {
        subject_id: s.id,
        code: s.code,
        name_fr: s.name_fr,
        name_ar: s.name_ar,
        coefficient: pref.custom_coefficient,
        is_optional: false,
        duration_minutes: null,
        verification: null,
        source_note: null,
        source_record_id: null,
        verified_at: null,
        level: pref.level,
        grade: pref.grade,
      };
    });
  return { mode: 'custom', pending, items, framework };
}

export interface PrefInput {
  subject_id: number;
  in_custom?: boolean;
  custom_coefficient?: number | null;
  level?: number | null;
  grade?: number | null;
}

/** Partial update of a student's per-subject preferences: only the fields sent are changed. */
export function saveSubjectPrefs(db: DB, user: User, items: PrefInput[]): void {
  tx(db, () => {
    for (const item of items) {
      if (!get(db, 'SELECT 1 FROM subjects WHERE id = ?', item.subject_id)) {
        throw new HttpError(400, 'unknown_subject', `Unknown subject ${item.subject_id}.`);
      }
      const current = get<PrefRow>(
        db,
        'SELECT subject_id, in_custom, custom_coefficient, level, grade FROM user_subjects WHERE user_id = ? AND subject_id = ?',
        user.id,
        item.subject_id,
      );
      const next = {
        in_custom: item.in_custom === undefined ? (current?.in_custom ?? 0) : item.in_custom ? 1 : 0,
        custom_coefficient:
          item.custom_coefficient === undefined ? (current?.custom_coefficient ?? null) : item.custom_coefficient,
        level: item.level === undefined ? (current?.level ?? null) : item.level,
        grade: item.grade === undefined ? (current?.grade ?? null) : item.grade,
      };
      run(
        db,
        `INSERT INTO user_subjects (user_id, subject_id, in_custom, custom_coefficient, level, grade)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, subject_id) DO UPDATE SET
           in_custom = excluded.in_custom, custom_coefficient = excluded.custom_coefficient,
           level = excluded.level, grade = excluded.grade`,
        user.id,
        item.subject_id,
        next.in_custom,
        next.custom_coefficient,
        next.level,
        next.grade,
      );
    }
  });
}

export interface RowInput {
  edition_id: number;
  stream_id: number;
  subject_id: number;
  coefficient: number | null;
  duration_minutes: number | null;
  is_optional: boolean;
  verification: Verification;
  source_record_id: string | null;
  source_note: string;
}

/**
 * Records a new version of one subject's row. The previous version is kept and
 * marked SUPERSEDED with a pointer to its replacement; nothing is overwritten.
 */
export function setRow(db: DB, actor: Actor, input: RowInput): number {
  return tx(db, () => {
    const current = get<{ id: number; state: string; coefficient: number | null; verification: string }>(
      db,
      `SELECT id, state, coefficient, verification FROM stream_subjects
        WHERE edition_id = ? AND stream_id = ? AND subject_id = ? AND state IN ('PROVISIONAL','PUBLISHED')
        ORDER BY version DESC LIMIT 1`,
      input.edition_id,
      input.stream_id,
      input.subject_id,
    );
    const last = get<{ v: number | null }>(
      db,
      'SELECT MAX(version) AS v FROM stream_subjects WHERE edition_id = ? AND stream_id = ? AND subject_id = ?',
      input.edition_id,
      input.stream_id,
      input.subject_id,
    );
    const published = current?.state === 'PUBLISHED';
    const now = nowIso();
    const created = run(
      db,
      `INSERT INTO stream_subjects
         (edition_id, stream_id, subject_id, coefficient, duration_minutes, is_optional, state, verification,
          source_record_id, source_note, version, created_by, created_at, verified_by, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.edition_id,
      input.stream_id,
      input.subject_id,
      input.coefficient,
      input.duration_minutes,
      input.is_optional ? 1 : 0,
      published ? 'PUBLISHED' : 'PROVISIONAL',
      input.verification,
      input.source_record_id,
      input.source_note,
      (last?.v ?? 0) + 1,
      actor.id,
      now,
      published ? actor.id : null,
      published ? now : null,
    );
    if (current) {
      run(db, "UPDATE stream_subjects SET state = 'SUPERSEDED', superseded_by = ? WHERE id = ?", created.id, current.id);
    }
    audit(db, actor, 'coefficient.set', 'stream_subjects', created.id, {
      ...input,
      previous_row: current?.id ?? null,
      previous_coefficient: current?.coefficient ?? null,
    });
    return created.id;
  });
}

/** Takes a subject out of a stream's table. The row stays in the history as RETIRED. */
export function retireRow(db: DB, actor: Actor, rowId: number, note: string): void {
  const row = get<{ id: number; state: string }>(db, 'SELECT id, state FROM stream_subjects WHERE id = ?', rowId);
  if (!row) throw new HttpError(404, 'not_found', 'Row not found.');
  if (row.state !== 'PROVISIONAL' && row.state !== 'PUBLISHED') {
    throw new HttpError(409, 'not_current', 'Only a current row can be retired.');
  }
  run(db, "UPDATE stream_subjects SET state = 'RETIRED' WHERE id = ?", rowId);
  audit(db, actor, 'coefficient.retire', 'stream_subjects', rowId, { note, previous_state: row.state });
}

/**
 * Publishes a stream's provisional table to students. The reviewer states the
 * verification level and, for anything above UNVERIFIED, the official evidence checked.
 */
export function publishTable(
  db: DB,
  actor: Actor,
  editionId: number,
  streamId: number,
  verification: Verification,
  evidence: string,
  recordId: string | null,
): number {
  return tx(db, () => {
    const rows = all<{ id: number; coefficient: number | null; source_note: string | null }>(
      db,
      "SELECT id, coefficient, source_note FROM stream_subjects WHERE edition_id = ? AND stream_id = ? AND state = 'PROVISIONAL'",
      editionId,
      streamId,
    );
    if (rows.length === 0) throw new HttpError(409, 'nothing_to_publish', 'This stream has no provisional table.');
    if (rows.some((r) => r.coefficient === null)) {
      throw new HttpError(409, 'incomplete_table', 'Every subject needs a coefficient before the table is published.');
    }
    if ((verification === 'VERIFIED' || verification === 'PARTIALLY_VERIFIED') && evidence.trim().length < 10) {
      throw new HttpError(400, 'evidence_required', 'State which official document the values were checked against.');
    }
    if (recordId && !get(db, 'SELECT 1 FROM official_records WHERE id = ?', recordId)) {
      throw new HttpError(400, 'unknown_record', 'Unknown source record.');
    }
    // A published table for the same stream is replaced as a whole; its rows stay in the history.
    const previous = all<{ id: number }>(
      db,
      "SELECT id FROM stream_subjects WHERE edition_id = ? AND stream_id = ? AND state = 'PUBLISHED'",
      editionId,
      streamId,
    );
    for (const p of previous) run(db, "UPDATE stream_subjects SET state = 'SUPERSEDED' WHERE id = ?", p.id);
    const now = nowIso();
    for (const row of rows) {
      run(
        db,
        `UPDATE stream_subjects
            SET state = 'PUBLISHED', verification = ?, source_note = ?, source_record_id = COALESCE(?, source_record_id),
                verified_by = ?, verified_at = ?
          WHERE id = ?`,
        verification,
        evidence.trim() || row.source_note,
        recordId,
        actor.id,
        now,
        row.id,
      );
    }
    audit(db, actor, 'coefficient.publish_table', 'stream_subjects', `${editionId}:${streamId}`, {
      verification,
      evidence,
      record_id: recordId,
      rows: rows.map((r) => r.id),
      superseded: previous.map((p) => p.id),
      previous_notes: rows.map((r) => r.source_note),
    });
    return rows.length;
  });
}

/** Every version ever recorded for a stream, newest first within each subject. */
export function tableHistory(db: DB, editionId: number, streamId: number): CoefficientRow[] {
  return all<CoefficientRow>(
    db,
    `SELECT ss.id, ss.edition_id, ss.stream_id, ss.subject_id, ss.coefficient, ss.duration_minutes, ss.is_optional,
            ss.state, ss.verification, ss.source_record_id, ss.source_note, ss.version, ss.superseded_by,
            cu.name AS created_by_name, ss.created_at, vu.name AS verified_by_name, ss.verified_at
       FROM stream_subjects ss
       JOIN subjects s ON s.id = ss.subject_id
       LEFT JOIN users cu ON cu.id = ss.created_by
       LEFT JOIN users vu ON vu.id = ss.verified_by
      WHERE ss.edition_id = ? AND ss.stream_id = ?
      ORDER BY s.sort, ss.version DESC`,
    editionId,
    streamId,
  );
}
