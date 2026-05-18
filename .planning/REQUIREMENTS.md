# Requirements: IntelliMail AI Quality Milestone

**Defined:** 2026-05-14
**Core Value:** Every email a user receives should be understood by the system: correctly categorized, concisely summarized, and ready for action — without the user having to open it first.

---

## v1 Requirements

### Evaluation Baseline (Phase 1 gate)

- [ ] **EVAL-01**: A corpus of 30–50 real emails with ground-truth category labels exists in `.planning/eval/corpus.json` before any prompt is changed
- [ ] **EVAL-02**: Baseline accuracy scores (category accuracy %, summary quality rating) are recorded in `.planning/eval/baseline.md` and must be re-run after every prompt change to detect regression

### Prompt Engineering (Phase 1)

- [ ] **PROMPT-01**: The monolithic 7-field LLM prompt is split into Call A (classification: category, urgency, urgency_reason, summary, extracted_data, suggested_tone) and Call B (draft_reply, on-demand only — not called during email sync)
- [ ] **PROMPT-02**: The system prompt includes one-line boundary definitions for each of the 8 categories, preventing bleed between adjacent categories (fyi vs other, rewards_awards vs fyi, meeting_request vs other)
- [ ] **PROMPT-03**: The classification prompt includes 1–2 few-shot examples for each of the 3 most confused boundaries: fyi/other, rewards_awards/fyi, meeting_request/other
- [ ] **PROMPT-04**: Temperature is set explicitly on all 4 providers: 0.0–0.1 for Call A (classification), 0.3–0.5 for Call B (draft generation)
- [ ] **PROMPT-05**: Summary output is constrained structurally ("one sentence that states what action is needed") rather than by character count
- [ ] **PROMPT-06**: Provider-native JSON output modes are enabled on all 4 adapters (Groq strict schema mode, Gemini responseMimeType + responseSchema, NVIDIA NIM + DeepSeek OpenAI-compatible response_format); existing `extractJsonBlock()` fallback is retained
- [ ] **PROMPT-07**: A `low_confidence: true` flag is attached to any parsed result where the category fell back to the default enum value (signals uncertain classifications without exposing raw LLM scores)

### Infrastructure / Reliability (Phase 1)

- [ ] **INFRA-01**: A 4th parse fallback path exists: on parse failure, store DEFAULTS with `error: 'parse_failure'`, log at WARN with provider name and raw response excerpt — no silent failures
- [ ] **INFRA-02**: The classification queue enforces a per-email retry cap of 3 total attempts; emails that exhaust all attempts are stored with `source: 'failed'` and displayed as "Classification failed" in the UI

### Thread Context (Phase 2)

- [ ] **THREAD-01**: A `fetchThreadContext(userId, email)` helper in `classifier.js` retrieves prior emails in the same thread from SQLite using In-Reply-To / References headers
- [ ] **THREAD-02**: A `buildThreadContext(messages)` helper assembles thread context with a hard budget: 5 prior messages maximum, 500 chars each, oldest-first ordering with the triggering email last and explicitly labeled
- [ ] **THREAD-03**: A quoted-reply-chain stripping utility removes lines beginning with `>`, `On [date] wrote:`, and `--- Original Message ---` before context is assembled, preventing token waste from compounding quotations
- [ ] **THREAD-04**: The assembled thread context is injected into the Call A prompt under a labeled section heading (`## Prior thread context`) so the LLM knows what role each message plays
- [ ] **THREAD-05**: The total prior-context token budget is enforced at ~1 500 tokens; messages are truncated from the oldest end if the budget is exceeded
- [ ] **THREAD-06**: Every LLM call logs structured JSON to the console: `{ provider, user_id, email_id, token_count, outcome, latency_ms }` — this is the prerequisite for Phase 4 observability
- [ ] **THREAD-07**: Call B (draft generation) receives the assembled thread context so draft replies reference the actual conversation, not just the triggering email

### User Correction Loop (Phase 3)

- [ ] **CORRECT-01**: Two columns added to the `classifications` table via `ALTER TABLE` guards (production-safe): `user_corrected_category TEXT` and `corrected_at DATETIME`
- [ ] **CORRECT-02**: `POST /api/emails/:id/correct` endpoint accepts `{ category }`, validates against the `CATEGORIES` enum, writes both columns, and broadcasts `classification_updated` via SSE so the badge in the open email view updates live without reload
- [ ] **CORRECT-03**: A correction affordance appears on the category badge in the email detail view (inline category picker, no modal) — it becomes visible after 3 seconds of reading time to avoid accidental taps
- [ ] **CORRECT-04**: After a correction is submitted, a toast confirms: "Moved to [Category]. We'll remember this for future emails from [sender domain]."
- [ ] **CORRECT-05**: After 2 or more corrections from the same sender domain to the same category, a Tier 1 sender-rule override is stored in the database and applied before the regex rules tier on future emails from that domain
- [ ] **CORRECT-06**: Correction history (original category, corrected category, timestamp) is visible in the email detail panel so users can verify their corrections were recorded
- [ ] **CORRECT-07**: Thumbs up / thumbs down on summaries is stored to an `ai_feedback` table (summary_id, user_id, vote, created_at) as a batch quality signal; no re-generation is triggered on negative feedback

### Provider Observability (Phase 4)

- [ ] **OBSERVE-01**: `GET /api/llm/health` endpoint returns per-provider health data already computed by `router.js` (`getProviderHealth(userId)`) — requires no new computation, only an endpoint and auth guard
- [ ] **OBSERVE-02**: Structured JSON logging added to `classifier.js` so every LLM call emits `{ provider, user_id, email_id, token_count, outcome, latency_ms }` — prerequisite for the health UI to show real data
- [ ] **OBSERVE-03**: A provider health panel in Settings displays color-coded status per provider (green = ok, amber = rate_limited / service_busy, red = invalid_key / breaker_open), last error message truncated to 60 chars, last success timestamp — polled via HTMX every 30 seconds
- [ ] **OBSERVE-04**: A single amber pill "AI features degraded" appears on the dashboard when any provider is in a non-ok state — end users see this, not per-provider detail
- [ ] **OBSERVE-05**: On server startup, classification queue processing is delayed 30–60 seconds (warm-up probe) to prevent a burst of retry errors when a provider was mid-outage at restart
- [ ] **OBSERVE-06**: Post-parse semantic validation in the router triggers cascade fallback on soft failures (null or invalid category after parsing, empty summary) — not just HTTP errors — so circuit-breaker logic is not bypassed by malformed 200 responses

### AI Output UI (Phase 5)

- [ ] **UI-01**: Every email in the list and detail view shows a tier attribution badge: "Rule" (green dot, regex match), "AI" (blue dot, LLM classified), or "Failed" (red dot, fallback/failed) — sourced from the `source` column already stored in `classifications`
- [ ] **UI-02**: Hovering the urgency badge ("Urgent", "Moderate") shows a tooltip with the plain-text `urgency_reason` from the database — zero new data collection, purely a UI gap
- [ ] **UI-03**: Extracted structured data (PNR for travel, amount due / due date for financial, platform for meetings) is surfaced in the email list and detail without requiring the user to open the full email — data exists in `extracted_data` JSON in the `classifications` table
- [ ] **UI-04**: Draft replies are visually distinguished ("AI draft — review before sending") with a distinct background color and explicit attribution; they are never pre-populated in the active compose area without user action
- [ ] **UI-05**: A tone selector (Brief / Formal / Warm) appears before draft generation is triggered; selection is passed as a prompt parameter to Call B (no backend schema changes required)
- [ ] **UI-06**: The email detail view shows a provider attribution footer: "AI by [Provider] · [latency]ms" — sourced from the `llm_logs` table (model_id not stored; model name deferred per D-15)
- [ ] **UI-07**: AI annotations follow progressive disclosure: category + urgency badge in list view; summary shown on email open; draft reply shown only when the reply button is activated

---

## v2 Requirements

Acknowledged, not in current roadmap. Requires Phase 3 correction corpus to be useful.

### Correction-Informed Prompting

- **CORR-ADV-01**: After 20+ user corrections per category accumulate, a prompt tuning pass uses the correction data as few-shot examples to further improve classification accuracy
- **CORR-ADV-02**: Correction patterns are surfaced in a developer-facing analytics view (category confusion matrix, top-corrected sender domains)

### Advanced Thread Summarization

- **THREAD-ADV-01**: Summaries for threads with 3+ participants include attribution: "Alice asked X, Bob confirmed Y" — requires thread context (Phase 2) and is high implementation complexity for marginal gain over action-extraction summaries
- **THREAD-ADV-02**: For threads longer than 5 messages, a pre-summarization pass condenses older messages before the main classification call to prevent lost-in-the-middle degradation

### Per-Provider Prompt Variants

- **PROMPT-ADV-01**: Groq (schema-enforced, strict mode) receives a lighter system prompt without redundant output instructions; DeepSeek receives more explicit parsing rules — validated by measuring per-provider accuracy against the eval corpus

---

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Confidence percentages shown to users | Research: anchoring bias; users treat percentages as authoritative and lose trust when they're wrong. Use color coding + plain-language status instead. |
| Auto-archive based on AI category | Irreversibility risk with real users. Destructive actions require explicit user intent. |
| Re-generate summary immediately on thumbs-down | Wastes API tokens; research shows users prefer correction to re-generation. Batch feedback is the right signal. |
| Gmail OAuth / Microsoft Graph | IMAP-only this milestone; OAuth integration is a separate milestone. |
| Next.js or Supabase migration | Existing stack is production-stable; full migration is deferred. |
| New email categories | Current 8 categories cover the real traffic. Adding categories without data degrades existing accuracy. |
| Contacts, calendar, tasks, notes | Email only. |
| Expert persona prompting ("You are a world-class email expert...") | Research: EMNLP 2024 + arxiv 2311.10054 confirm expert persona framing degrades classification accuracy. Current neutral framing is correct — do not elaborate it. |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EVAL-01 | Phase 1 | Pending |
| EVAL-02 | Phase 1 | Pending |
| PROMPT-01 | Phase 1 | Pending |
| PROMPT-02 | Phase 1 | Pending |
| PROMPT-03 | Phase 1 | Pending |
| PROMPT-04 | Phase 1 | Pending |
| PROMPT-05 | Phase 1 | Pending |
| PROMPT-06 | Phase 1 | Pending |
| PROMPT-07 | Phase 1 | Pending |
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| THREAD-01 | Phase 2 | Pending |
| THREAD-02 | Phase 2 | Pending |
| THREAD-03 | Phase 2 | Pending |
| THREAD-04 | Phase 2 | Pending |
| THREAD-05 | Phase 2 | Pending |
| THREAD-06 | Phase 2 | Pending |
| THREAD-07 | Phase 2 | Pending |
| CORRECT-01 | Phase 3 | Pending |
| CORRECT-02 | Phase 3 | Pending |
| CORRECT-03 | Phase 3 | Pending |
| CORRECT-04 | Phase 3 | Pending |
| CORRECT-05 | Phase 3 | Pending |
| CORRECT-06 | Phase 3 | Pending |
| CORRECT-07 | Phase 3 | Pending |
| OBSERVE-01 | Phase 4 | Pending |
| OBSERVE-02 | Phase 4 | Pending |
| OBSERVE-03 | Phase 4 | Pending |
| OBSERVE-04 | Phase 4 | Pending |
| OBSERVE-05 | Phase 4 | Pending |
| OBSERVE-06 | Phase 4 | Pending |
| UI-01 | Phase 5 | Pending |
| UI-02 | Phase 5 | Pending |
| UI-03 | Phase 5 | Pending |
| UI-04 | Phase 5 | Pending |
| UI-05 | Phase 5 | Pending |
| UI-06 | Phase 5 | Pending |
| UI-07 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0 ✓

---

*Requirements defined: 2026-05-14*
*Last updated: 2026-05-14 after initial definition*
