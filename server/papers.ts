import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DocType, Verification } from '../shared/types.ts';
import { audit, run, tx, type Actor, type DB } from './db.ts';
import { HttpError, nowIso } from './util.ts';

/** Past-paper PDFs hosted by the platform live next to the database, one file per archive entry. */
export const MAX_PAPER_BYTES = 25 * 1024 * 1024;

export const papersDir = (): string => resolve(process.env.DATA_DIR?.trim() || './data', 'papers');

const pathFor = (id: number): string => join(papersDir(), `${id}.pdf`);

export function savePaperFile(id: number, bytes: Uint8Array): void {
  mkdirSync(papersDir(), { recursive: true });
  writeFileSync(pathFor(id), bytes);
}

export function readPaperFile(id: number): Uint8Array | null {
  const path = pathFor(id);
  return existsSync(path) ? readFileSync(path) : null;
}

export const isPdf = (bytes: Uint8Array): boolean => Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';

export interface PaperInput {
  exam_year: number;
  stream_id: number | null;
  subject_id: number | null;
  language: 'fr' | 'ar' | 'other';
  doc_type: DocType;
  title: string;
  source_authority: string;
  publication_date: string | null;
  verification: Verification;
  note?: string | null;
}

export type PaperSource = { url: string } | { file: { name: string; bytes: Uint8Array } };

/**
 * Files a past paper, hosted (`file`) or linked (`url`). Used by the upload form and the bulk importer,
 * so both apply the same rules.
 */
export function addPaper(db: DB, actor: Actor, input: PaperInput, source: PaperSource): number {
  // A correction is only "official" when its official origin has been verified.
  const officialType = input.doc_type === 'OFFICIAL_CORRECTION' || input.doc_type === 'MARKING_SCHEME';
  if (officialType && input.verification !== 'VERIFIED') {
    throw new HttpError(
      409,
      'unverified_official_document',
      'A document can be filed as an official correction or marking scheme only when its official source is verified.',
    );
  }
  if ('file' in source) {
    if (source.file.bytes.length > MAX_PAPER_BYTES) throw new HttpError(413, 'file_too_large', 'The file is larger than 25 MB.');
    if (!isPdf(source.file.bytes)) throw new HttpError(400, 'not_a_pdf', 'Only PDF files are accepted.');
  }
  return tx(db, () => {
    const created = run(
      db,
      `INSERT INTO past_papers (exam_year, stream_id, subject_id, language, doc_type, title, source_authority, publication_date,
                                url, verification, note, file_name, file_size, added_by, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.exam_year, input.stream_id, input.subject_id, input.language, input.doc_type, input.title,
      input.source_authority, input.publication_date, 'url' in source ? source.url : '', input.verification,
      input.note ?? null, 'file' in source ? source.file.name : null, 'file' in source ? source.file.bytes.length : null,
      actor.id, nowIso(),
    );
    if ('file' in source) {
      savePaperFile(created.id, source.file.bytes);
      run(db, 'UPDATE past_papers SET url = ? WHERE id = ?', `/api/archive/${created.id}/file`, created.id);
    }
    audit(db, actor, 'archive.add', 'past_paper', created.id, {
      doc_type: input.doc_type,
      verification: input.verification,
      file: 'file' in source ? source.file.name : null,
    });
    return created.id;
  });
}
