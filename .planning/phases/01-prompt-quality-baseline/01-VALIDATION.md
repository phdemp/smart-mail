---
phase: 1
slug: prompt-quality-baseline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test` + `node:assert/strict`) — no install needed |
| **Config file** | None — run directly via `node --test` |
| **Quick run command** | `node --test "tests/llm/**/*.test.js"` |
| **Full suite command** | `node --test "tests/**/*.test.js"` |
| **Estimated runtime** | ~5–10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test "tests/llm/**/*.test.js"`
- **After every plan wave:** Run `node --test "tests/**/*.test.js"`
- **Before `/gsd-verify-work`:** Full suite must be green + `node scripts/eval-corpus.js --score` showing improvement over baseline
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| eval-export | W0 | 0 | EVAL-01 | — | Eval script reads DB read-only; never writes classifications | manual + script | `node scripts/eval-corpus.js --export` | ❌ W0 | ⬜ pending |
| eval-label | W0 | 0 | EVAL-01 | — | N/A — manual labeling by user | manual | Review `.planning/eval/corpus.json`, add `ground_truth_category` | ❌ W0 | ⬜ pending |
| eval-baseline | W0 | 0 | EVAL-02 | — | Scoring mode uses temp DB to avoid production write | manual + script | `node scripts/eval-corpus.js --score` | ❌ W0 | ⬜ pending |
| system-prompt | 01 | 1 | PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-05 | — | N/A | unit | `node --test "tests/llm/base.test.js"` | ❌ W0 (new assertions needed) | ⬜ pending |
| build-draft-prompt | 01 | 1 | PROMPT-01 | — | buildDraftPrompt() is separate from buildPrompt() | unit | `node --test "tests/llm/base.test.js"` | ❌ W0 | ⬜ pending |
| parse-fallback | 01 | 1 | INFRA-01, PROMPT-07 | T-1-01 | parseProviderResponse returns DEFAULTS (no throw) on JSON-miss; raw excerpt logged at WARN only (not ERROR) | unit | `node --test "tests/llm/base.test.js"` | partial (existing throw test must be updated) | ⬜ pending |
| router-generate-draft | 02 | 1 | PROMPT-01, PROMPT-04 | — | generateDraft() uses 0.3–0.5 temperature; never called during email sync | unit | `node --test "tests/llm/router.test.js"` | ❌ W0 | ⬜ pending |
| classifier-redirect | 02 | 1 | PROMPT-01, PROMPT-08 | — | generateDraft() in classifier.js calls router.generateDraft() not router.classify() | unit | `node --test "tests/classifier_validation.test.js"` | partial | ⬜ pending |
| attempt-cap | 03 | 2 | INFRA-02 | — | After 3 failures email stored as source='failed'; no further retries | unit | `node --test "tests/classifier_validation.test.js"` | ❌ W0 | ⬜ pending |
| api-status-failed | 03 | 2 | INFRA-02 | — | /api/llm/status includes failed_count from source='failed' rows | integration | `node --test "tests/api/scoping.test.js"` or manual | partial | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/eval-corpus.js` — NEW: two-mode eval script (`--export` and `--score`); uses CommonJS; reads live DB read-only for export
- [ ] `.planning/eval/` — directory to create for corpus.json and baseline.md
- [ ] `tests/llm/base.test.js` — UPDATE: change `assert.throws` case for JSON-miss to `assert.deepEqual` returning DEFAULTS; ADD: assertions for SYSTEM_PROMPT category definitions (PROMPT-02), few-shot examples (PROMPT-03), structural summary constraint (PROMPT-05), low_confidence flag (PROMPT-07), buildDraftPrompt existence (PROMPT-01)
- [ ] `tests/llm/router.test.js` — ADD: test block for `generateDraft()` method using existing fake provider pattern
- [ ] `tests/classifier_validation.test.js` — ADD: test case for INFRA-02 attempt cap behavior (3 failures → source='failed'; mock router.classify to always fail)

*Note: JSON mode assertions (PROMPT-06) are already GREEN in existing provider tests — no Wave 0 changes needed for those.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| corpus.json has 30-50 entries with `ground_truth_category` filled in | EVAL-01 | Labeling requires human review of real emails | Open `.planning/eval/corpus.json`; verify each entry has a non-null `ground_truth_category` from the allowed CATEGORIES enum |
| Baseline accuracy recorded in baseline.md before any prompt change | EVAL-02 | Requires live LLM API calls against real labeled corpus | Run `node scripts/eval-corpus.js --score --provider nvidia` (or preferred provider); verify `.planning/eval/baseline.md` is written with per-category breakdown |
| Draft generation does NOT fire during email sync | PROMPT-01 | Integration behavior across IMAP pipeline | Send a new email to the test IMAP account; verify in logs that only `classify()` is called, not `generateDraft()` |
| "Classification failed" badge visible in dashboard UI | INFRA-02 | Requires live IMAP + LLM failure simulation | Temporarily set invalid API keys for all providers; trigger a new email; verify the email appears with "Classification failed" status in the inbox |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
