---
phase: 03-user-correction-loop
plan: "03"
subsystem: api
tags: [better-sqlite3, sqlite, classifier, sender-rules, correction-loop, tdd]

# Dependency graph
requires:
  - phase: 03-user-correction-loop
    plan: "01"
    provides: sender_rules table, Phase 3 DB schema, correction.test.js test contract
  - phase: 02-thread-context
    provides: INFRA-02 attempt tracking in classifyEmail(), thread context integration
provides:
  - src/classifier.js — Tier 0 sender-rule lookup before Tier 1 regex, source='rule' short-circuit
affects:
  - 03-04 (UI layer — correction history, thumbs widget depend on Tier 0 being in place)
  - Phase 4+ (downstream consumers of source='rule' classification rows)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tier 0 sender-rule check: SELECT from sender_rules before rulesClassify(), mirroring Tier 1 short-circuit shape"
    - "source='rule' (singular) distinguishes Tier 0 hits from source='rules' Tier 1 hits"
    - "Tier 0 calls attempts.delete(attemptKey) consistent with Tier 1 pattern — clears retry counter on rule hit"

key-files:
  created: []
  modified:
    - src/classifier.js

key-decisions:
  - "Tier 0 block placed after attempt tracking (lines 168–177) and before Tier 1 rulesClassify() — email row already fetched, attemptKey already defined"
  - "Tier 0 calls attempts.delete(attemptKey) — consistent with Tier 1 and Tier 2 patterns; prevents orphaned retry counter when a sender rule fires"
  - "storeClassification called with email as 4th arg (IN-02 pattern) — avoids redundant DB round-trip"
  - "source='rule' (singular) chosen per D-06 spec — distinguishable from source='rules' (Tier 1) in query filters"

patterns-established:
  - "Tier 0 sender-rule check: domain = (email.from_address || '').split('@')[1]; skip if falsy; query sender_rules; short-circuit if found"
  - "Multi-tier classifier extension pattern: new tiers insert BEFORE the tier they precede, after any variables they depend on"

requirements-completed:
  - CORRECT-05

# Metrics
duration: 15min
completed: 2026-05-15
---

# Phase 3 Plan 03: Tier 0 Sender-Rule Lookup in classifyEmail() Summary

**Tier 0 sender-rule override inserted in classifier.js — future emails from corrected sender domains are auto-classified via DB lookup (source='rule') without touching LLM or regex tiers**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-15T09:38:00Z
- **Completed:** 2026-05-15T09:53:18Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Inserted Tier 0 sender-rule lookup block in `classifyEmail()` before the Tier 1 `rulesClassify()` call
- Query correctly scoped to both `user_id` and `domain` — cross-user rule leakage structurally impossible (T-03-07, ASVS V4 L1)
- `source: 'rule'` (singular) distinguishes Tier 0 hits from Tier 1 regex hits (`source: 'rules'`)
- Full test suite: 132/132 pass, 0 regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Insert Tier 0 sender-rule lookup into classifyEmail()** - `187ab34` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified
- `src/classifier.js` — Tier 0 sender-rule lookup block inserted at lines 179–197, before Tier 1 instant rules block

## Decisions Made
- Placed Tier 0 AFTER the attempt tracking block (not before it) — `attemptKey` must be defined before `attempts.delete(attemptKey)` can be called in the Tier 0 short-circuit path. This is the only safe insertion point after the email row is fetched.
- Included `attempts.delete(attemptKey)` in Tier 0 short-circuit — consistent with Tier 1 and Tier 2 patterns. Without it, the retry counter increments but is never cleared when a sender rule fires, which would eventually block future LLM calls for that email if it somehow went through the non-Tier-0 path again.
- Passed `email` as 4th arg to `storeClassification` — following the IN-02 pattern established in Phase 2 to avoid a redundant DB SELECT.

## Deviations from Plan

### Worktree Catch-Up Merge (Pre-Task)
- **Found during:** Worktree initialization
- **Issue:** This worktree was created before the 03-01 plan was executed and merged. The `correction.test.js` and Phase 3 DB migration guards in `src/db.js` were absent from the worktree.
- **Fix:** Fast-forward merged `work/merge-into-master` (commit `1669c7b`) into the worktree branch before implementing. This brought in `tests/correction.test.js`, the updated `src/db.js`, and all Phase 2 changes (`src/llm/thread.js`, updated `src/classifier.js` with attempt tracking, etc.).
- **Impact:** No scope change — the merge was a prerequisite catch-up, not new work. The classifier.js available after the merge was the correct Phase 2 version with attempt tracking (`attempts` map, `MAX_ATTEMPTS`, `attemptKey`) that the Tier 0 block correctly integrates with.

### Auto-detected Adaptation (Not a Deviation)
- The plan's interfaces section showed a `classifyEmail()` without attempt tracking. The actual code (post-Phase 2 merge) has attempt tracking (`attemptKey`, `attempts.delete`). The Tier 0 block was adapted to include `attempts.delete(attemptKey)` to match the established Tier 1 and Tier 2 patterns — this was the correct implementation, not a deviation.

---

**Total deviations:** 0 from plan execution (1 worktree catch-up merge required before starting)
**Impact on plan:** Worktree merge was a setup step. Plan executed exactly as specified once the correct codebase state was available.

## Issues Encountered
- Worktree was behind `work/merge-into-master` by the 03-01 commits. Fast-forward merge resolved this cleanly before execution.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CORRECT-05 complete: corrections stored in prior plans now feed future classifications via Tier 0
- 03-04 (UI additions: thumbs widget, correction affordance, SSE client listener) can proceed — Tier 0 is in place
- No blockers

## Self-Check: PASSED

- FOUND: src/classifier.js contains 'SELECT category FROM sender_rules WHERE user_id = ? AND domain = ?'
- FOUND: src/classifier.js contains "source: 'rule'" (distinct from existing "source: 'rules'" in Tier 1)
- FOUND: Tier 0 block at lines 179–197, before rulesClassify() call at line 200
- FOUND: commit 187ab34 (task commit)
- FOUND: 132/132 tests pass, 0 failures
- FOUND: node -e "require('./src/classifier')" exits 0

---
*Phase: 03-user-correction-loop*
*Completed: 2026-05-15*
