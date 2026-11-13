import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hashPassword, verifyPassword } from '../auth.ts';
import { search, tokenize, type KbDoc } from '../kb.ts';
import { parseRecord } from '../monitoring.ts';
import { allocate, buildPlan } from '../planner.ts';
import { buildUserContent, localReminder, provider, questionLanguage } from '../tutor.ts';
import { addDays, daysBetween, todayInAlgiers, weekday } from '../util.ts';

const doc = (id: string, over: Partial<KbDoc>): KbDoc => ({
  id,
  kind: 'record',
  provenance: 'OFFICIAL',
  verification: 'VERIFIED',
  title_fr: '',
  title_ar: '',
  text_fr: '',
  text_ar: '',
  extra: '',
  url: null,
  date: null,
  ...over,
});

describe('passwords', () => {
  test('a hash verifies only the password it was made from', async () => {
    const hash = await hashPassword('motdepasse-1');
    assert.match(hash, /^scrypt\$16384\$8\$1\$/);
    assert.equal(await verifyPassword('motdepasse-1', hash), true);
    assert.equal(await verifyPassword('motdepasse-2', hash), false);
    assert.equal(await verifyPassword('motdepasse-1', 'not-a-hash'), false);
  });
});

describe('dates', () => {
  test('day arithmetic works across months and years', () => {
    assert.equal(addDays('2026-12-30', 5), '2027-01-04');
    assert.equal(daysBetween('2026-11-11', '2026-12-06'), 25);
    assert.equal(weekday('2027-06-07'), 1, '7 June 2027 is a Monday');
    assert.equal(weekday('2026-06-07'), 0, '7 June 2026 was a Sunday');
    assert.match(todayInAlgiers(new Date('2026-11-10T23:30:00Z')), /^2026-11-11$/);
  });
});

describe('search', () => {
  test('French and Arabic words are normalised to the same stems', () => {
    assert.deepEqual(tokenize('Les inscriptions au baccalauréat'), ['inscription', 'baccalaureat']);
    assert.deepEqual(tokenize('التسجيلات في البكالوريا'), tokenize('تسجيل بكالوريا'));
    assert.deepEqual(tokenize('المعاملات'), tokenize('معامل'));
    assert.deepEqual(tokenize('مُعَامَلات'), tokenize('معاملات'), 'vowel marks are ignored');
  });

  test('the most relevant document comes first', () => {
    const docs = [
      doc('a', { title_fr: 'Calendrier des vacances scolaires', text_fr: 'Vacances de printemps du 18 mars au 4 avril.' }),
      doc('b', { title_fr: 'Inscriptions au BAC 2027', text_fr: "Aucune période d'inscription annoncée.", title_ar: 'التسجيلات في بكالوريا 2027' }),
      doc('c', { title_fr: 'Coefficients', text_fr: 'Les coefficients restent ceux du cadre en vigueur.' }),
    ];
    assert.equal(search(docs, 'quand ouvrent les inscriptions ?')[0]?.doc.id, 'b');
    assert.equal(search(docs, 'متى تفتح التسجيلات؟')[0]?.doc.id, 'b');
    assert.equal(search(docs, 'coefficient de maths')[0]?.doc.id, 'c');
    assert.deepEqual(search(docs, 'zzz'), []);
  });
});

describe('monitoring records', () => {
  test('verification, status and priority labels are split from their notes', () => {
    const rec = parseRecord({
      id: 'X-1',
      topic: 'Test',
      verification_status: 'PARTIALLY VERIFIED (title checked; text not opened)',
      status: 'SUPERSEDED (frozen); primary part stands',
      priority: 'HIGH (watch)',
      new_value: { a: 1 },
      superseded_by: ['X-2'],
      related_url: 'https://example.org/a',
    });
    assert.equal(rec.verification, 'PARTIALLY_VERIFIED');
    assert.equal(rec.verification_note, 'title checked; text not opened');
    assert.equal(rec.change_status, 'SUPERSEDED');
    assert.equal(rec.priority, 'HIGH');
    assert.equal(rec.priority_note, 'watch');
    assert.equal(rec.new_value, '{\n  "a": 1\n}');
    assert.deepEqual(rec.superseded_by, ['X-2']);
    assert.deepEqual(rec.related_urls, ['https://example.org/a']);
  });

  test('"UNVERIFIED" is never read as "VERIFIED"', () => {
    assert.equal(parseRecord({ id: 'X', verification_status: 'UNVERIFIED (claimed dates)' }).verification, 'UNVERIFIED');
    assert.equal(parseRecord({ id: 'X', verification_status: 'VERIFIED' }).verification, 'VERIFIED');
    assert.equal(parseRecord({ id: 'X' }).verification, 'UNVERIFIED', 'a missing level is treated as unverified');
  });
});

describe('revision planner', () => {
  const subjects = [
    { subject_id: 1, coefficient: 6, level: 2, chapters: [10, 11] },
    { subject_id: 2, coefficient: 5, level: 3, chapters: [] },
    { subject_id: 3, coefficient: 2, level: 5, chapters: [] },
    { subject_id: 4, coefficient: 1, level: null, chapters: [] },
  ];

  test('sessions follow coefficient and need, and every subject is covered', () => {
    const weights = allocate(subjects, 40);
    assert.equal(weights.reduce((sum, w) => sum + w.sessions, 0), 40);
    const by = Object.fromEntries(weights.map((w) => [w.subject_id, w.sessions]));
    assert.ok(by[1]! > by[2]! && by[2]! > by[3]!);
    assert.ok(by[4]! >= 1);
  });

  test('a plan is deterministic and stays inside its window', () => {
    const params = { hours_per_week: 6, days: [0, 3, 5], session_minutes: 90, weeks: 3, start: '2026-11-15' };
    const a = buildPlan(params, subjects);
    const b = buildPlan(params, subjects);
    assert.deepEqual(a, b);
    assert.equal(a.sessions.length, 12);
    for (const s of a.sessions) {
      assert.ok(s.day >= '2026-11-15' && s.day <= '2026-12-05');
      assert.ok([0, 3, 5].includes(weekday(s.day)));
      assert.equal(s.minutes, 90);
    }
    const first = a.sessions.filter((s) => s.subject_id === 1);
    assert.equal(first[0]?.focus, 'LESSON');
    assert.equal(first[0]?.chapter_id, 10);
    assert.equal(first[1]?.focus, 'EXERCISES');
    assert.equal(first[1]?.chapter_id, 10, 'the exercise session follows its lesson');
  });

  test('no subjects or no days gives an empty plan', () => {
    assert.deepEqual(buildPlan({ hours_per_week: 5, days: [1], session_minutes: 60, weeks: 2, start: '2026-11-15' }, []).sessions, []);
    assert.deepEqual(buildPlan({ hours_per_week: 5, days: [], session_minutes: 60, weeks: 2, start: '2026-11-15' }, subjects).sessions, []);
  });
});

describe('tutor prompt', () => {
  test('context documents carry their class and the question language is detected', () => {
    assert.equal(questionLanguage('Explique-moi les suites'), 'fr');
    assert.equal(questionLanguage('اشرح لي المتتاليات'), 'ar');
    const content = buildUserContent(
      'Session: BAC 2027',
      [
        doc('a', { title_fr: 'Arrêté n° 36', text_fr: 'Abrogation.', url: 'https://www.education.gov.dz/?p=4396', date: '2026-09-10' }),
        doc('b', { kind: 'watch', verification: null, title_fr: 'Inscriptions', text_fr: 'Aucune date.' }),
        doc('c', { kind: 'claim', provenance: 'UNVERIFIED', verification: 'UNVERIFIED', title_fr: 'Rumeur', text_fr: 'Non confirmé.' }),
      ],
      'Les coefficients ont-ils changé ?',
    );
    assert.match(content, /\[1\] class=OFFICIAL verification=VERIFIED kind=record date=2026-09-10 source=https:\/\/www\.education\.gov\.dz\/\?p=4396/);
    assert.match(content, /\[2\] class=MONITORING kind=watch/);
    assert.match(content, /\[3\] class=UNVERIFIED verification=UNVERIFIED kind=claim/);
    assert.match(content, /<question>\nLes coefficients ont-ils changé \?\n<\/question>/);
  });

  test('a local model is reminded of the language and of what the context can support', () => {
    const official = buildUserContent('p', [doc('a', { title_ar: 'قرار', text_ar: 'نص' })], 'هل تغيرت المعاملات؟');
    assert.match(localReminder(official), /Arabic/);
    assert.match(localReminder(official), /holds 1 OFFICIAL document/);
    const none = buildUserContent('p', [doc('b', { kind: 'watch', verification: null })], "Quand est l'examen ?");
    assert.match(localReminder(none), /French/);
    assert.match(localReminder(none), /NO OFFICIAL document/);
  });

  test('the provider follows the configuration', () => {
    const saved = { ...process.env };
    try {
      for (const k of ['TUTOR_PROVIDER', 'OLLAMA_MODEL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE']) delete process.env[k];
      assert.equal(provider(), 'none');
      process.env.OLLAMA_MODEL = 'qwen3.5:9b';
      assert.equal(provider(), 'local');
      process.env.ANTHROPIC_API_KEY = 'x';
      assert.equal(provider(), 'anthropic', 'a Claude key wins when nothing is forced');
      process.env.TUTOR_PROVIDER = 'local';
      assert.equal(provider(), 'local');
      process.env.TUTOR_PROVIDER = 'none';
      assert.equal(provider(), 'none');
    } finally {
      process.env = saved;
    }
  });
});
