# BAC MASTER AI

Bilingual (French / Arabic, full right-to-left) preparation platform for the Algerian baccalauréat, built around one rule: **only verified official information reaches students**, and every piece of content says where it comes from.

## Run it locally

Requirements: Node.js 22.18 or later (Node 24 recommended). Nothing else: the database is SQLite, built into Node.

```bash
cd bac-master-ai
npm install          # once
npm run setup        # once: creates .env with a random administrator password
npm run build        # builds the web client
npm start            # http://127.0.0.1:8787
```

Sign in as the administrator with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`, or create a student account from the sign-in page.

For development with hot reload: `npm run dev`, then open http://localhost:5173 (the API runs on port 8787 behind it).

Other commands: `npm test` (54 API and unit tests on an in-memory database), `npm run typecheck`, `npm run import:papers -- <manifest.json>` (bulk import of past papers, see below).

### Official past papers in the exam simulator

`npm run import:exam -- content/exams/<file>.json` loads a past BAC paper as a timed mock exam: the official statements and the official model answer and marking scale, transcribed from the scans (Arabic original, French translation flagged as such). It is shown to students of the paper's stream in every session, with the official duration, and a review task asks a teacher to check the transcription against the PDF in Annales. A file may hold one exam or an array (both subjects of a session). Loaded so far (`content/exams/`): BAC 2008, 2009 and 2010 mathematics, subjects 1 and 2, for every stream (M, SE, TM, GE, and LP/LE, which share one paper): 30 official mock exams. Where a question relies on a printed figure, the figure is replaced by its data (points or a table of values) and the exam instructions say so. Where the official key leaves out a result (some 2008 keys give only the marking scale), the platform's computed answer is marked « Complément de la plateforme » / «إضافة من المنصة»; where the key contains an obvious slip, the instructions name it and give the corrected value. Maths papers were chosen first because they survive transcription to text; physics and natural-science papers rely on figures and documents.

### Revision lessons

`npm run import:lessons -- content/lessons/*.json` loads revision chapters (a lesson and a corrected exercise, French and Arabic). They are written by AI, stored as `AI_GENERATED`, their place in the official programme is marked unverified, and one review task per subject asks a teacher to check them. Loaded so far: 97 chapters following the units of the 3AS programme — maths 14 (sequences, exponential, probability, logarithm, integration, complex numbers, limits and continuity, derivatives, space geometry, differential equations, arithmetic for M/TM, two-variable statistics for GE, congruences and functions for LP/LE), physics 10 (adds falling bodies, satellites, esterification, fission/fusion, and oscillations for M/TM), natural sciences 7 (adds respiration/fermentation and plate tectonics), Arabic 8, philosophy 8, history-geography 8, French 7 (the fantastic short story for LP/LE only), English 8, Islamic sciences 8, economics 6, law 5, accounting 8. A chapter is shown only to the streams listed in its file. Not written on purpose: Tamazight, the third foreign language, technology (four engineering branches), arts and sport, which need specialist teachers.

### Past papers in bulk

`npm run import:papers -- <manifest.json>` files many PDFs at once. The manifest is a JSON array; each entry gives `file` (path relative to the manifest), `exam_year`, `stream` and `subject` codes (`M`, `SE`, `MATH`, `PHYS`... or `null`), `language`, `doc_type`, `title`, `source_authority`, `verification` and an optional `note`. Entries go through the same checks as the upload form, and an entry already in the archive is skipped, so a manifest can be run again safely.

The official annals 2008–2016 (subjects with the ONEC model answers and marking scales) come from ONEFD, the ministry's distance-learning office: `https://www.onefd.edu.dz/ANNALES_BAC/ANNALES.html`, one zip per stream. 2008–2010 are page images and were rebuilt into one PDF per subject; 2011–2016 are one PDF per stream and year, kept whole. The working files are in `data/import-onefd/` (zips, extracted files, `build/manifest.json`).

### AI tutor

The tutor answers from the platform's own documents (official records, lessons, exercises), cites them by number, answers in the student's language and labels every answer as AI-generated. Official facts (dates, coefficients, rules) are given only when an official document in the platform states them; otherwise it says that nothing verified is available. Two engines are supported; `TUTOR_PROVIDER` in `.env` chooses (`local`, `anthropic`, `none`).

**Local, free, offline (default):** an open model run by [Ollama](https://ollama.com) on this computer.

```bash
winget install Ollama.Ollama      # once
ollama pull qwen3:8b              # once, 5.2 GB
```

`.env`: `TUTOR_PROVIDER=local`, `OLLAMA_MODEL=qwen3:8b`, `OLLAMA_THINK=true` (reasoning mode, more accurate in maths), `OLLAMA_NUM_CTX=12288` (keeps the model entirely on an 8 GB GPU; spilling to the CPU is about 4 times slower). Qwen3 8B was chosen after a side-by-side test against Qwen3.5 9B on maths, physics and official-information questions in French and Arabic: 10/10 against 8/10, and 6 to 25 seconds per answer on an RTX 2060 SUPER against 40 to 80. A small model can still make mistakes: answers are labelled AI-generated and students should compare with the official corrections in Annales.

**Claude API:** `TUTOR_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=...`. Uses `claude-opus-5-5` with streaming.

Each student can ask `TUTOR_DAILY_LIMIT` questions per 24 hours (default 40; staff are not limited). With `TUTOR_PROVIDER=none` the tutor answers only with matching platform documents, never with generated text.

### Accounts and backups

- **Forgotten password:** there is no e-mail service, so an administrator opens Administration → Utilisateurs, clicks "Lien de réinitialisation" and hands the link to the person. It works once, for 24 hours, and closes the account's other sessions.
- **Backups:** the server copies the database to `data/backups/bacmaster-<date>.db` at startup and then once a day, keeping 14 days (`BACKUP_KEEP_DAYS`). Hosted PDFs in `data/papers/` never change once written: back that folder up once, then incrementally. Copy `data/backups/` to another disk or machine regularly; a backup on the same disk does not survive a disk failure.

## What is in it

| Area | Students | Staff |
|---|---|---|
| Official information | Calendar, announcements, official texts with verification badges and source links, rumours checked against official sources | Edit student-facing wording of records, add dates and checked rumours |
| Subjects and coefficients | Published table for their stream, or a personal list until one is verified; weighted average and "grade needed" calculator | Versioned table per session and stream; publishing needs a verification level and the document checked |
| Lessons and exercises | FR/AR content with KaTeX maths, solutions, progress | Review (changes the label), flag as outdated, edit (creates a new version) |
| Exam simulator | Timed paper (server-side clock), corrections hidden until handed in, self-marking, results per exercise | Review practice papers |
| Revision planner | Sessions weighted by coefficient and self-assessed level, laid over the official school calendar | |
| AI tutor | Chat grounded in the platform's own documents, each source shown with its provenance | |
| Past papers | Filterable archive; hosted PDFs open for signed-in users | Upload a PDF (stored in `data/papers/`, 25 MB max, real PDFs only) or add a link. An entry can be filed as an official correction or marking scheme only if its source is verified |
| Administration | | Review queue, monitoring imports and reports, users and roles, append-only audit log |

## Integrity rules (enforced in the code and covered by tests)

- No BAC 2027 registration, exam or results date is shown until an official source announces one.
- Coefficient tables seeded at install are **provisional and hidden**: they were typed from memory and must be checked against the official text (arrêté n° 186 du 23 mars 2006 modifié) and published by a teacher.
- An announcement can be published only if it cites a fully verified official record and has no `[placeholder]` left; only administrators publish.
- A calendar date can be "confirmed" only with a verified source.
- Nothing is overwritten: coefficients and lessons are versioned, records keep a history, rows are retired rather than deleted, and staff actions are logged.
- AI-generated content and answers are always labelled and never presented as official.

## Monitoring

The monitoring agent's prompt is in `monitoring/MASTER_PROMPT.md`. Each run writes `monitoring/records.json` and `monitoring/reports/<date>-report.md` (official scans go in `monitoring/evidence/`). In the app, **Administration → Veille → Importer** reads them: new or changed records become review tasks and are never shown to students before a person approves them.

**Daily run:** `monitoring/run-daily.ps1` runs the agent headless with Claude Code (`claude -p`), allowed to read the web and to write only inside `monitoring/`; logs go to `monitoring/logs/`. To run it every morning at 07:30, register it once as a Windows scheduled task:

```powershell
powershell -ExecutionPolicy Bypass -File monitoring\install-schedule.ps1            # install
powershell -ExecutionPolicy Bypass -File monitoring\install-schedule.ps1 -Remove    # remove
```

Each run uses your Claude Code plan. In November, check the morning report: BAC registration has been announced only one day before it opens.

## Layout

```
server/      Hono API (TypeScript run natively by Node), SQLite schema, seed data, tests
src/         React 19 + Tailwind v4 client (pages, components, FR/AR strings in src/i18n)
shared/      Types used by both sides
monitoring/  Monitoring prompt, records, reports, evidence
data/        SQLite database (created on first start, not committed)
```

## Before going live

- Have a teacher verify and publish each stream's coefficient table (review queue).
- Have the sample mathematics content (AI-written) reviewed.
- Serve over HTTPS and set `COOKIE_SECURE=true`; set `HOST=0.0.0.0` only behind a reverse proxy.
