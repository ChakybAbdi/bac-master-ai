/**
 * Loads revision chapters (lessons + exercises) from content/lessons/*.json.
 *
 *   npm run import:lessons -- content/lessons/*.json
 *
 * The content is written by AI: it is stored as AI_GENERATED, its chapters as UNVERIFIED against the
 * official programme, and a review task asks a teacher to check it. Running a file twice adds nothing.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { all, audit, get, openDb, run, tx, type Actor, type DB } from './db.ts';
import { nowIso } from './util.ts';

const text = z.string().min(1);
const fileSchema = z.object({
  key: text,
  subject: text,
  streams: z.array(text).min(1),
  edition_year: z.number().int().optional(),
  chapters: z
    .array(
      z.object({
        title_fr: text,
        title_ar: text,
        lessons: z.array(z.object({ title_fr: text, title_ar: text, body_fr: text, body_ar: text })).min(1),
        exercises: z
          .array(
            z.object({
              title_fr: text,
              title_ar: text,
              statement_fr: text,
              statement_ar: text,
              solution_fr: text,
              solution_ar: text,
              points: z.number().nonnegative().default(0),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
});

export interface LessonImport {
  chapters: number;
  lessons: number;
  exercises: number;
}

export function importLessons(db: DB, actor: Actor, raw: unknown): LessonImport {
  const file = fileSchema.parse(raw);
  const subject = get<{ id: number; name_fr: string; name_ar: string }>(db, 'SELECT id, name_fr, name_ar FROM subjects WHERE code = ?', file.subject);
  if (!subject) throw new Error(`unknown subject code "${file.subject}"`);
  const streamIds = file.streams.map((code) => {
    const row = get<{ id: number }>(db, 'SELECT id FROM streams WHERE code = ?', code);
    if (!row) throw new Error(`unknown stream code "${code}"`);
    return row.id;
  });
  const editions = all<{ id: number; exam_year: number }>(db, 'SELECT id, exam_year FROM editions ORDER BY exam_year');
  const year = file.edition_year ?? editions.find((e) => e.exam_year > new Date().getFullYear())?.exam_year;
  const editionId = editions.find((e) => e.exam_year === year)?.id;
  if (!editionId) throw new Error(`no edition for BAC ${year}`);

  const now = nowIso();
  const result: LessonImport = { chapters: 0, lessons: 0, exercises: 0 };
  return tx(db, () => {
    const added: number[] = [];
    const base = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM chapters WHERE subject_id = ? AND edition_id = ?', subject.id, editionId)!.n;
    file.chapters.forEach((ch, i) => {
      if (get(db, 'SELECT 1 FROM chapters WHERE subject_id = ? AND edition_id = ? AND title_fr = ?', subject.id, editionId, ch.title_fr)) return;
      const chapter = run(
        db,
        `INSERT INTO chapters (edition_id, subject_id, title_fr, title_ar, sort, verification, note_fr, note_ar)
         VALUES (?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?)`,
        editionId, subject.id, ch.title_fr, ch.title_ar, base + i,
        "Chapitre de révision rédigé par IA. Sa place dans le programme officiel n'a pas été vérifiée.",
        'محور للمراجعة من إعداد الذكاء الاصطناعي. لم يتم التحقق من موقعه في البرنامج الرسمي.',
      );
      added.push(chapter.id);
      result.chapters += 1;
      for (const sid of streamIds) run(db, 'INSERT INTO chapter_streams (chapter_id, stream_id) VALUES (?, ?)', chapter.id, sid);
      ch.lessons.forEach((l, j) => {
        run(
          db,
          `INSERT INTO lessons (chapter_id, sort, title_fr, title_ar, body_fr, body_ar, provenance, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'AI_GENERATED', ?, ?)`,
          chapter.id, j, l.title_fr, l.title_ar, l.body_fr, l.body_ar, actor.id, now,
        );
        result.lessons += 1;
      });
      ch.exercises.forEach((e, j) => {
        run(
          db,
          `INSERT INTO exercises (chapter_id, sort, title_fr, title_ar, statement_fr, statement_ar, solution_fr, solution_ar, points,
                                  provenance, solution_provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AI_GENERATED', 'AI_GENERATED')`,
          chapter.id, j, e.title_fr, e.title_ar, e.statement_fr, e.statement_ar, e.solution_fr, e.solution_ar, e.points,
        );
        result.exercises += 1;
      });
    });
    if (added.length > 0) {
      run(
        db,
        `INSERT INTO proposals (kind, title_fr, title_ar, detail_fr, detail_ar, payload, source, priority, mandatory,
                                teacher_verification, edition_id, status, created_at)
         VALUES ('REVIEW_CONTENT', ?, ?, ?, ?, ?, 'MANUAL', 'MEDIUM', 0, 1, ?, 'PENDING', ?)`,
        `Relire les contenus rédigés par IA : ${subject.name_fr}`,
        `مراجعة المحتويات المعدة بالذكاء الاصطناعي: ${subject.name_ar}`,
        `${result.chapters} chapitre(s), ${result.lessons} leçon(s) et ${result.exercises} exercice(s) rédigés par IA. Vérifier l'exactitude, la conformité au programme officiel de 3AS et la traduction.`,
        `${result.chapters} محور، ${result.lessons} درس و${result.exercises} تمرين من إعداد الذكاء الاصطناعي. يجب التحقق من الصحة والمطابقة لبرنامج السنة الثالثة ثانوي والترجمة.`,
        JSON.stringify({ chapter_ids: added, key: file.key }),
        editionId,
        now,
      );
      audit(db, actor, 'content.import', 'subject', subject.id, { key: file.key, ...result });
    }
    return result;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: npm run import:lessons -- <file.json> [more.json...]');
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
      const r = importLessons(db, { id: admin.id, name: `${admin.name} (import)` }, JSON.parse(readFileSync(file, 'utf8')));
      console.log(`[lessons] ${file}: ${r.chapters} chapter(s), ${r.lessons} lesson(s), ${r.exercises} exercise(s) added`);
    } catch (error) {
      failed += 1;
      console.error(`[lessons] ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  db.close();
  process.exit(failed ? 2 : 0);
}
