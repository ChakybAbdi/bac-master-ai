// End-to-end tests of the API on an in-memory database seeded like a new installation.
// Run with: npm test
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Hono } from 'hono';
import { createApp } from '../app.ts';
import { backupNow } from '../backup.ts';
import { ensureAdmin, type AppEnv } from '../auth.ts';
import { openDb, type DB } from '../db.ts';
import { importExam } from '../import-exam.ts';
import { importLessons } from '../import-lessons.ts';
import { importManifest } from '../import-papers.ts';
import { seed } from '../seed.ts';

process.env.MONITORING_DIR = resolve('monitoring');
const dataDir = mkdtempSync(join(tmpdir(), 'bacmaster-test-'));
process.env.DATA_DIR = dataDir;
after(() => rmSync(dataDir, { recursive: true, force: true }));
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.ANTHROPIC_PROFILE;

let db: DB;
let app: Hono<AppEnv>;

interface Reply<T = any> {
  status: number;
  body: T;
  cookie: string | null;
  text: string;
}

async function call<T = any>(method: string, path: string, opts: { body?: unknown; cookie?: string | null } = {}): Promise<Reply<T>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await app.request(`/api${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Server-sent events and empty bodies are read through `text`.
  }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: body as T, cookie: setCookie ? setCookie.split(';')[0]! : null, text };
}

let student: string;
let admin: string;
let editionId: number;
let streamSE: number;

before(async () => {
  db = openDb(':memory:');
  assert.equal(seed(db), true);
  assert.equal(seed(db), false, 'seeding twice must be a no-op');
  assert.equal(await ensureAdmin(db), 'created');
  app = createApp(db, resolve('does-not-exist'));

  const meta = await call('GET', '/meta');
  editionId = meta.body.editions.find((e: { exam_year: number }) => e.exam_year === 2027).id;
  streamSE = meta.body.streams.find((s: { code: string }) => s.code === 'SE').id;

  const reg = await call('POST', '/auth/register', {
    body: { name: 'Élève Test', email: 'eleve@test.local', password: 'motdepasse-1', locale: 'fr' },
  });
  assert.equal(reg.status, 201);
  student = reg.cookie!;
  const login = await call('POST', '/auth/login', { body: { email: 'admin@test.local', password: 'correct-horse-battery' } });
  assert.equal(login.status, 200);
  admin = login.cookie!;
});

describe('accounts', () => {
  test('reference data is served without signing in', async () => {
    const meta = await call('GET', '/meta');
    assert.equal(meta.status, 200);
    assert.deepEqual(meta.body.editions.map((e: { exam_year: number }) => e.exam_year), [2026, 2027, 2028]);
    assert.equal(meta.body.streams.length, 7);
    assert.equal(meta.body.ai.enabled, false);
  });

  test('a session cookie identifies the student', async () => {
    const me = await call('GET', '/auth/me', { cookie: student });
    assert.equal(me.body.user.email, 'eleve@test.local');
    assert.equal(me.body.user.role, 'student');
    assert.equal(me.body.user.password_hash, undefined);
  });

  test('duplicate e-mail and wrong password are refused', async () => {
    const dup = await call('POST', '/auth/register', {
      body: { name: 'Autre', email: 'ELEVE@test.local', password: 'motdepasse-2' },
    });
    assert.equal(dup.status, 409);
    const bad = await call('POST', '/auth/login', { body: { email: 'eleve@test.local', password: 'nope-nope' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.code, 'invalid_credentials');
  });

  test('student pages need a session and staff pages need a staff role', async () => {
    assert.equal((await call('GET', '/dashboard')).status, 401);
    assert.equal((await call('GET', '/admin/overview', { cookie: student })).status, 403);
    assert.equal((await call('GET', '/admin/overview', { cookie: admin })).status, 200);
  });

  test('a request from another site is refused', async () => {
    const res = await app.request('/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost' } });
    assert.equal(res.status, 403);
  });

  test('the student chooses a stream', async () => {
    const res = await call('PATCH', '/me', { cookie: student, body: { stream_id: streamSE } });
    assert.equal(res.body.user.stream_id, streamSE);
    assert.equal(res.body.user.edition_id, editionId);
  });
});

describe('official information', () => {
  test('no BAC 2027 registration, exam or results date is shown', async () => {
    const dash = await call('GET', '/dashboard', { cookie: student });
    const byKey = Object.fromEntries(dash.body.official.map((l: { key: string }) => [l.key, l]));
    for (const key of ['REGISTRATION', 'EXAM', 'RESULTS']) {
      assert.equal(byKey[key].status, 'NOT_ANNOUNCED');
      assert.equal(byKey[key].dates_fr, null);
    }
    assert.equal(byKey.FRAMEWORK.status, 'VERIFIED');
    assert.equal(dash.body.announcements.length, 0, 'drafts are not shown to students');
  });

  test('the calendar carries the dates of the official communiqué', async () => {
    const cal = await call('GET', '/official/calendar', { cookie: student });
    const third = cal.body.items.find((e: { concerns_3as: number }) => e.concerns_3as === 2 && true);
    const period = cal.body.items.find((e: { starts_on: string }) => e.starts_on === '2027-05-09');
    assert.ok(third);
    assert.equal(period.ends_on, '2027-05-13');
    assert.equal(period.status, 'CONFIRMED');
    assert.equal(period.source_url, 'https://www.education.gov.dz/?p=4519');
    for (const e of cal.body.items) {
      if (['REGISTRATION', 'EXAM', 'RESULTS'].includes(e.kind)) assert.equal(e.starts_on, null);
    }
  });

  test('students only see published records, each with its source', async () => {
    const recs = await call('GET', '/official/records', { cookie: student });
    const ids = recs.body.items.map((r: { id: string }) => r.id);
    assert.ok(ids.includes('BAC-REC-0001'));
    assert.ok(!ids.includes('BAC-REC-0008'), 'the registration watch item is internal');
    assert.ok(!ids.includes('BAC-REC-0012'));
    for (const r of recs.body.items) {
      assert.equal(r.visibility, 'PUBLISHED');
      assert.ok(r.title_fr && r.title_ar && r.summary_fr && r.summary_ar);
    }
    const baseline = recs.body.items.find((r: { id: string }) => r.id === 'BAC-REC-0011');
    assert.equal(baseline.verification, 'PARTIALLY_VERIFIED');
    const superseded = recs.body.items.find((r: { id: string }) => r.id === 'BAC-REC-0003');
    assert.equal(superseded.change_status, 'SUPERSEDED');
  });

  test('checked rumours are labelled, never confirmed', async () => {
    const claims = await call('GET', '/official/claims', { cookie: student });
    assert.equal(claims.body.items.length, 5);
    for (const cl of claims.body.items) assert.ok(['UNVERIFIED', 'SUPERSEDED'].includes(cl.verdict));
  });
});

describe('coefficients stay hidden until a teacher verifies them', () => {
  test('before review the student gets no provisional value', async () => {
    const view = await call('GET', '/subjects', { cookie: student });
    assert.equal(view.body.mode, 'custom');
    assert.equal(view.body.pending, true);
    assert.deepEqual(view.body.items, []);
  });

  test('the student can keep a personal list meanwhile', async () => {
    const meta = await call('GET', '/meta');
    const math = meta.body.subjects.find((s: { code: string }) => s.code === 'MATH').id;
    const saved = await call('PUT', '/subjects/prefs', {
      cookie: student,
      body: { items: [{ subject_id: math, in_custom: true, custom_coefficient: 5, level: 2, grade: 11.5 }] },
    });
    assert.equal(saved.body.items.length, 1);
    assert.equal(saved.body.items[0].coefficient, 5);
    assert.equal(saved.body.items[0].verification, null);
  });

  test('publishing a table requires a verification level and evidence', async () => {
    const queue = await call('GET', '/admin/proposals', { cookie: admin });
    assert.equal(queue.body.items.length, 11);
    const proposal = queue.body.items.find(
      (p: { kind: string; payload: { stream_id: number } }) =>
        p.kind === 'PUBLISH_COEFFICIENT_TABLE' && p.payload.stream_id === streamSE,
    );
    assert.equal(proposal.mandatory, true);
    assert.equal(proposal.teacher_verification, true);

    const noLevel = await call('POST', `/admin/proposals/${proposal.id}/decide`, { cookie: admin, body: { decision: 'APPROVE' } });
    assert.equal(noLevel.status, 400);
    const noEvidence = await call('POST', `/admin/proposals/${proposal.id}/decide`, {
      cookie: admin,
      body: { decision: 'APPROVE', verification: 'VERIFIED' },
    });
    assert.equal(noEvidence.status, 400);
    assert.equal(noEvidence.body.error.code, 'evidence_required');

    const stillHidden = await call('GET', '/subjects', { cookie: student });
    assert.equal(stillHidden.body.mode, 'custom', 'a failed approval must not publish anything');

    const ok = await call('POST', `/admin/proposals/${proposal.id}/decide`, {
      cookie: admin,
      body: { decision: 'APPROVE', verification: 'VERIFIED', evidence: 'Checked against arrêté n° 186, annexe 3AS.' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.outcome.rows_published, 11);
  });

  test('after review the student sees the table with its verification', async () => {
    const view = await call('GET', '/subjects', { cookie: student });
    assert.equal(view.body.mode, 'official');
    assert.equal(view.body.items.length, 11);
    for (const item of view.body.items) assert.equal(item.verification, 'VERIFIED');
    const math = view.body.items.find((i: { code: string }) => i.code === 'MATH');
    assert.equal(math.level, 2, 'the level set earlier is kept');
    assert.equal(math.grade, 11.5);
  });

  test('changing a published coefficient keeps the old value in the history', async () => {
    const meta = await call('GET', '/meta');
    const math = meta.body.subjects.find((s: { code: string }) => s.code === 'MATH').id;
    const res = await call('PUT', '/admin/academic/row', {
      cookie: admin,
      body: {
        edition_id: editionId, stream_id: streamSE, subject_id: math, coefficient: 6, duration_minutes: null,
        is_optional: false, verification: 'VERIFIED', source_record_id: 'BAC-REC-0001', source_note: 'Correction after review.',
      },
    });
    assert.equal(res.status, 200);
    const tables = await call('GET', `/admin/academic?edition_id=${editionId}`, { cookie: admin });
    const table = tables.body.tables.find((t: { stream_id: number }) => t.stream_id === streamSE);
    const current = table.current.find((r: { subject_id: number }) => r.subject_id === math);
    const old = table.history.find((r: { subject_id: number }) => r.subject_id === math);
    assert.equal(current.coefficient, 6);
    assert.equal(current.version, 2);
    assert.equal(current.state, 'PUBLISHED');
    assert.equal(old.coefficient, 5);
    assert.equal(old.state, 'SUPERSEDED');
    assert.equal(old.superseded_by, current.id);
  });
});

describe('announcements', () => {
  test('an announcement citing an unverified record cannot be published', async () => {
    const list = await call('GET', '/admin/announcements', { cookie: admin });
    const reminder = list.body.items.find((a: { kind: string }) => a.kind === 'REGISTRATION_REMINDER');
    const res = await call('POST', `/admin/announcements/${reminder.id}/publish`, { cookie: admin });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'unverified_source');
  });

  test('unfilled placeholders block publication even with a verified source', async () => {
    const created = await call('POST', '/admin/announcements', {
      cookie: admin,
      body: {
        kind: 'EXAM_ALERT', priority: 'HIGH', edition_id: editionId, stream_id: null,
        title_fr: 'Épreuves : [date]', title_ar: 'الاختبارات: [التاريخ]', body_fr: 'Texte', body_ar: 'نص', record_id: 'BAC-REC-0001',
      },
    });
    const res = await call('POST', `/admin/announcements/${created.body.id}/publish`, { cookie: admin });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'placeholder_left');
  });

  test('an approved announcement reaches the student and can be marked as read', async () => {
    const queue = await call('GET', '/admin/proposals', { cookie: admin });
    const proposal = queue.body.items.find((p: { kind: string }) => p.kind === 'PUBLISH_ANNOUNCEMENT');
    const ok = await call('POST', `/admin/proposals/${proposal.id}/decide`, { cookie: admin, body: { decision: 'APPROVE' } });
    assert.equal(ok.status, 200);

    const notes = await call('GET', '/notifications', { cookie: student });
    assert.equal(notes.body.unread, 1);
    assert.equal(notes.body.items[0].record_verification, 'VERIFIED');
    await call('POST', '/official/announcements/read', { cookie: student, body: { ids: [notes.body.items[0].id] } });
    assert.equal((await call('GET', '/notifications', { cookie: student })).body.unread, 0);
  });

  test('a teacher cannot publish announcements', async () => {
    const reg = await call('POST', '/auth/register', {
      body: { name: 'Prof Test', email: 'prof@test.local', password: 'motdepasse-3' },
    });
    const users = await call('GET', '/admin/users', { cookie: admin });
    const prof = users.body.items.find((u: { email: string }) => u.email === 'prof@test.local');
    await call('PATCH', `/admin/users/${prof.id}/role`, { cookie: admin, body: { role: 'teacher' } });
    const list = await call('GET', '/admin/announcements', { cookie: reg.cookie });
    assert.equal(list.status, 200);
    const draft = list.body.items.find((a: { status: string }) => a.status === 'DRAFT');
    assert.equal((await call('POST', `/admin/announcements/${draft.id}/publish`, { cookie: reg.cookie })).status, 403);
  });
});

describe('other publication gates', () => {
  test('a confirmed date must cite a verified record', async () => {
    const res = await call('POST', '/admin/calendar', {
      cookie: admin,
      body: {
        edition_id: editionId, kind: 'EXAM', starts_on: '2027-06-13', ends_on: '2027-06-17',
        dates_fr: 'du 13 au 17 juin 2027', dates_ar: 'من 13 إلى 17 جوان 2027', title_fr: 'Épreuves', title_ar: 'الاختبارات',
        status: 'CONFIRMED', concerns_3as: 2, record_id: 'BAC-REC-0009',
      },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'unverified_source');
  });

  test('a correction is filed as official only when its source is verified', async () => {
    const res = await call('POST', '/admin/archive', {
      cookie: admin,
      body: {
        exam_year: 2026, stream_id: streamSE, subject_id: null, language: 'ar', doc_type: 'OFFICIAL_CORRECTION',
        title: 'Corrigé', source_authority: 'Site non officiel', publication_date: null, url: 'https://example.org/corrige.pdf',
        verification: 'UNVERIFIED',
      },
    });
    assert.equal(res.status, 409);
    const teacher = await call('POST', '/admin/archive', {
      cookie: admin,
      body: {
        exam_year: 2026, stream_id: streamSE, subject_id: null, language: 'ar', doc_type: 'TEACHER_CORRECTION',
        title: 'Corrigé proposé par un enseignant', source_authority: 'Enseignant', publication_date: null,
        url: 'https://example.org/corrige.pdf', verification: 'UNVERIFIED',
      },
    });
    assert.equal(teacher.status, 201);
    const archive = await call('GET', '/archive', { cookie: student });
    assert.equal(archive.body.items[0].doc_type, 'TEACHER_CORRECTION');
  });

  test('importing the same monitoring file again changes nothing', async () => {
    const res = await call('POST', '/admin/monitoring/import', { cookie: admin });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.created, []);
    assert.deepEqual(res.body.changed, []);
    assert.equal(res.body.unchanged, 12);
    assert.equal(res.body.run_is_new, false);
  });

  test('the last administrator cannot be demoted', async () => {
    const users = await call('GET', '/admin/users', { cookie: admin });
    const me = users.body.items.find((u: { role: string }) => u.role === 'admin');
    const res = await call('PATCH', `/admin/users/${me.id}/role`, { cookie: admin, body: { role: 'student' } });
    assert.equal(res.status, 409);
  });
});

describe('hosted past papers', () => {
  const upload = (fields: Record<string, string>, bytes: Uint8Array<ArrayBuffer>, name: string) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', new File([bytes], name, { type: 'application/pdf' }));
    return app.request('/api/admin/archive/upload', { method: 'POST', headers: { cookie: admin }, body: form });
  };
  const fields = {
    exam_year: '2021', stream_id: '', subject_id: '', language: 'ar', doc_type: 'SUBJECT',
    title: 'Sujet BAC 2021', source_authority: 'dzexams.com (non officiel)', publication_date: '', verification: 'UNVERIFIED', note: '',
  };
  const pdf = new TextEncoder().encode(['%PDF-1.4', '%fake test document', '%%EOF', ''].join('\n'));

  test('a PDF is stored and served to signed-in students', async () => {
    const res = await upload(fields, pdf, 'BAC 2021 maths.pdf');
    assert.equal(res.status, 201);
    const { id } = (await res.json()) as { id: number };
    const archive = await call('GET', '/archive', { cookie: student });
    const entry = archive.body.items.find((p: { id: number }) => p.id === id);
    assert.equal(entry.url, `/api/archive/${id}/file`);
    assert.equal(entry.file_name, 'BAC 2021 maths.pdf');
    assert.equal(entry.verification, 'UNVERIFIED');
    const file = await app.request(`/api/archive/${id}/file`, { headers: { cookie: student } });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.equal(new TextDecoder().decode(await file.arrayBuffer()).slice(0, 5), '%PDF-');
    assert.equal((await app.request(`/api/archive/${id}/file`)).status, 401, 'files need a session');
  });

  test('a file that is not a PDF is refused', async () => {
    const res = await upload(fields, new TextEncoder().encode('<html>not a pdf</html>'), 'fake.pdf');
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'not_a_pdf');
  });

  test('an uploaded file cannot be filed as an official correction without verification', async () => {
    const res = await upload({ ...fields, doc_type: 'OFFICIAL_CORRECTION' }, pdf, 'corrige.pdf');
    assert.equal(res.status, 409);
  });

  test('a manifest is imported once, with the same rules as the upload form', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bacmaster-import-'));
    try {
      writeFileSync(join(dir, 'maths.pdf'), pdf);
      writeFileSync(join(dir, 'fake.pdf'), '<html>not a pdf</html>');
      const base = {
        exam_year: 2010, stream: 'M', subject: 'MATH', language: 'ar', source_authority: 'ONEFD', note: null,
      };
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify([
          { ...base, file: 'maths.pdf', doc_type: 'OFFICIAL_CORRECTION', title: 'BAC 2010 — Mathématiques — corrigé', verification: 'VERIFIED' },
          { ...base, file: 'maths.pdf', doc_type: 'OFFICIAL_CORRECTION', title: 'Corrigé non vérifié', verification: 'UNVERIFIED' },
          { ...base, file: 'fake.pdf', doc_type: 'SUBJECT', title: 'Faux PDF', verification: 'VERIFIED' },
          { ...base, file: 'maths.pdf', stream: 'XX', doc_type: 'SUBJECT', title: 'Filière inconnue', verification: 'VERIFIED' },
        ]),
      );
      const actor = { id: 'import-test', name: 'Import' };
      const first = importManifest(db, actor, join(dir, 'manifest.json'));
      assert.equal(first.added, 1);
      assert.deepEqual(first.failed.map((f) => f.title), ['Corrigé non vérifié', 'Faux PDF', 'Filière inconnue']);
      const second = importManifest(db, actor, join(dir, 'manifest.json'));
      assert.equal(second.added, 0, 'a second run adds nothing');
      assert.equal(second.skipped, 1);

      const archive = await call('GET', '/archive', { cookie: student });
      const entry = archive.body.items.find((p: { title: string }) => p.title === 'BAC 2010 — Mathématiques — corrigé');
      assert.equal(entry.doc_type, 'OFFICIAL_CORRECTION');
      assert.equal(entry.file_name, 'BAC 2010 Mathématiques corrigé.pdf');
      const file = await app.request(entry.url, { headers: { cookie: student } });
      assert.equal(file.status, 200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('learning', () => {
  let lessonId: number;
  let mathId: number;

  test('AI-written lessons are labelled as such', async () => {
    const subjects = await call('GET', '/learn/subjects', { cookie: student });
    assert.equal(subjects.body.items.length, 1);
    mathId = subjects.body.items[0].subject_id;
    assert.equal(subjects.body.items[0].chapters, 3);
    const detail = await call('GET', `/learn/subjects/${mathId}`, { cookie: student });
    assert.equal(detail.body.chapters.length, 3);
    assert.equal(detail.body.chapters[0].verification, 'UNVERIFIED');
    lessonId = detail.body.chapters[0].lessons[0].id;
    assert.equal(detail.body.chapters[0].lessons[0].provenance, 'AI_GENERATED');
    const lesson = await call('GET', `/learn/lessons/${lessonId}`, { cookie: student });
    assert.match(lesson.body.lesson.body_fr, /u_\{n\+1\}/);
    assert.match(lesson.body.lesson.body_ar, /المتتالية/);
  });

  test('progress is recorded per student', async () => {
    await call('POST', `/learn/lessons/${lessonId}/progress`, { cookie: student, body: { done: true } });
    const subjects = await call('GET', '/learn/subjects', { cookie: student });
    assert.equal(subjects.body.items[0].lessons_done, 1);
  });

  test('a teacher review changes the label and is recorded', async () => {
    const queue = await call('GET', '/admin/proposals', { cookie: admin });
    const proposal = queue.body.items.find((p: { kind: string }) => p.kind === 'REVIEW_CONTENT');
    const ok = await call('POST', `/admin/proposals/${proposal.id}/decide`, { cookie: admin, body: { decision: 'APPROVE' } });
    assert.equal(ok.body.outcome.lessons, 3);
    const lesson = await call('GET', `/learn/lessons/${lessonId}`, { cookie: student });
    assert.equal(lesson.body.lesson.provenance, 'TEACHER_REVIEWED');
    assert.ok(lesson.body.lesson.reviewed_by_name);
  });

  test('editing a lesson creates a new version and keeps the student progress', async () => {
    const res = await call('PUT', `/admin/content/lessons/${lessonId}`, {
      cookie: admin,
      body: { title_fr: 'Titre corrigé', title_ar: 'عنوان مصحح', body_fr: 'Nouveau texte', body_ar: 'نص جديد' },
    });
    assert.equal(res.status, 200);
    assert.notEqual(res.body.id, lessonId);
    assert.equal((await call('GET', `/learn/lessons/${lessonId}`, { cookie: student })).status, 404);
    const fresh = await call('GET', `/learn/lessons/${res.body.id}`, { cookie: student });
    assert.equal(fresh.body.lesson.version, 2);
    assert.equal(fresh.body.lesson.done, true);
  });
});

describe('examination simulator', () => {
  test('corrections stay hidden until the paper is handed in', async () => {
    const exams = await call('GET', '/sim/exams', { cookie: student });
    assert.equal(exams.body.items.length, 1);
    const exam = exams.body.items[0];
    assert.equal(exam.total_points, 20);
    assert.equal(exam.default_duration, null, 'no unverified official duration is preset');

    const detail = await call('GET', `/sim/exams/${exam.id}`, { cookie: student });
    assert.equal(detail.body.exam.exercises.length, 3);
    for (const ex of detail.body.exam.exercises) assert.equal(ex.solution_fr, undefined);

    const started = await call('POST', '/sim/attempts', { cookie: student, body: { exam_id: exam.id, duration_minutes: 210 } });
    assert.equal(started.status, 201);
    const attemptId = started.body.attempt.id;
    const resumed = await call('POST', '/sim/attempts', { cookie: student, body: { exam_id: exam.id, duration_minutes: 60 } });
    assert.equal(resumed.body.resumed, true);
    assert.equal(resumed.body.attempt.id, attemptId);

    const open = await call('GET', `/sim/attempts/${attemptId}`, { cookie: student });
    for (const ex of open.body.exam.exercises) assert.equal(ex.solution_fr, undefined);
    assert.equal((await call('POST', `/sim/attempts/${attemptId}/grade`, { cookie: student, body: { scores: {} } })).status, 409);

    const ids = open.body.exam.exercises.map((e: { id: number }) => e.id);
    const submitted = await call('POST', `/sim/attempts/${attemptId}/submit`, {
      cookie: student,
      body: { answers: { [ids[0]]: 'u1 = 11/3' } },
    });
    assert.equal(submitted.body.attempt.status, 'SUBMITTED');
    const closed = await call('GET', `/sim/attempts/${attemptId}`, { cookie: student });
    for (const ex of closed.body.exam.exercises) assert.ok(ex.solution_fr.length > 50);

    const tooHigh = await call('POST', `/sim/attempts/${attemptId}/grade`, {
      cookie: student,
      body: { scores: { [ids[0]]: 7, [ids[1]]: 9, [ids[2]]: 5 } },
    });
    assert.equal(tooHigh.status, 400);
    const graded = await call('POST', `/sim/attempts/${attemptId}/grade`, {
      cookie: student,
      body: { scores: { [ids[0]]: 4.5, [ids[1]]: 6, [ids[2]]: 5 } },
    });
    assert.equal(graded.body.attempt.score, 15.5);
    assert.equal(graded.body.attempt.max_score, 20);
    assert.equal(graded.body.attempt.status, 'GRADED');
  });

  test("another student cannot read someone else's attempt", async () => {
    const other = await call('POST', '/auth/register', {
      body: { name: 'Autre Élève', email: 'autre@test.local', password: 'motdepasse-4' },
    });
    const mine = await call('GET', '/sim/attempts', { cookie: student });
    const res = await call('GET', `/sim/attempts/${mine.body.items[0].id}`, { cookie: other.cookie });
    assert.equal(res.status, 404);
  });
});

describe('revision planner', () => {
  test('a plan spreads the weekly hours over the chosen days', async () => {
    const res = await call('POST', '/planner', {
      cookie: student,
      body: { hours_per_week: 10, days: [0, 2, 5, 6], session_minutes: 60, weeks: 4 },
    });
    assert.equal(res.status, 201);
    const plan = res.body.plan;
    assert.equal(plan.sessions.length, 40);
    assert.equal(plan.official_weights, true);
    for (const s of plan.sessions) {
      assert.ok([0, 2, 5, 6].includes(new Date(`${s.day}T00:00:00Z`).getUTCDay()));
    }
    const total = plan.weights.reduce((sum: number, w: { sessions: number }) => sum + w.sessions, 0);
    assert.equal(total, 40);
    const toggled = await call('POST', `/planner/sessions/${plan.sessions[0].id}/toggle`, { cookie: student });
    assert.ok(toggled.body.done_at);
  });
});

describe('tutor without an API key', () => {
  test('it answers with platform documents and their provenance, not with generated text', async () => {
    const res = await call('POST', '/tutor/ask', {
      cookie: student,
      body: { question: 'Quand ouvrent les inscriptions au BAC 2027 ?' },
    });
    assert.equal(res.status, 200);
    const events = res.text
      .split('\n\n')
      .filter(Boolean)
      .map((chunk) => {
        const event = /^event: (.*)$/m.exec(chunk)?.[1];
        const data = /^data: (.*)$/m.exec(chunk)?.[1];
        return { event, data: data ? JSON.parse(data) : null };
      });
    const meta = events.find((e) => e.event === 'meta')!;
    assert.equal(meta.data.mode, 'RETRIEVAL_ONLY');
    assert.ok(meta.data.sources.length > 0);
    assert.equal(meta.data.sources[0].kind, 'watch', 'the top document says that nothing is announced yet');
    const done = events.find((e) => e.event === 'done')!;
    assert.equal(done.data.message.mode, 'RETRIEVAL_ONLY');

    const conv = await call('GET', `/tutor/conversations/${meta.data.conversation_id}`, { cookie: student });
    assert.equal(conv.body.messages.length, 2);
    assert.equal(conv.body.messages[0].role, 'user');
  });

  test('a question in Arabic finds the Arabic wording', async () => {
    const res = await call('POST', '/tutor/ask', { cookie: student, body: { question: 'هل تغيرت معاملات المواد في بكالوريا 2027؟' } });
    const meta = JSON.parse(/^data: (.*)$/m.exec(res.text.split('\n\n')[0]!)![1]!);
    const kinds = meta.sources.map((s: { kind: string }) => s.kind);
    assert.ok(kinds.includes('coefficients') || kinds.includes('record') || kinds.includes('claim'));
    assert.match(res.text, /المساعد|وثائق/);
  });
});

describe('audit trail', () => {
  test('staff decisions are logged with the person who took them', async () => {
    const log = await call('GET', '/admin/audit', { cookie: admin });
    const actions = log.body.items.map((e: { action: string }) => e.action);
    for (const expected of ['coefficient.publish_table', 'coefficient.set', 'announcement.publish', 'content.review', 'lesson.new_version']) {
      assert.ok(actions.includes(expected), `missing audit entry ${expected}`);
    }
    const publish = log.body.items.find((e: { action: string }) => e.action === 'coefficient.publish_table');
    assert.equal(publish.actor_name, 'Administrateur');
  });
});

describe('launch safeguards', () => {
  test('an administrator issues a one-time reset link; using it closes the old sessions', async () => {
    const reg = await call('POST', '/auth/register', {
      body: { name: 'Oublieux', email: 'oubli@test.local', password: 'ancien-mot-1', locale: 'ar' },
    });
    const oldSession = reg.cookie!;
    const id = reg.body.user.id as string;
    assert.equal((await call('POST', `/admin/users/${id}/reset-link`, { cookie: student })).status, 403);
    const issued = await call('POST', `/admin/users/${id}/reset-link`, { cookie: admin });
    assert.equal(issued.status, 201);
    const token = issued.body.token as string;

    assert.equal((await call('POST', '/auth/reset', { body: { token: 'x'.repeat(40), password: 'nouveau-mot-1' } })).status, 400);
    const reset = await call('POST', '/auth/reset', { body: { token, password: 'nouveau-mot-1' } });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.user.email, 'oubli@test.local');
    assert.ok(reset.cookie, 'the user is signed in with the new password');
    assert.equal((await call('GET', '/auth/me', { cookie: oldSession })).body.user, null, 'old sessions are closed');

    const again = await call('POST', '/auth/reset', { body: { token, password: 'encore-autre-1' } });
    assert.equal(again.body.error.code, 'reset_invalid', 'a link works once');
    assert.equal((await call('POST', '/auth/login', { body: { email: 'oubli@test.local', password: 'ancien-mot-1' } })).status, 401);
    assert.equal((await call('POST', '/auth/login', { body: { email: 'oubli@test.local', password: 'nouveau-mot-1' } })).status, 200);
  });

  test('the tutor answers a limited number of questions per student per day', async () => {
    const reg = await call('POST', '/auth/register', {
      body: { name: 'Curieux', email: 'curieux@test.local', password: 'curieux-mot-1' },
    });
    const saved = process.env.TUTOR_DAILY_LIMIT;
    process.env.TUTOR_DAILY_LIMIT = '1';
    try {
      const first = await call('POST', '/tutor/ask', { cookie: reg.cookie, body: { question: 'Comment dériver une fonction ?' } });
      assert.equal(first.status, 200);
      const second = await call('POST', '/tutor/ask', { cookie: reg.cookie, body: { question: 'Et une primitive ?' } });
      assert.equal(second.status, 429);
      assert.equal(second.body.error.code, 'daily_limit');
      const staff = await call('POST', '/tutor/ask', { cookie: admin, body: { question: 'Test du personnel' } });
      assert.equal(staff.status, 200, 'staff are not capped');
    } finally {
      if (saved === undefined) delete process.env.TUTOR_DAILY_LIMIT;
      else process.env.TUTOR_DAILY_LIMIT = saved;
    }
  });

  test('the database is copied once a day', () => {
    const file = backupNow(db, dataDir);
    assert.ok(file && existsSync(file));
    assert.equal(backupNow(db, dataDir), null, 'one copy per day');
  });
});

describe('official past papers in the simulator', () => {
  test('an exam file is loaded once, shown to its stream in every session, with official provenance', async () => {
    const file = JSON.parse(readFileSync(resolve('content/exams/bac-2010-maths-M-sujet1.json'), 'utf8'));
    const actor = { id: 'import-test', name: 'Import' };
    const id = importExam(db, actor, file);
    assert.ok(id);
    assert.equal(importExam(db, actor, file), null, 'a second import adds nothing');

    const reg = await call('POST', '/auth/register', { body: { name: 'Matheux', email: 'matheux@test.local', password: 'matheux-mot-1' } });
    const meta = await call('GET', '/meta');
    const streamM = meta.body.streams.find((s: { code: string }) => s.code === 'M').id;
    const edition2028 = meta.body.editions.find((e: { exam_year: number }) => e.exam_year === 2028).id;
    assert.equal((await call('PATCH', '/me', { cookie: reg.cookie, body: { edition_id: edition2028, stream_id: streamM } })).status, 200);
    const list = await call('GET', '/sim/exams', { cookie: reg.cookie });
    assert.ok(list.body.items.some((x: { id: number }) => x.id === id), 'shown to a 2028 student of the stream');

    const exam = await call('GET', `/sim/exams/${id}`, { cookie: reg.cookie });
    assert.equal(exam.status, 200);
    assert.equal(exam.body.exam.kind, 'OFFICIAL_PAST');
    assert.equal(exam.body.exam.provenance, 'OFFICIAL');
    assert.equal(exam.body.exam.total_points, 20);
    assert.equal(exam.body.exam.exercises.length, 4);
  });
});

describe('revision content files', () => {
  test('a lesson file is loaded once, labelled AI-generated and queued for teacher review', async () => {
    const file = JSON.parse(readFileSync(resolve('content/lessons/phys-radioactivite.json'), 'utf8'));
    const actor = { id: 'import-test', name: 'Import' };
    assert.deepEqual(importLessons(db, actor, file), { chapters: 1, lessons: 1, exercises: 1 });
    assert.deepEqual(importLessons(db, actor, file), { chapters: 0, lessons: 0, exercises: 0 }, 'a second import adds nothing');

    const reg = await call('POST', '/auth/register', { body: { name: 'Physicien', email: 'physicien@test.local', password: 'physicien-mot-1' } });
    assert.equal((await call('PATCH', '/me', { cookie: reg.cookie, body: { edition_id: editionId, stream_id: streamSE } })).status, 200);
    const subjects = await call('GET', '/learn/subjects', { cookie: reg.cookie });
    const phys = subjects.body.items.find((s: { name_fr: string }) => s.name_fr === 'Sciences physiques');
    assert.ok(phys, 'shown to a sciences student');
    const detail = await call('GET', `/learn/subjects/${phys.subject_id}`, { cookie: reg.cookie });
    assert.match(JSON.stringify(detail.body), /AI_GENERATED/);
    const review = await call('GET', '/admin/proposals', { cookie: admin });
    assert.match(JSON.stringify(review.body), /Sciences physiques/);
  });
});
