---
status: complete
phase: 01-prompt-quality-baseline
source:
  - .planning/phases/01-prompt-quality-baseline/01-01-SUMMARY.md
  - .planning/phases/01-prompt-quality-baseline/01-02-SUMMARY.md
  - .planning/phases/01-prompt-quality-baseline/01-03-SUMMARY.md
started: 2026-05-14T00:00:00Z
updated: 2026-05-14T12:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server. Start fresh with `node src/server.js`. Server boots without errors — the low_confidence column migration runs silently. No uncaught exceptions or startup crashes.
result: pass
notes: Server printed "IntelliMail running at http://localhost:3000". Migration ran silently. Structured JSON classification logs flowed immediately. IMAP errors are pre-existing config issues unrelated to Phase 1.

### 2. Eval corpus --export
expected: Run `node scripts/eval-corpus.js --export`. Exits 0, prints "Exported N emails". No-args exits 1 with usage. corpus.json has correct schema (id, subject, from, body_snippet, ground_truth_category).
result: pass
notes: Exported 100 emails. No-args exits 1 with usage message. Schema keys verified: body_snippet,from,ground_truth_category,id,subject.

### 3. Full test suite
expected: `node --test "tests/**/*.test.js"` shows 103 pass, 0 fail, 0 cancelled.
result: pass
notes: 103 pass, 0 fail, 0 cancelled.

### 4. LLM status includes failed_count
expected: GET /api/llm/status returns JSON with `failed_count` field (integer ≥ 0).
result: pass
notes: `failed_count` present in api.js status endpoint (line 1329), queried as `SELECT COUNT(*) ... WHERE source = 'failed'`.

### 5. Archive vs Delete
expected: POST /api/emails/:id/archive sets `is_archived = 1`, not `is_deleted = 1`.
result: pass
notes: Archive block uses `is_archived = 1`. No `is_deleted` in archive path. CR-05 fix confirmed.

### 6. Reclassify stores user's category immediately
expected: POST /api/emails/:id/reclassify with a category writes it directly to DB with source='user', without re-queuing the LLM.
result: pass
notes: INSERT writes `'user'` as source (line 968). No queueClassification call in reclassify path. WR-07 fix confirmed.

### 7. Draft generation returns prose not JSON
expected: Draft calls use buildDraftPrompt() without SYSTEM_PROMPT prepended in any provider.
result: pass
notes: All 4 providers (nvidia, groq, deepseek, gemini) have `opts.mode === 'draft'` conditional that routes to `buildDraftPrompt()`. WR-09 fix confirmed.

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
