# PROJECT.md — IntelliMail AI Quality Milestone

## What This Is

IntelliMail is a production multi-user email client with an AI classification layer. It runs Node.js/Express + SQLite with IMAP/SMTP and a 4-provider LLM cascade (NVIDIA NIM → Groq → Gemini → DeepSeek).

This milestone improves the AI layer across every dimension users experience: category accuracy, summary quality, draft reply usefulness, reliability, and observability — while keeping the existing architecture intact and production stable.

## Core Value

Every email a user receives should be understood by the system: correctly categorized, concisely summarized, and ready for action — without the user having to open it first.

## Who It's For

Production users of IntelliMail. Changes must not break what's working. Stability is a constraint, not a trade-off.

## Context

| Item | Detail |
|---|---|
| Codebase state | Brownfield — existing production app with real users |
| Stack | Node.js/Express, SQLite (better-sqlite3), IMAP (imapflow), SMTP (nodemailer) |
| AI layer | Two-tier: regex rules → 4-provider LLM router with circuit breaker |
| Deployment | Linux VPS via SSH, systemd |
| Codebase map | `.planning/codebase/` (7 documents) |

## Requirements

### Validated

- ✓ Multi-user JWT auth with signup/login — existing
- ✓ IMAP sync with IDLE push + cron fallback — existing
- ✓ Two-tier classification: regex rules tier + LLM cascade tier — existing
- ✓ 4-provider LLM router: NVIDIA NIM → Groq → Gemini → DeepSeek — existing
- ✓ Circuit breaker + token bucket rate limiting per user per provider — existing
- ✓ Email send/reply/forward via SMTP — existing
- ✓ SSE real-time push to browser on new email + classification — existing
- ✓ Draft generation per email — existing
- ✓ Category-specific action panels in UI (8 categories) — existing
- ✓ Per-user API key management — existing
- ✓ Default trial keys for new users (signup day only) — existing
- ✓ Classification scope gate (latest 100 / 10 days) — existing

### Active

- [ ] Improved prompt templates: classification accuracy, summary quality, and draft reply relevance all measurably better
- [ ] Thread-aware classification: full thread history passed to LLM, not just the triggering email
- [ ] User feedback / correction: users can mark a classification as wrong; correction stored and visible
- [ ] Richer AI output UI: summaries, urgency, extracted data, and draft replies displayed with more context and clarity
- [x] Provider observability: visible health status per provider, last error, last success — surfaced in UI and/or admin view *(Validated in Phase 4)*
- [ ] Reliable classification: silent failures eliminated; every in-scope email either classified or clearly marked as failed with reason

### Out of Scope

- Gmail OAuth / Microsoft Graph — IMAP-only stays this milestone
- Next.js or Supabase migration — existing stack stays
- Contacts, calendar, tasks, notes — email only
- New email categories — current 8 categories sufficient for now

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| Evolve IntelliMail incrementally | Production users; stability constraint; full rewrite deferred | Milestone scoped to AI layer improvements only |
| Keep existing LLM cascade | NVIDIA/Groq/Gemini/DeepSeek router is working; improve prompts before switching models | Active |
| Thread-aware context | Single-email context is causing poor quality on replies and summaries in threads | Active |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-18 — Phase 4 complete (provider observability)*
