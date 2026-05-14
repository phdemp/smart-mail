---
phase: 01-prompt-quality-baseline
plan: "01"
subsystem: eval-infra
tags: [eval, test-stubs, wave-0, infra]
dependency_graph:
  requires: []
  provides:
    - scripts/eval-corpus.js (two-mode eval runner)
    - .planning/eval/corpus.json (placeholder corpus)
    - .planning/eval/baseline.md (placeholder baseline)
    - Wave 0 test stubs in base.test.js, router.test.js, classifier_validation.test.js
  affects:
    - tests/llm/base.test.js
    - tests/llm/router.test.js
    - tests/classifier_validation.test.js
tech_stack:
  added: []
  patterns:
    - better-sqlite3 readonly mode for DB access from offline scripts
    - process.env.DB_PATH override before src/ require (eval isolation)
key_files:
  created:
    - scripts/eval-corpus.js
    - .planning/eval/corpus.json
    - .planning/eval/baseline.md
  modified:
    - tests/llm/base.test.js
    - tests/llm/router.test.js
    - tests/classifier_validation.test.js
decisions:
  - Eval script uses CommonJS require throughout (matches entire codebase convention)
  - --score mode sets DB_PATH to os.tmpdir() throwaway as first statement before any src/ require (T-01-02 mitigation)
  - --export mode opens intellimail.db with readonly: true (T-01-01 mitigation)
  - base.test.js updated with assert.fail stubs instead of skip — keeps tests visibly RED (Wave 0 contract)
  - PROMPT-03 disambiguation stub added to base.test.js (fyi/other, rewards_awards/fyi, meeting_request/other pairs)
  - No new npm dependencies introduced
metrics:
  duration: "4 minutes"
  completed: "2026-05-14T10:47:19Z"
  tasks_completed: 2
  files_created: 3
  files_modified: 3
---

# Phase 01 Plan 01: Eval Infrastructure and Wave 0 Test Stubs Summary

Offline eval runner (--export and --score modes) plus Wave 0 pre-declared test contracts for INFRA-01, generateDraft(), and INFRA-02 attempt cap — all intentionally RED until Plans 02 and 03 ship.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create scripts/eval-corpus.js (two-mode eval runner) | c9a8a90 | scripts/eval-corpus.js, .planning/eval/corpus.json, .planning/eval/baseline.md |
| 2 | Update test stubs — base.test.js, router.test.js, classifier_validation.test.js | 8f91a47 | tests/llm/base.test.js, tests/llm/router.test.js, tests/classifier_validation.test.js |

## Decisions Made

1. **Eval isolation via DB_PATH first**: `--score` mode sets `process.env.DB_PATH = os.tmpdir() + '/eval-score-throwaway.db'` as the first executable statement before any `src/` require. This prevents `storeClassification()` from writing to the production DB even if accidentally triggered (T-01-02 mitigation from plan threat model).

2. **Read-only DB for --export**: `better-sqlite3` opened with `{ readonly: true }` for the --export mode. No INSERT/UPDATE/DELETE calls in the export path (T-01-01).

3. **assert.fail() over skip**: Wave 0 stubs use `assert.fail('not yet implemented — Plan 02')` rather than test skipping. This keeps them visibly RED in CI, making the forward-declared contracts traceable and impossible to accidentally omit from Plan 02/03 work.

4. **PROMPT-03 stub added**: The plan requires a specific disambiguation stub for `fyi/other`, `rewards_awards/fyi`, and `meeting_request/other` pairs. This stub is pre-declared in base.test.js and confirms the exact 3 pairs that Plan 02's SYSTEM_PROMPT must cover.

5. **No new npm dependencies**: All required tooling (better-sqlite3, node:test, node:assert/strict) was already present.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

The following stubs are **intentional Wave 0 pre-declarations** (not defects). They are RED now and will turn GREEN when the specified plan ships:

| File | Stub | Turns GREEN |
|------|------|-------------|
| tests/llm/base.test.js | `buildPrompt in regen mode includes tone instruction` | Plan 02 (regen branch removed) |
| tests/llm/base.test.js | `parseProviderResponse returns DEFAULTS with error on garbage input (no throw)` | Plan 02 (INFRA-01) |
| tests/llm/base.test.js | `PROMPT-01: buildDraftPrompt exists and is a function` | Plan 02 |
| tests/llm/base.test.js | `PROMPT-02: SYSTEM_PROMPT includes one-liner definitions for all 8 categories` | Plan 02 |
| tests/llm/base.test.js | `PROMPT-05: SYSTEM_PROMPT uses structural summary constraint not character-count limit` | Plan 02 |
| tests/llm/base.test.js | `PROMPT-07: parseProviderResponse sets low_confidence when category falls back to default` | Plan 02 |
| tests/llm/base.test.js | `buildDraftPrompt includes from, subject, and body truncated to ~800` | Plan 02 |
| tests/llm/base.test.js | `PROMPT-03: SYSTEM_PROMPT includes disambiguation examples for fyi/other, rewards_awards/fyi, meeting_request/other` | Plan 02 |
| tests/llm/router.test.js | `router.generateDraft returns draft_reply from first provider` | Plan 02 |
| tests/classifier_validation.test.js | `classifyEmail stores source="failed" after 3 failed attempts (INFRA-02)` | Plan 03 |

A verifier MUST NOT flag these RED stubs as phase failures — they are the correct Wave 0 state.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. The eval script is an offline developer tool only (no HTTP exposure). Threat mitigations from the plan's threat register are applied:

| Flag | File | Description |
|------|------|-------------|
| T-01-01 mitigated | scripts/eval-corpus.js | DB opened with readonly: true for --export mode |
| T-01-02 mitigated | scripts/eval-corpus.js | DB_PATH set to throwaway path before any src/ require in --score mode |

## Self-Check: PASSED

- scripts/eval-corpus.js: FOUND
- .planning/eval/corpus.json: FOUND (valid JSON array)
- .planning/eval/baseline.md: FOUND (contains "Eval Baseline")
- Commit c9a8a90: FOUND
- Commit 8f91a47: FOUND
- tests/llm/base.test.js: old "throws on garbage input" test gone, new stubs present
- tests/llm/router.test.js: generateDraft stub present and RED
- tests/classifier_validation.test.js: INFRA-02 stub present and RED
