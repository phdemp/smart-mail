---
phase: 03-user-correction-loop
plan: "01"
subsystem: testing
tags: [node-test, better-sqlite3, sqlite, schema-migration, tdd, wave-0]

# Dependency graph
requires:
  - phase: 02-thread-context
    provides: inline migration guard pattern (try/catch db.exec), llm_logs table precedent
provides:
  - tests/correction.test.js — 10-test Wave 0 contract covering CORRECT-01, CORRECT-05, CORRECT-07
  - Phase 3 DB schema: user_corrected_category, corrected_at, sender_rules, ai_feedback tables
affects:
  - 03-02 (extends /reclassify endpoint — tests must stay green)
  - 03-03 (adds DB writes to routes tested here)
  - 03-04 (UI layer depends on schema verified here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave 0 test-first: test contract committed before any implementation"
    - "Isolated test DB via process.env.DB_PATH set before require('../src/db')"
    - "Phase 3 DB migrations use existing inline try/catch guard pattern"

key-files:
  created:
    - tests/correction.test.js
  modified:
    - src/db.js

key-decisions:
  - "Phase 3 DB migrations added to src/db.js alongside test file (deviation Rule 2) — PRAGMA schema assertions require live schema from db.js"
  - "Test uses two test.before hooks: first deletes stale DB, second opens db module and seeds user"
  - "sender_rules and ai_feedback tables use separate CREATE TABLE and CREATE UNIQUE INDEX guards (two separate try/catch blocks) matching llm_logs precedent"

patterns-established:
  - "correction.test.js: DB isolation pattern — process.env.DB_PATH before any src/db require, rmSync in before/after"
  - "Schema assertions via PRAGMA table_info(...).all().map(c => c.name) + assert.ok(cols.includes(...))"
  - "Sender rule promotion query shape: COUNT(*) with JOIN emails + substr(from_address, instr('@')+1) = domain"

requirements-completed:
  - CORRECT-01
  - CORRECT-02
  - CORRECT-05
  - CORRECT-06
  - CORRECT-07

# Metrics
duration: 12min
completed: 2026-05-15
---

# Phase 3 Plan 01: User Correction Loop — Wave 0 Test Contract Summary

**10-test schema + DB-layer contract for sender_rules, ai_feedback, and correction audit columns using isolated better-sqlite3 test DB**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-15T15:11:00Z
- **Completed:** 2026-05-15T15:23:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Created `tests/correction.test.js` with 10 named tests covering CORRECT-01, CORRECT-05, and CORRECT-07 requirements
- Added Phase 3 DB migrations to `src/db.js` (user_corrected_category, corrected_at ALTER TABLE guards; sender_rules and ai_feedback CREATE TABLE + UNIQUE INDEX guards)
- All 10 new tests pass; full suite (103 tests) remains green with 0 failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tests/correction.test.js with schema and DB-layer tests** - `63e1878` (test)

**Plan metadata:** (see final commit below)

## Files Created/Modified
- `tests/correction.test.js` — 10-test Wave 0 contract: schema assertions, sender_rules uniqueness, ai_feedback UPSERT idempotency, sender rule promotion query shape, Tier 0 lookup
- `src/db.js` — Phase 3 inline migration guards: ALTER TABLE classifications for audit columns; CREATE TABLE sender_rules + ai_feedback with UNIQUE indexes

## Decisions Made
- Followed existing `INSERT INTO users (email) VALUES (?)` pattern (no password_hash column in users table), not the plan's suggested `(email, password_hash)` variant — plan's suggestion was incorrect for this schema
- Split sender_rules CREATE TABLE and CREATE UNIQUE INDEX into two separate try/catch guards to match the llm_logs table precedent in db.js
- Tests 1–4 assert schema only (PRAGMA table_info); Tests 5–10 assert DB-layer behavior — clean separation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added Phase 3 DB migrations to src/db.js**
- **Found during:** Task 1 (Create tests/correction.test.js with schema and DB-layer tests)
- **Issue:** Plan frontmatter listed only `tests/correction.test.js` as the modified file, but PRAGMA table_info assertions in tests 1–4 require the schema columns/tables to actually exist in the live DB produced by src/db.js. Without the migrations in db.js, all schema assertion tests would fail.
- **Fix:** Added inline migration guards for `user_corrected_category`, `corrected_at` (ALTER TABLE), `sender_rules` table + UNIQUE index, and `ai_feedback` table + UNIQUE index — all following the established Phase 2 try/catch pattern already in db.js.
- **Files modified:** src/db.js
- **Verification:** `node --test tests/correction.test.js` — 10/10 pass; `node --test tests/**/*.test.js` — 103/103 pass
- **Committed in:** 63e1878 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for schema assertion tests to pass. Migrations are exactly what db.js would need in Phase 3 anyway (per 03-PATTERNS.md). No scope creep.

## Issues Encountered
- Plan suggested seeding user with `password_hash` column that does not exist in the actual `users` table schema — used actual schema pattern (`email` only) from `classifier_validation.test.js` analog.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 0 gate satisfied: `tests/correction.test.js` exists and all 10 tests pass
- Phase 3 DB schema is in place: sender_rules, ai_feedback tables and correction audit columns created
- Wave 1 plans (03-02, 03-03) can now extend /reclassify and classifier.js against a verified schema
- No blockers

## Self-Check: PASSED

- FOUND: tests/correction.test.js
- FOUND: src/db.js (with Phase 3 migrations)
- FOUND: commit 63e1878 (task commit)
- FOUND: commit 9b62348 (SUMMARY commit)
- FOUND: .planning/phases/03-user-correction-loop/03-01-SUMMARY.md
- All 10 new tests pass; 103 total tests pass, 0 failures

---
*Phase: 03-user-correction-loop*
*Completed: 2026-05-15*
