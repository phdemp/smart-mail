---
plan: 03-05
phase: 03-user-correction-loop
gap_closure: true
status: complete
completed: 2026-05-15
key-files:
  modified:
    - src/routes/api.js
---

# Plan 03-05 Summary: Correction Affordance Scope Fix

## What was built

Moved the correction-affordance div from inside `renderActionZone()`'s `default:` (other) case to the outer email detail template, making it unconditionally available for all 8 email categories.

**Changes to `src/routes/api.js`:**
- Inserted correction-affordance div (with Recategorize button + Alpine `x-data` category picker) into the outer template at line 585, immediately after the action zone conditional block — renders for every category
- Removed the correction-affordance div and the standalone Recategorize button toggle from the `default:` case of `renderActionZone()` — the `other` case now only returns the data-card and Delete/Draft Reply buttons
- The 3-second timer script (line 678) required no changes — it already guards with `if (el && !el.dataset.timerSet)` and works correctly now that the element is always present

## Verification

- `grep -n "correction-affordance" src/routes/api.js` returns 2 hits: outer template insertion (line 585) and timer getElementById (line 678). Zero hits inside `default:` case.
- Phase 3 endpoint features confirmed intact: `classification_updated` broadcast, `user_corrected_category` writes, `ai_feedback` UPSERT
- 132/132 tests pass, 0 failures

## Gap closed

CORRECT-03: Correction affordance now renders for all 8 categories (meeting_request, financial, legal, travel, pitch_deck, fyi, rewards_awards, other). Previously only `other` category emails showed the picker.

## Self-Check: PASSED
