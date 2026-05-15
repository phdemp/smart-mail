---
phase: 04-provider-observability
plan: 02
subsystem: backend
tags: [health-endpoint, soft-fail, circuit-breaker, htmx, server-startup, observability]

# Dependency graph
requires:
  - "04-01 — test stubs for health endpoint and warmup delay"
provides:
  - "GET /api/llm/health returns { providers, failed_count } (OBSERVE-01)"
  - "GET /api/llm/health/pill returns amber pill HTML or empty string (OBSERVE-04)"
  - "Soft-failure gate in router._callProviders() with soft_fail llm_logs outcome (OBSERVE-06)"
  - "30-second startup warmup delay wrapping classifyAllUnclassifiedForUser (OBSERVE-05)"
affects:
  - "04-03 (wave 2) — Settings health panel and dashboard pill insertion"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Soft-failure gate: validate parsed.category against CATEGORIES enum before accepting LLM result"
    - "isSoftFail condition excludes draft mode (Pitfall 2 from RESEARCH.md — draft has no category field)"
    - "HTMX pill endpoint returns empty string (not 401/404) when all providers ok — hx-swap=innerHTML keeps wrapper in DOM"
    - "setTimeout warmup pattern: startSyncForUser immediate, classifyAllUnclassifiedForUser delayed 30s"

key-files:
  created: []
  modified:
    - src/llm/router.js
    - src/routes/api.js
    - src/server.js
    - tests/api/health.test.js
    - tests/llm/router.test.js

key-decisions:
  - "Soft-fail gate uses mode !== 'draft' guard to prevent false cascade on draft mode (no category field in draft results)"
  - "Soft failures do NOT increment br.fails — content issue not availability failure (D-13)"
  - "Pill route returns empty string (200 OK) when all ok — allows HTMX hx-swap=innerHTML to keep wrapper div in DOM for polling"
  - "New health routes are NOT added to PUBLIC_API_PATHS — global requireAuth in server.js applies automatically"

# Metrics
duration: 3min
completed: 2026-05-15
---

# Phase 4 Plan 02: Provider Observability Backend Implementation Summary

**Soft-failure cascade gate in router.js (OBSERVE-06), two health API endpoints in api.js (OBSERVE-01/04), 30s startup warmup delay in server.js (OBSERVE-05), and 8 new passing tests replacing todo stubs**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-15T13:45:09Z
- **Completed:** 2026-05-15T13:48:00Z
- **Tasks:** 2
- **Files modified:** 5 (0 new, 5 modified)

## Accomplishments

- Modified `src/llm/router.js`: Added `CATEGORIES` to import, restructured `_callProviders()` success path with soft-fail gate — cascade on null/invalid category or empty summary, log `soft_fail` to `llm_logs`, no `br.fails` increment
- Modified `src/routes/api.js`: Added `GET /api/llm/health` (JSON shape `{ providers, failed_count }`) and `GET /api/llm/health/pill` (amber pill HTML fragment or empty string)
- Modified `src/server.js`: `startSyncForUser` called immediately, `classifyAllUnclassifiedForUser` wrapped in `setTimeout(fn, 30000)` for 30s startup warmup
- Implemented 4 real tests in `tests/api/health.test.js` replacing `test.todo()` stubs — all 4 pass
- Added 4 new soft-fail cascade tests in `tests/llm/router.test.js` — all 4 pass
- Full suite: **140 pass, 0 fail, 1 todo** (1 remaining todo from server.test.js wave-0 stub, unchanged)

## Task Commits

Each task was committed atomically:

1. **Task 1: Soft-failure gate in router.js + 4 cascade tests** - `5b1c5f1` (feat)
2. **Task 2: Health endpoints in api.js + warmup delay in server.js + health tests** - `fc45a83` (feat)

## Files Created/Modified

- `src/llm/router.js` — CATEGORIES added to import; soft-fail gate inserted between br state updates and mapResult; success llm_logs INSERT moved to after isSoftFail check to prevent double-logging
- `src/routes/api.js` — Two new routes: GET /api/llm/health (JSON) and GET /api/llm/health/pill (HTML fragment); both auth-guarded via global middleware; pill excludes 'unknown' status (Pitfall 5)
- `src/server.js` — init() restructured: startSyncForUser loop runs immediately; classifyAllUnclassifiedForUser loop wrapped in setTimeout with 30000ms delay
- `tests/api/health.test.js` — 4 test.todo() stubs replaced with real tests: 401 without token, { providers, failed_count } shape, empty pill when all ok/unknown, amber pill with exact "AI features degraded" text
- `tests/llm/router.test.js` — 4 new tests added: cascade on null category, cascade on empty summary, no cascade on low_confidence alone, no breaker trip on soft_fail

## Requirements Satisfied

- **OBSERVE-01:** GET /api/llm/health returns { providers: {...}, failed_count: N } with auth guard
- **OBSERVE-02:** Confirmed — router.js already logs structured JSON to llm_logs; `soft_fail` is a new valid outcome value
- **OBSERVE-05:** classifyAllUnclassifiedForUser called only after 30s setTimeout; startSyncForUser called immediately
- **OBSERVE-06:** Soft-failure gate triggers cascade on null category, invalid category, empty summary; does NOT trip circuit breaker; applies only in classify mode (mode !== 'draft')

## Decisions Made

- Used `mode !== 'draft'` guard in isSoftFail condition — draft mode doesn't produce category/summary, so soft-fail check would always cascade (false positive). Only classify mode validates semantic content.
- The success `llm_logs` INSERT was moved from before the isSoftFail check to after it, preventing double-logging when a provider soft-fails (avoids writing both 'success' and 'soft_fail' for the same call).
- Health routes rely on global requireAuth middleware in server.js:74-81 — no per-route `requireAuth` call needed.
- Pill returns `res.send('')` (empty string, 200 OK) when all providers ok/unknown — this allows the HTMX wrapper div to remain in the DOM via `hx-swap="innerHTML"` (Pitfall 3: `outerHTML` would remove the div and stop polling).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The server.test.js `test.todo('classifyAllUnclassifiedForUser is called after 30s delay...')` is a pre-existing wave-0 stub from Plan 01, intentionally left as todo for a future plan that adds injectable dependencies to server.js init().

## Threat Flags

No new threat surface beyond what the plan's STRIDE threat register documents. All new routes are under /api/ and NOT in PUBLIC_API_PATHS — global requireAuth applies automatically. Pill HTML contains no dynamic content (no escHtml needed, no user data inserted).

## Self-Check

- `src/llm/router.js` — FOUND
- `src/routes/api.js` — FOUND
- `src/server.js` — FOUND
- `tests/api/health.test.js` — FOUND
- `tests/llm/router.test.js` — FOUND
- `.planning/phases/04-provider-observability/04-02-SUMMARY.md` — FOUND
- Commit `5b1c5f1` — FOUND
- Commit `fc45a83` — FOUND
- Full suite: 140 pass, 0 fail, 1 todo — VERIFIED

## Self-Check: PASSED

---
*Phase: 04-provider-observability*
*Completed: 2026-05-15*
