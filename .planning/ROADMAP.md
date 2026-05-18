# Roadmap: IntelliMail AI Quality Milestone

## Overview

IntelliMail has a working two-tier AI classifier in production. This milestone raises output quality across every dimension users experience — accuracy, summary usefulness, draft relevance, reliability, and transparency — without touching the existing architecture. Five phases deliver incrementally: eval corpus first (a hard gate), then prompt improvements, then thread context, then a user correction loop, then provider observability, then richer AI output in the UI. Each phase's output is a prerequisite for the next. Stability is a constraint throughout.

## Phases

- [ ] **Phase 1: Prompt Quality Baseline** - Eval corpus, split prompts, structured output, reliability infra — the gate for all subsequent work
- [x] **Phase 2: Thread Context** - Full thread history passed to classification and draft calls; structured logging enabled *(Complete 2026-05-15)*
- [x] **Phase 3: User Correction Loop** - Inline correction affordance, sender-rule promotion, summary feedback — storage and consumer in one phase *(Complete 2026-05-15)*
- [x] **Phase 4: Provider Observability** - Health endpoint, structured logging UI, user-facing degraded indicator, soft-failure cascade *(Complete 2026-05-18)*
- [ ] **Phase 5: AI Output UI** - Tier attribution, urgency tooltips, extracted data panels, draft visual treatment, progressive disclosure

## Phase Details

### Phase 1: Prompt Quality Baseline
**Goal**: The AI classifier produces measurably better output — verifiable against a frozen eval corpus — with no silent failures and no wasted tokens on draft generation during email sync
**Depends on**: Nothing (first phase — hard gate for all other phases)
**Requirements**: EVAL-01, EVAL-02, PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-04, PROMPT-05, PROMPT-06, PROMPT-07, INFRA-01, INFRA-02
**Success Criteria** (what must be TRUE):
  1. A labeled eval corpus of 30-50 real emails exists and baseline accuracy scores are recorded — any future prompt change can be measured against this frozen baseline
  2. Classification calls (Call A) and draft-reply calls (Call B) are separate; drafts are never generated during email sync, only on-demand
  3. Every provider returns structured JSON via native output modes; the existing extractJsonBlock() fallback still fires on parse failure without silent errors
  4. Any email that exhausts 3 classification attempts is stored with source: 'failed' and shown as "Classification failed" in the UI — no email silently disappears from the inbox without a visible status
  5. A low_confidence flag is attached to results where the category fell back to the enum default, giving operators a signal without exposing raw scores to users
**Plans**: 3 plans

Plans:
- [ ] 01-01-PLAN.md — Eval infrastructure: eval-corpus.js script, .planning/eval/ placeholders, Wave 0 test stubs
- [ ] 01-02-PLAN.md — LLM prompt foundation: SYSTEM_PROMPT update, buildDraftPrompt(), parseProviderResponse() hardening
- [ ] 01-03-PLAN.md — Draft chain + reliability: router.generateDraft(), provider temperature opts, INFRA-02 attempt counter

**Risks:**
- Prompt changes that improve accuracy on one category boundary can regress another — the eval corpus is the only protection against this; build it first, before touching a single prompt line
- INFRA-02 (retry cap) must ship in this phase; if it slips to Phase 2, adding thread context (which multiplies tokens per call) during an outage creates a cost runaway scenario

### Phase 2: Thread Context
**Goal**: Classification and draft replies use the full conversation history — not just the triggering email — so accuracy improves for reply threads and drafts reference what was actually said
**Depends on**: Phase 1 (eval corpus must exist to detect thread context regressions; INFRA-02 retry cap must be in place before token spend multiplies)
**Requirements**: THREAD-01, THREAD-02, THREAD-03, THREAD-04, THREAD-05, THREAD-06, THREAD-07
**Success Criteria** (what must be TRUE):
  1. When a reply email arrives, the classifier receives up to 5 prior messages from the thread (oldest first, triggering email last) under a labeled context section — quoted reply chains stripped before assembly
  2. The assembled thread context never exceeds the 1500-token prior-context budget; messages are truncated from the oldest end when the budget is exceeded
  3. Draft replies reference the actual conversation history, not just the triggering email
  4. Every LLM call emits a structured JSON log entry with provider, user_id, email_id, token_count, outcome, and latency_ms — visible in application logs from day one of this phase
**Plans**: 5 plans

Plans:

**Wave 0**
- [x] 02-01-PLAN.md — Wave 0 test stubs: thread.test.js (new), base.test.js + router.test.js extensions

**Wave 1** *(blocked on Wave 0 completion)*
- [x] 02-02-PLAN.md — DB foundation: llm_logs table + 30-day pruning, idx_emails_msgid_user index, imap.js storeEmail raw_headers fix
- [x] 02-03-PLAN.md — Thread utility module: src/llm/thread.js (fetchThreadContext, buildThreadContext, stripQuotedReplies)
- [x] 02-04-PLAN.md — Prompt injection: base.js opts.threadContext in buildPrompt() and buildDraftPrompt()

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-05-PLAN.md — Wire-up + logging: classifier.js thread fetch, router.js token_count + llm_logs INSERT

Cross-cutting constraints:
- All `fetchThreadContext` SQL queries must include `AND user_id = ?` — cross-user thread leakage prevention (V4, ASVS L1)
- `node --test "tests/**/*.test.js"` must pass green (103+ tests) before each wave merge and before `/gsd-verify-work`

**Risks:**
- Quoted reply chains inflate token counts dramatically (a 3-message thread can use more tokens than a long single email because every reply quotes all prior messages); the stripping utility (THREAD-03) and budget enforcement (THREAD-05) must both be in place before enabling thread context in production
- Test classification accuracy separately for 1-message, 2-4 message, and 5+ message threads against the Phase 1 eval corpus before enabling for all users; monitor token costs in the first 48 hours after enabling

### Phase 3: User Correction Loop
**Goal**: Users can mark a wrong classification, the system confirms the correction visibly, and corrections from the same sender accumulate into a persistent rule — closing the feedback loop with a real downstream consumer
**Depends on**: Phase 1 (corrections should target real prompt-level errors, not systematic failures that Phase 1 will have fixed; corrections against a broken baseline produce noisy signal)
**Requirements**: CORRECT-01, CORRECT-02, CORRECT-03, CORRECT-04, CORRECT-05, CORRECT-06, CORRECT-07
**Success Criteria** (what must be TRUE):
  1. A user can correct a wrong category directly from the category badge in the email detail view — no modal, no navigation — and the badge updates live without a page reload
  2. After submitting a correction, a toast confirms "Moved to [Category]. We'll remember this for future emails from [sender domain]." — the feedback loop is visibly closed
  3. After 2 or more corrections from the same sender domain to the same category, a Tier 1 sender-rule override is stored and applied on future emails from that domain before any regex or LLM processing
  4. Correction history (original category, corrected category, timestamp) is visible in the email detail panel
  5. Thumbs up / thumbs down on summaries is stored to the ai_feedback table — the signal is captured even though no immediate re-generation is triggered
**Plans**: 4 plans

Plans:

**Wave 0**
- [x] 03-01-PLAN.md — Test stubs: tests/correction.test.js — schema assertions, sender rule promotion, ai_feedback UPSERT

**Wave 1** *(blocked on Wave 0 completion)*
- [x] 03-02-PLAN.md — DB schema: classifications audit columns, sender_rules table, ai_feedback table
- [x] 03-03-PLAN.md — Classifier Tier 0: sender-rule lookup before rulesClassify() in classifyEmail()

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03-04-PLAN.md — Endpoint + UI: /reclassify extension, /feedback endpoint, setBroadcast injection, email detail fragment, app.js SSE listener

Cross-cutting constraints:
- All DB queries in /reclassify and /feedback MUST include `AND user_id = req.user.id` — cross-user classification/feedback access prevention (V4, ASVS L1)
- category validated against CATEGORIES enum; vote validated against ['up','down'] before any DB write (V5, ASVS L1)
- broadcast cannot be imported from api.js via require('../server') — use setBroadcast injection pattern
- `node --test "tests/**/*.test.js"` must pass green (122+ tests) before each wave merge and before `/gsd-verify-work`

**Risks:**
- Storing corrections without a downstream consumer is worse than no feedback system — it creates false confidence that the system is learning when it isn't; the sender-rule consumer (CORRECT-05) is mandatory in this same phase, not a follow-up
- The 3-second read-time delay before the correction affordance appears (CORRECT-03) must be validated against real mobile usage; too short causes accidental taps, too long causes the affordance to be missed

### Phase 4: Provider Observability
**Goal**: Operators can see per-provider health status in Settings; end users see a single degraded indicator on the dashboard; soft failures (malformed 200 responses) trigger cascade fallback, not silent acceptance
**Depends on**: Phase 2 (THREAD-06 structured logging is the prerequisite — building a health UI without structured log data is impossible; the health endpoint exposes data already computed in router.js but the UI needs real log-sourced context)
**Requirements**: OBSERVE-01, OBSERVE-02, OBSERVE-03, OBSERVE-04, OBSERVE-05, OBSERVE-06
**Success Criteria** (what must be TRUE):
  1. GET /api/llm/health returns per-provider status (ok / rate_limited / service_busy / invalid_key / breaker_open), last error message, and last success timestamp — auth-guarded, no new computation required
  2. The Settings page shows a color-coded provider health panel (green / amber / red) with last error truncated to 60 chars, polled via HTMX every 30 seconds
  3. A single amber "AI features degraded" pill appears on the dashboard when any provider is in a non-ok state — end users see this language, not circuit-breaker terminology
  4. When a provider returns HTTP 200 with a null or invalid category, or an empty summary, the router triggers cascade fallback to the next provider rather than accepting the malformed result
  5. On server startup, the classification queue is held for 30-60 seconds before resuming, preventing a burst of retry errors if a provider was mid-outage at restart time
**Plans**: 3 plans

Plans:

**Wave 0**
- [x] 04-01-PLAN.md — Wave 0 test stubs: tests/api/health.test.js (new), tests/server.test.js (new)

**Wave 1** *(blocked on Wave 0 completion)*
- [x] 04-02-PLAN.md — Backend: /api/llm/health + /api/llm/health/pill endpoints (api.js), soft-failure gate + CATEGORIES import (router.js), startup warmup delay (server.js), 4 new router test cases

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 04-03-PLAN.md — Frontend: Settings health panel (settings.html), dashboard pill HTMX wrapper (dashboard.html)

Cross-cutting constraints:
- New /api/llm/health routes must NOT be added to PUBLIC_API_PATHS — global requireAuth in server.js:74-81 covers them (V2, ASVS L1)
- getProviderHealth(req.user.id) is user-scoped — never call with a hardcoded or null userId in production code (V4, ASVS L1)
- last_error_msg rendered via Alpine x-text (not x-html) in settings.html — XSS prevention (V5, ASVS L1)
- Dashboard pill must say "AI features degraded" only — no provider names, no circuit-breaker terms in end-user facing HTML
- `node --test "tests/**/*.test.js"` must pass green (136+ tests) before each wave merge and before `/gsd-verify-work`

**Risks:**
- The user-facing / operator-facing language boundary is a design decision to make before implementation; "circuit breaker open" must never appear to end users; agree on the language split before writing the UI

### Phase 5: AI Output UI
**Goal**: Every AI annotation in the inbox follows progressive disclosure — category and urgency in list view, summary on open, draft only on reply — with transparent attribution so users understand what classified each email and why
**Depends on**: Phase 3 (users must have a correction path before more AI output is added to the inbox; showing more AI annotations without a way to fix wrong ones erodes trust faster than it builds it)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07
**Success Criteria** (what must be TRUE):
  1. Every email in list and detail views shows a tier attribution badge: "Rule" (green dot), "AI" (blue dot), or "Failed" (red dot) — sourced from the existing source column in the classifications table
  2. Hovering the urgency badge shows a plain-text tooltip with the urgency_reason from the database — no new data collection, purely surfacing what is already stored
  3. Extracted structured data (PNR for travel, amount due / due date for financial, platform for meetings) is visible in the email list and detail without opening the full email — sourced from extracted_data JSON already in the classifications table
  4. Draft replies are visually distinguished with "AI draft — review before sending" attribution and a distinct background; they are never pre-populated in the active compose area without explicit user action
  5. A tone selector (Brief / Formal / Warm) appears before draft generation is triggered; the selection is passed as a prompt parameter to Call B with no backend schema changes
  6. The email detail view shows a provider attribution footer: "AI by [Provider] · [latency]ms"
**Plans**: 3 plans

Plans:

**Wave 1** *(independent — can run in parallel)*
- [x] 05-01-PLAN.md — CSS foundation: neomorphic shadow variables + all Phase 5 component classes (public/css/app.css)
- [x] 05-02-PLAN.md — List view changes: SQL SELECT patch, tierBadge() + keyFactLine() helpers, list row template, templates.js warm tone (src/routes/api.js, src/llm/templates.js)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 05-03-PLAN.md — Detail view + draft UX: tier badge in header, urgency tooltip, llm_logs attribution footer, draft section restructure, renderActionZone() updates, draftEditor() Alpine updates (src/routes/api.js, public/js/app.js)

Cross-cutting constraints:
- All new user-sourced data in HTML template literals MUST use escHtml() — XSS prevention (V5, ASVS L1)
- CSS variables only — no hardcoded hex values in any new CSS declaration
- No border on tier badges (except .tone-chip--selected) — shadow defines edges (sketch-findings constraint)
- FAILED badge MUST have box-shadow: var(--shadow-convex-sm) — convex constraint from sketch-findings
- Draft section MUST NOT auto-populate on email open — only after Reply button click (D-13)
- `node --test "tests/**/*.test.js"` must pass green (141+ tests) before each wave merge and before `/gsd-verify-work`

**Risks:**
- Individual transparency features each seem low-density; the aggregate cognitive load of all annotations visible simultaneously is the real risk; test with the full inbox loaded before finalizing which annotations appear in list view vs detail view only
- The extracted data panel (UI-03) depends on extracted_data being populated consistently in the classifications table; verify data completeness for each category before surfacing the panel in the UI

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Prompt Quality Baseline | 0/TBD | Not started | - |
| 2. Thread Context | 5/5 | Complete | 2026-05-15 |
| 3. User Correction Loop | 4/4 | Complete | 2026-05-15 |
| 4. Provider Observability | 3/3 | Complete | 2026-05-18 |
| 5. AI Output UI | 3/3 | In progress | - |
