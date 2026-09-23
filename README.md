# NOUR

A private NCC Level 10 study coach with source-backed chat, interactive drills,
optional voice, timed mock exams and saved learning progress.

## Start locally

Use Node.js 22.16 or later (Node 22 is used in CI).

```sh
npm ci
npm run setup
```

Open `.env.local`. Setup generates a unique `APP_ACCESS_PASSWORD` and `AUTH_SECRET`
without overwriting an existing environment file or printing credentials. Add
`KIMI_API_KEY` and choose a `KIMI_MODEL` available in your Moonshot account. Add
`OPENAI_API_KEY` if you want voice. Then:

```sh
npm run db:migrate
npm run dev
```

Open http://localhost:3000 and unlock it with `APP_ACCESS_PASSWORD` from `.env.local`.
On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.
The launch commands load `.env.local` at Node startup. If your network uses a
certificate installed in the operating system's trust store, use a Node version
that supports `--use-system-ca` and add `NODE_OPTIONS=--use-system-ca` to your
local `.env.local`. This keeps HTTPS certificate verification enabled.
Text chat needs the coaching API key; browsing saved work and local retrieval do not.
No provider keys are committed. Automated unit/browser tests never call paid APIs.
The separately invoked live conversation evaluation does; it requires `--live`.

## How the coach works

- The server searches the knowledge bank with BM25 keyword ranking, acronym expansion,
  category context and follow-up handling. It retains supporting sources for short quiz
  answers instead of searching for the letter alone. It does not compare incompatible vectors.
- Saved, authorized conversation history supplies continuity. Clients cannot inject system
  messages or another session's history. Recent weak topics and mistakes inform revision.
- Difficult scenarios, calculations and analytical questions automatically use Kimi K3's
  `high` reasoning effort. Ordinary recall uses `low`; saying "think deeply" also selects
  high. This is a tested routing heuristic, not a guarantee that difficulty is always detected.
  Streaming completion caps are 8,192 tokens for low and 16,384 for high, including thinking;
  provider timeouts are 120 and 240 seconds. Automatic routing never chooses `max`.
- The teaching persona is `data/coach-policy.md`. Runtime evidence rules in
  `src/lib/coaching.ts` override unsupported factual assertions in that persona; the old
  `NCC_Study_Partner_System_Prompt_v1.md` is a historical design reference, not runtime policy.
- Answers show source excerpts and publication links where checked. Missing NCC evidence
  requires an explicit limitation; ordinary calculations/general explanations are labeled
  separately. Conflicts and dynamic claims must be marked for verification.
- Model citations are checked against retrieved source IDs. This is a structural check;
  it cannot prove that every explanation or generated answer is factually correct.
- Chat turns have stable IDs, recoverable partial messages, cancellation and idempotent retries.
  Only completed turns are included in subsequent model history. At most 40 recent messages
  and 32,000 history characters are included; this is bounded context, not unlimited memory.
  Private provider reasoning is neither displayed nor saved as conversation history.

The committed legacy corpus is available for study, but its original PDF is absent. Its old
chapter labels are unreliable. Runtime labels are conservatively inferred from actual text,
source IDs remain stable, and legacy material is marked `VERIFY`. No original page numbers
or independent currency verification are invented. See [knowledge bank workflow](docs/knowledge-bank.md)
to regenerate from an authorized source PDF with traceable pages, sections and hashes.
The separate `data/verified-materials.json` supplement contains four passages checked against
NCC/ITU publications. A checked publication is not certification of current legal applicability
or of the rest of the study bank. Source cards expose review dates and currency limitations.

Run the reproducible [conversation evaluation](docs/conversation-evaluation.md) to check
grounded accuracy, difficult reasoning, follow-up understanding and unsupported premises.
Reports retain the actual answers for human review; a passing regression check is not a
general intelligence score.

```sh
npm run eval:conversation
npm run eval:conversation -- --live
```

The first command checks fixtures and retrieval without provider calls. The second makes
up to ten sequential paid requests, with explicit input, completion and elapsed-time caps.

## Exams and progress

The simulator validates 5 distinct questions with four choices and actual source IDs.
Generation uses high reasoning effort with a 24,576-token completion cap and at most one
schema repair within the overall request deadline.
It stores the complete attempt on the server and withholds answer keys until submission.
Answers save with revision checks; a stale save cannot overwrite newer work. The 30-minute
deadline uses server time and survives reloads. Answers received after expiry do not change
the grade. Submitting again returns the original result.

Progress includes saved exam results, weak topics, a mistake notebook with explanations and
sources, and targeted revision. The 90% threshold is a training target, not an exam guarantee.
Chat quizzes provide conversational practice; the persistent quantitative record comes from
server-graded mock exams. Review generated questions against their excerpts.

## Private access and deployment

This is one learner's private study space. All successful password logins access that same
learner's history. Do not share its password as if it were a multi-account service.

Production requires `APP_ACCESS_PASSWORD` (12+ characters), `AUTH_SECRET` (32+ characters),
`DATABASE_URL`, `KIMI_API_KEY` and the chosen model. Use HTTPS and set `APP_ORIGIN` to the
exact public origin when using a reverse proxy. Cookies are signed, HttpOnly, SameSite=Strict,
and Secure in production. Logout revokes the server login. Changing the password or signing
secret invalidates existing cookies. Passwordless access is limited to unconfigured local development.

For hosted/serverless deployments, use a persistent Turso database (`libsql://...`) and
`TURSO_AUTH_TOKEN`; the local SQLite file is for a persistent local host. Run the versioned
migrations against the selected database once before starting a release:

```sh
npm run db:migrate
npm run build
npm start
```

The migration runner preserves existing Session/Message data and assigns it to the private
learner. It tracks migration checksums and fails on schema errors. Do not use `prisma db push`
alongside this workflow. `prisma/setup.sql` is retained only as a historical schema reference.
Knowledge JSON and the policy file are explicitly included in traced Next.js deployment output.

Database-backed quotas cap chat/voice requests, exam generation, and the combined daily AI
request count. `DAILY_AI_REQUEST_LIMIT` defaults to 300; hourly defaults are 90 chat requests,
6 exam generations, 90 transcriptions and 90 speech requests. An exam can make up to two bounded
provider calls to repair invalid output. These are request caps, not a guaranteed monetary ceiling.
Provider responses, transcripts and secrets are not printed in application error logs.

## Voice

Voice is optional and clearly labeled as AI-generated. The app chooses a supported browser
recording format, stops microphone tracks on cancellation/navigation, and aborts pending work.
Recordings are limited to 10 MB; spoken responses use at most 4,000 characters per request.
Transcription does not force English, allowing the provider to detect the language. Language
quality and voice availability depend on the provider. See the official
[audio reference](https://developers.openai.com/api/reference/typescript/resources/audio)
and [speech guidance](https://developers.openai.com/api/docs/guides/text-to-speech).

## Backups and restoration

```sh
npm run db:backup
```

This exports a consistent snapshot of sessions, messages and exams to the ignored `backups/`
folder. It excludes login sessions and quotas. Keep backups private and copy them to secure storage.
To restore, point `DATABASE_URL` at a new empty database, migrate it, then run:

```sh
npm run db:migrate
npm run db:restore -- backups/nour-DATE.json
```

Restore refuses to overwrite existing study data and applies rows transactionally. Validate
the restored sessions and exams before switching a deployment to the restored database.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Tests cover real isolated SQLite persistence, ownership, quotas, expired exams, revision conflicts,
SSE fragmentation/cancellation, retrieval, metadata and invalid model output. Browser tests mock
external services. Playwright uses installed Chrome on Windows; set `PLAYWRIGHT_CHROME_PATH`
if necessary. On Linux run `npx playwright install chromium` first. CI runs these checks on Node 22.

## Project structure

- `src/app/api`: authenticated chat, sessions, audio, exams and progress routes.
- `src/lib`: retrieval, coaching, provider calls, validation, persistence and access controls.
- `src/hooks`, `src/components`: independent chat, voice and exam lifecycles and accessible UI.
- `prisma/migrations`: versioned SQLite/Turso changes.
- `scripts`: environment setup, migrations, backup/restore and PDF ingestion.
- `tests`, `e2e`: domain/integration and browser regression coverage.

Proprietary — created for Musterferh.
