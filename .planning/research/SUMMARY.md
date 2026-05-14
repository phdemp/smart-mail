# Project Research Summary

**Project:** IntelliMail AI Quality Milestone
**Domain:** Production LLM email classification — brownfield improvement
**Researched:** 2026-05-14
**Confidence:** HIGH

---

## Executive Summary

IntelliMail is a working production email client with a two-tier classifier: fast regex rules followed by a 4-provider LLM cascade (NVIDIA NIM → Groq → Gemini → DeepSeek). The AI classification infrastructure is already built and functional. This milestone is not about replacing the architecture — it is about raising output quality incrementally while keeping real users unaffected. The highest-leverage changes are prompt engineering (split the monolithic prompt, add category boundary definitions, set temperature explicitly) and structured output enforcement (provider-native JSON modes). These changes are low-risk, reversible, and have the most research backing.

The single most important cross-cutting finding is that **quality improvements cannot be verified without a labeled eval corpus**. Every research file flags this independently: PITFALLS warns against prompt regression with no safety net, STACK warns that "looks better" without a scored diff is flying blind, and FEATURES notes that improvements without measurement make it impossible to know whether corrections are helping or degrading quality. Building a 30–50 email eval corpus is a prerequisite to touching any prompt — it is the zeroth step of Phase 1, not an optional follow-up.

The recommended approach is a 5-phase incremental rollout ordered by risk and dependency: (1) establish eval baseline and fix the monolithic prompt, (2) add thread context to classification and drafts, (3) wire user correction storage and the feedback loop, (4) expose provider observability in the UI, (5) enrich the AI output UI with transparency patterns. Each phase's output is a prerequisite for the next. The critical risk across all phases is cost runaway from retry amplification — adding thread context in Phase 2 multiplies token spend per call, and combined with the current unbounded retry behavior, a provider outage could burn significant API budget in minutes.

---

## Key Findings

### Recommended Stack

No stack changes are needed for this milestone. The existing Node.js/Express/CommonJS codebase, 4-provider cascade, and SQLite schema are all sufficient. The improvements are prompt engineering, structured output configuration, and thin schema additions.

**Changes by component:**
- **`src/llm/templates.js`:** Split 7-field monolithic prompt into Call A (classification: category/urgency/urgency_reason/summary/extracted_data/suggested_tone) and Call B (draft_reply, lazy/on-demand only). Add category boundary definitions, few-shot examples for 3 ambiguous boundaries, explicit temperature 0.0–0.1 for classification, 0.3–0.5 for draft. Structural summary constraint: "one sentence, state action needed" — not a character limit.
- **`src/llm/providers/*.js`:** Enable provider-native JSON modes. Groq: `response_format: { type: "json_object" }` or strict schema mode (HIGH confidence — official docs confirmed). Gemini: `responseMimeType: "application/json"` + `responseSchema`. NVIDIA NIM and DeepSeek: OpenAI-compatible `response_format`. Keep `extractJsonBlock()` as fallback; do not remove it.
- **`src/classifier.js`:** Add `fetchThreadContext()` + `buildThreadContext()` helpers. Budget: 5 prior messages max, 500 chars each, quoted-reply-chain stripping, newest-last ordering, labeled with From/Date markers.
- **`src/db.js`:** Two `ALTER TABLE` guards: `user_corrected_category TEXT`, `corrected_at DATETIME` on `classifications`. Safe for live SQLite WAL mode — atomic, NULL default, no downtime.
- **`src/routes/api.js`:** `GET /api/llm/health` (two lines; data already computed in router) and `POST /api/emails/:id/correct`.

### Expected Features

**Must have (table stakes — ship this milestone):**
- Correct category on first classification — accuracy improvement via prompt fixes
- One-click correction for wrong category — currently missing entirely; users expect it
- Summary that names the required action — current summaries are generic; action extraction needed
- Thread-aware classification — single-message context misfires on reply threads
- Failed classification visible to user — silent failures break trust silently

**Should have (differentiators — this milestone or next):**
- Urgency reason shown on hover — data already in DB; purely a UI gap, zero new data collection needed
- Tier attribution badge (Rule / AI / Failed) — single most-requested AI transparency feature per Google PAIR research
- Draft tone selector (brief / formal / warm) — low effort, highest perceived quality lift for drafts
- Provider health indicator in settings — differentiates from black-box AI; operator debugging signal
- Correction confirmation toast with sender memory — closes the feedback loop visibly

**Defer:**
- Participant-attributed thread summaries (high implementation risk for marginal gain over action-extraction summaries)
- Confidence percentages shown to users (research: anchoring bias, backfires)
- Auto-archive suggestions based on AI category (irreversibility risk with real users)
- Correction-informed prompting (needs correction corpus first; future milestone)

### Architecture Approach

The architecture is additive, not transformative. All changes flow through existing component boundaries. The classifier gains thread-fetching logic but provider adapters are unchanged. The router's health data is already computed — it just needs an endpoint. The corrections feature adds two columns via the existing migration guard pattern, one new API endpoint, and a UI affordance using the existing HTMX + Alpine.js pattern. No new services, no new dependencies, no framework changes.

**Modified components:**
1. `src/classifier.js` — thread context assembly (new helpers, no interface change to router)
2. `src/db.js` — two-column migration (additive, production-safe)
3. `src/routes/api.js` — two new endpoints
4. `src/llm/templates.js` — prompt redesign (highest impact, eval corpus required first)
5. `views/settings.html` / `views/dashboard.html` — provider health panel, correction affordance

**Unchanged:** `router.js`, all 4 provider adapters, `imap.js`, `smtp.js`, auth stack, SSE infrastructure, scope gate logic, rules tier (Tier 1). The cascade stays intact — improvements happen above and below it, not inside it.

### Critical Pitfalls

1. **Prompt regression with no eval corpus (PE-1/PE-2)** — Changing any prompt without a frozen baseline of 30+ real emails means regressions are invisible until users complain. Freeze the corpus before the first prompt edit. This is a gate, not a nice-to-have.

2. **Token budget exceeded by thread context (TC-2/TC-3)** — Adding thread context multiplies token spend. Quoted reply chains inflate this further (a 3-message thread can use more tokens than a single long email because every reply quotes all prior messages). Strip quoted blocks before assembly. Enforce a hard budget. Log token counts from day one.

3. **Retry amplification during provider outages (PR-2)** — The current queue has no per-email attempt cap. During an outage, 50 emails generate 200+ API calls. With thread context, each call is 3–5x larger. Add a retry cap of 3 total attempts per email before marking `classification_failed`. This must ship before Phase 2.

4. **Feedback stored but never consumed (FL-1)** — Corrections stored without a downstream consumer are worse than no feedback system — they create false confidence. Correction storage and at least one consumer (sender-rule promotion after 2+ corrections) must ship in the same phase.

5. **Silent quality failure inside HTTP 200 (PR-1)** — The circuit breaker only trips on HTTP errors. A provider can return 200 with `category: null` or an empty summary. Add a post-parse semantic validation step that triggers cascade fallback on soft failures (null/invalid category, empty summary), not just HTTP errors.

---

## Implications for Roadmap

### Phase 1: Prompt Quality Baseline

**Rationale:** Prompt improvements are the highest-leverage, lowest-risk changes. But they require a regression safety net first. This phase also eliminates the monolithic prompt (drafts as a lazy call), which reduces cost on every classified email immediately.

**Delivers:**
- 30–50 email eval corpus with baseline scores (gate for all future prompt changes)
- Prompt split: Call A (classification) + Call B (draft, on-demand only) — eliminates draft_reply token burn on every email
- Category boundary definitions in system prompt (one-line per category)
- Few-shot examples for 3 ambiguous boundaries only (fyi/other, rewards_awards/fyi, meeting_request/other)
- Explicit temperature: 0.0–0.1 for classification, 0.3–0.5 for draft
- Structural summary constraint: "one sentence, state what action is needed"
- Provider-native JSON modes on all 4 adapters; `extractJsonBlock()` kept as fallback
- `low_confidence: true` flag when enum fallback fires (derived from validation, not LLM self-assessment)
- 4th parse fallback path: DEFAULTS + `error: 'parse_failure'` logged at WARN (eliminates silent failures)

**Avoids:** PE-1, PE-2, PE-3

**Research flag:** Standard patterns. All recommendations are HIGH confidence from multiple independent sources. No additional research needed.

---

### Phase 2: Thread Context

**Rationale:** Thread context is the highest accuracy-impact change but requires careful implementation. It must come after the eval corpus (Phase 1) exists so regressions are detectable. The retry cap must be in place before this ships — thread context multiplies cost per call, and unbounded retries during an outage would be expensive.

**Delivers:**
- `fetchThreadContext()` + `buildThreadContext()` in `classifier.js`
- Quoted-reply-chain stripping utility (lines starting with `>`, `On [date] wrote:`, `--- Original Message ---`)
- Thread assembly: 5 prior messages max, 500 chars each, oldest-first in context, latest message last and explicitly labeled
- Hard token budget enforced in prompt construction (~1500 tokens for prior context)
- Per-email retry cap (3 total attempts) added to queue before thread context is enabled
- Token count logging per LLM call from day one (cost visibility)
- Thread-aware draft generation: Call B uses thread context, not just the triggering email

**Avoids:** TC-1 (lost-in-middle), TC-2 (budget exceeded), TC-3 (quoted chain inflation), TC-4 (message ordering), PR-2 (cost runaway)

**Research flag:** Test classification accuracy separately for 1-message, 2–4 message, and 5+ message threads against the Phase 1 eval corpus before enabling for all users. Monitor token costs in the first 48 hours.

---

### Phase 3: User Correction Loop

**Rationale:** Architecturally simple (two DB columns, one endpoint) but the feedback loop design is the hardest part. The correction consumer must ship in the same phase as the UI — storing corrections without acting on them is worse than no feedback system.

**Delivers:**
- Schema migration: `user_corrected_category` + `corrected_at` on `classifications` (ALTER TABLE guards, safe in production)
- `POST /api/emails/:id/correct` (auth, enum validation, SSE broadcast for live badge update)
- Correction affordance: inline category picker on badge, no modal, appears after 3s read time
- Correction toast: "Moved to Financial. We'll remember this for future emails from [sender]."
- Sender-rule promotion: after 2+ corrections from same sender domain, create a Tier 1 rule override in DB
- Correction history visible in email detail
- Thumbs up/down on summaries stored to `ai_feedback` table (batch signal; no re-generation triggered)

**Avoids:** FL-1 (never consumed), FL-2 (negative skew only), FL-3 (acting on noisy signal too early — threshold: 20+ corrections per category before prompt change), UI-2 (too subtle or too disruptive)

**Research flag:** The correction threshold before acting on signal (20+) and sender-rule promotion logic need explicit design decisions before coding begins. These are product decisions, not technical ones.

---

### Phase 4: Provider Observability

**Rationale:** Health data already exists in `router.js`. The only gap is an endpoint and a UI. Prerequisite: structured logging must be extended to `classifier.js` first. The UI must distinguish user-facing language from operator-level detail — end users should never see "circuit breaker open."

**Delivers:**
- `GET /api/llm/health` endpoint (two lines; data already in router)
- Structured JSON logging in `classifier.js`: every LLM call logs provider, user_id, email_id, token_count, outcome, latency_ms
- Provider health panel in settings: color-coded status per provider, last-error truncated to 60 chars, HTMX-polled every 30s
- User-facing indicator on dashboard: single amber pill "AI features degraded" (not per-provider detail)
- Operator-only section in settings for full per-provider detail
- Startup health probe: 30–60s warm-up before resuming classification queue on restart (prevents post-restart error bursts)
- Post-parse semantic validation: soft failure triggers cascade fallback (not just HTTP errors)

**Avoids:** PR-1 (silent quality failure), PR-3 (circuit breaker reset on restart), PR-5 (no structured logging makes health UI impossible to build), UI-5 (health display causing user anxiety)

**Research flag:** The user-facing vs operator-facing boundary is a design decision to make explicitly before implementation. Default to less information for end users.

---

### Phase 5: Richer AI Output UI

**Rationale:** Transparency patterns that build long-term trust. Must come after Phase 3 (correction path exists) — users need a way to act on wrong classifications before more AI output is added to the inbox UI.

**Delivers:**
- Tier attribution badge: "Rule match" (green dot) / "AI classified" (blue dot) / "Classification failed" (red dot)
- Urgency reason tooltip: hover on Urgent badge → shows `urgency_reason` from DB (zero new data)
- Extracted data panel: PNR, amount due, due date surfaced without opening email (data exists in DB; purely UI gap)
- Draft reply visual treatment: "AI draft — review before sending" with distinct background; not pre-populated in active compose area
- Draft tone selector: brief / formal / warm, before generation (prompt param only, no backend changes)
- Provider attribution footer in email detail: "AI by Groq · Llama 3.3 70B · 1.2s"
- Progressive disclosure enforced: category + urgency in list view; summary on open; draft only on reply initiation

**Avoids:** UI-1 (AI confidence as certainty), UI-3 (alert fatigue from all annotations visible at once), UI-4 (draft shown as ready-to-send)

**Research flag:** Test the full inbox with all annotations loaded before finalizing display density. Individual features seem reasonable; aggregate cognitive load is the risk. Run with a small subset of users first.

---

### Phase Ordering Rationale

- Phase 1 is a hard gate. No subsequent phase should touch prompts without the eval corpus.
- Phase 2 depends on Phase 1 (eval corpus must exist to detect thread context regressions) and on the retry cap (PR-2) being in place before shipping.
- Phase 3 is largely independent of Phase 2 but should come after Phase 1 baseline accuracy is improved — corrections should reflect real classification errors, not systematic prompt failures that Phase 1 will fix.
- Phase 4 depends on structured logging being extended first. Building a health UI from `console.log` is impossible.
- Phase 5 must come after Phase 3. Adding more AI output to the UI without a correction path leaves users unable to act on errors.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new dependencies; all changes additive to existing infrastructure |
| Features | HIGH | Competitive analysis from SaneBox, Superhuman, Shortwave, Canary Mail; clear priority order |
| Architecture | HIGH | Based on direct codebase analysis of classifier.js, router.js, db.js; line-level recommendations |
| Pitfalls | HIGH | 3 pitfalls (PE-1, TC-2, PR-2) independently confirmed across all 4 research files |

**Overall confidence:** HIGH

### Gaps to Address

- **Per-provider prompt variants (LOW):** Differentiated prompt text for Groq (schema-enforced, lighter) vs DeepSeek (more explicit rules) is plausible but not directly validated. Treat as a Phase 1 experiment, not a firm requirement.
- **Progressive thread summarization (LOW):** Pre-summarizing threads > 5 messages before the main call is logically sound but not validated for email. Flag for Phase 2 if production thread depth data shows it's needed.
- **Correction threshold calibration:** The 20+ corrections/category threshold is a reasonable heuristic — revisit once real correction volume data exists from Phase 3.
- **Token budgets by provider:** Actual token limits depend on which model each provider serves at runtime. Log counts in Phase 2 before hardcoding budget constants.

---

## Sources

### Primary (HIGH confidence)
- Groq Structured Outputs Official Docs — provider-native JSON mode
- Chroma Research 2025 "Context Rot" — thread context budget and ordering
- Wharton GAIL Tech Report 2025 — CoT degradation on classification
- EMNLP 2024 / arxiv 2311.10054 — expert persona prompting degrades classification accuracy
- MDPI Electronics 2024 — multi-task prompt degradation
- Cleanlab few-shot selection research — diminishing returns after 2–3 examples
- Google PAIR Explainability guidelines — tier attribution as most-requested transparency feature
- IntelliMail codebase direct analysis — classifier.js, router.js, db.js, templates.js, CONCERNS.md

### Secondary (MEDIUM confidence)
- PromptLayer 2025 Practitioner Guide — structural vs length constraints for summarization
- arxiv 2509.25498 — LLM overconfidence; escape hatch instruction rationale
- arxiv 2306.11980 — draft reply framing and CO-STAR pattern
- Portkey.ai LLM observability guide — structured logging and soft-failure detection
- EvidentlyAI LLM regression testing guide — eval corpus design and LLM-as-judge approach

### Tertiary (LOW confidence)
- Per-provider prompt variant differentiation — inferred from provider diversity rationale; no direct study
- Progressive thread summarization — logical extension of context management literature; not validated for email specifically

---

*Research completed: 2026-05-14*
*Ready for roadmap: yes*
