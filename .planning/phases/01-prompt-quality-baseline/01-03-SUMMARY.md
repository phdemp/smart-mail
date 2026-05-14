---
phase: 01-prompt-quality-baseline
plan: "03"
subsystem: llm-router-providers
tags: [router, providers, draft-chain, infra-02, temperature, tdd, wave-2]
dependency_graph:
  requires:
    - 01-02-SUMMARY (buildDraftPrompt() exported from base.js — needed by all 4 providers)
  provides:
    - router.generateDraft() method with temperature=0.4 and mode:draft routing
    - All 4 providers read opts.temperature and route to buildDraftPrompt on mode:draft
    - INFRA-02 per-email attempt counter (3 retries, then source:failed)
    - low_confidence INTEGER column migration in db.js
    - storeClassification() writes low_confidence to DB
    - /api/llm/status exposes failed_count
    - classifier.generateDraft() and api.js draft/regen endpoint call router.generateDraft()
    - Wave 0 stubs: router.test.js generateDraft stub GREEN; classifier_validation.test.js INFRA-02 stub GREEN
  affects:
    - src/llm/router.js
    - src/llm/providers/nvidia.js
    - src/llm/providers/groq.js
    - src/llm/providers/deepseek.js
    - src/llm/providers/gemini.js
    - src/classifier.js
    - src/routes/api.js
    - src/db.js
    - tests/llm/router.test.js
    - tests/classifier_validation.test.js
tech_stack:
  added: []
  patterns:
    - generateDraft() mirrors classify() cascade with temperature=0.4 in providerCfg and maxWaitMs=2000
    - opts.temperature || 0.1 pattern in all 4 providers for temperature override
    - opts.mode === 'draft' ? buildDraftPrompt() : buildPrompt() conditional in user message position
    - INFRA-02 attempts Map with MAX_ATTEMPTS=3 — in-memory, keyed by userId::emailId
    - Inline try/catch ALTER TABLE migration for low_confidence column
key_files:
  created: []
  modified:
    - src/llm/router.js
    - src/llm/providers/nvidia.js
    - src/llm/providers/groq.js
    - src/llm/providers/deepseek.js
    - src/llm/providers/gemini.js
    - src/classifier.js
    - src/routes/api.js
    - src/db.js
    - tests/llm/router.test.js
    - tests/classifier_validation.test.js
decisions:
  - "INFRA-02 test uses 4 calls (not 3) because the attempt counter must exceed MAX_ATTEMPTS: on call 1 counter=1, call 2 counter=2, call 3 counter=3 — all store fallback; on call 4 counter=4 > 3 — stores source:failed"
  - "attempts.delete(attemptKey) on success covers both Tier 1 and Tier 2 success paths to clean up the counter and allow re-classification of the same email if re-queued"
  - "low_confidence passed through from routed.low_confidence in LLM success path — fallback/rules paths always write 0 since category is known-valid at that point"
  - "response_format: { type: json_object } and responseMimeType: application/json preserved in all 4 provider files (PROMPT-06 regression protection)"
metrics:
  duration: "12 minutes"
  completed: "2026-05-14T11:15:00Z"
  tasks_completed: 2
  files_created: 0
  files_modified: 10
---

# Phase 01 Plan 03: Draft Chain + INFRA-02 Reliability Summary

router.generateDraft() wired end-to-end with temperature 0.4 and buildDraftPrompt routing across all 4 providers; INFRA-02 attempt cap (3 retries) live; low_confidence column migrated; failed_count surfaced in /api/llm/status; all 103 tests green.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add router.generateDraft() and update all 4 providers for temperature opts + buildDraftPrompt routing | 4b6f798 | src/llm/router.js, src/llm/providers/nvidia.js, src/llm/providers/groq.js, src/llm/providers/deepseek.js, src/llm/providers/gemini.js, tests/llm/router.test.js |
| 2 | INFRA-02 attempt counter in classifier.js; redirect draft call sites; db.js low_confidence migration; api.js failed_count + regen redirect; turn classifier_validation stub GREEN | ad9102f | src/classifier.js, src/db.js, src/routes/api.js, tests/classifier_validation.test.js |

## Decisions Made

1. **INFRA-02 test uses 4 calls**: The attempt counter increments before the threshold check. Counter reaches MAX_ATTEMPTS=3 on the 3rd call — but since `currentAttempts > MAX_ATTEMPTS` (strictly greater than), the cap fires on call 4. The test inserts the email, calls classifyEmail 3 times (deleting the classification row between calls so INSERT OR IGNORE allows re-insertion), then calls a 4th time — on which `currentAttempts=4 > 3` triggers the `source: 'failed'` write. This is the correct behavioral reading of the code.

2. **attempts.delete on both success paths**: The attempt key is deleted on the Tier 1 rules success path AND the Tier 2 LLM success path, ensuring that if a previously-failing email later gets a successful classification, its counter is reset. This prevents phantom failure states surviving across server restarts.

3. **low_confidence in storeClassification**: The `low_confidence` field is passed through to storeClassification only on the LLM success path where `routed.low_confidence` is set by `parseProviderResponse()`. Fallback/rules paths always write 0, since their categories are known-valid before storage.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all stubs from Plan 01 targeting Plans 02 and 03 have been turned GREEN. No new stubs introduced.

## Threat Surface Scan

All mitigations from the plan's threat model were implemented as specified:

| Flag | File | Description |
|------|------|-------------|
| T-03-01 mitigated | src/classifier.js | MAX_ATTEMPTS=3 hard cap per emailId; source:failed prevents re-queuing |
| T-03-02 mitigated | src/routes/api.js | failed_count field in /api/llm/status exposes operator-visible count |
| T-03-03 mitigated | src/llm/providers/base.js (Plan 02) | buildDraftPrompt() places opts.tone in controlled trailing position |
| T-03-04 accepted | src/db.js, src/classifier.js | low_confidence stored as 0/1; not exposed to end users in Phase 1 |
| T-03-05 accepted | src/routes/api.js | failed_count behind existing auth middleware; no new access-control surface |
| T-03-06 accepted | src/classifier.js | In-memory attempts Map resets on restart; source:failed row prevents double-write via INSERT OR IGNORE |

No new network endpoints, auth paths, or schema changes beyond the low_confidence column (which is operator-internal and behind auth).

## Self-Check: PASSED

- src/llm/router.js: FOUND
- src/llm/providers/nvidia.js: FOUND
- src/llm/providers/groq.js: FOUND
- src/llm/providers/deepseek.js: FOUND
- src/llm/providers/gemini.js: FOUND
- src/classifier.js: FOUND
- src/routes/api.js: FOUND
- src/db.js: FOUND
- tests/llm/router.test.js: FOUND
- tests/classifier_validation.test.js: FOUND
- Commit 4b6f798: FOUND
- Commit ad9102f: FOUND
- node --test tests/**/*.test.js: 103 pass, 0 fail
- typeof r.generateDraft === 'function': VERIFIED
- nvidia/groq/deepseek json_object preserved (PROMPT-06): VERIFIED
- gemini responseMimeType application/json preserved (PROMPT-06): VERIFIED
- router.generateDraft in src/classifier.js (count 1): VERIFIED
- router.generateDraft in src/routes/api.js (count 1): VERIFIED
- failed_count in src/routes/api.js (count 1): VERIFIED
- low_confidence in src/db.js (count 2): VERIFIED
- low_confidence in src/classifier.js (count 3): VERIFIED
- db.js initializes without error (migration idempotent): VERIFIED
- INFRA-02 test passes with actual source='failed' assertion: VERIFIED
