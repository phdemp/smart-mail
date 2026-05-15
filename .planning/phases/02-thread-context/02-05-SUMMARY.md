---
phase: 02-thread-context
plan: "05"
subsystem: classifier-router-integration
tags: [thread-context, llm-logging, classifier, router, integration, tdd]
dependency_graph:
  requires: [02-02, 02-03, 02-04]
  provides: [classifyEmail-passes-threadContext, generateDraft-passes-threadContext, llm_logs-INSERT-on-every-call]
  affects: [src/classifier.js, src/llm/router.js]
tech_stack:
  added: []
  patterns:
    - "IIFE try/catch for non-fatal DB call in hot path: (() => { try { ... } catch(_) { return []; } })()"
    - "tokenCount approximation: ceil((SYSTEM_PROMPT.length + body.length + threadContext.length) / 4)"
    - "Absorb llm_logs INSERT failure silently: try { db.prepare(...).run(...) } catch(_) {}"
key_files:
  created: []
  modified:
    - src/classifier.js
    - src/llm/router.js
decisions:
  - "Thread context fetch uses IIFE try/catch pattern: fetchThreadContext errors never crash the classify hot path — degrade gracefully to single-email context (T-02-15 mitigated)"
  - "buildThreadContext([]) returns null, null || undefined = undefined, base.js skips injection when threadContext is absent — no accidental empty-section injection"
  - "tokenCount computed after bucket acquire but before provider.call(), so skipped_* paths (before acquire) are correctly excluded"
  - "llm_logs INSERT wrapped in try/catch: a schema mismatch or DB error must not block the LLM response flowing back to the caller"
  - "userId null-guarded in INSERT: userId != null ? userId : null — handles legacy callers without userId"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-15"
  tasks_completed: 2
  files_modified: 2
---

# Phase 2 Plan 05: Classifier + Router Integration Summary

**One-liner:** Wired fetchThreadContext/buildThreadContext into both classifyEmail and generateDraft, and added tokenCount computation + llm_logs INSERT to every provider call in _callProviders — completing the Phase 2 THREAD-01 through THREAD-07 end-to-end integration.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire fetchThreadContext + buildThreadContext into classifyEmail() and generateDraft() | 9b2f9dc | src/classifier.js |
| 2 | Add token_count computation and llm_logs INSERT to router.js _callProviders() | c653faa | src/llm/router.js |

## What Was Built

### Task 1 — src/classifier.js

**New require at top:**
```js
const { fetchThreadContext, buildThreadContext } = require('./llm/thread');
```

**In classifyEmail() — Tier 2 block (before llm.router.classify):**
```js
const priorMessages = (() => {
  try { return fetchThreadContext(userId, email); } catch (_) { return []; }
})();
const threadContext = buildThreadContext(priorMessages) || undefined;
const routed = await llm.router.classify(email, { mode: 'full', userId, threadContext });
```

**In generateDraft() — before llm.router.generateDraft:**
```js
const priorMessages = (() => {
  try { return fetchThreadContext(userId, email); } catch (_) { return []; }
})();
const threadContext = buildThreadContext(priorMessages) || undefined;
const routed = await llm.router.generateDraft(email, { mode: 'draft', userId, threadContext });
```

Both sites follow the same pattern: IIFE wraps fetchThreadContext so DB errors return [] without crashing; buildThreadContext([]) returns null; `null || undefined` = undefined; base.js injection skips when threadContext is absent.

### Task 2 — src/llm/router.js

**New requires (line 1 and 3):**
```js
const { parseProviderResponse, DEFAULTS, SYSTEM_PROMPT } = require('./providers/base');
const { db } = require('../db');
```

**tokenCount computation added after bucket acquire (before provider.call):**
```js
const promptApprox = (SYSTEM_PROMPT || '').length
  + (email.body_text || email.preview || '').length
  + ((opts.threadContext || '').length);
const tokenCount = Math.ceil(promptApprox / 4);
```

**SUCCESS path — log extended + INSERT:**
```js
log({ provider: name, mode, outcome: 'success', latency_ms: Date.now() - start,
      email_id: email.id, user_id: userId, token_count: tokenCount });
try {
  db.prepare("INSERT INTO llm_logs ...").run(name, userId != null ? userId : null,
    email.id, tokenCount, 'success', Date.now() - start);
} catch (_) {}
```

**ERROR path — identical pattern with `outcome` variable.**

**Skipped paths unchanged:** skipped_breaker, skipped_quota, skipped_bucket log calls have no token_count and no INSERT (tokenCount is not yet computed at those call sites).

## Verification Results

| Check | Result |
|-------|--------|
| `node --test tests/llm/thread.test.js` | 13/13 pass |
| `node --test tests/llm/base.test.js` | 22/22 pass |
| `node --test tests/llm/router.test.js` | 13/13 pass (incl. 2 new llm_logs tests) |
| `node --test tests/classifier_validation.test.js` | 4/4 pass |
| `node --test tests/**/*.test.js` | 122/122 pass |
| `grep -n "INSERT INTO llm_logs" src/llm/router.js` | 2 occurrences |
| `grep -n "fetchThreadContext" src/classifier.js` | 3 occurrences (require + 2 call sites) |
| `node -e "require('./src/llm/router')"` | No crash |

## Deviations from Plan

### Upstream Merge Required

The worktree was spawned from the `master` branch at commit `13ca826`, which predates all Wave 1 work (plans 02-01 through 02-04). Before executing this plan, a fast-forward merge of `work/merge-into-master` was performed to bring in:
- `src/llm/thread.js` (02-03)
- `src/llm/providers/base.js` changes including opts.threadContext injection (02-04)
- `src/db.js` llm_logs table and idx_emails_msgid_user index (02-02)
- All Phase 1 and Wave 0 test files

This is expected behavior for a Wave 2 plan running in a parallel worktree — it is not a plan deviation.

### Auto-discovered: generateDraft already called router.generateDraft (not router.classify)

The plan's interface section showed `generateDraft` calling `llm.router.classify(email, { mode: 'regen', userId })`. The actual Phase 1 updated code calls `llm.router.generateDraft(email, { mode: 'draft', userId })`. The thread context was added to match the actual call — the plan's interface description was written against the pre-Phase-1 code. No plan change was needed — the result is correct.

## Threat Surface Scan

T-02-13 (cross-user thread leakage): Confirmed mitigated — fetchThreadContext receives userId from classifyEmail(userId, emailId) which is sourced from the authenticated session. The V4 predicate (user_id = ?) in thread.js SQL enforces per-user scoping.

T-02-15 (fetchThreadContext failure in hot path): Confirmed mitigated — IIFE try/catch returns [] on any error; chain degrades to single-email classify with no exception propagation.

T-02-16 (tokenCount as API cost estimate): tokenCount is chars/4 proxy as documented in D-04. Logged for Phase 4 observability only; not used for billing or security decisions.

## Known Stubs

None — all implementation is complete and tested end-to-end.

## Self-Check: PASSED

- `src/classifier.js` — exists, contains fetchThreadContext in 3 locations (require + 2 calls)
- `src/llm/router.js` — exists, contains 2 INSERT INTO llm_logs, 2 SYSTEM_PROMPT usages, 5 tokenCount usages
- Commit `9b2f9dc` — verified in git log
- Commit `c653faa` — verified in git log
- 122/122 tests pass across full test suite
