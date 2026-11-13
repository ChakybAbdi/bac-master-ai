import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ChangeStatus, OfficialRecord, Priority, Verification } from '../shared/types.ts';
import { all, audit, get, run, tx, type Actor, type DB } from './db.ts';
import { HttpError, nowIso, parseJson } from './util.ts';

/**
 * Bridge between the monitoring agent and the platform.
 *
 * The agent writes `records.json` and a Markdown report per run. Importing them
 * never changes anything students can see: new records arrive as INTERNAL and
 * create review tasks, and a record whose official content changed is taken out
 * of the student view until a person has re-approved its summary. The previous
 * version of a changed record is always kept in `record_history`.
 */

export const monitoringDir = (): string => resolve(process.env.MONITORING_DIR?.trim() || './monitoring');

type Raw = Record<string, unknown>;

interface MonitoringFile {
  schema?: string;
  last_run?: Raw;
  records?: Raw[];
}

const text = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const list = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value) return [value];
  return [];
};

/** Splits "PARTIALLY VERIFIED (reason)" into the level and the free-text note. */
function label<T extends string>(value: unknown, options: [string, T][], fallback: T): { value: T; note: string | null } {
  const raw = typeof value === 'string' ? value.trim() : '';
  const upper = raw.toUpperCase();
  for (const [prefix, mapped] of options) {
    if (upper.startsWith(prefix)) {
      const note = raw
        .slice(prefix.length)
        .replace(/^[\s;:,-]+/, '')
        .replace(/^\((.*)\)$/s, '$1')
        .trim();
      return { value: mapped, note: note || null };
    }
  }
  return { value: fallback, note: raw || null };
}

const VERIFICATION: [string, Verification][] = [
  ['PARTIALLY VERIFIED', 'PARTIALLY_VERIFIED'],
  ['PARTIALLY_VERIFIED', 'PARTIALLY_VERIFIED'],
  ['UNVERIFIED', 'UNVERIFIED'],
  ['CONTRADICTED', 'CONTRADICTED'],
  ['VERIFIED', 'VERIFIED'],
];
const CHANGE: [string, ChangeStatus][] = (
  ['NEW', 'UPDATED', 'CONFIRMED', 'CORRECTED', 'REPEATED', 'UNVERIFIED', 'SUPERSEDED'] as ChangeStatus[]
).map((s) => [s, s]);
const PRIORITY: [string, Priority][] = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Priority[]).map((p) => [p, p]);

/** The parts of a record that carry official content. A change here needs a human review. */
const MATERIAL_FIELDS = [
  'topic',
  'document_title',
  'original_url',
  'publication_date',
  'examination_year',
  'applicable_stream',
  'applicable_subject',
  'previous_value',
  'new_value',
  'verification',
  'superseded_by',
  'unverified_claims',
] as const;

type Parsed = Omit<
  OfficialRecord,
  'visibility' | 'title_fr' | 'title_ar' | 'summary_fr' | 'summary_ar' | 'impact_fr' | 'impact_ar' | 'updated_at'
>;

export function parseRecord(raw: Raw): Parsed {
  if (typeof raw.id !== 'string' || !raw.id) throw new HttpError(400, 'invalid_record', 'A record has no id.');
  const verification = label(raw.verification_status, VERIFICATION, 'UNVERIFIED');
  const change = label(raw.status, CHANGE, 'NEW');
  const priority = label(raw.priority, PRIORITY, 'LOW');
  return {
    id: raw.id,
    topic: text(raw.topic) ?? raw.id,
    authority: text(raw.authority),
    document_title: text(raw.document_title),
    original_url: text(raw.original_url),
    scan_url: text(raw.document_scan_url),
    related_urls: [...list(raw.related_url), ...list(raw.sources)],
    publication_date: text(raw.publication_date),
    examination_year: text(raw.examination_year),
    applicable_stream: text(raw.applicable_stream),
    applicable_subject: text(raw.applicable_subject),
    previous_value: text(raw.previous_value),
    new_value: text(raw.new_value),
    verification: verification.value,
    verification_note: verification.note,
    change_status: change.value,
    change_note: change.note,
    priority: priority.value,
    priority_note: priority.note,
    first_detected: text(raw.first_detected),
    last_verified: text(raw.last_verified),
    student_impact: text(raw.student_impact),
    product_impact: text(raw.product_impact),
    required_action: text(raw.required_action),
    superseded_by: list(raw.superseded_by),
    unverified_claims: list(raw.unverified_claims),
  };
}

type RecordRow = Record<string, string | number | null>;

export function rowToRecord(row: RecordRow): OfficialRecord {
  const { raw: _raw, imported_at: _imported, ...rest } = row;
  return {
    ...(rest as unknown as OfficialRecord),
    related_urls: parseJson<string[]>(row.related_urls, []),
    superseded_by: parseJson<string[]>(row.superseded_by, []),
    unverified_claims: parseJson<string[]>(row.unverified_claims, []),
  };
}

function findReport(dir: string, checkedAt: string): { file: string; markdown: string } | null {
  const reports = join(dir, 'reports');
  if (!existsSync(reports)) return null;
  const files = readdirSync(reports).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) return null;
  const file = files.find((f) => f.startsWith(checkedAt.slice(0, 10))) ?? files[files.length - 1]!;
  return { file, markdown: readFileSync(join(reports, file), 'utf8') };
}

export interface ImportResult {
  available: boolean;
  checked_at: string | null;
  run_is_new: boolean;
  created: string[];
  changed: string[];
  refreshed: string[];
  unchanged: number;
  proposals: number;
}

export function importMonitoring(db: DB, actor: Actor | null, opts: { createProposals: boolean }): ImportResult {
  const dir = monitoringDir();
  const file = join(dir, 'records.json');
  const result: ImportResult = {
    available: false,
    checked_at: null,
    run_is_new: false,
    created: [],
    changed: [],
    refreshed: [],
    unchanged: 0,
    proposals: 0,
  };
  if (!existsSync(file)) return result;

  let data: MonitoringFile;
  try {
    data = JSON.parse(readFileSync(file, 'utf8')) as MonitoringFile;
  } catch {
    throw new HttpError(422, 'invalid_monitoring_file', 'records.json is not valid JSON.');
  }
  if (!Array.isArray(data.records)) {
    throw new HttpError(422, 'invalid_monitoring_file', 'records.json has no "records" list.');
  }
  result.available = true;
  const now = nowIso();
  const checkedAt = text(data.last_run?.checked_at);
  result.checked_at = checkedAt;

  tx(db, () => {
    if (checkedAt && !get(db, 'SELECT 1 FROM monitoring_runs WHERE checked_at = ?', checkedAt)) {
      const report = findReport(dir, checkedAt);
      run(
        db,
        `INSERT INTO monitoring_runs (checked_at, previous_check, coverage, summary, report_file, report_markdown, imported_at, imported_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        checkedAt,
        text(data.last_run?.previous_check),
        text(data.last_run?.coverage),
        JSON.stringify(data.last_run ?? {}),
        report?.file ?? null,
        report?.markdown ?? null,
        now,
        actor?.id ?? null,
      );
      result.run_is_new = true;
    }

    for (const raw of data.records!) {
      const rec = parseRecord(raw);
      const rawJson = JSON.stringify(raw);
      const existing = get<RecordRow>(db, 'SELECT * FROM official_records WHERE id = ?', rec.id);

      if (!existing) {
        run(
          db,
          `INSERT INTO official_records
             (id, topic, authority, document_title, original_url, scan_url, related_urls, publication_date, examination_year,
              applicable_stream, applicable_subject, previous_value, new_value, verification, verification_note,
              change_status, change_note, priority, priority_note, first_detected, last_verified, student_impact,
              product_impact, required_action, superseded_by, unverified_claims, visibility, raw, imported_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INTERNAL', ?, ?, ?)`,
          rec.id,
          rec.topic,
          rec.authority,
          rec.document_title,
          rec.original_url,
          rec.scan_url,
          JSON.stringify(rec.related_urls),
          rec.publication_date,
          rec.examination_year,
          rec.applicable_stream,
          rec.applicable_subject,
          rec.previous_value,
          rec.new_value,
          rec.verification,
          rec.verification_note,
          rec.change_status,
          rec.change_note,
          rec.priority,
          rec.priority_note,
          rec.first_detected,
          rec.last_verified,
          rec.student_impact,
          rec.product_impact,
          rec.required_action,
          JSON.stringify(rec.superseded_by),
          JSON.stringify(rec.unverified_claims),
          rawJson,
          now,
          now,
        );
        result.created.push(rec.id);
        if (opts.createProposals) {
          run(
            db,
            `INSERT INTO proposals (kind, title_fr, title_ar, detail_fr, detail_ar, payload, source, record_id, priority, mandatory, teacher_verification, status, created_at)
             VALUES ('PUBLISH_RECORD', ?, ?, ?, ?, ?, 'MONITORING', ?, ?, 0, 0, 'PENDING', ?)`,
            `Nouvelle fiche issue de la veille : ${rec.topic}`,
            `بطاقة جديدة من الرصد: ${rec.topic}`,
            rec.required_action,
            rec.required_action,
            JSON.stringify({ record_id: rec.id }),
            rec.id,
            rec.priority,
            now,
          );
          result.proposals += 1;
        }
        continue;
      }

      if (existing.raw === rawJson) {
        result.unchanged += 1;
        continue;
      }

      const before = rowToRecord(existing);
      const material = MATERIAL_FIELDS.some((f) => JSON.stringify(before[f]) !== JSON.stringify(rec[f]));
      run(
        db,
        'INSERT INTO record_history (record_id, snapshot, replaced_at, replaced_by, reason) VALUES (?, ?, ?, ?, ?)',
        rec.id,
        JSON.stringify(existing),
        now,
        actor?.id ?? null,
        material ? 'Monitoring import: official content changed' : 'Monitoring import: status or dates refreshed',
      );
      // A record whose official content changed leaves the student view until its summary is re-approved.
      const visibility = material ? 'INTERNAL' : String(existing.visibility);
      run(
        db,
        `UPDATE official_records SET
           topic = ?, authority = ?, document_title = ?, original_url = ?, scan_url = ?, related_urls = ?,
           publication_date = ?, examination_year = ?, applicable_stream = ?, applicable_subject = ?,
           previous_value = ?, new_value = ?, verification = ?, verification_note = ?, change_status = ?,
           change_note = ?, priority = ?, priority_note = ?, first_detected = ?, last_verified = ?,
           student_impact = ?, product_impact = ?, required_action = ?, superseded_by = ?, unverified_claims = ?,
           visibility = ?, raw = ?, updated_at = ?
         WHERE id = ?`,
        rec.topic,
        rec.authority,
        rec.document_title,
        rec.original_url,
        rec.scan_url,
        JSON.stringify(rec.related_urls),
        rec.publication_date,
        rec.examination_year,
        rec.applicable_stream,
        rec.applicable_subject,
        rec.previous_value,
        rec.new_value,
        rec.verification,
        rec.verification_note,
        rec.change_status,
        rec.change_note,
        rec.priority,
        rec.priority_note,
        rec.first_detected,
        rec.last_verified,
        rec.student_impact,
        rec.product_impact,
        rec.required_action,
        JSON.stringify(rec.superseded_by),
        JSON.stringify(rec.unverified_claims),
        visibility,
        rawJson,
        now,
        rec.id,
      );
      if (!material) {
        result.refreshed.push(rec.id);
        continue;
      }
      result.changed.push(rec.id);
      if (opts.createProposals) {
        run(
          db,
          `INSERT INTO proposals (kind, title_fr, title_ar, detail_fr, detail_ar, payload, source, record_id, priority, mandatory, teacher_verification, status, created_at)
           VALUES ('PUBLISH_RECORD', ?, ?, ?, ?, ?, 'MONITORING', ?, ?, 1, 0, 'PENDING', ?)`,
          `Fiche modifiée par la veille : ${rec.topic}`,
          `بطاقة عدلها الرصد: ${rec.topic}`,
          "Le contenu officiel de cette fiche a changé. Elle est retirée de l'espace élève jusqu'à la mise à jour et la validation de son résumé. L'ancienne version est conservée dans l'historique.",
          'تغير المحتوى الرسمي لهذه البطاقة. سحبت من فضاء التلميذ إلى غاية تحديث ملخصها والمصادقة عليه. النسخة السابقة محفوظة في السجل.',
          JSON.stringify({ record_id: rec.id }),
          rec.id,
          rec.priority === 'LOW' ? 'MEDIUM' : rec.priority,
          now,
        );
        result.proposals += 1;
      }
    }

    audit(db, actor, 'monitoring.import', 'monitoring', checkedAt, {
      created: result.created,
      changed: result.changed,
      refreshed: result.refreshed,
      unchanged: result.unchanged,
    });
  });
  return result;
}

export function listRecords(db: DB, onlyPublished: boolean): OfficialRecord[] {
  const rows = all<RecordRow>(
    db,
    `SELECT * FROM official_records ${onlyPublished ? "WHERE visibility = 'PUBLISHED'" : ''}
      ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
               COALESCE(publication_date, last_verified) DESC, id`,
  );
  return rows.map(rowToRecord);
}

export function lastCheck(db: DB): string | null {
  return get<{ checked_at: string }>(db, 'SELECT checked_at FROM monitoring_runs ORDER BY checked_at DESC LIMIT 1')
    ?.checked_at ?? null;
}
