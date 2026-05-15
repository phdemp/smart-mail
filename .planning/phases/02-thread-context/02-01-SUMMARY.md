---
phase: 02-thread-context
plan: 01
subsystem: testing
tags: [node-test, sqlite, better-sqlite3, tdd, thread-context, llm-logging]

# Dependency graph
requires: []
provides:
  - "Wave 0 failing test suite covering all 7 THREAD requirements"
  - "tests/llm/thread.test.js: 13 RED tests for stripQuotedReplies, buildThreadContext, fetchThreadContext"
  - "tests/llm/base.test.js: 4 new tests for opts.threadContext injection (THREAD-04/07)"
  - "tests/llm/router.test.js: 2 new tests for llm_logs INSERT verification (THREAD-06)"
affects:
  - 02-02-PLAN
  - 02-03-PLAN
  - 02-04-PLAN
  - 02-05-PLAN

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DB isolation in tests: process.env.DB_PATH set before any src/db require, unique path per file"
    - "Wave 0 RED tests: tests import from src modules that don't exist yet, fail with MODULE_NOT_FOUND"
    - "test.before/test.after lifecycle for DB setup/teardown with fs.rmSync"

key-files:
  created:
    - tests/llm/thread.test.js
  modified:
    - tests/llm/base.test.js
    - tests/llm/router.test.js

key-decisions:
  - "Thread utility tests placed in tests/llm/thread.test.js (not classifier.js tests) per file-placement decision from CONTEXT.md"
  - "router.test.js gets DB isolation (DB_PATH + test.before/after) to support llm_logs table query in new tests"
  - "buildDraftPrompt tests reference function that does not yet exist in base.js exports — correct RED state, not a bug"
  - "13 test cases covers all THREAD-01 through THREAD-05 behaviors; extra test for --- Original Message --- separator added beyond minimum"

patterns-established:
  - "DB isolation pattern: const dbPath = path.join(__dirname, '..', '..', 'intellimail-{feature}-test.db'); process.env.DB_PATH = dbPath; before any requires"
  - "Wave 0 RED state: test.before requiring src/llm/thread causes all dependent tests to fail with MODULE_NOT_FOUND — confirmed correct"
  - "Append-only test extension: new tests added at end of existing files with Phase 2 comment header"

requirements-completed:
  - THREAD-01
  - THREAD-02
  - THREAD-03
  - THREAD-04
  - THREAD-05
  - THREAD-06
  - THREAD-07

# Metrics
duration: 6min
completed: 2026-05-15
---

# Phase 2 Plan 01: Thread Context Test Scaffolding Summary

**Wave 0 test scaffolding: 19 new failing tests covering all 7 THREAD requirements — RED state confirmed via MODULE_NOT_FOUND and assertion errors**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-15T05:18:11Z
- **Completed:** 2026-05-15T05:24:11Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `tests/llm/thread.test.js` with 13 test cases (4 stripQuotedReplies, 5 buildThreadContext, 4 fetchThreadContext) covering all THREAD-01 through THREAD-05 behaviors
- Extended `tests/llm/base.test.js` with 4 tests for `opts.threadContext` injection in `buildPrompt` and `buildDraftPrompt` (THREAD-04 and THREAD-07)
- Extended `tests/llm/router.test.js` with 2 tests for `llm_logs` INSERT verification after success/error paths (THREAD-06)
- Added DB isolation to `router.test.js` (unique `DB_PATH` + `test.before`/`test.after` lifecycle) to support Phase 2 DB-dependent assertions
- All 93 pre-existing tests continue to pass with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tests/llm/thread.test.js** - `eb41ed2` (test)
2. **Task 2: Extend base.test.js and router.test.js** - `8f04b77` (test)

## Files Created/Modified

- `tests/llm/thread.test.js` - 13 RED tests for stripQuotedReplies, buildThreadContext, fetchThreadContext with full DB isolation pattern
- `tests/llm/base.test.js` - Extended with 4 tests for opts.threadContext injection in buildPrompt/buildDraftPrompt
- `tests/llm/router.test.js` - Extended with 2 tests for llm_logs INSERT, added DB isolation at top

## Decisions Made

- Used `path.join(__dirname, '..', '..', 'intellimail-thread-test.db')` as isolated DB path for thread tests (unique filename prevents collision with other test DBs)
- Added DB isolation to the TOP of `router.test.js` (before `require('../../src/llm/router')`) so the DB_PATH is set before any module load, even though current router.js doesn't use DB
- `buildDraftPrompt` tests correctly fail with `TypeError: buildDraftPrompt is not a function` because it's not yet exported from base.js — this is valid RED state, not a test error
- Added 4th stripQuotedReplies test for `--- Original Message ---` pattern beyond the 3 required by behavior spec, for completeness

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Research document claimed 103 pre-existing tests; actual count is 93. The discrepancy is likely from how the research was run (may have included tests in a different state or used a different counting method). All 93 actual pre-existing tests pass without regression. This is not a blocking issue.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 0 test scaffold complete — all THREAD requirements have corresponding failing tests
- Plans 02-05 (implementation plans) can now proceed in Wave 1/Wave 2; as each plan lands, its corresponding tests will turn GREEN
- Plan 02: `src/db.js` migration (llm_logs table) will partially fix router.test.js test errors (SQLITE_ERROR → AssertionError)
- Plan 03: `src/llm/thread.js` implementation will fix all 13 thread.test.js failures
- Plan 04: `src/llm/providers/base.js` extension will fix 3 base.test.js failures
- Plan 05: `src/llm/router.js` extension will fix 2 router.test.js failures

---

## Self-Check

- [x] `tests/llm/thread.test.js` exists
- [x] `tests/llm/base.test.js` modified (verified with node --test)
- [x] `tests/llm/router.test.js` modified (verified with node --test)
- [x] Commits eb41ed2 and 8f04b77 exist in git history
- [x] All 93 pre-existing tests still pass

## Self-Check: PASSED

All files exist and are committed. All pre-existing tests pass. New tests are in expected RED state.

---
*Phase: 02-thread-context*
*Completed: 2026-05-15*
