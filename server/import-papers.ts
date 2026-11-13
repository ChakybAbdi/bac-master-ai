/**
 * Bulk import of past papers from a manifest (JSON array) prepared offline, for example from the ONEFD annals.
 *
 *   npm run import:papers -- <manifest.json>
 *
 * Each entry names a local PDF and its metadata, with stream and subject given by code (M, SE, MATH, PHYS...).
 * Files go through the same checks as the upload form (real PDF, 25 MB, official corrections must be verified).
 * Running the same manifest twice adds nothing: an active entry with the same year, stream, title and source is skipped.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { get, openDb, type Actor, type DB } from './db.ts';
import { addPaper } from './papers.ts';

const entrySchema = z.object({
  file: z.string().min(1),
  exam_year: z.number().int().min(1990).max(2100),
  stream: z.string().min(1).nullable(),
  subject: z.string().min(1).nullable(),
  language: z.enum(['fr', 'ar', 'other']),
  doc_type: z.enum(['SUBJECT', 'OFFICIAL_CORRECTION', 'MARKING_SCHEME', 'TEACHER_CORRECTION', 'AI_CORRECTION', 'OTHER']),
  title: z.string().trim().min(1).max(300),
  source_authority: z.string().trim().min(1).max(200),
  verification: z.enum(['VERIFIED', 'PARTIALLY_VERIFIED', 'UNVERIFIED', 'CONTRADICTED']),
  note: z.string().trim().max(1000).nullable().optional(),
  publication_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export interface ImportResult {
  added: number;
  skipped: number;
  failed: { title: string; reason: string }[];
}

const idFor = (db: DB, table: 'streams' | 'subjects', code: string | null): number | null => {
  if (code === null) return null;
  const row = get<{ id: number }>(db, `SELECT id FROM ${table} WHERE code = ?`, code);
  if (!row) throw new Error(`unknown ${table === 'streams' ? 'stream' : 'subject'} code "${code}"`);
  return row.id;
};

/** A download name students will see: the title, made safe for a file name. */
const fileNameFor = (title: string): string =>
  `${title.replace(/[^\p{L}\p{N}._ -]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'document'}.pdf`;

export function importManifest(db: DB, actor: Actor, manifestPath: string): ImportResult {
  const raw: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = z.array(entrySchema).parse(raw);
  const base = dirname(resolve(manifestPath));
  const result: ImportResult = { added: 0, skipped: 0, failed: [] };

  for (const entry of entries) {
    try {
      const streamId = idFor(db, 'streams', entry.stream);
      const subjectId = idFor(db, 'subjects', entry.subject);
      const existing = get<{ id: number }>(
        db,
        `SELECT id FROM past_papers WHERE state = 'ACTIVE' AND exam_year = ? AND stream_id IS ? AND title = ? AND source_authority = ?`,
        entry.exam_year, streamId, entry.title, entry.source_authority,
      );
      if (existing) {
        result.skipped += 1;
        continue;
      }
      const path = isAbsolute(entry.file) ? entry.file : join(base, entry.file);
      const bytes = new Uint8Array(readFileSync(path));
      addPaper(
        db,
        actor,
        {
          exam_year: entry.exam_year,
          stream_id: streamId,
          subject_id: subjectId,
          language: entry.language,
          doc_type: entry.doc_type,
          title: entry.title,
          source_authority: entry.source_authority,
          publication_date: entry.publication_date ?? null,
          verification: entry.verification,
          note: entry.note ?? null,
        },
        { file: { name: fileNameFor(entry.title), bytes } },
      );
      result.added += 1;
    } catch (error) {
      result.failed.push({ title: entry.title, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

// Command line entry point.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const manifest = process.argv[2];
  if (!manifest) {
    console.error('Usage: npm run import:papers -- <manifest.json>');
    process.exit(1);
  }
  const db = openDb(join(resolve(process.env.DATA_DIR?.trim() || './data'), 'bacmaster.db'));
  const admin = get<Actor>(db, "SELECT id, name FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
  if (!admin) {
    console.error('No administrator account yet: start the server once (npm start) so it is created, then run the import.');
    process.exit(1);
  }
  const result = importManifest(db, { id: admin.id, name: `${admin.name} (import)` }, manifest);
  db.close();
  console.log(`[import] ${basename(manifest)}: ${result.added} added, ${result.skipped} already present, ${result.failed.length} failed`);
  for (const f of result.failed) console.log(`  failed: ${f.title} — ${f.reason}`);
  process.exit(result.failed.length ? 2 : 0);
}
