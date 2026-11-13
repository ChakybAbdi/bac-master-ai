import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { nowIso } from './util.ts';

export type DB = DatabaseSync;
export type Param = string | number | bigint | null | Uint8Array;

/**
 * Integrity rules enforced by the schema and the code around it:
 *  - Academic values (stream_subjects), lessons and official records are versioned.
 *    A change inserts a new row or snapshots the old one; nothing is overwritten in place.
 *  - Rows are retired or superseded, never deleted.
 *  - Every official value carries a verification level and, where one exists, a source record.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS editions (
  id INTEGER PRIMARY KEY,
  exam_year INTEGER NOT NULL UNIQUE,
  school_year TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','UPCOMING','ARCHIVED')),
  note_fr TEXT,
  note_ar TEXT
);

CREATE TABLE IF NOT EXISTS streams (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  verification TEXT NOT NULL CHECK (verification IN ('VERIFIED','PARTIALLY_VERIFIED','UNVERIFIED','CONTRADICTED')),
  note_fr TEXT,
  note_ar TEXT
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','teacher','admin')),
  locale TEXT NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr','ar')),
  edition_id INTEGER REFERENCES editions(id),
  stream_id INTEGER REFERENCES streams(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- One-time password reset links, issued by an administrator (there is no e-mail service).
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS official_records (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  authority TEXT,
  document_title TEXT,
  original_url TEXT,
  scan_url TEXT,
  related_urls TEXT NOT NULL DEFAULT '[]',
  publication_date TEXT,
  examination_year TEXT,
  applicable_stream TEXT,
  applicable_subject TEXT,
  previous_value TEXT,
  new_value TEXT,
  verification TEXT NOT NULL CHECK (verification IN ('VERIFIED','PARTIALLY_VERIFIED','UNVERIFIED','CONTRADICTED')),
  verification_note TEXT,
  change_status TEXT NOT NULL CHECK (change_status IN ('NEW','UPDATED','CONFIRMED','CORRECTED','REPEATED','UNVERIFIED','SUPERSEDED')),
  change_note TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  priority_note TEXT,
  first_detected TEXT,
  last_verified TEXT,
  student_impact TEXT,
  product_impact TEXT,
  required_action TEXT,
  superseded_by TEXT NOT NULL DEFAULT '[]',
  unverified_claims TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (visibility IN ('PUBLISHED','INTERNAL')),
  title_fr TEXT,
  title_ar TEXT,
  summary_fr TEXT,
  summary_ar TEXT,
  impact_fr TEXT,
  impact_ar TEXT,
  raw TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS record_history (
  id INTEGER PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES official_records(id),
  snapshot TEXT NOT NULL,
  replaced_at TEXT NOT NULL,
  replaced_by TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS record_history_record ON record_history(record_id);

CREATE TABLE IF NOT EXISTS stream_subjects (
  id INTEGER PRIMARY KEY,
  edition_id INTEGER NOT NULL REFERENCES editions(id),
  stream_id INTEGER NOT NULL REFERENCES streams(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  coefficient REAL,
  duration_minutes INTEGER,
  is_optional INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('PROVISIONAL','PUBLISHED','SUPERSEDED','RETIRED')),
  verification TEXT NOT NULL CHECK (verification IN ('VERIFIED','PARTIALLY_VERIFIED','UNVERIFIED','CONTRADICTED')),
  source_record_id TEXT REFERENCES official_records(id),
  source_note TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  superseded_by INTEGER REFERENCES stream_subjects(id),
  created_by TEXT,
  created_at TEXT NOT NULL,
  verified_by TEXT,
  verified_at TEXT
);
CREATE INDEX IF NOT EXISTS stream_subjects_lookup ON stream_subjects(edition_id, stream_id, state);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY,
  edition_id INTEGER NOT NULL REFERENCES editions(id),
  kind TEXT NOT NULL CHECK (kind IN ('TEST','HOLIDAY','REGISTRATION','EXAM','RESULTS','OTHER')),
  starts_on TEXT,
  ends_on TEXT,
  dates_fr TEXT,
  dates_ar TEXT,
  title_fr TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  audience_fr TEXT,
  audience_ar TEXT,
  note_fr TEXT,
  note_ar TEXT,
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED','PROVISIONAL','NOT_ANNOUNCED')),
  concerns_3as INTEGER NOT NULL DEFAULT 1,
  record_id TEXT REFERENCES official_records(id),
  state TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (state IN ('PUBLISHED','RETIRED')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY,
  edition_id INTEGER REFERENCES editions(id),
  claim_fr TEXT NOT NULL,
  claim_ar TEXT NOT NULL,
  finding_fr TEXT NOT NULL,
  finding_ar TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('UNVERIFIED','SUPERSEDED','CONTRADICTED')),
  record_id TEXT REFERENCES official_records(id),
  checked_on TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (state IN ('PUBLISHED','RETIRED'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('DASHBOARD','REGISTRATION_REMINDER','REVISION_PLAN_UPDATE','CURRICULUM_UPDATE','EXAM_ALERT')),
  priority TEXT NOT NULL CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  edition_id INTEGER REFERENCES editions(id),
  stream_id INTEGER REFERENCES streams(id),
  title_fr TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  body_fr TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  record_id TEXT REFERENCES official_records(id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('PUBLISH_COEFFICIENT_TABLE','PUBLISH_ANNOUNCEMENT','PUBLISH_RECORD','REVIEW_CONTENT','TASK')),
  title_fr TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  detail_fr TEXT,
  detail_ar TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL CHECK (source IN ('MONITORING','SEED','MANUAL')),
  record_id TEXT REFERENCES official_records(id),
  priority TEXT NOT NULL CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  mandatory INTEGER NOT NULL DEFAULT 0,
  teacher_verification INTEGER NOT NULL DEFAULT 0,
  edition_id INTEGER REFERENCES editions(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS proposals_status ON proposals(status);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY,
  edition_id INTEGER NOT NULL REFERENCES editions(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  title_fr TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  verification TEXT NOT NULL CHECK (verification IN ('VERIFIED','PARTIALLY_VERIFIED','UNVERIFIED','CONTRADICTED')),
  note_fr TEXT,
  note_ar TEXT,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','ARCHIVED'))
);

CREATE TABLE IF NOT EXISTS chapter_streams (
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  stream_id INTEGER NOT NULL REFERENCES streams(id),
  PRIMARY KEY (chapter_id, stream_id)
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  sort INTEGER NOT NULL DEFAULT 0,
  title_fr TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  body_fr TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('OFFICIAL','TEACHER_REVIEWED','AI_GENERATED','UNVERIFIED')),
  outdated INTEGER NOT NULL DEFAULT 0,
  outdated_note TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  superseded_by INTEGER REFERENCES lessons(id),
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','SUPERSEDED','ARCHIVED')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY,
  edition_id INTEGER NOT NULL REFERENCES editions(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  title_fr TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'PRACTICE' CHECK (kind IN ('PRACTICE','OFFICIAL_PAST')),
  default_duration INTEGER,
  instructions_fr TEXT,
  instructions_ar TEXT,
  provenance TEXT NOT NULL CHECK (provenance IN ('OFFICIAL','TEACHER_REVIEWED','AI_GENERATED','UNVERIFIED')),
  total_points REAL NOT NULL DEFAULT 20,
  outdated INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','ARCHIVED')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_streams (
  exam_id INTEGER NOT NULL REFERENCES exams(id),
  stream_id INTEGER NOT NULL REFERENCES streams(id),
  PRIMARY KEY (exam_id, stream_id)
);

CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY,
  exam_id INTEGER REFERENCES exams(id),
  chapter_id INTEGER REFERENCES chapters(id),
  sort INTEGER NOT NULL DEFAULT 0,
  title_fr TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  statement_fr TEXT NOT NULL,
  statement_ar TEXT NOT NULL,
  solution_fr TEXT NOT NULL,
  solution_ar TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  provenance TEXT NOT NULL CHECK (provenance IN ('OFFICIAL','TEACHER_REVIEWED','AI_GENERATED','UNVERIFIED')),
  solution_provenance TEXT NOT NULL CHECK (solution_provenance IN ('OFFICIAL','TEACHER_REVIEWED','AI_GENERATED','UNVERIFIED')),
  reviewed_by TEXT,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id),
  duration_minutes INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','SUBMITTED','GRADED')),
  answers TEXT NOT NULL DEFAULT '{}',
  scores TEXT,
  score REAL,
  max_score REAL
);
CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id);

CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  done_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS user_subjects (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  in_custom INTEGER NOT NULL DEFAULT 0,
  custom_coefficient REAL,
  level INTEGER CHECK (level IS NULL OR level BETWEEN 1 AND 5),
  grade REAL CHECK (grade IS NULL OR (grade >= 0 AND grade <= 20)),
  PRIMARY KEY (user_id, subject_id)
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  params TEXT NOT NULL,
  weights TEXT NOT NULL DEFAULT '[]',
  official_weights INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plan_sessions (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  minutes INTEGER NOT NULL,
  focus TEXT NOT NULL CHECK (focus IN ('LESSON','EXERCISES','EXAM_PRACTICE','REVIEW')),
  chapter_id INTEGER REFERENCES chapters(id),
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS plan_sessions_plan ON plan_sessions(plan_id, day);

CREATE TABLE IF NOT EXISTS past_papers (
  id INTEGER PRIMARY KEY,
  exam_year INTEGER NOT NULL,
  stream_id INTEGER REFERENCES streams(id),
  subject_id INTEGER REFERENCES subjects(id),
  language TEXT NOT NULL CHECK (language IN ('fr','ar','other')),
  doc_type TEXT NOT NULL CHECK (doc_type IN ('SUBJECT','OFFICIAL_CORRECTION','MARKING_SCHEME','TEACHER_CORRECTION','AI_CORRECTION','OTHER')),
  title TEXT NOT NULL,
  source_authority TEXT NOT NULL,
  publication_date TEXT,
  url TEXT NOT NULL,
  verification TEXT NOT NULL CHECK (verification IN ('VERIFIED','PARTIALLY_VERIFIED','UNVERIFIED','CONTRADICTED')),
  note TEXT,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','RETIRED')),
  added_by TEXT,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  api_content TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  mode TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS monitoring_runs (
  id INTEGER PRIMARY KEY,
  checked_at TEXT NOT NULL UNIQUE,
  previous_check TEXT,
  coverage TEXT,
  summary TEXT NOT NULL DEFAULT '{}',
  report_file TEXT,
  report_markdown TEXT,
  imported_at TEXT NOT NULL,
  imported_by TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT
);
`;

const statements = new WeakMap<DB, Map<string, StatementSync>>();
const txDepth = new WeakMap<DB, number>();

function prepare(db: DB, sql: string): StatementSync {
  let cache = statements.get(db);
  if (!cache) {
    cache = new Map();
    statements.set(db, cache);
  }
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

/** Additive changes for databases created by an earlier version. Columns are only ever added. */
function migrate(db: DB): void {
  const columns = (table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const papers = columns('past_papers');
  if (!papers.includes('file_name')) db.exec('ALTER TABLE past_papers ADD COLUMN file_name TEXT');
  if (!papers.includes('file_size')) db.exec('ALTER TABLE past_papers ADD COLUMN file_size INTEGER');
}

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function get<T>(db: DB, sql: string, ...params: Param[]): T | undefined {
  return prepare(db, sql).get(...params) as T | undefined;
}

export function all<T>(db: DB, sql: string, ...params: Param[]): T[] {
  return prepare(db, sql).all(...params) as T[];
}

export function run(db: DB, sql: string, ...params: Param[]): { changes: number; id: number } {
  const result = prepare(db, sql).run(...params);
  return { changes: Number(result.changes), id: Number(result.lastInsertRowid) };
}

/** Runs fn inside a transaction. Nested calls join the outer transaction. */
export function tx<T>(db: DB, fn: () => T): T {
  const depth = txDepth.get(db) ?? 0;
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth.set(db, 0);
  }
}

export function getSetting(db: DB, key: string): string | null {
  return get<{ value: string }>(db, 'SELECT value FROM meta WHERE key = ?', key)?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string): void {
  run(db, 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

export interface Actor {
  id: string;
  name: string;
}

export function audit(
  db: DB,
  actor: Actor | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  detail?: Record<string, unknown>,
): void {
  run(
    db,
    'INSERT INTO audit_log (at, actor_id, actor_name, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    nowIso(),
    actor?.id ?? null,
    actor?.name ?? 'system',
    action,
    entity,
    entityId === null ? null : String(entityId),
    detail ? JSON.stringify(detail) : null,
  );
}
