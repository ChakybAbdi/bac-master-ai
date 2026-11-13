import type { Provenance, TutorSource, User, Verification } from '../shared/types.ts';
import { tableRows } from './academic.ts';
import { all, get, type DB } from './db.ts';
import { parseJson } from './util.ts';

/**
 * The tutor's knowledge base. It is assembled from the database on each
 * question, so it can never be staler than what the platform itself shows:
 * official records, the calendar, checked rumours, published announcements,
 * the stream's coefficient table and the lessons for the student's stream.
 * Every document keeps its provenance, which the tutor must surface.
 */
export interface KbDoc {
  id: string;
  /** 'watch' marks a monitoring status line ("nothing announced yet"), which is not an official text. */
  kind: 'record' | 'calendar' | 'watch' | 'claim' | 'announcement' | 'coefficients' | 'lesson' | 'exercise';
  provenance: Provenance;
  verification: Verification | null;
  title_fr: string;
  title_ar: string;
  text_fr: string;
  text_ar: string;
  /** Extra text used for matching only (for instance the English wording of a monitoring record). */
  extra: string;
  url: string | null;
  date: string | null;
}

const STOPWORDS = new Set(
  [
    // French
    'le la les de des du un une et en au aux est sont pour par sur dans que qui quoi quel quelle quels quelles ce cet cette ces',
    'il elle on nous vous je tu mon ma mes ton ta son sa ses ne pas plus se ou avec sans comment quand etre avoir ai as ont',
    'the an of to in is are for and or on what when how does do',
    // Arabic (already normalised)
    'في من علي الي عن ما هل هو هي هذا هذه ذلك التي الذي او ثم ان كان لا لم لن كيف متي اين ماذا هناك مع بين قد كل يكون تكون',
  ]
    .join(' ')
    .split(/\s+/),
);

/** Lower-cases, strips Latin accents and Arabic vowel marks, and unifies Arabic letter variants. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

function stem(token: string): string {
  if (/^[؀-ۿ]+$/.test(token)) {
    let t = token;
    // Conjunction or preposition + definite article, then the bare article.
    t = t.replace(/^[وفبكل]?ال(?=.{3,})/, '');
    t = t.replace(/^لل(?=.{3,})/, '');
    // Common plural endings.
    if (t.length > 5) t = t.replace(/(ات|ون|ين)$/, '');
    return t;
  }
  return token.length > 3 ? token.replace(/[sx]$/, '') : token;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of normalize(text).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    const token = stem(raw);
    if (token.length >= 2 && !STOPWORDS.has(token)) out.push(token);
  }
  return out;
}

export interface Hit {
  doc: KbDoc;
  score: number;
}

/** BM25 ranking over the assembled documents. Title terms count twice. */
export function search(docs: KbDoc[], query: string, limit = 6): Hit[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || docs.length === 0) return [];
  const k1 = 1.4;
  const b = 0.75;
  const bags = docs.map((doc) => {
    const title = tokenize(`${doc.title_fr} ${doc.title_ar}`);
    const body = tokenize(`${doc.text_fr} ${doc.text_ar} ${doc.extra}`);
    const tf = new Map<string, number>();
    for (const t of title) tf.set(t, (tf.get(t) ?? 0) + 2);
    for (const t of body) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { tf, length: title.length * 2 + body.length };
  });
  const avgLength = bags.reduce((sum, bag) => sum + bag.length, 0) / bags.length || 1;
  const hits: Hit[] = [];
  const idf = new Map<string, number>();
  for (const term of terms) {
    const df = bags.reduce((n, bag) => n + (bag.tf.has(term) ? 1 : 0), 0);
    idf.set(term, Math.log(1 + (bags.length - df + 0.5) / (df + 0.5)));
  }
  bags.forEach((bag, i) => {
    let score = 0;
    for (const term of terms) {
      const f = bag.tf.get(term);
      if (!f) continue;
      score += (idf.get(term)! * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * bag.length) / avgLength));
    }
    if (score > 0) hits.push({ doc: docs[i]!, score });
  });
  return hits.sort((x, y) => y.score - x.score).slice(0, limit);
}

const SUPERSEDED_FR = "Statut : remplacé ou gelé. Ce texte n'est plus applicable.";
const SUPERSEDED_AR = 'الوضعية: ملغى أو مجمد. هذا النص لم يعد ساري المفعول.';

interface RecordRow {
  id: string;
  topic: string;
  document_title: string | null;
  original_url: string | null;
  publication_date: string | null;
  last_verified: string | null;
  examination_year: string | null;
  new_value: string | null;
  verification: Verification;
  change_status: string;
  title_fr: string | null;
  title_ar: string | null;
  summary_fr: string | null;
  summary_ar: string | null;
  impact_fr: string | null;
  impact_ar: string | null;
}

export function buildKb(db: DB, user: User): KbDoc[] {
  const docs: KbDoc[] = [];

  for (const r of all<RecordRow>(
    db,
    `SELECT id, topic, document_title, original_url, publication_date, last_verified, examination_year, new_value,
            verification, change_status, title_fr, title_ar, summary_fr, summary_ar, impact_fr, impact_ar
       FROM official_records WHERE visibility = 'PUBLISHED'`,
  )) {
    const superseded = r.change_status === 'SUPERSEDED';
    docs.push({
      id: `record:${r.id}`,
      kind: 'record',
      provenance: 'OFFICIAL',
      verification: r.verification,
      title_fr: r.title_fr ?? r.document_title ?? r.topic,
      title_ar: r.title_ar ?? r.document_title ?? r.topic,
      text_fr: [r.summary_fr, r.impact_fr, superseded ? SUPERSEDED_FR : null].filter(Boolean).join(' '),
      text_ar: [r.summary_ar, r.impact_ar, superseded ? SUPERSEDED_AR : null].filter(Boolean).join(' '),
      extra: [r.topic, r.examination_year, r.new_value].filter(Boolean).join(' '),
      url: r.original_url,
      date: r.publication_date ?? r.last_verified,
    });
  }

  if (user.edition_id) {
    const events = all<{
      id: number;
      title_fr: string;
      title_ar: string;
      dates_fr: string | null;
      dates_ar: string | null;
      audience_fr: string | null;
      audience_ar: string | null;
      note_fr: string | null;
      note_ar: string | null;
      status: string;
      starts_on: string | null;
      original_url: string | null;
      verification: Verification | null;
      last_verified: string | null;
    }>(
      db,
      `SELECT e.id, e.title_fr, e.title_ar, e.dates_fr, e.dates_ar, e.audience_fr, e.audience_ar, e.note_fr, e.note_ar,
              e.status, e.starts_on, r.original_url, r.verification, r.last_verified
         FROM calendar_events e LEFT JOIN official_records r ON r.id = e.record_id
        WHERE e.edition_id = ? AND e.state = 'PUBLISHED'`,
      user.edition_id,
    );
    for (const e of events) {
      const announced = e.status !== 'NOT_ANNOUNCED';
      docs.push({
        id: `calendar:${e.id}`,
        kind: announced ? 'calendar' : 'watch',
        provenance: 'OFFICIAL',
        verification: announced ? (e.verification ?? null) : null,
        title_fr: e.title_fr,
        title_ar: e.title_ar,
        text_fr: [
          announced ? `Dates : ${e.dates_fr ?? ''}.` : 'Aucune date officielle annoncée à la dernière vérification des sources officielles.',
          e.audience_fr ? `Public concerné : ${e.audience_fr}.` : null,
          e.note_fr,
        ]
          .filter(Boolean)
          .join(' '),
        text_ar: [
          announced ? `التواريخ: ${e.dates_ar ?? ''}.` : 'لم يعلن عن أي تاريخ رسمي عند آخر تحقق من المصادر الرسمية.',
          e.audience_ar ? `المعنيون: ${e.audience_ar}.` : null,
          e.note_ar,
        ]
          .filter(Boolean)
          .join(' '),
        extra: '',
        url: e.original_url,
        date: announced ? e.starts_on : e.last_verified,
      });
    }
  }

  for (const cl of all<{
    id: number;
    claim_fr: string;
    claim_ar: string;
    finding_fr: string;
    finding_ar: string;
    checked_on: string;
  }>(db, "SELECT id, claim_fr, claim_ar, finding_fr, finding_ar, checked_on FROM claims WHERE state = 'PUBLISHED'")) {
    docs.push({
      id: `claim:${cl.id}`,
      kind: 'claim',
      provenance: 'UNVERIFIED',
      verification: 'UNVERIFIED',
      title_fr: `Rumeur vérifiée : ${cl.claim_fr}`,
      title_ar: `إشاعة تم التحقق منها: ${cl.claim_ar}`,
      text_fr: cl.finding_fr,
      text_ar: cl.finding_ar,
      extra: '',
      url: null,
      date: cl.checked_on,
    });
  }

  for (const a of all<{
    id: number;
    title_fr: string;
    title_ar: string;
    body_fr: string;
    body_ar: string;
    published_at: string | null;
    original_url: string | null;
    verification: Verification | null;
  }>(
    db,
    `SELECT a.id, a.title_fr, a.title_ar, a.body_fr, a.body_ar, a.published_at, r.original_url, r.verification
       FROM announcements a LEFT JOIN official_records r ON r.id = a.record_id
      WHERE a.status = 'PUBLISHED' AND (a.edition_id IS NULL OR a.edition_id = ?) AND (a.stream_id IS NULL OR a.stream_id = ?)`,
    user.edition_id,
    user.stream_id,
  )) {
    docs.push({
      id: `announcement:${a.id}`,
      kind: 'announcement',
      provenance: 'OFFICIAL',
      verification: a.verification,
      title_fr: a.title_fr,
      title_ar: a.title_ar,
      text_fr: a.body_fr,
      text_ar: a.body_ar,
      extra: '',
      url: a.original_url,
      date: a.published_at?.slice(0, 10) ?? null,
    });
  }

  if (user.edition_id && user.stream_id) {
    const stream = get<{ name_fr: string; name_ar: string }>(
      db,
      'SELECT name_fr, name_ar FROM streams WHERE id = ?',
      user.stream_id,
    );
    const edition = get<{ exam_year: number }>(db, 'SELECT exam_year FROM editions WHERE id = ?', user.edition_id);
    const rows = tableRows(db, user.edition_id, user.stream_id, 'PUBLISHED');
    if (stream && edition && rows.length > 0) {
      const verification = rows[0]!.verification;
      docs.push({
        id: `coefficients:${user.edition_id}:${user.stream_id}`,
        kind: 'coefficients',
        provenance: verification === 'UNVERIFIED' ? 'UNVERIFIED' : 'OFFICIAL',
        verification,
        title_fr: `Matières et coefficients, filière ${stream.name_fr}, BAC ${edition.exam_year}`,
        title_ar: `المواد والمعاملات، شعبة ${stream.name_ar}، بكالوريا ${edition.exam_year}`,
        text_fr: rows
          .map((r) => `${r.name_fr} : coefficient ${r.coefficient}${r.is_optional ? ' (matière facultative)' : ''}`)
          .join(' ; '),
        text_ar: rows
          .map((r) => `${r.name_ar}: المعامل ${r.coefficient}${r.is_optional ? ' (مادة اختيارية)' : ''}`)
          .join(' ؛ '),
        extra: rows[0]!.source_note ?? '',
        url: null,
        date: rows[0]!.verified_at?.slice(0, 10) ?? null,
      });
    } else if (stream && edition) {
      docs.push({
        id: `coefficients-pending:${user.edition_id}:${user.stream_id}`,
        kind: 'watch',
        provenance: 'OFFICIAL',
        verification: null,
        title_fr: `Coefficients de la filière ${stream.name_fr}, BAC ${edition.exam_year} : en attente de vérification`,
        title_ar: `معاملات شعبة ${stream.name_ar}، بكالوريا ${edition.exam_year}: في انتظار التحقق`,
        text_fr:
          "La plateforme n'a pas encore publié la table des matières et coefficients de cette filière : les valeurs n'ont pas été vérifiées par un enseignant sur le texte officiel. Les coefficients exacts sont à demander à l'établissement.",
        text_ar:
          'لم تنشر المنصة بعد جدول مواد ومعاملات هذه الشعبة: لم يتحقق أستاذ من القيم بالرجوع إلى النص الرسمي. تطلب المعاملات الدقيقة من المؤسسة التعليمية.',
        extra: 'coefficients coefficient matieres subjects',
        url: null,
        date: null,
      });
    }
  }

  if (user.edition_id) {
    const lessons = all<{
      id: number;
      title_fr: string;
      title_ar: string;
      body_fr: string;
      body_ar: string;
      provenance: Provenance;
      chapter_fr: string;
      chapter_ar: string;
      subject_fr: string;
      subject_ar: string;
    }>(
      db,
      `SELECT l.id, l.title_fr, l.title_ar, l.body_fr, l.body_ar, l.provenance,
              c.title_fr AS chapter_fr, c.title_ar AS chapter_ar, s.name_fr AS subject_fr, s.name_ar AS subject_ar
         FROM lessons l
         JOIN chapters c ON c.id = l.chapter_id
         JOIN subjects s ON s.id = c.subject_id
        WHERE l.state = 'ACTIVE' AND c.state = 'ACTIVE' AND c.edition_id = ?
          AND (? IS NULL OR EXISTS (SELECT 1 FROM chapter_streams cs WHERE cs.chapter_id = c.id AND cs.stream_id = ?))`,
      user.edition_id,
      user.stream_id,
      user.stream_id,
    );
    for (const l of lessons) {
      docs.push({
        id: `lesson:${l.id}`,
        kind: 'lesson',
        provenance: l.provenance,
        verification: null,
        title_fr: `${l.subject_fr}, ${l.chapter_fr} : ${l.title_fr}`,
        title_ar: `${l.subject_ar}، ${l.chapter_ar}: ${l.title_ar}`,
        text_fr: l.body_fr,
        text_ar: l.body_ar,
        extra: '',
        url: null,
        date: null,
      });
    }
  }

  return docs;
}

/** One exercise with its solution, added to the context when the student asks about it. */
export function exerciseDoc(db: DB, exerciseId: number): KbDoc | null {
  const e = get<{
    id: number;
    title_fr: string;
    title_ar: string;
    statement_fr: string;
    statement_ar: string;
    solution_fr: string;
    solution_ar: string;
    solution_provenance: Provenance;
  }>(
    db,
    'SELECT id, title_fr, title_ar, statement_fr, statement_ar, solution_fr, solution_ar, solution_provenance FROM exercises WHERE id = ?',
    exerciseId,
  );
  if (!e) return null;
  return {
    id: `exercise:${e.id}`,
    kind: 'exercise',
    provenance: e.solution_provenance,
    verification: null,
    title_fr: e.title_fr,
    title_ar: e.title_ar,
    text_fr: `Énoncé :\n${e.statement_fr}\n\nCorrigé :\n${e.solution_fr}`,
    text_ar: `النص:\n${e.statement_ar}\n\nالحل:\n${e.solution_ar}`,
    extra: '',
    url: null,
    date: null,
  };
}

function excerpt(text: string, max = 260): string {
  const plain = text.replace(/\$\$?/g, '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}

export function toSources(docs: KbDoc[]): TutorSource[] {
  return docs.map((doc, i) => ({
    n: i + 1,
    kind: doc.kind,
    provenance: doc.provenance,
    verification: doc.verification,
    title_fr: doc.title_fr,
    title_ar: doc.title_ar,
    excerpt_fr: excerpt(doc.text_fr),
    excerpt_ar: excerpt(doc.text_ar),
    url: doc.url,
    date: doc.date,
  }));
}

export function parseSources(value: unknown): TutorSource[] {
  return parseJson<TutorSource[]>(value, []);
}
