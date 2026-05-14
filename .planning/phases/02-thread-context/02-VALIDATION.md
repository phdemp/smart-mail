---
phase: 2
slug: thread-context
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node v24) |
| **Config file** | none — run via `node --test "tests/**/*.test.js"` |
| **Quick run command** | `node --test "tests/llm/thread.test.js" "tests/llm/base.test.js" "tests/llm/router.test.js"` |
| **Full suite command** | `node --test "tests/**/*.test.js"` |
| **Estimated runtime** | ~5 seconds (103 existing + new tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test "tests/llm/thread.test.js" "tests/llm/base.test.js" "tests/llm/router.test.js"`
- **After every plan wave:** Run `node --test "tests/**/*.test.js"` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green (103+ tests)
- **Max feedback latency:** ~5 seconds

---

## Per-Requirement Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| THREAD-01 | fetchThreadContext returns prior emails via header match | unit | `node --test "tests/llm/thread.test.js"` | ❌ W0 | ⬜ pending |
| THREAD-01 | fetchThreadContext falls back to subject when headers empty | unit | `node --test "tests/llm/thread.test.js"` | ❌ W0 | ⬜ pending |
| THREAD-02 | buildThreadContext limits to 5 prior messages, oldest-first | unit | `node --test "tests/llm/thread.test.js"` | ❌ W0 | ⬜ pending |
| THREAD-02 | buildThreadContext enforces 500-char per-message limit | unit | `node --test "tests/llm/thread.test.js"` | ❌ W0 | ⬜ pending |
| THREAD-03 | stripQuotedReplies removes `>` lines and attribution headers | unit | `node --test "tests/llm/thread.test.js"` | ❌ W0 | ⬜ pending |
| THREAD-03 | stripQuotedReplies falls back to original when < 100 chars remain | unit | `node --test "tests/llm/thread.test.js"` | ❌ W0 | ⬜ pending |
| THREAD-04 | buildPrompt with opts.threadContext injects ## Prior thread context section | unit | `node --test "tests/llm/base.test.js"` | ✅ extend | ⬜ pending |
| THREAD-04 | buildPrompt without opts.threadContext is unchanged | unit | `node --test "tests/llm/base.test.js"` | ✅ extend | ⬜ pending |
| THREAD-05 | buildThreadContext drops oldest messages when total exceeds 6000 chars | unit | `node --test "tests/llm/thread.test.js"` | ❌ W0 | ⬜ pending |
| THREAD-06 | llm_logs row inserted after successful classify call | integration | `node --test "tests/llm/router.test.js"` | ✅ extend | ⬜ pending |
| THREAD-06 | llm_logs row inserted after failed classify call | integration | `node --test "tests/llm/router.test.js"` | ✅ extend | ⬜ pending |
| THREAD-07 | buildDraftPrompt with opts.threadContext injects ## Prior thread context section | unit | `node --test "tests/llm/base.test.js"` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/llm/thread.test.js` — stubs for THREAD-01, THREAD-02, THREAD-03, THREAD-05 (new file, new module)

*All other test files already exist; thread.test.js is the only missing infrastructure.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| storeEmail() writes raw_headers for new IMAP messages | THREAD-01 prerequisite | Requires live IMAP connection | Connect IMAP account, receive a new email, query `SELECT raw_headers FROM emails ORDER BY id DESC LIMIT 1` — verify non-null JSON |
| Structured log appears in server stdout on email classification | THREAD-06 | Console output not captured by unit tests | Start server, trigger classification, verify `{ ts, provider, user_id, email_id, token_count, outcome, latency_ms }` JSON appears in console |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`tests/llm/thread.test.js`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
