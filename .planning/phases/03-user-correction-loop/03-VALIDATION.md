---
phase: 3
slug: user-correction-loop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test` + `node:assert/strict`) — no install needed |
| **Config file** | None — run directly via `node --test` |
| **Quick run command** | `node --test "tests/correction.test.js"` |
| **Full suite command** | `node --test "tests/**/*.test.js"` |
| **Estimated runtime** | ~5–10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test "tests/correction.test.js"`
- **After every plan wave:** Run `node --test "tests/**/*.test.js"` (must maintain 122+ pass, 0 fail)
- **Before `/gsd-verify-work`:** Full suite green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| correction-schema | W0 | 0 | CORRECT-01 | V4 | Migration guard idempotent; columns absent before run | unit (schema) | `node --test "tests/correction.test.js"` | ❌ W0 | ⬜ pending |
| correction-stubs | W0 | 0 | CORRECT-02, CORRECT-05, CORRECT-06, CORRECT-07 | V4, V5 | Stub tests cover all server-side requirements | unit stubs | `node --test "tests/correction.test.js"` | ❌ W0 | ⬜ pending |
| sender-rules-table | 1 | 1 | CORRECT-05 | V4 | sender_rules scoped to user_id; unique index prevents duplicates | unit | `node --test "tests/correction.test.js"` | ❌ W0 | ⬜ pending |
| ai-feedback-table | 1 | 1 | CORRECT-07 | V4, V5 | ai_feedback scoped to user_id; vote CHECK constraint; UPSERT works | unit | `node --test "tests/correction.test.js"` | ❌ W0 | ⬜ pending |
| tier-0-sender-rule | 1 | 1 | CORRECT-05 | V4 | sender_rules lookup includes user_id; returns correct category | unit | `node --test "tests/correction.test.js"` | ❌ W0 | ⬜ pending |
| reclassify-extension | 2 | 2 | CORRECT-02, CORRECT-04, CORRECT-06 | V4, V5 | category validated against CATEGORIES enum; email ownership verified before write; audit columns written; domain extracted without @ | integration | `node --test "tests/correction.test.js"` | ❌ W0 | ⬜ pending |
| sender-rule-promotion | 2 | 2 | CORRECT-05 | V4 | COUNT query scoped to (user_id, domain, category) tuple; rule created at count=2 | unit | `node --test "tests/correction.test.js"` | ❌ W0 | ⬜ pending |
| feedback-endpoint | 2 | 2 | CORRECT-07 | V4, V5 | vote validated in ['up','down']; classification_id verified via email ownership; UPSERT on second vote | unit | `node --test "tests/correction.test.js"` | ❌ W0 | ⬜ pending |
| correction-ui | 2 | 2 | CORRECT-03, CORRECT-04 | — | 3-second timer and toast are browser-side; not unit-testable | manual | Open email detail; wait 3s; verify correction affordance appears | — | ⬜ pending |
| sse-live-update | 2 | 2 | CORRECT-03 | — | SSE classification_updated event triggers HTMX re-render | manual | Submit correction; verify badge updates without page reload | — | ⬜ pending |
| correction-history | 2 | 2 | CORRECT-06 | — | History row only shown when user_corrected_category is non-null | manual | Open corrected email; verify correction history row shows | — | ⬜ pending |
| thumbs-ui | 2 | 2 | CORRECT-07 | — | Thumbs replaced with "Thanks!" via outerHTML swap; no page change | manual | Click thumbs; verify inline "Thanks!" replacement | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/correction.test.js` — NEW: covers CORRECT-01 (schema), CORRECT-02 (reclassify endpoint), CORRECT-05 (sender rule promotion), CORRECT-06 (audit column read), CORRECT-07 (ai_feedback upsert); uses isolated test DB via `process.env.DB_PATH` pattern from existing test files

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Correction affordance hidden for 3 seconds then visible | CORRECT-03 | CSS timer — browser-side behavior, not unit-testable | Open email detail; wait 3s; verify correction UI becomes interactive |
| Toast confirms correction with sender domain | CORRECT-04 | SSE → toast chain is browser-side | Submit correction; verify toast shows "Moved to [Category]. We'll remember this for future emails from [domain]." |
| Badge updates live after correction (no page reload) | CORRECT-03 | HTMX SSE re-render — browser-side | Submit correction; confirm badge updates in email detail without full page reload |
| Correction history row visible in detail panel | CORRECT-06 | Template rendering — browser-side | Open an email that has been corrected; verify "Corrected to: [category]" + timestamp row appears |
| Thumbs replaced with "Thanks!" after click | CORRECT-07 | HTMX outerHTML swap — browser-side | Click 👍 or 👎; verify thumbs row replaced with "Thanks!" microcopy |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
