// Types shared by the API server and the web client.
// Field names mirror the database columns (snake_case) so rows can be sent as they are.

export type Locale = 'fr' | 'ar';
export type Role = 'student' | 'teacher' | 'admin';

/** Verification levels of the monitoring framework (section 5 of the monitoring brief). */
export type Verification = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'CONTRADICTED';
/** Change-detection statuses (section 4 of the monitoring brief). */
export type ChangeStatus = 'NEW' | 'UPDATED' | 'CONFIRMED' | 'CORRECTED' | 'REPEATED' | 'UNVERIFIED' | 'SUPERSEDED';
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
/** The four classes of information the platform must keep apart. */
export type Provenance = 'OFFICIAL' | 'TEACHER_REVIEWED' | 'AI_GENERATED' | 'UNVERIFIED';

export type EditionStatus = 'ACTIVE' | 'UPCOMING' | 'ARCHIVED';
export type EventStatus = 'CONFIRMED' | 'PROVISIONAL' | 'NOT_ANNOUNCED';
export type EventKind = 'TEST' | 'HOLIDAY' | 'REGISTRATION' | 'EXAM' | 'RESULTS' | 'OTHER';
export type ClaimVerdict = 'UNVERIFIED' | 'SUPERSEDED' | 'CONTRADICTED';
export type AnnouncementKind =
  | 'DASHBOARD'
  | 'REGISTRATION_REMINDER'
  | 'REVISION_PLAN_UPDATE'
  | 'CURRICULUM_UPDATE'
  | 'EXAM_ALERT';
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ProposalKind =
  | 'PUBLISH_COEFFICIENT_TABLE'
  | 'PUBLISH_ANNOUNCEMENT'
  | 'PUBLISH_RECORD'
  | 'REVIEW_CONTENT'
  | 'TASK';
export type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type RowState = 'PROVISIONAL' | 'PUBLISHED' | 'SUPERSEDED' | 'RETIRED';
export type DocType =
  | 'SUBJECT'
  | 'OFFICIAL_CORRECTION'
  | 'MARKING_SCHEME'
  | 'TEACHER_CORRECTION'
  | 'AI_CORRECTION'
  | 'OTHER';
export type FocusKind = 'LESSON' | 'EXERCISES' | 'EXAM_PRACTICE' | 'REVIEW';
export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'GRADED';
export type TutorMode = 'AI' | 'RETRIEVAL_ONLY';

export const VERIFICATIONS: Verification[] = ['VERIFIED', 'PARTIALLY_VERIFIED', 'UNVERIFIED', 'CONTRADICTED'];
export const PRIORITIES: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const DOC_TYPES: DocType[] = [
  'SUBJECT',
  'OFFICIAL_CORRECTION',
  'MARKING_SCHEME',
  'TEACHER_CORRECTION',
  'AI_CORRECTION',
  'OTHER',
];
export const ANNOUNCEMENT_KINDS: AnnouncementKind[] = [
  'DASHBOARD',
  'REGISTRATION_REMINDER',
  'REVISION_PLAN_UPDATE',
  'CURRICULUM_UPDATE',
  'EXAM_ALERT',
];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  locale: Locale;
  edition_id: number | null;
  stream_id: number | null;
  created_at: string;
}

export interface Edition {
  id: number;
  exam_year: number;
  school_year: string;
  status: EditionStatus;
  note_fr: string | null;
  note_ar: string | null;
}

export interface Stream {
  id: number;
  code: string;
  name_fr: string;
  name_ar: string;
  sort: number;
  verification: Verification;
  note_fr: string | null;
  note_ar: string | null;
}

export interface Subject {
  id: number;
  code: string;
  name_fr: string;
  name_ar: string;
  sort: number;
}

export interface Meta {
  editions: Edition[];
  streams: Stream[];
  subjects: Subject[];
  ai: { enabled: boolean; model: string };
  /** ISO timestamp of the last monitoring run imported into the platform. */
  last_check: string | null;
}

/** One row of the structured record kept by the monitoring agent (section 12 of the brief). */
export interface OfficialRecord {
  id: string;
  topic: string;
  authority: string | null;
  document_title: string | null;
  original_url: string | null;
  scan_url: string | null;
  related_urls: string[];
  publication_date: string | null;
  examination_year: string | null;
  applicable_stream: string | null;
  applicable_subject: string | null;
  previous_value: string | null;
  new_value: string | null;
  verification: Verification;
  verification_note: string | null;
  change_status: ChangeStatus;
  change_note: string | null;
  priority: Priority;
  priority_note: string | null;
  first_detected: string | null;
  last_verified: string | null;
  student_impact: string | null;
  product_impact: string | null;
  required_action: string | null;
  superseded_by: string[];
  unverified_claims: string[];
  visibility: 'PUBLISHED' | 'INTERNAL';
  title_fr: string | null;
  title_ar: string | null;
  summary_fr: string | null;
  summary_ar: string | null;
  impact_fr: string | null;
  impact_ar: string | null;
  updated_at: string;
}

export interface RecordHistoryEntry {
  id: number;
  record_id: string;
  snapshot: Record<string, unknown>;
  replaced_at: string;
  replaced_by_name: string | null;
  reason: string | null;
}

export interface CalendarEvent {
  id: number;
  edition_id: number;
  kind: EventKind;
  starts_on: string | null;
  ends_on: string | null;
  dates_fr: string | null;
  dates_ar: string | null;
  title_fr: string;
  title_ar: string;
  audience_fr: string | null;
  audience_ar: string | null;
  note_fr: string | null;
  note_ar: string | null;
  status: EventStatus;
  /** 2 = listed specifically for the 3rd year, 1 = every pupil, 0 = listed for other years only. */
  concerns_3as: number;
  record_id: string | null;
  source_url: string | null;
  last_verified: string | null;
}

export interface Claim {
  id: number;
  edition_id: number | null;
  claim_fr: string;
  claim_ar: string;
  finding_fr: string;
  finding_ar: string;
  verdict: ClaimVerdict;
  record_id: string | null;
  checked_on: string;
}

export interface Announcement {
  id: number;
  kind: AnnouncementKind;
  priority: Priority;
  edition_id: number | null;
  stream_id: number | null;
  title_fr: string;
  title_ar: string;
  body_fr: string;
  body_ar: string;
  record_id: string | null;
  status: AnnouncementStatus;
  created_at: string;
  published_at: string | null;
  read_at?: string | null;
  record_verification?: Verification | null;
  record_url?: string | null;
  record_title?: string | null;
}

export interface SubjectItem {
  subject_id: number;
  code: string;
  name_fr: string;
  name_ar: string;
  coefficient: number | null;
  is_optional: boolean;
  duration_minutes: number | null;
  verification: Verification | null;
  source_note: string | null;
  source_record_id: string | null;
  verified_at: string | null;
  /** Self-assessed level, 1 (weak) to 5 (strong). */
  level: number | null;
  /** Latest mark out of 20 typed into the average calculator. */
  grade: number | null;
}

export interface FrameworkRef {
  record_id: string;
  verification: Verification;
  title_fr: string | null;
  title_ar: string | null;
  url: string | null;
  last_verified: string | null;
}

export interface SubjectsView {
  /** official = a published table exists for the stream; custom = the student maintains their own list. */
  mode: 'official' | 'custom';
  /** True when a provisional table is waiting for verification by a teacher. */
  pending: boolean;
  items: SubjectItem[];
  framework: FrameworkRef | null;
}

export interface LessonSummary {
  id: number;
  title_fr: string;
  title_ar: string;
  provenance: Provenance;
  outdated: boolean;
  done: boolean;
}

export interface Lesson extends LessonSummary {
  chapter_id: number;
  subject_id: number;
  chapter_title_fr: string;
  chapter_title_ar: string;
  body_fr: string;
  body_ar: string;
  outdated_note: string | null;
  version: number;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
}

export interface Exercise {
  id: number;
  exam_id: number | null;
  chapter_id: number | null;
  sort: number;
  title_fr: string;
  title_ar: string;
  statement_fr: string;
  statement_ar: string;
  /** Solutions are withheld from an exam until the attempt has been handed in. */
  solution_fr?: string;
  solution_ar?: string;
  points: number;
  provenance: Provenance;
  solution_provenance: Provenance;
}

export interface ChapterView {
  id: number;
  subject_id: number;
  title_fr: string;
  title_ar: string;
  sort: number;
  verification: Verification;
  note_fr: string | null;
  note_ar: string | null;
  lessons: LessonSummary[];
  exercises: Exercise[];
}

export interface LearnSubject {
  subject_id: number;
  name_fr: string;
  name_ar: string;
  chapters: number;
  lessons: number;
  lessons_done: number;
}

export interface Exam {
  id: number;
  edition_id: number;
  subject_id: number;
  subject_name_fr: string;
  subject_name_ar: string;
  title_fr: string;
  title_ar: string;
  kind: 'PRACTICE' | 'OFFICIAL_PAST';
  default_duration: number | null;
  instructions_fr: string | null;
  instructions_ar: string | null;
  provenance: Provenance;
  total_points: number;
  outdated: boolean;
  exercise_count: number;
  exercises?: Exercise[];
}

export interface Attempt {
  id: number;
  exam_id: number;
  duration_minutes: number;
  started_at: string;
  finished_at: string | null;
  status: AttemptStatus;
  answers: Record<string, string>;
  scores: Record<string, number> | null;
  score: number | null;
  max_score: number | null;
  exam_title_fr?: string;
  exam_title_ar?: string;
  subject_id?: number;
  subject_name_fr?: string;
  subject_name_ar?: string;
}

export interface PlanParams {
  hours_per_week: number;
  /** Weekdays to study on, 0 = Sunday ... 6 = Saturday. */
  days: number[];
  session_minutes: number;
  weeks: number;
  start: string;
}

export interface PlanSession {
  id: number;
  day: string;
  subject_id: number;
  minutes: number;
  focus: FocusKind;
  chapter_id: number | null;
  done_at: string | null;
}

export interface PlanWeight {
  subject_id: number;
  coefficient: number | null;
  level: number;
  share: number;
  sessions: number;
}

export interface Plan {
  id: number;
  created_at: string;
  params: PlanParams;
  /** True when the weighting used official published coefficients. */
  official_weights: boolean;
  weights: PlanWeight[];
  sessions: PlanSession[];
}

export interface TutorSource {
  n: number;
  kind: string;
  provenance: Provenance;
  verification: Verification | null;
  title_fr: string;
  title_ar: string;
  excerpt_fr: string;
  excerpt_ar: string;
  url: string | null;
  date: string | null;
}

export interface TutorMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources: TutorSource[];
  mode: TutorMode | null;
  created_at: string;
}

export interface Conversation {
  id: number;
  title: string;
  updated_at: string;
}

export interface PastPaper {
  id: number;
  exam_year: number;
  stream_id: number | null;
  subject_id: number | null;
  language: Locale | 'other';
  doc_type: DocType;
  title: string;
  source_authority: string;
  publication_date: string | null;
  url: string;
  verification: Verification;
  note: string | null;
  /** Set when the platform hosts the PDF itself (url then points at /api/archive/:id/file). */
  file_name: string | null;
  file_size: number | null;
  added_at: string;
}

export type RecommendationKind =
  | 'COMPLETE_PROFILE'
  | 'SUBJECTS_PENDING'
  | 'SET_LEVELS'
  | 'READ_ANNOUNCEMENT'
  | 'UPCOMING_EVENT'
  | 'REGISTRATION_WATCH'
  | 'PRIORITISE_SUBJECT'
  | 'CREATE_PLAN'
  | 'TODAY_SESSIONS'
  | 'TRY_SIMULATOR'
  | 'CONTINUE_LESSONS';

export interface Recommendation {
  kind: RecommendationKind;
  priority: Priority;
  /** Values interpolated into the localized sentence on the client. */
  params: Record<string, string | number | null>;
  href: string;
}

export interface OfficialStatusLine {
  key: 'REGISTRATION' | 'EXAM' | 'RESULTS' | 'FRAMEWORK';
  status: EventStatus | Verification;
  dates_fr: string | null;
  dates_ar: string | null;
  record_id: string | null;
  source_url: string | null;
  last_verified: string | null;
}

export interface Dashboard {
  official: OfficialStatusLine[];
  upcoming: CalendarEvent[];
  announcements: Announcement[];
  unread: number;
  recommendations: Recommendation[];
  today: PlanSession[];
  progress: { lessons_done: number; lessons_total: number; attempts: number; best_score: number | null };
}

export interface Proposal {
  id: number;
  kind: ProposalKind;
  title_fr: string;
  title_ar: string;
  detail_fr: string | null;
  detail_ar: string | null;
  payload: Record<string, unknown>;
  source: 'MONITORING' | 'SEED' | 'MANUAL';
  record_id: string | null;
  priority: Priority;
  mandatory: boolean;
  teacher_verification: boolean;
  edition_id: number | null;
  status: ProposalStatus;
  created_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface CoefficientRow {
  id: number;
  edition_id: number;
  stream_id: number;
  subject_id: number;
  coefficient: number | null;
  duration_minutes: number | null;
  is_optional: number;
  state: RowState;
  verification: Verification;
  source_record_id: string | null;
  source_note: string | null;
  version: number;
  superseded_by: number | null;
  created_by_name: string | null;
  created_at: string;
  verified_by_name: string | null;
  verified_at: string | null;
}

export interface MonitoringRun {
  id: number;
  checked_at: string;
  previous_check: string | null;
  coverage: string | null;
  summary: Record<string, unknown>;
  report_file: string | null;
  report_markdown?: string | null;
  imported_at: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
}

export interface AdminOverview {
  pending_proposals: number;
  mandatory_pending: number;
  draft_announcements: number;
  provisional_tables: number;
  unreviewed_content: number;
  records: { total: number; verified: number; partial: number; unverified: number };
  users: { students: number; staff: number };
  last_run: MonitoringRun | null;
  ai: { enabled: boolean; model: string };
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
