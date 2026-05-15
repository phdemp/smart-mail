---
phase: 02-thread-context
plan: "04"
subsystem: llm-providers
tags: [thread-context, prompt-injection, backward-compat, tdd]
dependency_graph:
  requires: [02-01]
  provides: [opts.threadContext in buildPrompt, buildDraftPrompt exported]
  affects: [src/llm/providers/base.js, tests/llm/base.test.js]
tech_stack:
  added: []
  patterns: [opts parameter bag extension, labeled section heading injection]
key_files:
  created: []
  modified:
    - src/llm/providers/base.js
    - tests/llm/base.test.js
decisions:
  - "Inject threadContext block between system prompt and From: line, not after body — ensures LLM reads prior context before the email under classification"
  - "buildDraftPrompt added as new export (not in pre-Phase-2 base.js) with identical injection pattern"
  - "module.exports extended to include buildDraftPrompt — no existing keys removed"
metrics:
  duration: "~2 minutes"
  completed: "2026-05-15"
  tasks_completed: 1
  files_modified: 2
---

# Phase 2 Plan 04: opts.threadContext Injection into buildPrompt and buildDraftPrompt Summary

**One-liner:** Extended `base.js` with opts.threadContext injection using labeled `## Prior thread context` / `## Current email` section headings in both `buildPrompt` and the newly-added `buildDraftPrompt`, backward-compatible when threadContext is absent.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| RED | Add failing tests for opts.threadContext injection | 2b43584 | tests/llm/base.test.js |
| GREEN | Implement threadContext injection + buildDraftPrompt | f463951 | src/llm/providers/base.js |

## What Was Built

### `src/llm/providers/base.js` changes

**`buildPrompt` extension:**
- After the blank line following `SYSTEM_PROMPT`, added conditional `opts.threadContext` injection block
- Injection format: `## Prior thread context\n\n{opts.threadContext}\n\n## Current email\n\n`
- Guard: `if (opts.threadContext)` — falsy/absent threadContext leaves output byte-for-byte identical to pre-Phase-2

**New `buildDraftPrompt` function:**
- Mirrors the draft-prompt builder described in 02-CONTEXT.md (D-14, D-15)
- Same `## Prior thread context` / `## Current email` injection pattern
- Supports `opts.tone` suffix line (identical to how it was documented in the plan interface)
- Exported in `module.exports`

### `tests/llm/base.test.js` additions (4 new tests)
- `buildPrompt injects ## Prior thread context when opts.threadContext present`
- `buildPrompt without opts.threadContext is unchanged`
- `buildDraftPrompt injects ## Prior thread context when opts.threadContext present`
- `buildDraftPrompt without opts.threadContext is unchanged`

## Verification Results

| Check | Result |
|-------|--------|
| `node --test tests/llm/base.test.js` | 14/14 pass |
| `node --test tests/**/*.test.js` | 97/97 pass |
| `## Prior thread context` occurrences in base.js | Exactly 2 (buildPrompt + buildDraftPrompt) |
| `## Current email` occurrences in base.js | Exactly 2 |
| Backward compat: `buildPrompt(email, {})` | No section headers — confirmed OK |
| `buildPrompt(email, {}).includes('## Prior thread context')` | false — confirmed |

## TDD Gate Compliance

- RED commit: `2b43584` — `test(02-04): add failing tests for opts.threadContext injection...`
- GREEN commit: `f463951` — `feat(02-04): inject opts.threadContext into buildPrompt and buildDraftPrompt...`
- Gate sequence: RED → GREEN — compliant

## Deviations from Plan

### Auto-discovered Issues

**1. [Rule 2 - Missing Critical Functionality] buildDraftPrompt did not exist in base.js**
- **Found during:** Task 1 RED phase — tests for `buildDraftPrompt` failed with `TypeError: buildDraftPrompt is not a function`
- **Issue:** The plan's interface section showed `buildDraftPrompt` as if it already existed in `base.js`, but the actual file had no such function. Plan 02-CONTEXT.md D-14/D-15 specify this function is needed for Phase 2 draft context injection.
- **Fix:** Created `buildDraftPrompt(email, opts = {})` with the full pattern (instruction lines, `opts.threadContext` injection, `From:/Subject:` fields, `opts.tone` suffix). Added to `module.exports`.
- **Files modified:** `src/llm/providers/base.js`
- **Commit:** f463951

**Note:** Plan 02-01 (Wave 0 test stubs) has not yet been executed in this worktree. The 4 failing test stubs expected by plan 02-01's must_haves were written here as part of the TDD RED phase for plan 02-04. This is additive — the stubs are now in GREEN state rather than RED, which is the correct state for Wave 1.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: prompt-injection | src/llm/providers/base.js | opts.threadContext is injected verbatim into the LLM prompt. Mitigation T-02-11 applies: threadContext is assembled by buildThreadContext (plan 02-03) which truncates each message to 500 chars and enforces 6000-char total budget. The `## Prior thread context` / `## Current email` structural labels are injected by base.js (not from email body), providing semantic separation between adversarial content and classification instructions. |

## Known Stubs

None — the implementation is complete and tested.

## Self-Check: PASSED

- `src/llm/providers/base.js` — exists and contains `## Prior thread context` in 2 locations
- `tests/llm/base.test.js` — exists with 14 tests (10 pre-existing + 4 new)
- Commit `2b43584` — verified in git log
- Commit `f463951` — verified in git log
- All 97 tests pass across the full test suite
