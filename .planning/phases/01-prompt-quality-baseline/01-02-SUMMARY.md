---
phase: 01-prompt-quality-baseline
plan: "02"
subsystem: llm-prompts
tags: [prompts, base-js, classification, tdd, wave-1]
dependency_graph:
  requires:
    - 01-01-SUMMARY (Wave 0 stubs created RED stubs in base.test.js)
  provides:
    - Updated SYSTEM_PROMPT with category definitions and disambiguation examples
    - buildDraftPrompt() as Call B (draft-only prompt)
    - parseProviderResponse() 4th fallback path (WARN + return DEFAULTS)
    - low_confidence flag on enum-miss category results
    - All Wave 0 base.test.js stubs turned GREEN
  affects:
    - src/llm/providers/base.js
    - tests/llm/base.test.js
    - All 4 provider files (import SYSTEM_PROMPT from base.js)
tech_stack:
  added: []
  patterns:
    - buildDraftPrompt mirrors buildPrompt structure — push lines into array, join at end
    - parseProviderResponse 4th path: extractJsonBlock returns null → WARN + return DEFAULTS
    - categoryMissed flag: tracked before DEFAULTS spread, applied after all validation
    - D-13 disambiguation format: Subject/From → category (not confused_category: reason)
key_files:
  created: []
  modified:
    - src/llm/providers/base.js
    - tests/llm/base.test.js
decisions:
  - "SYSTEM_PROMPT disambiguation examples use compound 'not X; not Y' phrasing to satisfy all 3 'not fyi / not rewards_awards / not meeting_request' test assertions in a single pass"
  - "Regen mode test deleted from base.test.js — regen branch removed from buildPrompt; tone is now handled exclusively by buildDraftPrompt"
  - "categoryMissed placed before DEFAULTS spread so it captures the raw LLM output, not the already-defaulted value"
  - "DEFAULTS.draft_reply retained in DEFAULTS object per plan instruction — costs nothing, not emitted by Call A"
metrics:
  duration: "7 minutes"
  completed: "2026-05-14T10:54:32Z"
  tasks_completed: 2
  files_created: 0
  files_modified: 2
---

# Phase 01 Plan 02: SYSTEM_PROMPT Improvements and Wave 0 Stub Cleanup Summary

SYSTEM_PROMPT split from draft generation (Call A/Call B), category one-liners and disambiguation examples added, parseProviderResponse() hardened with WARN+return-DEFAULTS fallback, low_confidence flag wired — all Wave 0 base.test.js stubs turned GREEN with 18/18 passing.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update src/llm/providers/base.js — 5 changes | ba0e470 | src/llm/providers/base.js |
| 2 | Update tests/llm/base.test.js — turn Wave 0 stubs GREEN | cb40360 | tests/llm/base.test.js |

## Decisions Made

1. **Compound disambiguation phrasing**: The plan's SYSTEM_PROMPT examples were written with `fyi (not other: ...)` and `rewards_awards (not fyi: ...)` and `meeting_request (not other: ...)`. This only produces `not other`, `not fyi`, and `not other` — but the test checks for `not fyi`, `not rewards_awards`, and `not meeting_request`. To satisfy all three assertions, the fyi examples use compound phrasing: `fyi (not other: ...; not rewards_awards: ...)` and `fyi (not other: ...; not meeting_request: ...)`. This is more informative for the LLM and passes all 3 disambiguation assertions.

2. **Regen mode test deleted**: The Wave 0 stub said "delete this test when Plan 02 ships". The test checked that buildPrompt in regen mode includes tone instruction — which is no longer valid behavior. Deleted and replaced with `buildPrompt does not include draft_reply instruction (Call A only)`.

3. **categoryMissed before DEFAULTS spread**: The `const categoryMissed = !CATEGORIES.includes(obj.category)` check must happen before `const out = { ...DEFAULTS }` to capture the raw LLM response. If placed after the spread, we'd be checking `out.category` which is already defaulted to 'other' — always true, masking whether the LLM sent a bad value.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Disambiguation phrasing insufficient for test assertions**
- **Found during:** Task 1 acceptance criteria verification
- **Issue:** Plan's example format `fyi (not other: ...)` + `rewards_awards (not fyi: ...)` + `meeting_request (not other: ...)` only produces `not other`, `not fyi`, `not other` patterns. The test requires `not fyi`, `not rewards_awards`, AND `not meeting_request` each appear at least once.
- **Fix:** Added compound disambiguation phrasing to fyi examples: `not other: ...; not rewards_awards: ...` and `not other: ...; not meeting_request: ...`
- **Files modified:** src/llm/providers/base.js (SYSTEM_PROMPT disambiguation examples)
- **Commit:** ba0e470

## Known Stubs

None — all data is wired. All Wave 0 stubs from Plan 01 that targeted base.js are now GREEN.

The following Wave 0 stub from Plan 01 remains RED and is expected to stay RED until Plan 03:
- `tests/llm/router.test.js`: `router.generateDraft returns draft_reply from first provider` — this is a Plan 03 item, not a Plan 02 item

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. The console.warn in parseProviderResponse() logs only the first 200 chars of the raw LLM response (T-02-02 mitigation — limits PII exposure surface in logs). The whitelist check `CATEGORIES.includes(obj.category)` prevents LLM category injection (T-02-01). Email fields in buildPrompt/buildDraftPrompt are placed after structural section markers (T-02-03).

| Flag | File | Description |
|------|------|-------------|
| T-02-01 mitigated | src/llm/providers/base.js | categoryMissed flag tracks enum violations; low_confidence set for operator visibility |
| T-02-02 mitigated | src/llm/providers/base.js | console.warn uses raw.slice(0, 200) only |
| T-02-03 mitigated | src/llm/providers/base.js | Email fields placed after From:/Subject: markers in both buildPrompt and buildDraftPrompt |

## Self-Check: PASSED

- src/llm/providers/base.js: FOUND
- tests/llm/base.test.js: FOUND
- Commit ba0e470: FOUND
- Commit cb40360: FOUND
- node --test tests/llm/base.test.js: 18 pass, 0 fail
- SYSTEM_PROMPT contains no 'draft_reply': VERIFIED
- SYSTEM_PROMPT contains no 'max 120 chars': VERIFIED
- SYSTEM_PROMPT contains 'action' (structural constraint): VERIFIED
- All 8 categories in SYSTEM_PROMPT: VERIFIED
- 'not fyi' in SYSTEM_PROMPT (count 2): VERIFIED
- 'not rewards_awards' in SYSTEM_PROMPT (count 1): VERIFIED
- 'not meeting_request' in SYSTEM_PROMPT (count 1): VERIFIED
- parseProviderResponse('garbage').error === 'parse_failure': VERIFIED
- parseProviderResponse('{category:spam}').low_confidence === true: VERIFIED
- typeof buildDraftPrompt === 'function': VERIFIED
- No assert.fail calls in base.test.js: VERIFIED
