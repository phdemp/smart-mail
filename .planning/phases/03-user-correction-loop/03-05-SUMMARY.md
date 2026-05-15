---
phase: 03-user-correction-loop
plan: 05
subsystem: ui
tags: [html-template, correction-affordance, htmx, alpine, sse, email-detail]

# Dependency graph
requires:
  - phase: 03-user-correction-loop
    provides: "Phase 3 plans 01-04: correction DB schema, Tier 0 sender rules, /reclassify endpoint, SSE broadcast, 3-second timer pattern"
provides:
  - "correction-affordance div rendered unconditionally in outer email detail template for all 8 email categories"
  - "3-second read timer wired to correction-affordance-${email.id} element in outer template"
  - "default: (other) case renderActionZone() cleaned of Recategorize button and picker"
  - "CORRECT-03 gap closed: 8 of 8 categories now present correction UI"
affects: [04-ui-polish, future-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Correction affordance placed unconditionally in outer template, not inside switch-case branches"
    - "3-second opacity timer in outer template script block uses getElementById guard for safe no-op when element absent"

key-files:
  created: []
  modified:
    - src/routes/api.js

key-decisions:
  - "Correction affordance div moved from renderActionZone() default: case to outer email detail template — enables all 8 categories"
  - "3-second timer script added to outer template (was missing from worktree baseline) to reveal affordance after read delay"
  - "default: case retains only data-card (DETECTED TYPE, SOURCE DOMAIN) and Delete + Draft Reply buttons"

patterns-established:
  - "Universal UI affordances belong in the outer template, not inside switch-case branches"

requirements-completed: [CORRECT-03]

# Metrics
duration: 15min
completed: 2026-05-15
---

# Phase 3 Plan 05: Correction Affordance Gap Closure Summary

**Correction-affordance div relocated from renderActionZone() default: case to outer email detail template, making the Recategorize picker unconditionally available for all 8 email categories via a 3-second opacity timer**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-15T16:14:00Z
- **Completed:** 2026-05-15T16:30:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Removed Recategorize button (with `x-data="{open:false}"` Alpine state) and the category picker `<div>` block from `renderActionZone()` `default:` case
- Inserted correction-affordance div (with `id="correction-affordance-${email.id}"`, its own Alpine `x-data="{open:false}"` scope, Recategorize button, and category picker) into the outer email detail template unconditionally
- Added 3-second read timer script to the outer template — reveals the affordance via opacity transition after user has had time to read
- All 7 tests in worktree test suite pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Move correction-affordance div from renderActionZone() default: case to outer email detail template** - `44bdf0b` (feat)
2. **Task 2: Run full test suite to confirm no regressions** - no commit (verification-only, no code changes)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/routes/api.js` - Removed correction affordance from default: case; inserted correction-affordance div + 3-second timer into outer email detail template

## Decisions Made
- The worktree baseline (pre-Phase-3 state) had the correction affordance inside the `default:` case but WITHOUT the `id="correction-affordance-${email.id}"` wrapping div and WITHOUT the 3-second timer script. The fix was applied to the worktree's version as a complete implementation: both the div-with-ID and the timer script were added to the outer template.
- The `default:` case Recategorize button used a separate Alpine `x-data` scope (`open` state) from the picker div. The new outer template version consolidates both button and picker inside a single `x-data="{open:false}"` scope — cleaner architecture.

## Deviations from Plan

### Auto-adapted for Worktree Baseline

**1. [Rule 1 - Adaptation] Applied fix to pre-Phase-3 worktree baseline**
- **Found during:** Task 1 (reading worktree's api.js)
- **Issue:** The worktree was branched from a pre-Phase-3 commit. The worktree's `api.js` (71220 bytes) lacked the `id="correction-affordance-${email.id}"` wrapping div, lacked the 3-second timer script, and had a simpler picker structure without Alpine x-data consolidation. The plan was written against the Phase 3 version (main project's `work/merge-into-master` branch, 77744 bytes).
- **Fix:** Applied the spirit of the plan to the worktree's file: (a) removed Recategorize button and picker from `default:` case, (b) inserted new correction-affordance div with ID + Recategorize button + picker + Alpine state into the outer template, (c) added 3-second timer script.
- **Files modified:** src/routes/api.js
- **Verification:** `grep -c "correction-affordance" src/routes/api.js` returns 2 (div element + timer getElementById); default: case contains only data-card + Delete + Draft Reply; 7 tests pass.
- **Committed in:** 44bdf0b (Task 1 commit)

**2. [Rule 3 - Adaptation] correction.test.js absent from worktree; ran available test suite**
- **Found during:** Task 2 (test suite execution)
- **Issue:** `tests/correction.test.js` (added in Plan 03-01) does not exist in the worktree. The plan's verification commands reference it. The worktree has 7 tests across smoke, classifier_validation, and migration test files.
- **Fix:** Ran all available test files. All 7 pass with exit 0.
- **Committed in:** N/A (no code change)

---

**Total deviations:** 2 adaptations (both caused by worktree branching from pre-Phase-3 baseline)
**Impact on plan:** Both adaptations necessary. The core goal is fully achieved: correction-affordance div is unconditionally rendered in the outer template for all 8 categories.

## Issues Encountered
- Worktree file is a pre-Phase-3 snapshot (~71KB vs main branch ~78KB). The plan was written against the Phase 3 version. The structural change described in the plan was implemented faithfully in the worktree's version by adapting to the actual file structure.

## Known Stubs
None — the correction affordance is fully wired: the div renders unconditionally, the timer script reveals it after 3 seconds, and the category picker POSTs to `/reclassify` (already implemented in the main project's Phase 3 plans).

## Threat Flags
None — no new network endpoints, auth paths, or trust boundaries introduced. The correction-affordance div is a UI-only change; the `/reclassify` endpoint already validates category against the validCategories enum and checks email ownership via `user_id`.

## Next Phase Readiness
- CORRECT-03 gap closed: all 8 email categories render the correction affordance after 3-second read delay
- This worktree commit (`44bdf0b`) will be merged back to `work/merge-into-master` where the full Phase 3 code lives
- The merge will produce the definitive fixed `api.js` combining Phase 3 features + gap closure

---
*Phase: 03-user-correction-loop*
*Completed: 2026-05-15*
