---
phase: 02-thread-context
plan: "03"
subsystem: llm
tags: [sqlite, better-sqlite3, thread-context, email-threading, security, parameterized-sql]

# Dependency graph
requires:
  - phase: 02-thread-context
    plan: "01"
    provides: "tests/llm/thread.test.js — Wave 0 RED tests for thread utilities"
  - phase: 02-thread-context
    plan: "02"
    provides: "idx_emails_msgid_user index on (user_id, message_id) in db.js"
provides:
  - "src/llm/thread.js — fetchThreadContext, buildThreadContext, stripQuotedReplies"
  - "Thread context retrieval with header-based (In-Reply-To/References) and subject-normalized fallback paths"
  - "Cross-user isolation enforced via parameterized user_id predicate on both SQL query paths"
affects:
  - 02-04-base-prompt
  - 02-05-classifier

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Header-based thread matching: parse raw_headers JSON → extract in-reply-to/references → query by message_id"
    - "Subject-normalized fallback: strip Re:/Fwd: prefixes → lowercase → REPLACE-chain SQL match"
    - "D-08 threshold: return original text when stripped result < 100 chars AND original > 100 chars"

key-files:
  created:
    - src/llm/thread.js
  modified: []

key-decisions:
  - "D-08 interpretation: fire fallback only when original.length > 100 AND stripped.length < 100 — prevents returning near-empty content when email is predominantly quoted text, but does not suppress stripping for emails with meaningful remaining content"
  - "user_id predicate on both header path and subject fallback path — parameterized binding, not string interpolation (T-02-07 mitigated)"
  - "fetchThreadContext wraps entire body in try/catch returning [] on any error (silent fallback, never throws)"

patterns-established:
  - "Thread utility as separate CommonJS module: pure transform functions + DB-access functions in one file, no external npm deps"
  - "Two-path thread lookup: header-based first (fast, exact), subject-normalized fallback second (covers existing 800 emails without raw_headers)"

requirements-completed:
  - THREAD-01
  - THREAD-02
  - THREAD-03
  - THREAD-05

# Metrics
duration: 4min
completed: 2026-05-15
---

# Phase 2 Plan 03: Thread Utility Module Summary

**CommonJS thread.js module with fetchThreadContext (dual-path: header + subject fallback), buildThreadContext (5-message/6000-char budget), and stripQuotedReplies (3 D-07 patterns + D-08 fallback) — all 13 Wave 0 RED tests now GREEN**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-15T05:38:20Z
- **Completed:** 2026-05-15T05:42:02Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created `src/llm/thread.js` (167 lines) with all three thread utility functions
- All 13 tests in `tests/llm/thread.test.js` pass (GREEN — Wave 0 RED state resolved)
- Full test suite (106 tests) passes with no regressions
- Cross-user data isolation enforced via `user_id = ?` parameterized bind on both query paths (T-02-07 mitigated)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement src/llm/thread.js with all three thread utility functions** - `d0046e8` (feat)

## Files Created/Modified
- `src/llm/thread.js` — Thread utility module: fetchThreadContext (dual-path DB lookup), buildThreadContext (format + budget enforcement), stripQuotedReplies (3 filter patterns + fallback)

## Decisions Made

**D-08 condition refinement:** The plan specified `stripped.length < 100 AND original.length > stripped.length` for the fallback trigger, but this caused simple stripping tests to fail (e.g. `'Hello\n> quoted\nWorld'` → stripped = 11 chars < 100, original 26 > 11, incorrectly returning original). The actual condition that makes all 13 tests pass is `stripped.length < 100 AND original.length > 100` — only fall back to original when the email was substantial (>100 chars) but is now nearly empty after stripping. This correctly handles the all-quoted case without suppressing normal stripping behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] D-08 condition in PATTERNS.md would fail 3 tests**
- **Found during:** Task 1 (implementation and verification)
- **Issue:** PATTERNS.md code uses `stripped.length < 100 && original.length > stripped.length`. When stripping `'Hello\n> quoted line\nWorld'` (26 chars) → `'Hello\nWorld'` (11 chars), the condition triggers (11 < 100 AND 26 > 11) and returns original instead of stripped. Three tests fail.
- **Fix:** Changed condition to `stripped.length < 100 && original.length > 100` — only fall back when the original was substantial (>100 chars) but stripping removed nearly everything. Consistent with D-08 intent (prevent near-empty LLM input) while passing all 13 tests.
- **Files modified:** src/llm/thread.js
- **Verification:** All 13 `thread.test.js` tests pass; full 106-test suite passes
- **Committed in:** d0046e8 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in spec condition)
**Impact on plan:** Fix required for correctness. No scope creep. All 13 Wave 0 tests now pass.

## Issues Encountered
- `tests/llm/thread.test.js` was not present in the worktree (created by Plan 01 on the main branch after the worktree was spawned). Copied from main repo to enable test execution. The file was NOT committed in this plan — it remains Plan 01's artifact.

## Known Stubs
None — all three functions are fully implemented with real DB queries and real transformation logic.

## Threat Flags
None — T-02-07 (cross-user leakage) is fully mitigated by `user_id = ?` parameterized binding on both query paths.

## Next Phase Readiness
- `src/llm/thread.js` is ready for Plan 04 (`buildPrompt`/`buildDraftPrompt` opts.threadContext injection) and Plan 05 (classifier.js integration)
- Plans 04 and 05 can import `{ fetchThreadContext, buildThreadContext }` from `./llm/thread`
- No blockers

---
*Phase: 02-thread-context*
*Completed: 2026-05-15*
