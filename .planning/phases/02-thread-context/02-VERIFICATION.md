---
phase: 02-thread-context
verified: 2026-05-15T12:00:00Z
status: passed
score: 14/14
overrides_applied: 0
re_verification: false
---

# Phase 2: Thread Context Verification Report

**Phase Goal:** Classification and draft replies use the full conversation history — not just the triggering email — so accuracy improves for reply threads and drafts reference what was actually said.
**Verified:** 2026-05-15
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | fetchThreadContext helper exists and retrieves prior emails via In-Reply-To/References headers | VERIFIED | `src/llm/thread.js` exports `fetchThreadContext`; header path at lines 108–136; `user_id = ?` on every query |
| 2 | buildThreadContext assembles 5 prior messages max, 500 chars each, oldest-first, with 6000-char budget | VERIFIED | Constants `THREAD_MAX_MESSAGES=5`, `THREAD_MSG_MAX_CHARS=500`, `THREAD_BUDGET_CHARS=6000` at lines 6–8; `.slice(-5)` + budget loop at lines 68–80; all 13 thread tests pass |
| 3 | stripQuotedReplies removes `>` lines, `On...wrote:` attribution, `--- Original Message ---` separators | VERIFIED | Three filter patterns at lines 30–33; D-08 fallback at line 42; spot-checked, all pass |
| 4 | Thread context injected into Call A prompt under `## Prior thread context` labeled section | VERIFIED | `buildPrompt` lines 63–70 in `base.js`; 4 base.test.js tests pass including positive and negative cases |
| 5 | Total prior-context budget enforced at ~1500 tokens (6000 chars); oldest messages dropped first | VERIFIED | `while` loop at thread.js line 75 drops oldest; hard cap at line 80; budget test passes |
| 6 | Every LLM call logs structured JSON to console AND inserts row into `llm_logs` table | VERIFIED | `log({...token_count: tokenCount})` at router.js lines 114, 123; `INSERT INTO llm_logs` at lines 117, 126; both `classify inserts row into llm_logs` router tests pass |
| 7 | Call B (generateDraft) receives assembled thread context | VERIFIED | `buildDraftPrompt` in base.js lines 83–90 injects `opts.threadContext`; `generateDraft` in classifier.js lines 322–326 fetches and passes `threadContext` |
| 8 | classifyEmail passes threadContext in opts to router.classify | VERIFIED | classifier.js lines 198–202; `fetchThreadContext` + `buildThreadContext` called in IIFE, result passed as `threadContext` in opts |
| 9 | generateDraft passes threadContext in opts to router.generateDraft | VERIFIED | classifier.js lines 322–326; identical IIFE pattern |
| 10 | fetchThreadContext always includes AND user_id = ? (no cross-user leakage) | VERIFIED | Both header path (line 129) and subject fallback path (line 150) use parameterized `user_id = ?`; cross-user isolation test passes |
| 11 | llm_logs table has all 8 required columns on server startup | VERIFIED | `CREATE TABLE llm_logs` at db.js lines 183–194; runtime check confirmed all 8 columns: id, ts, provider, user_id, email_id, token_count, outcome, latency_ms |
| 12 | 30-day retention pruning executes on startup | VERIFIED | db.js line 197: `DELETE FROM llm_logs WHERE ts < datetime('now', '-30 days')` |
| 13 | idx_emails_msgid_user index exists on emails(user_id, message_id) | VERIFIED | db.js line 255: `CREATE INDEX IF NOT EXISTS idx_emails_msgid_user ON emails(user_id, message_id)`; confirmed at runtime |
| 14 | storeEmail() persists raw_headers JSON (in-reply-to + references) for new IMAP emails | VERIFIED | imap.js lines 70–79: `rawHeadersJson = JSON.stringify({'in-reply-to': ..., 'references': ...})`; inserted as 14th column line 99 |

**Score:** 14/14 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/llm/thread.js` | Thread utility module: fetchThreadContext, buildThreadContext, stripQuotedReplies | VERIFIED | 167 lines; exports all three functions; CommonJS, no external npm deps |
| `src/db.js` | llm_logs CREATE TABLE guard, 30-day pruning, idx_emails_msgid_user index | VERIFIED | Lines 181–197 (table + pruning), line 255 (index) |
| `src/imap.js` | storeEmail writes raw_headers JSON with in-reply-to and references | VERIFIED | Lines 70–99; 14-column INSERT |
| `src/llm/providers/base.js` | opts.threadContext injection in buildPrompt and buildDraftPrompt | VERIFIED | Lines 63–70 (buildPrompt), lines 83–90 (buildDraftPrompt) |
| `src/classifier.js` | classifyEmail and generateDraft call fetchThreadContext + buildThreadContext | VERIFIED | Lines 4, 198–202, 322–326 |
| `src/llm/router.js` | llm_logs INSERT after every provider call; tokenCount computed | VERIFIED | Lines 90–93 (tokenCount), 115–119 (success INSERT), 123–128 (error INSERT) |
| `tests/llm/thread.test.js` | 13 tests covering all thread utility behaviors (Wave 0 → GREEN) | VERIFIED | 13/13 pass |
| `tests/llm/base.test.js` | 4 new tests for opts.threadContext injection | VERIFIED | All 22 base tests pass (including 4 new Phase 2 tests) |
| `tests/llm/router.test.js` | 2 new tests for llm_logs INSERT on success/error | VERIFIED | All 13 router tests pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tests/llm/thread.test.js` | `src/llm/thread.js` | `require('../../src/llm/thread')` | VERIFIED | File exists; 13 tests pass |
| `src/llm/thread.js` | `src/db.js` | `const { db } = require('../db')` | VERIFIED | Line 3 of thread.js |
| `src/classifier.js` | `src/llm/thread.js` | `require('./llm/thread')` | VERIFIED | Line 4 of classifier.js |
| `src/llm/router.js` | `src/db.js` | `const { db } = require('../db')` | VERIFIED | Line 3 of router.js |
| `src/llm/router.js` | `llm_logs` table | `INSERT INTO llm_logs` | VERIFIED | Lines 117, 126 — both success and error paths |
| `src/llm/providers/base.js` | LLM prompt | `opts.threadContext` injection | VERIFIED | buildPrompt lines 63–70; buildDraftPrompt lines 83–90 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/classifier.js` classifyEmail | `threadContext` | `fetchThreadContext(userId, email)` → SQLite emails table | DB query with user_id + message_id/subject predicates | FLOWING |
| `src/llm/providers/base.js` buildPrompt | `opts.threadContext` | Passed from classifier.js via router opts | Non-null when prior messages exist | FLOWING |
| `src/llm/router.js` _callProviders | `tokenCount` | `(SYSTEM_PROMPT.length + body.length + threadContext.length) / 4` | Computed from real prompt components | FLOWING |
| `src/llm/router.js` llm_logs INSERT | Row data | `name, userId, email.id, tokenCount, outcome, latency_ms` | All from real provider call metadata | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `src/llm/thread.js` exports three functions | `node -e "const t = require('./src/llm/thread'); console.log(Object.keys(t))"` | `[ 'fetchThreadContext', 'buildThreadContext', 'stripQuotedReplies' ]` | PASS |
| `buildPrompt` injects `## Prior thread context` when threadContext present | inline node eval | `with ctx has ## Prior: true`, `with ctx has ## Current: true` | PASS |
| `buildPrompt` omits section headers when threadContext absent | inline node eval | `no ctx lacks ## Prior: true` | PASS |
| `buildDraftPrompt` injects context + tone | inline node eval | `draft with ctx has ## Prior: true`, `draft has tone: true` | PASS |
| `stripQuotedReplies` removes all three D-07 patterns | inline node eval | All three strip tests PASS | PASS |
| D-08 fallback: returns original when stripped < 100 chars, original > 100 | inline node eval | PASS | PASS |
| `buildThreadContext` enforces 5-message limit and 6000-char budget | inline node eval | PASS (5 blocks), budget PASS (2678 chars) | PASS |
| llm_logs table created with all 8 columns | inline node eval | all 8 columns present | PASS |
| idx_emails_msgid_user index exists | inline node eval | index row returned | PASS |
| No circular import crash on router require | `node -e "require('./src/llm/router')"` | No output (exit 0) | PASS |
| All 13 thread tests pass | `node --test tests/llm/thread.test.js` | 13/13 pass | PASS |
| All 22 base tests pass | `node --test tests/llm/base.test.js` | 22/22 pass | PASS |
| All 13 router tests pass including 2 new llm_logs tests | `node --test tests/llm/router.test.js` | 13/13 pass | PASS |
| Full suite 122 tests pass | `node --test "tests/**/*.test.js"` | 122/122 pass | PASS |

---

### Probe Execution

No probe scripts declared or found in `scripts/*/tests/probe-*.sh`. Step 7c: SKIPPED (no conventional probes for this phase).

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| THREAD-01 | 02-01, 02-02, 02-03, 02-05 | `fetchThreadContext(userId, email)` retrieves prior emails via In-Reply-To/References | SATISFIED | `src/llm/thread.js` fetchThreadContext, dual-path SQL; wired into classifier.js |
| THREAD-02 | 02-01, 02-03 | `buildThreadContext(messages)` 5 messages max, 500 chars each, oldest-first, budget | SATISFIED | thread.js lines 65–83; constants THREAD_MAX_MESSAGES=5, THREAD_MSG_MAX_CHARS=500, THREAD_BUDGET_CHARS=6000 |
| THREAD-03 | 02-01, 02-03 | `stripQuotedReplies` removes `>`, `On...wrote:`, `--- Original Message ---` | SATISFIED | thread.js lines 25–44; all three patterns tested |
| THREAD-04 | 02-01, 02-04 | Thread context injected under `## Prior thread context` in Call A prompt | SATISFIED | base.js buildPrompt lines 63–70 |
| THREAD-05 | 02-01, 02-03 | Total prior-context token budget ~1500 tokens (6000 chars); oldest truncated first | SATISFIED | thread.js budget loop lines 75–80 |
| THREAD-06 | 02-01, 02-02, 02-05 | Every LLM call logs `{ provider, user_id, email_id, token_count, outcome, latency_ms }` | SATISFIED | router.js: console log lines 114/123, llm_logs INSERT lines 117/126 |
| THREAD-07 | 02-01, 02-04, 02-05 | Call B (draft generation) receives assembled thread context | SATISFIED | base.js buildDraftPrompt lines 83–90; classifier.js generateDraft lines 322–326 |

All 7 THREAD requirements satisfied.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/db.js` | 32 | `TODO: encrypt at rest before any multi-tenant or cloud deployment.` | Info | Pre-existing comment predates Phase 2; not introduced by this phase; references a known risk (WR-01) with explicit scoping note |

No TBD, FIXME, or XXX markers found in any Phase 2 modified files (`src/llm/thread.js`, `src/llm/router.js`, `src/classifier.js`, `src/llm/providers/base.js`, `src/db.js`, `src/imap.js`).

The `TODO` in `src/db.js` line 32 is pre-existing (present before Phase 2), references a known architectural risk explicitly scoped out of this milestone, and is not actionable within Phase 2. It does not trigger a BLOCKER.

---

### Human Verification Required

None. All truths are verifiable programmatically. No UI behavior, real-time events, or external service integrations were added in this phase.

---

### Gaps Summary

No gaps. All 14 truths verified, all 7 THREAD requirements satisfied, full test suite green (122/122), no debt markers introduced by this phase.

---

## Summary

Phase 2 delivered the full thread-context pipeline end-to-end:

1. **thread.js** — new utility module with `stripQuotedReplies` (3 D-07 patterns + D-08 fallback), `buildThreadContext` (5-message/6000-char budget, oldest-first), and `fetchThreadContext` (header-based + subject-normalized fallback, user-scoped).
2. **db.js** — `llm_logs` table (8 columns), 30-day pruning on startup, `idx_emails_msgid_user` covering index.
3. **imap.js** — `storeEmail()` persists raw threading headers for all new IMAP emails.
4. **base.js** — `buildPrompt` and `buildDraftPrompt` both accept `opts.threadContext` and inject under `## Prior thread context` / `## Current email` labeled section headings; backward-compatible when absent.
5. **classifier.js** — both `classifyEmail` and `generateDraft` fetch thread context via IIFE try/catch and pass it through opts.
6. **router.js** — `tokenCount` computed from prompt approximation; `INSERT INTO llm_logs` on both success and error paths.

One notable deviation from the PLAN spec: Plan 02-03's D-08 condition (`original.length > stripped.length`) was refined to `original.length > 100` to correctly pass all 13 tests without suppressing normal quote stripping. This is documented in the 02-03 SUMMARY.

---

_Verified: 2026-05-15_
_Verifier: Claude (gsd-verifier)_
