import type { ClaimVerdict, EventKind, EventStatus, Priority, ProposalKind } from '../shared/types.ts';
import { audit, get, getSetting, run, setSetting, tx, type DB } from './db.ts';
import { importMonitoring } from './monitoring.ts';
import { MATH_CHAPTERS, MATH_EXAM } from './seed-content.ts';
import { nowIso } from './util.ts';

/**
 * First-run data.
 *
 * Seeding policy:
 *  - Official records and calendar dates that were verified on the original
 *    documents are published, each with its source.
 *  - Anything that still needs a human decision is NOT published. It is stored
 *    as provisional and placed in the review queue: coefficient tables (the
 *    values below were entered from memory and never checked against the
 *    official text), announcements to students, and AI-written content review.
 *  - No BAC 2027 registration, examination or results date is seeded, because
 *    none has been officially announced.
 */

const BASELINE_CHECK = '2026-11-10';

// --- Reference data ---------------------------------------------------------

const EDITIONS = [
  {
    exam_year: 2026,
    school_year: '2025-2026',
    status: 'ARCHIVED',
    note_fr: 'Session passée, conservée comme repère. Ses dates et ses règles ne valent pas pour les sessions suivantes.',
    note_ar: 'دورة سابقة محفوظة كمرجع. تواريخها وقواعدها لا تسري على الدورات الموالية.',
  },
  { exam_year: 2027, school_year: '2026-2027', status: 'ACTIVE', note_fr: null, note_ar: null },
  {
    exam_year: 2028,
    school_year: '2027-2028',
    status: 'UPCOMING',
    note_fr: "Aucune information officielle propre à cette session n'a encore été publiée.",
    note_ar: 'لم تنشر بعد أي معلومة رسمية خاصة بهذه الدورة.',
  },
] as const;

const STREAM_NOTE_FR =
  "Désignation d'usage. La liste officielle des filières (arrêté n° 37 du 14 avril 2022 modifié) n'a pas été consultée.";
const STREAM_NOTE_AR = 'تسمية متداولة. لم يتم الاطلاع على القائمة الرسمية للشعب (القرار رقم 37 المؤرخ في 14 أفريل 2022 المعدل).';

const STREAMS = [
  { code: 'SE', name_fr: 'Sciences expérimentales', name_ar: 'علوم تجريبية' },
  { code: 'M', name_fr: 'Mathématiques', name_ar: 'رياضيات' },
  { code: 'TM', name_fr: 'Technique mathématique', name_ar: 'تقني رياضي' },
  { code: 'GE', name_fr: 'Gestion et économie', name_ar: 'تسيير واقتصاد' },
  { code: 'LP', name_fr: 'Lettres et philosophie', name_ar: 'آداب وفلسفة' },
  { code: 'LE', name_fr: 'Langues étrangères', name_ar: 'لغات أجنبية' },
  { code: 'ARTS', name_fr: 'Arts', name_ar: 'فنون' },
] as const;

const SUBJECTS = [
  { code: 'MATH', name_fr: 'Mathématiques', name_ar: 'الرياضيات' },
  { code: 'PHYS', name_fr: 'Sciences physiques', name_ar: 'العلوم الفيزيائية' },
  { code: 'SNV', name_fr: 'Sciences de la nature et de la vie', name_ar: 'علوم الطبيعة والحياة' },
  { code: 'TECH', name_fr: 'Technologie', name_ar: 'التكنولوجيا' },
  { code: 'GEST', name_fr: 'Gestion comptable et financière', name_ar: 'التسيير المحاسبي والمالي' },
  { code: 'ECO', name_fr: 'Économie et management', name_ar: 'الاقتصاد والمناجمنت' },
  { code: 'DROIT', name_fr: 'Droit', name_ar: 'القانون' },
  { code: 'ARAB', name_fr: 'Langue et littérature arabes', name_ar: 'اللغة العربية وآدابها' },
  { code: 'PHILO', name_fr: 'Philosophie', name_ar: 'الفلسفة' },
  { code: 'HG', name_fr: 'Histoire et géographie', name_ar: 'التاريخ والجغرافيا' },
  { code: 'FR', name_fr: 'Langue française', name_ar: 'اللغة الفرنسية' },
  { code: 'EN', name_fr: 'Langue anglaise', name_ar: 'اللغة الإنجليزية' },
  { code: 'LV3', name_fr: 'Troisième langue étrangère', name_ar: 'اللغة الأجنبية الثالثة' },
  { code: 'ISLAM', name_fr: 'Sciences islamiques', name_ar: 'العلوم الإسلامية' },
  { code: 'TAMAZIGHT', name_fr: 'Langue amazighe', name_ar: 'اللغة الأمازيغية' },
  { code: 'EPS', name_fr: 'Éducation physique et sportive', name_ar: 'التربية البدنية والرياضية' },
  { code: 'ARTS', name_fr: 'Arts', name_ar: 'الفنون' },
] as const;

/**
 * Provisional tables: subject code, coefficient, optional flag.
 * UNVERIFIED. These are the commonly cited values of the framework that
 * predates July 2026, typed from memory. They stay hidden from students until
 * a teacher has checked them against the official text and published them.
 * No table is proposed for the Arts stream.
 */
const PROVISIONAL_TABLES: Record<string, [string, number, boolean?][]> = {
  SE: [['SNV', 6], ['PHYS', 5], ['MATH', 5], ['ARAB', 3], ['FR', 2], ['EN', 2], ['PHILO', 2], ['HG', 2], ['ISLAM', 2], ['EPS', 1], ['TAMAZIGHT', 2, true]],
  M: [['MATH', 7], ['PHYS', 6], ['SNV', 2], ['ARAB', 3], ['FR', 2], ['EN', 2], ['PHILO', 2], ['HG', 2], ['ISLAM', 2], ['EPS', 1], ['TAMAZIGHT', 2, true]],
  TM: [['TECH', 7], ['MATH', 6], ['PHYS', 6], ['ARAB', 3], ['FR', 2], ['EN', 2], ['PHILO', 2], ['HG', 2], ['ISLAM', 2], ['EPS', 1], ['TAMAZIGHT', 2, true]],
  GE: [['GEST', 6], ['ECO', 5], ['MATH', 5], ['HG', 4], ['ARAB', 3], ['DROIT', 2], ['FR', 2], ['EN', 2], ['PHILO', 2], ['ISLAM', 2], ['EPS', 1], ['TAMAZIGHT', 2, true]],
  LP: [['ARAB', 6], ['PHILO', 6], ['HG', 4], ['FR', 3], ['EN', 3], ['MATH', 2], ['ISLAM', 2], ['EPS', 1], ['TAMAZIGHT', 2, true]],
  LE: [['ARAB', 5], ['FR', 5], ['EN', 5], ['LV3', 4], ['HG', 3], ['PHILO', 2], ['MATH', 2], ['ISLAM', 2], ['EPS', 1], ['TAMAZIGHT', 2, true]],
};

const PROVISIONAL_NOTE =
  "Valeur d'usage du cadre antérieur à juillet 2026, saisie de mémoire. Non vérifiée sur le texte officiel (arrêté n° 186 du 23 mars 2006 modifié).";

// --- Student-facing wording for the baseline monitoring records --------------
// French and Arabic summaries of verified official documents. They add no
// interpretation; the original document remains the reference.

interface RecordText {
  title_fr: string;
  title_ar: string;
  summary_fr: string;
  summary_ar: string;
  impact_fr?: string;
  impact_ar?: string;
}

const RECORD_TEXT: Record<string, RecordText> = {
  'BAC-REC-0001': {
    title_fr: "Arrêté n° 36 du 9 septembre 2026 : abrogation de l'arrêté n° 20 sur les horaires et coefficients",
    title_ar: 'القرار رقم 36 المؤرخ في 9 سبتمبر 2026: إلغاء القرار رقم 20 المتعلق بالمواقيت والمعاملات',
    summary_fr:
      "L'arrêté n° 36 abroge l'arrêté n° 20 du 28 juillet 2026 relatif aux horaires et coefficients de l'enseignement secondaire général et technologique (article 1), ainsi que les circulaires prises pour son application (article 2). Les dispositions de l'arrêté n° 186 du 23 mars 2006 restent en vigueur (article 3).",
    summary_ar:
      'يلغي القرار رقم 36 القرار رقم 20 المؤرخ في 28 جويلية 2026 المتضمن المواقيت والمعاملات لمرحلة التعليم الثانوي العام والتكنولوجي (المادة الأولى)، وكذا المناشير الصادرة تطبيقا له (المادة 2). وتبقى أحكام القرار رقم 186 المؤرخ في 23 مارس 2006 سارية المفعول (المادة 3).',
    impact_fr: "Les changements de matières et de coefficients annoncés en juillet 2026 ne s'appliquent pas au BAC 2027.",
    impact_ar: 'التغييرات في المواد والمعاملات المعلن عنها في جويلية 2026 لا تطبق على بكالوريا 2027.',
  },
  'BAC-REC-0002': {
    title_fr: 'Communiqué du 16 septembre 2026 : gel des dispositions pédagogiques de juillet 2026',
    title_ar: 'بيان 16 سبتمبر 2026: تجميد الترتيبات البيداغوجية لشهر جويلية 2026',
    summary_fr:
      "À l'exception des dispositions concernant l'enseignement primaire, toutes les dispositions adoptées en juillet 2026 sont gelées par décision du Conseil des ministres du 6 septembre 2026, jusqu'à leur approbation par le Conseil des ministres. Aucune disposition concernant le secteur n'est adoptée sans cette approbation.",
    summary_ar:
      'باستثناء الترتيبات الخاصة بالتعليم الابتدائي، تم تجميد كل الترتيبات المتخذة في جويلية 2026 بقرار من مجلس الوزراء المنعقد في 6 سبتمبر 2026، إلى غاية المصادقة عليها في مجلس الوزراء. ولا يعتمد أي ترتيب يخص القطاع دون هذه المصادقة.',
    impact_fr: "Aucun changement de l'organisation des matières du secondaire pour l'année scolaire 2026-2027.",
    impact_ar: 'لا تغيير في تنظيم مواد التعليم الثانوي للسنة الدراسية 2026-2027.',
  },
  'BAC-REC-0003': {
    title_fr: 'Dispositions pédagogiques de juillet 2026 pour le secondaire (non applicables)',
    title_ar: 'الترتيبات البيداغوجية لشهر جويلية 2026 الخاصة بالتعليم الثانوي (غير مطبقة)',
    summary_fr:
      "Annoncées les 29 et 30 juillet 2026 : maintien du tronc commun pour 2026-2027, transfert de certains contenus vers les 1re et 2e années, volume horaire renforcé pour les matières essentielles en 3e année, ajout de l'informatique en 3e année pour les filières Mathématiques et « هندسة » (anciennement Technique mathématique). Pour le secondaire, ces dispositions ont été abrogées ou gelées en septembre 2026.",
    summary_ar:
      'أعلن عنها يومي 29 و30 جويلية 2026: الإبقاء على الجذع المشترك للسنة الدراسية 2026-2027، تحويل بعض المحتويات إلى السنتين الأولى والثانية، تدعيم الحجم الساعي للمواد الأساسية في السنة الثالثة، وإدراج الإعلام الآلي في السنة الثالثة لشعبتي الرياضيات و«هندسة» (تقني رياضي سابقا). وقد ألغيت أو جمدت هذه الترتيبات في سبتمبر 2026 بالنسبة للتعليم الثانوي.',
    impact_fr: "Ne pas en tenir compte pour préparer le BAC 2027.",
    impact_ar: 'لا تؤخذ بعين الاعتبار في التحضير لبكالوريا 2027.',
  },
  'BAC-REC-0004': {
    title_fr: 'Réforme de structure annoncée pour 2027-2028 (gelée)',
    title_ar: 'إصلاح هيكلي أعلن عنه للسنة الدراسية 2027-2028 (مجمد)',
    summary_fr:
      "Annoncé le 25 juillet 2026 : passage du tronc commun à un système de filières dès la 1re année secondaire et création d'une filière Informatique à partir de l'année scolaire 2027-2028. Cette annonce est couverte par le gel du 16 septembre 2026.",
    summary_ar:
      'أعلن عنه يوم 25 جويلية 2026: الانتقال من الجذع المشترك إلى نظام الشعب ابتداء من السنة الأولى ثانوي واستحداث شعبة المعلوماتية ابتداء من السنة الدراسية 2027-2028. ويشمل التجميد المعلن عنه في 16 سبتمبر 2026 هذا الإعلان.',
    impact_fr: 'Sans effet sur le BAC 2027.',
    impact_ar: 'لا أثر له على بكالوريا 2027.',
  },
  'BAC-REC-0005': {
    title_fr: 'Calendrier des examens trimestriels et des vacances scolaires 2026-2027',
    title_ar: 'رزنامة الاختبارات الفصلية والعطل المدرسية للسنة الدراسية 2026-2027',
    summary_fr:
      "Communiqué du 5 octobre 2026, pris en application de l'arrêté n° 41 du 28 septembre 2026. Il fixe les périodes des examens trimestriels (الاختبارات الفصلية) et les vacances scolaires. Pour la 3e année secondaire, il indique la période du 9 au 13 mai 2027. Il ne contient aucune date de l'examen du baccalauréat.",
    summary_ar:
      'بلاغ 5 أكتوبر 2026، تنفيذا لأحكام القرار رقم 41 المؤرخ في 28 سبتمبر 2026. يحدد فترات إجراء الاختبارات الفصلية والعطل المدرسية. وبالنسبة للسنة الثالثة ثانوي يذكر الفترة من 09 إلى 13 ماي 2027. لا يتضمن أي تاريخ لامتحان شهادة البكالوريا.',
    impact_fr: 'Les dates figurent dans le calendrier de la plateforme.',
    impact_ar: 'التواريخ مدرجة في رزنامة المنصة.',
  },
  'BAC-REC-0006': {
    title_fr: 'Rentrée scolaire 2026-2027 : lancement le 21 septembre 2026',
    title_ar: 'الدخول المدرسي 2026-2027: الانطلاق يوم 21 سبتمبر 2026',
    summary_fr:
      "La rentrée des élèves, d'abord fixée au dimanche 6 septembre 2026 (communiqué du 30 juillet 2026), a eu lieu le lundi 21 septembre 2026 selon le compte rendu du ministère du 22 septembre 2026. L'avis officiel modifiant la date n'a pas été retrouvé.",
    summary_ar:
      'حدد دخول التلاميذ في البداية ليوم الأحد 6 سبتمبر 2026 (بيان 30 جويلية 2026)، وانطلقت السنة الدراسية يوم الاثنين 21 سبتمبر 2026 حسب ما نشرته الوزارة يوم 22 سبتمبر 2026. لم يعثر على الإشعار الرسمي الذي غير التاريخ.',
    impact_fr: "L'année scolaire a commencé deux semaines plus tard que prévu. Aucun aménagement officiel des programmes n'a été trouvé.",
    impact_ar: 'انطلقت السنة الدراسية بعد أسبوعين من الموعد المحدد أولا. لم يعثر على أي تكييف رسمي للبرامج.',
  },
  'BAC-REC-0007': {
    title_fr: "Format de l'examen du baccalauréat : inchangé selon le ministre (30 juillet 2026)",
    title_ar: 'نمط امتحان شهادة البكالوريا: لم يتغير حسب تصريح الوزير (30 جويلية 2026)',
    summary_fr:
      "Lors de sa conférence de presse du 30 juillet 2026, le ministre a déclaré que le mode d'examen du baccalauréat (نمط الامتحان) reste inchangé et que les candidats composent dans les matières programmées en 3e année secondaire. Cette déclaration a été faite en même temps que des dispositions gelées par la suite. Aucun document officiel postérieur modifiant le format n'a été trouvé.",
    summary_ar:
      'صرح الوزير خلال ندوته الصحفية يوم 30 جويلية 2026 أن نمط امتحان شهادة البكالوريا لم يتغير وأن المترشحين يمتحنون في المواد المبرمجة في السنة الثالثة ثانوي. وقد جاء هذا التصريح مع ترتيبات تم تجميدها لاحقا. لم يعثر على أي وثيقة رسمية لاحقة تغير نمط الامتحان.',
  },
  'BAC-REC-0010': {
    title_fr: 'Textes réglementaires de référence',
    title_ar: 'النصوص التنظيمية المرجعية',
    summary_fr:
      "Textes cités dans les visas de l'arrêté n° 36 : arrêté n° 186 du 23 mars 2006 relatif aux horaires et coefficients de l'enseignement secondaire général et technologique, modifié ; arrêté n° 37 du 14 avril 2022 fixant les filières de l'enseignement secondaire général et technologique, modifié ; arrêté n° 25 du 2 octobre 2007 fixant les modalités d'organisation de l'examen du baccalauréat, modifié. Leurs titres et leurs dates sont vérifiés. Les textes eux-mêmes n'ont pas été consultés.",
    summary_ar:
      'النصوص المذكورة في تأشيرات القرار رقم 36: القرار رقم 186 المؤرخ في 23 مارس 2006 المتعلق بالمواقيت والمعاملات لمرحلة التعليم الثانوي العام والتكنولوجي، المعدل؛ القرار رقم 37 المؤرخ في 14 أفريل 2022 الذي يحدد شعب التعليم الثانوي العام والتكنولوجي، المعدل؛ القرار رقم 25 المؤرخ في 2 أكتوبر 2007 الذي يحدد كيفيات تنظيم امتحان شهادة البكالوريا، المعدل. تم التحقق من عناوينها وتواريخها، أما النصوص نفسها فلم يتم الاطلاع عليها.',
  },
  'BAC-REC-0011': {
    title_fr: 'Session 2026 : repères (ne valent pas pour 2027)',
    title_ar: 'دورة 2026: معالم مرجعية (لا تسري على دورة 2027)',
    summary_fr:
      "Inscriptions du 18 novembre au 17 décembre 2025, entièrement en ligne (communiqué du ministère relayé par la Radio algérienne). Épreuves du dimanche 7 au jeudi 11 juin 2026 (dépêche APS). Entrée dans les centres de 7 h 15 à 8 h et de 13 h 45 à 14 h 30, téléphones et appareils électroniques remis à l'entrée (communiqué du ministère du 1er juin 2026). Résultats le dimanche 12 juillet 2026 à partir de 10 h (communiqué du ministère du 8 juillet 2026).",
    summary_ar:
      'التسجيلات من 18 نوفمبر إلى 17 ديسمبر 2025، إلكترونيا بالكامل (بيان الوزارة كما نقلته الإذاعة الجزائرية). الاختبارات من الأحد 7 إلى الخميس 11 جوان 2026 (برقية وكالة الأنباء الجزائرية). الدخول إلى المراكز من 7:15 إلى 8:00 ومن 13:45 إلى 14:30، مع تسليم الهواتف والأجهزة الإلكترونية عند الدخول (بيان الوزارة بتاريخ 1 جوان 2026). النتائج يوم الأحد 12 جويلية 2026 ابتداء من الساعة 10:00 (بيان الوزارة بتاريخ 8 جويلية 2026).',
    impact_fr: "Ces éléments décrivent la session 2026. Rien n'indique officiellement qu'ils seront repris en 2027.",
    impact_ar: 'هذه المعطيات تخص دورة 2026. لا يوجد ما يؤكد رسميا اعتمادها في دورة 2027.',
  },
};

// --- Official calendar (communiqué of 5 October 2026) and items not yet announced --

interface SeedEvent {
  kind: EventKind;
  starts_on: string | null;
  ends_on: string | null;
  dates_fr: string | null;
  dates_ar: string | null;
  title_fr: string;
  title_ar: string;
  audience_fr: string;
  audience_ar: string;
  note_fr?: string;
  note_ar?: string;
  status: EventStatus;
  concerns_3as: number;
  record: string;
}

const YEARS_1_2_FR = 'Dates indiquées pour les 1re et 2e années secondaires';
const YEARS_1_2_AR = 'تواريخ محددة للسنتين الأولى والثانية ثانوي';
const NO_3AS_FR = "Le communiqué ne donne pas de dates distinctes pour la 3e année secondaire à ce trimestre.";
const NO_3AS_AR = 'لا يحدد البلاغ تواريخ خاصة بالسنة الثالثة ثانوي في هذا الفصل.';
const ALL_FR = 'Tous les élèves';
const ALL_AR = 'كل التلاميذ';
const CANDIDATES_FR = 'Tous les candidats';
const CANDIDATES_AR = 'كل المترشحين';

const EVENTS: SeedEvent[] = [
  {
    kind: 'HOLIDAY', starts_on: '2026-10-27', ends_on: '2026-11-02',
    dates_fr: 'du mardi 27 octobre 2026 au soir au lundi 2 novembre 2026 au matin',
    dates_ar: 'من مساء الثلاثاء 27 أكتوبر 2026 إلى صباح الاثنين 02 نوفمبر 2026',
    title_fr: "Vacances d'automne", title_ar: 'عطلة الخريف',
    audience_fr: ALL_FR, audience_ar: ALL_AR, status: 'CONFIRMED', concerns_3as: 1, record: 'BAC-REC-0005',
  },
  {
    kind: 'TEST', starts_on: '2026-12-06', ends_on: '2026-12-10',
    dates_fr: 'du 6 au 10 décembre 2026', dates_ar: 'من 06 إلى 10 ديسمبر 2026',
    title_fr: 'Examens du premier trimestre', title_ar: 'اختبارات الفصل الأول',
    audience_fr: YEARS_1_2_FR, audience_ar: YEARS_1_2_AR, note_fr: NO_3AS_FR, note_ar: NO_3AS_AR,
    status: 'CONFIRMED', concerns_3as: 0, record: 'BAC-REC-0005',
  },
  {
    kind: 'HOLIDAY', starts_on: '2026-12-17', ends_on: '2027-01-03',
    dates_fr: 'du jeudi 17 décembre 2026 au soir au dimanche 3 janvier 2027 au matin',
    dates_ar: 'من مساء الخميس 17 ديسمبر 2026 إلى صباح الأحد 03 جانفي 2027',
    title_fr: "Vacances d'hiver", title_ar: 'عطلة الشتاء',
    audience_fr: ALL_FR, audience_ar: ALL_AR, status: 'CONFIRMED', concerns_3as: 1, record: 'BAC-REC-0005',
  },
  {
    kind: 'TEST', starts_on: '2027-03-02', ends_on: '2027-03-08',
    dates_fr: 'les 2, 3, 4, 7 et 8 mars 2027', dates_ar: 'أيام 2، 3، 4، 7، 8 مارس 2027',
    title_fr: 'Examens du deuxième trimestre', title_ar: 'اختبارات الفصل الثاني',
    audience_fr: YEARS_1_2_FR, audience_ar: YEARS_1_2_AR, note_fr: NO_3AS_FR, note_ar: NO_3AS_AR,
    status: 'CONFIRMED', concerns_3as: 0, record: 'BAC-REC-0005',
  },
  {
    kind: 'HOLIDAY', starts_on: '2027-03-18', ends_on: '2027-04-04',
    dates_fr: 'du jeudi 18 mars 2027 au soir au dimanche 4 avril 2027 au matin',
    dates_ar: 'من مساء الخميس 18 مارس 2027 إلى صباح الأحد 04 أفريل 2027',
    title_fr: 'Vacances de printemps', title_ar: 'عطلة الربيع',
    audience_fr: ALL_FR, audience_ar: ALL_AR, status: 'CONFIRMED', concerns_3as: 1, record: 'BAC-REC-0005',
  },
  {
    kind: 'TEST', starts_on: '2027-05-09', ends_on: '2027-05-13',
    dates_fr: 'du 9 au 13 mai 2027', dates_ar: 'من 09 إلى 13 ماي 2027',
    title_fr: "Période d'examens de la 3e année secondaire", title_ar: 'فترة اختبارات السنة الثالثة ثانوي',
    audience_fr: '3e année secondaire, toutes filières', audience_ar: 'السنة الثالثة ثانوي، كل الشعب',
    note_fr: 'Le communiqué indique cette période dans le calendrier des examens trimestriels, sans préciser le trimestre.',
    note_ar: 'يذكر البلاغ هذه الفترة ضمن رزنامة الاختبارات الفصلية دون تحديد الفصل.',
    status: 'CONFIRMED', concerns_3as: 2, record: 'BAC-REC-0005',
  },
  {
    kind: 'TEST', starts_on: '2027-05-23', ends_on: '2027-05-27',
    dates_fr: 'du 23 au 27 mai 2027', dates_ar: 'من 23 إلى 27 ماي 2027',
    title_fr: 'Examens du troisième trimestre', title_ar: 'اختبارات الفصل الثالث',
    audience_fr: YEARS_1_2_FR, audience_ar: YEARS_1_2_AR,
    status: 'CONFIRMED', concerns_3as: 0, record: 'BAC-REC-0005',
  },
  {
    kind: 'REGISTRATION', starts_on: null, ends_on: null, dates_fr: null, dates_ar: null,
    title_fr: 'Inscriptions au BAC 2027', title_ar: 'التسجيلات في امتحان شهادة البكالوريا دورة 2027',
    audience_fr: CANDIDATES_FR, audience_ar: CANDIDATES_AR,
    note_fr: "Aucune période officielle d'inscription n'a été annoncée. Le site bac.onec.dz affiche encore le formulaire des résultats du BAC 2026.",
    note_ar: 'لم يعلن عن أي فترة رسمية للتسجيل. ما زال موقع bac.onec.dz يعرض استمارة نتائج بكالوريا 2026.',
    status: 'NOT_ANNOUNCED', concerns_3as: 2, record: 'BAC-REC-0008',
  },
  {
    kind: 'EXAM', starts_on: null, ends_on: null, dates_fr: null, dates_ar: null,
    title_fr: 'Épreuves du BAC 2027', title_ar: 'اختبارات امتحان شهادة البكالوريا دورة 2027',
    audience_fr: CANDIDATES_FR, audience_ar: CANDIDATES_AR,
    note_fr: "Aucune date officielle n'a été annoncée. Le calendrier scolaire officiel 2026-2027 ne contient aucune date du baccalauréat.",
    note_ar: 'لم يعلن عن أي تاريخ رسمي. الرزنامة المدرسية الرسمية 2026-2027 لا تتضمن أي تاريخ لامتحان البكالوريا.',
    status: 'NOT_ANNOUNCED', concerns_3as: 2, record: 'BAC-REC-0009',
  },
  {
    kind: 'RESULTS', starts_on: null, ends_on: null, dates_fr: null, dates_ar: null,
    title_fr: 'Résultats du BAC 2027', title_ar: 'نتائج امتحان شهادة البكالوريا دورة 2027',
    audience_fr: CANDIDATES_FR, audience_ar: CANDIDATES_AR,
    note_fr: "Aucune date officielle n'a été annoncée.", note_ar: 'لم يعلن عن أي تاريخ رسمي.',
    status: 'NOT_ANNOUNCED', concerns_3as: 2, record: 'BAC-REC-0009',
  },
];

// --- Rumours that were checked ------------------------------------------------

const CLAIMS: { claim_fr: string; claim_ar: string; finding_fr: string; finding_ar: string; verdict: ClaimVerdict; record: string }[] = [
  {
    claim_fr: 'Les inscriptions au BAC 2027 auraient lieu du 18 novembre au 17 décembre 2026.',
    claim_ar: 'تجرى التسجيلات في بكالوريا 2027 من 18 نوفمبر إلى 17 ديسمبر 2026.',
    finding_fr: "Aucune annonce officielle ne confirme ces dates. Ce sont le jour et le mois de la période d'inscription de la session 2026 (du 18 novembre au 17 décembre 2025), repris tels quels. Une période proche est possible, mais elle n'est pas confirmée.",
    finding_ar: 'لا يوجد أي إعلان رسمي يؤكد هذه التواريخ. هي نفس يوم وشهر فترة التسجيل في دورة 2026 (من 18 نوفمبر إلى 17 ديسمبر 2025) وقد نقلت كما هي. قد تكون الفترة متقاربة، لكنها غير مؤكدة.',
    verdict: 'UNVERIFIED', record: 'BAC-REC-0008',
  },
  {
    claim_fr: 'Le BAC 2027 se déroulerait du 7 au 11 juin 2027.',
    claim_ar: 'تجرى بكالوريا 2027 من 7 إلى 11 جوان 2027.',
    finding_fr: "Aucune date officielle n'a été annoncée. Du 7 au 11 juin, ce sont les dates de la session 2026. En 2027, le 7 juin tombe un lundi, alors que la session 2026 a commencé un dimanche.",
    finding_ar: 'لم يعلن عن أي تاريخ رسمي. من 7 إلى 11 جوان هي تواريخ دورة 2026. في سنة 2027 يوافق 7 جوان يوم الاثنين، بينما انطلقت دورة 2026 يوم الأحد.',
    verdict: 'UNVERIFIED', record: 'BAC-REC-0009',
  },
  {
    claim_fr: 'Le BAC 2027 se déroulerait du 13 au 17 juin 2027.',
    claim_ar: 'تجرى بكالوريا 2027 من 13 إلى 17 جوان 2027.',
    finding_fr: 'Aucune source officielle ne donne ces dates. Le calendrier scolaire officiel 2026-2027 ne contient aucune date du baccalauréat.',
    finding_ar: 'لا يوجد أي مصدر رسمي يذكر هذه التواريخ. الرزنامة المدرسية الرسمية 2026-2027 لا تتضمن أي تاريخ لامتحان البكالوريا.',
    verdict: 'UNVERIFIED', record: 'BAC-REC-0009',
  },
  {
    claim_fr: 'Les résultats du BAC 2027 seraient publiés le 17 juillet 2027.',
    claim_ar: 'تعلن نتائج بكالوريا 2027 يوم 17 جويلية 2027.',
    finding_fr: "Aucune date officielle de publication des résultats n'a été annoncée.",
    finding_ar: 'لم يعلن عن أي تاريخ رسمي لإعلان النتائج.',
    verdict: 'UNVERIFIED', record: 'BAC-REC-0009',
  },
  {
    claim_fr: 'Le BAC 2027 se passerait avec de nouvelles matières et de nouveaux coefficients.',
    claim_ar: 'تجرى بكالوريا 2027 بمواد ومعاملات جديدة.',
    finding_fr: "Ces informations viennent de l'arrêté n° 20 du 28 juillet 2026, abrogé par l'arrêté n° 36 du 9 septembre 2026 avant toute application. Les dispositions de l'arrêté n° 186 du 23 mars 2006 restent en vigueur.",
    finding_ar: 'مصدر هذه المعلومات هو القرار رقم 20 المؤرخ في 28 جويلية 2026، وقد ألغي بالقرار رقم 36 المؤرخ في 9 سبتمبر 2026 قبل أي تطبيق. وتبقى أحكام القرار رقم 186 المؤرخ في 23 مارس 2006 سارية المفعول.',
    verdict: 'SUPERSEDED', record: 'BAC-REC-0001',
  },
];

interface SeedProposal {
  kind: ProposalKind;
  title_fr: string;
  title_ar: string;
  detail_fr: string;
  detail_ar: string;
  payload?: Record<string, unknown>;
  record?: string;
  priority: Priority;
  mandatory?: boolean;
  teacher?: boolean;
}

export function seed(db: DB): boolean {
  if (getSetting(db, 'seeded')) return false;
  const now = nowIso();

  tx(db, () => {
    for (const e of EDITIONS) {
      run(
        db,
        'INSERT INTO editions (exam_year, school_year, status, note_fr, note_ar) VALUES (?, ?, ?, ?, ?)',
        e.exam_year, e.school_year, e.status, e.note_fr, e.note_ar,
      );
    }
    STREAMS.forEach((s, i) =>
      run(
        db,
        "INSERT INTO streams (code, name_fr, name_ar, sort, verification, note_fr, note_ar) VALUES (?, ?, ?, ?, 'PARTIALLY_VERIFIED', ?, ?)",
        s.code, s.name_fr, s.name_ar, i, STREAM_NOTE_FR, STREAM_NOTE_AR,
      ),
    );
    SUBJECTS.forEach((s, i) =>
      run(db, 'INSERT INTO subjects (code, name_fr, name_ar, sort) VALUES (?, ?, ?, ?)', s.code, s.name_fr, s.name_ar, i),
    );

    const editionId = get<{ id: number }>(db, 'SELECT id FROM editions WHERE exam_year = 2027')!.id;
    const streamId = (code: string): number => get<{ id: number }>(db, 'SELECT id FROM streams WHERE code = ?', code)!.id;
    const subjectId = (code: string): number => get<{ id: number }>(db, 'SELECT id FROM subjects WHERE code = ?', code)!.id;

    // Monitoring records: imported as they are, then the verified baseline is published with its wording.
    importMonitoring(db, null, { createProposals: false });
    const recordExists = (id: string): boolean => Boolean(get(db, 'SELECT 1 FROM official_records WHERE id = ?', id));
    const rec = (id: string | undefined): string | null => (id && recordExists(id) ? id : null);
    for (const [id, t] of Object.entries(RECORD_TEXT)) {
      run(
        db,
        `UPDATE official_records
            SET title_fr = ?, title_ar = ?, summary_fr = ?, summary_ar = ?, impact_fr = ?, impact_ar = ?, visibility = 'PUBLISHED'
          WHERE id = ?`,
        t.title_fr, t.title_ar, t.summary_fr, t.summary_ar, t.impact_fr ?? null, t.impact_ar ?? null, id,
      );
    }
    if (recordExists('BAC-REC-0001')) setSetting(db, 'framework_record_id', 'BAC-REC-0001');

    for (const e of EVENTS) {
      run(
        db,
        `INSERT INTO calendar_events
           (edition_id, kind, starts_on, ends_on, dates_fr, dates_ar, title_fr, title_ar, audience_fr, audience_ar,
            note_fr, note_ar, status, concerns_3as, record_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        editionId, e.kind, e.starts_on, e.ends_on, e.dates_fr, e.dates_ar, e.title_fr, e.title_ar, e.audience_fr,
        e.audience_ar, e.note_fr ?? null, e.note_ar ?? null, e.status, e.concerns_3as, rec(e.record), now,
      );
    }

    for (const cl of CLAIMS) {
      run(
        db,
        'INSERT INTO claims (edition_id, claim_fr, claim_ar, finding_fr, finding_ar, verdict, record_id, checked_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        editionId, cl.claim_fr, cl.claim_ar, cl.finding_fr, cl.finding_ar, cl.verdict, rec(cl.record), BASELINE_CHECK,
      );
    }

    const proposals: SeedProposal[] = [];

    for (const [code, rows] of Object.entries(PROVISIONAL_TABLES)) {
      const sid = streamId(code);
      for (const [subject, coefficient, optional] of rows) {
        run(
          db,
          `INSERT INTO stream_subjects
             (edition_id, stream_id, subject_id, coefficient, is_optional, state, verification, source_record_id, source_note, version, created_at)
           VALUES (?, ?, ?, ?, ?, 'PROVISIONAL', 'UNVERIFIED', ?, ?, 1, ?)`,
          editionId, sid, subjectId(subject), coefficient, optional ? 1 : 0, rec('BAC-REC-0010'), PROVISIONAL_NOTE, now,
        );
      }
      const stream = STREAMS.find((s) => s.code === code)!;
      proposals.push({
        kind: 'PUBLISH_COEFFICIENT_TABLE',
        title_fr: `Vérifier et publier la table des matières et coefficients : ${stream.name_fr}, BAC 2027`,
        title_ar: `التحقق من جدول المواد والمعاملات ونشره: شعبة ${stream.name_ar}، بكالوريا 2027`,
        detail_fr:
          "Les valeurs proposées sont celles du cadre antérieur à juillet 2026, saisies de mémoire sans consultation du texte officiel. Vérifiez chaque matière et chaque coefficient sur le texte officiel (arrêté n° 186 du 23 mars 2006 modifié), corrigez si nécessaire dans la base académique, puis publiez. Tant que la table n'est pas publiée, les élèves ne voient aucune valeur.",
        detail_ar:
          'القيم المقترحة هي قيم الإطار السابق لشهر جويلية 2026، وقد أدخلت من الذاكرة دون الرجوع إلى النص الرسمي. تحقق من كل مادة وكل معامل في النص الرسمي (القرار رقم 186 المؤرخ في 23 مارس 2006 المعدل)، صحح عند الحاجة في القاعدة الأكاديمية، ثم انشر. ما دام الجدول غير منشور، لا يرى التلاميذ أي قيمة.',
        payload: { edition_id: editionId, stream_id: sid },
        record: 'BAC-REC-0001',
        priority: 'HIGH',
        mandatory: true,
        teacher: true,
      });
    }

    proposals.push(
      {
        kind: 'TASK',
        title_fr: 'Filière Arts : saisir les matières et coefficients à partir du texte officiel',
        title_ar: 'شعبة فنون: إدخال المواد والمعاملات انطلاقا من النص الرسمي',
        detail_fr: "Aucune valeur n'est proposée pour cette filière. Saisissez la table dans la base académique à partir du texte officiel, puis publiez-la.",
        detail_ar: 'لا توجد أي قيمة مقترحة لهذه الشعبة. أدخل الجدول في القاعدة الأكاديمية انطلاقا من النص الرسمي ثم انشره.',
        record: 'BAC-REC-0010',
        priority: 'HIGH',
        mandatory: true,
        teacher: true,
      },
      {
        kind: 'TASK',
        title_fr: 'Confirmer la configuration du simulateur pour le BAC 2027',
        title_ar: 'تأكيد إعدادات محاكي الامتحان لبكالوريا 2027',
        detail_fr:
          "Aucune épreuve d'informatique ne doit figurer pour les filières Mathématiques et Technique mathématique : l'ajout annoncé en juillet 2026 n'est pas en vigueur (arrêté n° 36, communiqué du 16 septembre 2026). Les durées officielles des épreuves ne sont pas renseignées : le simulateur demande la durée à l'élève.",
        detail_ar:
          'يجب ألا يظهر أي اختبار في الإعلام الآلي لشعبتي الرياضيات والتقني رياضي: الإدراج المعلن عنه في جويلية 2026 غير ساري المفعول (القرار رقم 36، بيان 16 سبتمبر 2026). المدد الرسمية للاختبارات غير مدخلة: يطلب المحاكي المدة من التلميذ.',
        record: 'BAC-REC-0001',
        priority: 'HIGH',
        mandatory: true,
      },
      {
        kind: 'TASK',
        title_fr: 'Obtenir les textes officiels de référence',
        title_ar: 'الحصول على النصوص الرسمية المرجعية',
        detail_fr:
          "Arrêté n° 186 du 23 mars 2006 (horaires et coefficients), arrêté n° 37 du 14 avril 2022 (filières) et arrêté n° 25 du 2 octobre 2007 (organisation de l'examen du baccalauréat), dans leur version modifiée. Leurs titres et leurs dates sont vérifiés, pas leur contenu.",
        detail_ar:
          'القرار رقم 186 المؤرخ في 23 مارس 2006 (المواقيت والمعاملات)، القرار رقم 37 المؤرخ في 14 أفريل 2022 (الشعب) والقرار رقم 25 المؤرخ في 2 أكتوبر 2007 (تنظيم امتحان شهادة البكالوريا)، في صيغتها المعدلة. تم التحقق من عناوينها وتواريخها دون محتواها.',
        record: 'BAC-REC-0010',
        priority: 'HIGH',
        teacher: true,
      },
    );

    // Sample content: mathematics, shared by the three streams with a heavy mathematics paper.
    const math = subjectId('MATH');
    const contentStreams = ['SE', 'M', 'TM'].map(streamId);
    const chapterIds: number[] = [];
    MATH_CHAPTERS.forEach((ch, i) => {
      const chapter = run(
        db,
        `INSERT INTO chapters (edition_id, subject_id, title_fr, title_ar, sort, verification, note_fr, note_ar)
         VALUES (?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?)`,
        editionId, math, ch.title_fr, ch.title_ar, i,
        "Chapitre de révision. Sa place dans le programme officiel n'a pas été vérifiée.",
        'محور للمراجعة. لم يتم التحقق من موقعه في البرنامج الرسمي.',
      );
      chapterIds.push(chapter.id);
      for (const sid of contentStreams) run(db, 'INSERT INTO chapter_streams (chapter_id, stream_id) VALUES (?, ?)', chapter.id, sid);
      run(
        db,
        "INSERT INTO lessons (chapter_id, sort, title_fr, title_ar, body_fr, body_ar, provenance, created_at) VALUES (?, 0, ?, ?, ?, ?, 'AI_GENERATED', ?)",
        chapter.id, ch.lesson.title_fr, ch.lesson.title_ar, ch.lesson.body_fr, ch.lesson.body_ar, now,
      );
      const ex = ch.exercise;
      run(
        db,
        `INSERT INTO exercises (chapter_id, sort, title_fr, title_ar, statement_fr, statement_ar, solution_fr, solution_ar, points, provenance, solution_provenance)
         VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, 'AI_GENERATED', 'AI_GENERATED')`,
        chapter.id, ex.title_fr, ex.title_ar, ex.statement_fr, ex.statement_ar, ex.solution_fr, ex.solution_ar, ex.points,
      );
    });

    const exam = run(
      db,
      `INSERT INTO exams (edition_id, subject_id, title_fr, title_ar, kind, default_duration, instructions_fr, instructions_ar, provenance, total_points, created_at)
       VALUES (?, ?, ?, ?, 'PRACTICE', NULL, ?, ?, 'AI_GENERATED', ?, ?)`,
      editionId, math, MATH_EXAM.title_fr, MATH_EXAM.title_ar, MATH_EXAM.instructions_fr, MATH_EXAM.instructions_ar,
      MATH_EXAM.exercises.reduce((sum, ex) => sum + ex.points, 0), now,
    );
    for (const sid of contentStreams) run(db, 'INSERT INTO exam_streams (exam_id, stream_id) VALUES (?, ?)', exam.id, sid);
    MATH_EXAM.exercises.forEach((ex, i) =>
      run(
        db,
        `INSERT INTO exercises (exam_id, sort, title_fr, title_ar, statement_fr, statement_ar, solution_fr, solution_ar, points, provenance, solution_provenance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AI_GENERATED', 'AI_GENERATED')`,
        exam.id, i, ex.title_fr, ex.title_ar, ex.statement_fr, ex.statement_ar, ex.solution_fr, ex.solution_ar, ex.points,
      ),
    );
    proposals.push({
      kind: 'REVIEW_CONTENT',
      title_fr: 'Relire les contenus de mathématiques rédigés par IA',
      title_ar: 'مراجعة محتويات الرياضيات التي أعدها الذكاء الاصطناعي',
      detail_fr:
        "Trois chapitres, trois leçons, trois exercices et un sujet d'entraînement ont été rédigés par IA. La liste des chapitres n'a pas été comparée au programme officiel. Après relecture par un enseignant, ils porteront la mention « Relu par un enseignant ».",
      detail_ar:
        'ثلاثة محاور وثلاثة دروس وثلاثة تمارين وموضوع تدريبي من إعداد الذكاء الاصطناعي. لم تقارن قائمة المحاور بالبرنامج الرسمي. بعد مراجعتها من طرف أستاذ ستحمل عبارة «راجعه أستاذ».',
      payload: { chapter_ids: chapterIds, exam_ids: [exam.id] },
      priority: 'MEDIUM',
      teacher: true,
    });

    // Announcements are drafts. Publishing one is a human decision and requires a verified source record.
    const dashboard = run(
      db,
      `INSERT INTO announcements (kind, priority, edition_id, title_fr, title_ar, body_fr, body_ar, record_id, status, created_at)
       VALUES ('DASHBOARD', 'MEDIUM', ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
      editionId,
      'BAC 2027 : aucun changement de matières ni de coefficients en vigueur',
      'بكالوريا 2027: لا تغيير ساري المفعول في المواد والمعاملات',
      "Par l'arrêté n° 36 du 9 septembre 2026, le ministère de l'Éducation nationale a abrogé l'arrêté n° 20 du 28 juillet 2026 relatif aux horaires et coefficients de l'enseignement secondaire général et technologique. Les dispositions de l'arrêté n° 186 du 23 mars 2006 restent en vigueur. Les autres dispositions pédagogiques annoncées en juillet 2026, hors cycle primaire, sont gelées jusqu'à leur approbation en Conseil des ministres (communiqué du ministère du 16 septembre 2026).",
      'ألغت وزارة التربية الوطنية، بموجب القرار رقم 36 المؤرخ في 9 سبتمبر 2026، القرار رقم 20 المؤرخ في 28 جويلية 2026 المتضمن المواقيت والمعاملات لمرحلة التعليم الثانوي العام والتكنولوجي، وتبقى أحكام القرار رقم 186 المؤرخ في 23 مارس 2006 سارية المفعول. أما باقي الترتيبات البيداغوجية المعلن عنها في جويلية 2026، ما عدا الخاصة بالتعليم الابتدائي، فقد تم تجميدها إلى غاية المصادقة عليها في مجلس الوزراء (بيان الوزارة بتاريخ 16 سبتمبر 2026).',
      rec('BAC-REC-0001'),
      now,
    );
    run(
      db,
      `INSERT INTO announcements (kind, priority, edition_id, title_fr, title_ar, body_fr, body_ar, record_id, status, created_at)
       VALUES ('REGISTRATION_REMINDER', 'HIGH', ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
      editionId,
      'Inscriptions au BAC 2027 : [dates à compléter]',
      'التسجيلات في بكالوريا 2027: [تواريخ تستكمل]',
      "Modèle à compléter uniquement après la publication du communiqué officiel. Période d'inscription : du [date] au [date]. Candidats scolarisés : [procédure officielle]. Candidats libres : [procédure officielle]. Paiement des droits : [modalités officielles]. Source : [lien vers le communiqué].",
      'نموذج يستكمل فقط بعد صدور البيان الرسمي. فترة التسجيل: من [التاريخ] إلى [التاريخ]. المترشحون المتمدرسون: [الإجراء الرسمي]. المترشحون الأحرار: [الإجراء الرسمي]. دفع حقوق التسجيل: [الكيفيات الرسمية]. المصدر: [رابط البيان].',
      rec('BAC-REC-0008'),
      now,
    );
    proposals.push({
      kind: 'PUBLISH_ANNOUNCEMENT',
      title_fr: 'Publier l’annonce : aucun changement de matières ni de coefficients pour le BAC 2027',
      title_ar: 'نشر الإعلان: لا تغيير في المواد والمعاملات لبكالوريا 2027',
      detail_fr:
        "Annonce de tableau de bord en français et en arabe, liée à l'arrêté n° 36 (vérifié). Une notification se justifie surtout si les élèves ont vu circuler les changements annoncés en juillet 2026.",
      detail_ar:
        'إعلان للوحة القيادة بالفرنسية والعربية، مرتبط بالقرار رقم 36 (تم التحقق منه). يكون الإشعار مبررا خاصة إذا اطلع التلاميذ على التغييرات المعلن عنها في جويلية 2026.',
      payload: { announcement_id: dashboard.id },
      record: 'BAC-REC-0001',
      priority: 'MEDIUM',
    });

    for (const p of proposals) {
      run(
        db,
        `INSERT INTO proposals (kind, title_fr, title_ar, detail_fr, detail_ar, payload, source, record_id, priority, mandatory, teacher_verification, edition_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'SEED', ?, ?, ?, ?, ?, 'PENDING', ?)`,
        p.kind, p.title_fr, p.title_ar, p.detail_fr, p.detail_ar, JSON.stringify(p.payload ?? {}), rec(p.record),
        p.priority, p.mandatory ? 1 : 0, p.teacher ? 1 : 0, editionId, now,
      );
    }

    setSetting(db, 'seeded', now);
    audit(db, null, 'seed', 'database', null, { proposals: proposals.length });
  });
  return true;
}
