---
phase: 03-user-correction-loop
plan: "04"
subsystem: api
tags: [sse, htmx, sqlite, correction-loop, sender-rules, ai-feedback]

# Dependency graph
requires:
  - phase: 03-user-correction-loop
    provides: "schema migrations (CORRECT-01): user_corrected_category, corrected_at, sender_rules, ai_feedback tables"
  - phase: 03-user-correction-loop
    provides: "Tier 0 sender-rule lookup in classifyEmail() (03-03)"
provides:
  - "POST /api/emails/:id/reclassify extended with audit columns (user_corrected_category, corrected_at), domain extraction, sender-rule promotion after 2+ same-domain corrections, SSE broadcast"
  - "POST /api/emails/:id/feedback endpoint with vote validation (up/down), UPSERT to ai_feedback keyed on cls.id, outerHTML HTMX swap returning 'Thanks!'"
  - "setBroadcast injection: api.js broadcast stub replaced at server startup via setApiBroadcast(broadcast)"
  - "Email detail fragment: 3-second timer affordance, conditional correction history row, thumbs widget below AI summary"
  - "app.js SSE listener for classification_updated: toast + HTMX detail re-render + categoryChange list refresh"
affects:
  - "03-user-correction-loop"
  - "future-ai-quality-evals"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "setBroadcast injection pattern (mirrors classifier.js) — broadcast function injected into api.js via module-level stub replaced after router mount"
    - "cls.id as summary_id for ai_feedback UPSERT — classification row id used, not email.id"
    - "3-second IIFE timer with data-timerSet guard — prevents double-timer on HTMX re-render"
    - "Conditional correction history row — only rendered when user_corrected_category is non-null"
    - "SSE classification_updated event triggers toast + HTMX detail re-render + list categoryChange trigger"

key-files:
  created: []
  modified:
    - src/routes/api.js
    - src/server.js
    - public/js/app.js

key-decisions:
  - "Used cls.id (classification row id) as summary_id for ai_feedback UPSERT — not email.id — matching D-13 design decision"
  - "setBroadcast injected after router mount in server.js (not via circular require) — mirrors the existing setClassifierBroadcast pattern"
  - "Sender-rule promotion threshold is 2 corrections from the same (user_id, domain, category) tuple"
  - "correction-visible CSS class added via setTimeout(3000) IIFE with data-timerSet guard to survive HTMX re-renders"
  - "SSE broadcast payload for classification_updated contains email_id, category, source:'user', domain — no PII (T-03-15 accepted)"

patterns-established:
  - "API module broadcast injection: let broadcast = () => {}; exported setBroadcast function; server.js injects after mount"
  - "HTMX outerHTML swap for inline feedback confirmation (thumbs → 'Thanks!' without page reload)"
  - "Domain extraction from from_address: (addr || '').split('@')[1] || '' — defensive against missing @"

requirements-completed: [CORRECT-02, CORRECT-03, CORRECT-04, CORRECT-05, CORRECT-06, CORRECT-07]

# Metrics
duration: ~45min
completed: 2026-05-15
---

# Phase 03 Plan 04: Wave 2 Endpoints and UI Summary

**End-to-end user correction loop: /reclassify extended with audit trail + sender-rule promotion, /feedback UPSERT endpoint, SSE broadcast wired into api.js, and email detail fragment updated with 3-second timer, thumbs widget, and conditional correction history — all human-verified against 6 acceptance steps.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-15T00:00:00Z
- **Completed:** 2026-05-15T00:45:00Z
- **Tasks:** 2 auto + 1 checkpoint (human-verify, approved)
- **Files modified:** 3

## Accomplishments

- /reclassify endpoint extended with `user_corrected_category` + `corrected_at` audit columns, domain extraction from `from_address`, sender-rule promotion after 2 same-domain corrections (COUNT JOIN query scoped to user_id/domain/category), and SSE broadcast of `classification_updated` event
- /feedback endpoint added with vote validation, UPSERT to `ai_feedback` keyed on `cls.id`, and HTMX outerHTML swap returning "Thanks!" — idempotent on repeat votes
- `setApiBroadcast` injection wired in server.js immediately after existing `setClassifierBroadcast` call, no circular require
- Email detail fragment updated: 3-second timer IIFE (data-timerSet guard prevents double-timer on HTMX re-render), thumbs widget below AI summary (hx-target scoped to cls.id), conditional correction history row
- app.js `classification_updated` SSE listener: toast with domain, HTMX detail re-render, categoryChange list refresh
- Full test suite: 132/132 pass, 0 fail (human-verified, all 6 acceptance steps approved)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend /reclassify, add /feedback, wire setBroadcast** — `e57a64b` (feat)
2. **Task 2: Email detail fragment + SSE listener** — `018f7f0` (feat)

## Files Created/Modified

- `src/routes/api.js` — /reclassify extended with audit columns + domain extraction + sender-rule promotion + SSE broadcast; /feedback endpoint added; setBroadcast stub + export added at module scope; email detail fragment updated with thumbs widget, correction history row, 3-second timer script
- `src/server.js` — setApiBroadcast injection added after existing setClassifierBroadcast call
- `public/js/app.js` — classification_updated SSE listener added inside connectSSE(): showToast, htmx.ajax detail re-render, htmx.trigger categoryChange

## Decisions Made

- Used `cls.id` (classification row id) as `summary_id` in ai_feedback UPSERT — not `email.id` — per D-13: the feedback targets the AI-generated summary, not the email itself
- setBroadcast injected into api.js after router mount (not circular require) — mirrors the established classifier.js pattern
- Sender-rule promotion threshold: 2 corrections from same `(user_id, domain, category)` tuple using COUNT JOIN query with all three WHERE predicates to prevent cross-user contamination
- SSE broadcast payload for `classification_updated` contains `{email_id, category, source:'user', domain}` — no PII, consistent with T-03-15 accepted risk
- Correction history row conditionally rendered only when `user_corrected_category` is non-null — avoids null/empty row on uncorrected emails (Pitfall 7)
- 3-second IIFE timer uses `el.dataset.timerSet` guard to prevent double-timer on HTMX re-render (Pitfall 5)

## Deviations from Plan

None — plan executed exactly as written. All implementation followed PATTERNS.md specifications and RESEARCH.md pitfall guidance.

## Issues Encountered

None — both tasks implemented cleanly on the first attempt. All 132 tests passed before and after each task.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Complete Phase 3 user correction loop is delivered end-to-end: schema (03-01/03-02), Tier 0 lookup (03-03), correction endpoints + UI (03-04)
- Requirements CORRECT-01 through CORRECT-07 all delivered and human-verified
- sender_rules table is populated after 2 corrections; Tier 0 lookup is already active in classifyEmail()
- Ready for Phase 4 (AI quality evals / DeepEval integration) or any further Phase 3 follow-on

---
*Phase: 03-user-correction-loop*
*Completed: 2026-05-15*
