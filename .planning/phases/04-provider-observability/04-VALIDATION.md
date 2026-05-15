---
phase: 4
slug: provider-observability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` (no vitest — project uses native test runner) |
| **Config file** | none — uses `"test": "node --test \"tests/**/*.test.js\""` in package.json |
| **Quick run command** | `node --test "tests/llm/router.test.js"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test "tests/llm/router.test.js"`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| Wave 0 stubs | 01 | 0 | OBSERVE-01, OBSERVE-04 | — | N/A | unit | `node --test "tests/api/health.test.js"` | ❌ W0 | ⬜ pending |
| Wave 0 stubs | 01 | 0 | OBSERVE-05 | — | N/A | unit | `node --test "tests/server.test.js"` | ❌ W0 | ⬜ pending |
| Health endpoint | impl | 1 | OBSERVE-01 | info-disclosure | auth-guarded, user-scoped | unit | `node --test "tests/api/health.test.js"` | ❌ W0 | ⬜ pending |
| Pill endpoint | impl | 1 | OBSERVE-04 | XSS | no provider names in output | unit | `node --test "tests/api/health.test.js"` | ❌ W0 | ⬜ pending |
| Soft-failure gate | impl | 1 | OBSERVE-02, OBSERVE-06 | — | no breaker trip on soft_fail | unit | `node --test "tests/llm/router.test.js"` | ✅ extend | ⬜ pending |
| Startup warmup | impl | 1 | OBSERVE-05 | — | classifyAll not called before 30s | unit | `node --test "tests/server.test.js"` | ❌ W0 | ⬜ pending |
| Settings panel | impl | 2 | OBSERVE-03 | XSS | escHtml() on last_error_msg | manual | — | manual-only | ⬜ pending |
| Dashboard pill | impl | 2 | OBSERVE-04 | — | shows "AI features degraded" only | unit + manual | `node --test "tests/api/health.test.js"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/api/health.test.js` — stubs for OBSERVE-01 (health endpoint shape + auth) and OBSERVE-04 (pill returns amber HTML when any provider non-ok; empty when all ok)
- [ ] `tests/server.test.js` — stubs for OBSERVE-05 (warmup delay: classifyAllUnclassifiedForUser not called until 30s after init; requires mock timers)

*Existing `tests/llm/router.test.js` covers OBSERVE-02 and OBSERVE-06 with new test cases added in the implementation wave — no new file needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Settings health panel renders correct color per status (green/amber/red/grey dots) | OBSERVE-03 | Color rendering requires visual inspection; no DOM assertion available in node:test | Start server, open Settings > AI Providers, verify: ok → green dot, rate_limited → amber dot, invalid_key → red + "Check your API key →" link, unknown → grey + "No activity yet" |
| Amber pill appears on dashboard when any provider non-ok | OBSERVE-04 | Full browser flow required to observe HTMX polling | Open dashboard while one provider is in rate_limited state; verify amber "AI features degraded" pill appears above inbox; verify clicking navigates to Settings#providers |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
