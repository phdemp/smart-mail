---
phase: 04-provider-observability
plan: 01
subsystem: testing
tags: [node-test, test-stubs, health-endpoint, warmup-delay, htmx]

# Dependency graph
requires: []
provides:
  - "Failing test stubs for GET /api/llm/health (OBSERVE-01)"
  - "Failing test stubs for GET /api/llm/health/pill (OBSERVE-04)"
  - "Failing test stub for classifyAllUnclassifiedForUser 30s warmup delay (OBSERVE-05)"
affects:
  - "04-02 (wave 1) — must satisfy these stub contracts during implementation"
  - "04-03 (wave 2) — soft-failure cascade tests in router.test.js (separate file)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "test.todo() stubs with named test strings define behavioral contract before implementation"
    - "Inline Express test app with injectable mock for getProviderHealth (avoids importing full api.js)"
    - "HTTP request() helper pattern from scoping.test.js — project standard, copied verbatim"

key-files:
  created:
    - tests/api/health.test.js
    - tests/server.test.js
  modified: []

key-decisions:
  - "Use test.todo() for all stubs — stubs are pending (not failing), full suite exits 0"
  - "Mock getProviderHealth via module-level variable injection in inline Express app — avoids importing all of api.js with its side effects"
  - "tests/server.test.js does not import server.js directly — server starts HTTP listener on require, would conflict with test process"

patterns-established:
  - "Nyquist compliance: test stubs created in wave 0 before any implementation in wave 1"
  - "Injectable mock pattern: module-level variable swapped between tests for getProviderHealth"

requirements-completed:
  - OBSERVE-01
  - OBSERVE-04
  - OBSERVE-05

# Metrics
duration: 10min
completed: 2026-05-15
---

# Phase 4 Plan 01: Provider Observability Test Stubs Summary

**Nyquist-compliant test stubs for health endpoint shape (OBSERVE-01/04) and 30s startup warmup delay (OBSERVE-05), all pending via test.todo(), leaving the 132-test suite green**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-15T13:32:00Z
- **Completed:** 2026-05-15T13:42:37Z
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments
- Created tests/api/health.test.js with 4 todo stubs covering GET /api/llm/health (shape + auth) and GET /api/llm/health/pill (empty vs amber behavior)
- Created tests/server.test.js with 1 todo stub for the classifyAllUnclassifiedForUser 30s warmup delay behavior
- Full test suite maintained at 132 pass, 0 fail, 5 todo (the 5 new stubs) — acceptance criteria met exactly

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tests/api/health.test.js** - `eae9bf7` (test)
2. **Task 2: Create tests/server.test.js** - `b5455d6` (test)

**Plan metadata:** (committed with this SUMMARY)

## Files Created/Modified
- `tests/api/health.test.js` - 4 todo stubs for health endpoint and pill fragment; inline Express app with injectable mock getProviderHealth; request() helper and seed() from scoping.test.js
- `tests/server.test.js` - 1 todo stub for 30s startup warmup delay; no server.js import; uses node:test mock.timers pattern

## Decisions Made
- Used test.todo() not test.skip() — the plan explicitly requires pending stubs that do not pass yet
- Inline Express app in health.test.js mounts only the two health routes (not all of api.js) to avoid side effects from the full router (DB connections, IMAP sync start)
- server.test.js imports nothing from server.js — server.js calls app.listen() on require, which would bind a port and could conflict with parallel test execution

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 1 (plan 04-02) can begin: test stubs define the behavioral contract for the health endpoint, pill fragment, and warmup delay
- Implementation must satisfy: `GET /api/llm/health` returns `{ providers, failed_count }`, `/api/llm/health/pill` returns empty string when all ok, amber pill with "AI features degraded" text when any non-ok
- The injectable mock pattern in health.test.js is ready to be replaced with real route imports once api.js has the health routes

## Self-Check

- `tests/api/health.test.js` — FOUND
- `tests/server.test.js` — FOUND
- Commit `eae9bf7` — FOUND
- Commit `b5455d6` — FOUND
- Full suite: 132 pass, 0 fail, 5 todo — VERIFIED

## Self-Check: PASSED

---
*Phase: 04-provider-observability*
*Completed: 2026-05-15*
