/**
 * Loads an official past paper (content/exams/*.json) into the exam simulator.
 *
 *   npm run import:exam -- content/exams/*.json   (a file holds one exam or a list of exams)
 *
 * The statements and corrections are the official ones (ONEC), transcribed by hand from the scans;
 * a review task asks a teacher to check the transcription against the PDF in Annales.
 * Running a file twice adds nothing.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { all, audit, get, openDb, run, tx, type Actor, type DB } from './db.ts';
import { nowIso } from './util.ts';

const exerciseSchema = z.object({
  points: z.number().positive(),
  title_fr: z.string().min(1),
  title_ar: z.string().min(1),
  statement_fr: z.string().min(1),
  statement_ar: z.string().min(1),
  solution_fr: z.string().min(1),
  solution_ar: z.string().min(1),
});

const examSchema = z.object({
  key: z.string().min(1),
  exam_year: z.number().int(),
  subject: z.string().min(1),
  streams: z.array(z.string().min(1)).min(1),
  duration_minutes: z.number().int().min(10).max(300),
  title_fr: z.string().min(1),
  title_ar: z.string().min(1),
  instructions_fr: z.string().min(1),
  instructions_ar: z.string().min(1),
  source: z.string().min(1),
  exercises: z.array(exerciseSchema).min(1),
});

export type ExamFile = z.infer<typeof examSchema>;

/** Returns the new exam id, or null when the exam is already loaded. */
export function importExam(db: DB, actor: Actor, raw: unknown): number | null {
  const exam = examSchema.parse(raw);
  if (get(db, "SELECT 1 FROM exams WHERE title_fr = ? AND kind = 'OFFICIAL_PAST'", exam.title_fr)) return null;
  const subject = get<{ id: number }>(db, 'SELECT id FROM subjects WHERE code = ?', exam.subject);
  if (!subject) throw new Error(`unknown subject code "${exam.subject}"`);
  const streamIds = exam.streams.map((code) => {
    const row = get<{ id: number }>(db, 'SELECT id FROM streams WHERE code = ?', code);
    if (!row) throw new Error(`unknown stream code "${code}"`);
    return row.id;
  });
  // Official past papers are shown to every session; the edition column only needs a valid value.
  const edition = all<{ id: number; exam_year: number }>(db, 'SELECT id, exam_year FROM editions ORDER BY exam_year');
  const editionId = (edition.find((e) => e.exam_year >= new Date().getFullYear()) ?? edition.at(-1))?.id;
  if (!editionId) throw new Error('no edition in the database');
  const total = exam.exercises.reduce((sum, e) => sum + e.points, 0);
  const now = nowIso();

  return tx(db, () => {
    const created = run(
      db,
      `INSERT INTO exams (edition_id, subject_id, title_fr, title_ar, kind, default_duration, instructions_fr, instructions_ar,
                          provenance, total_points, created_at)
       VALUES (?, ?, ?, ?, 'OFFICIAL_PAST', ?, ?, ?, 'OFFICIAL', ?, ?)`,
      editionId, subject.id, exam.title_fr, exam.title_ar, exam.duration_minutes, exam.instructions_fr, exam.instructions_ar,
      total, now,
    );
    for (const sid of streamIds) run(db, 'INSERT INTO exam_streams (exam_id, stream_id) VALUES (?, ?)', created.id, sid);
    exam.exercises.forEach((e, i) =>
      run(
        db,
        `INSERT INTO exercises (exam_id, sort, title_fr, title_ar, statement_fr, statement_ar, solution_fr, solution_ar, points,
                                provenance, solution_provenance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFFICIAL', 'OFFICIAL')`,
        created.id, i, e.title_fr, e.title_ar, e.statement_fr, e.statement_ar, e.solution_fr, e.solution_ar, e.points,
      ),
    );
    run(
      db,
      `INSERT INTO proposals (kind, title_fr, title_ar, detail_fr, detail_ar, payload, source, priority, mandatory,
                              teacher_verification, edition_id, status, created_at)
       VALUES ('REVIEW_CONTENT', ?, ?, ?, ?, ?, 'MANUAL', 'MEDIUM', 0, 1, ?, 'PENDING', ?)`,
      `Vérifier la transcription : ${exam.title_fr}`,
      `التحقق من النسخ: ${exam.title_ar}`,
      `Sujet officiel saisi à partir des scans (${exam.source}). Comparer énoncés et corrigés avec le PDF de la rubrique Annales ; la version française est une traduction.`,
      `موضوع رسمي تمت كتابته انطلاقا من النسخ الممسوحة (${exam.source}). قارن النصوص والحلول مع ملف PDF في قسم الحوليات؛ النسخة الفرنسية ترجمة.`,
      JSON.stringify({ exam_ids: [created.id], key: exam.key }),
      editionId,
      now,
    );
    audit(db, actor, 'exam.import', 'exam', created.id, { key: exam.key, exercises: exam.exercises.length, total });
    return created.id;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: npm run import:exam -- <exam.json> [more.json...]');
    process.exit(1);
  }
  const db = openDb(join(resolve(process.env.DATA_DIR?.trim() || './data'), 'bacmaster.db'));
  const admin = get<Actor>(db, "SELECT id, name FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
  if (!admin) {
    console.error('No administrator account yet: start the server once (npm start), then run the import.');
    process.exit(1);
  }
  let failed = 0;
  for (const file of files) {
    try {
      // A file holds one exam, or a list of exams (for example both subjects of a session).
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      for (const exam of Array.isArray(raw) ? raw : [raw]) {
        const id = importExam(db, { id: admin.id, name: `${admin.name} (import)` }, exam);
        const key = (exam as { key?: string }).key ?? file;
        console.log(id ? `[exam] ${key}: added (exam ${id})` : `[exam] ${key}: already loaded`);
      }
    } catch (error) {
      failed += 1;
      console.error(`[exam] ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  db.close();
  process.exit(failed ? 2 : 0);
}
