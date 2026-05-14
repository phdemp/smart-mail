# Pitfalls Research — Email AI Improvement

**Project:** IntelliMail AI Quality Milestone
**Domain:** Production LLM email classification — brownfield improvement
**Researched:** 2026-05-14
**Stack context:** Node.js/Express + SQLite, 4-provider LLM cascade (NVIDIA NIM -> Groq -> Gemini -> DeepSeek), two-tier classifier (regex rules + LLM), in-memory classification queue, no E2E or browser tests, no structured logging, no monitoring.

---

## Prompt Engineering Pitfalls

### Pitfall PE-1: Prompt Changes Without a Regression Corpus

**What goes wrong:** A prompt is edited to fix one misclassification. The fix improves that case but silently breaks 3 others. Because there is no frozen test corpus of real emails with known-correct labels, the regression is invisible until a user complains.

**Why it happens:** The temptation is to eyeball a handful of examples, confirm they look better, and ship. Without a structured before/after comparison, you are flying blind. The existing test suite (`tests/llm/templates.test.js`) tests prompt construction — not prompt output quality. There is no eval harness.

**Warning signs:**
- Prompt changes decided by "this looks better" rather than a scored diff
- No file or document capturing what the prompt used to produce on a fixed set of inputs
- Users report regressions in categories that were not the target of the change

**Prevention:**
- Before touching any prompt, freeze a corpus of 30-50 real (anonymized) email samples with their current LLM outputs as a baseline
- After editing, run the same corpus through both prompt versions and diff the category/urgency/summary outputs
- Track prompt versions with a constant (already established in `CLAUDE.md` as `CURRENT_PROMPT_VERSION`) and log which version produced each stored result
- Use LLM-as-judge evaluation on the diff if no ground-truth labels exist yet — score whether the new outputs are better or worse on the criteria that matter (accuracy, relevance, faithfulness)

**Phase most at risk:** Prompt improvement phase (Phase 1). Every subsequent phase that adds thread context also modifies prompts.

---

### Pitfall PE-2: Evaluating Without Ground Truth

**What goes wrong:** The team asserts "the new prompt is better" based on spot-checking 5 emails. There is no measurement. When prompt version 3 is deployed, there is no way to know if version 2 was actually better on the long tail.

**Why it happens:** Building a labeled ground-truth dataset feels like extra work. It is skipped. The result is that "improvement" is subjective and unverifiable.

**Warning signs:**
- Prompt decisions justified with anecdotes, not numbers
- No eval script, no score baseline, no comparison artifact
- Team cannot answer "by how much did accuracy improve?"

**Prevention:**
- Establish a minimal labeled set of 30+ emails before the first prompt change (one afternoon of annotation)
- For categories where ground truth is expensive to collect, use LLM-as-judge with explicit criteria: "Does this summary contradict the email content?", "Is this urgency plausible given the email?"
- Store eval scores alongside prompt versions so the trend is visible over time
- The existing `tests/llm/templates.test.js` covers template construction — add a separate `evals/` directory for output quality scoring, separate from unit tests

**Phase most at risk:** Phase 1 (prompt improvement). Also Phase 3 (feedback loop) — without ground truth you cannot tell if user corrections are improving or degrading quality.

---

### Pitfall PE-3: One Prompt Doing Two Things

**What goes wrong:** A single LLM call is asked to return category, urgency score, summary, extracted data, and draft reply simultaneously. The model trades off quality on each task against the others. Changing the summary instructions accidentally shifts category outputs.

**Why it happens:** Bundling everything into one call feels efficient. It reduces API cost and latency. But it creates hidden coupling between unrelated output fields.

**Warning signs:**
- Prompt template has more than 3 distinct output fields
- Changing instructions for one output (e.g., summary) causes unexpected changes in another (e.g., urgency)
- Hard to write eval criteria because outputs are entangled

**Prevention:**
- Separate classification (category + urgency) from summarization from draft generation — at minimum keep them as separately testable prompt segments even if batched in one call for now
- `CLAUDE.md` already states "One Claude API call per prompt" — apply this discipline to the LLM cascade too; drafts should be a second call, not appended to the classify call
- If bundling is required for cost, use structured output (JSON schema) with strict field separation and test each field independently

**Phase most at risk:** Phase 1 (prompt improvement), Phase 2 (thread context) — thread context makes prompts longer; entangled outputs become harder to reason about.

---

## Thread Context Pitfalls

### Pitfall TC-1: Lost-in-the-Middle Degradation

**What goes wrong:** A long thread (10+ messages) is concatenated and passed to the LLM. The most important message — often the triggering reply in the middle of the chain — receives less attention than the first and last messages. The LLM classifies based on the oldest context rather than the current ask.

**Why it happens:** LLMs exhibit primacy and recency bias. Content in the middle of a long prompt is weighted less reliably regardless of its semantic importance. This is well-documented across model families.

**Warning signs:**
- Classification accuracy drops for long threads vs single emails
- Summaries describe the original email rather than the current situation
- Urgency scores are anchored to the first message, not the latest reply

**Prevention:**
- Always place the most recent message last (recency position) and the system instruction first
- For threads > 4 messages, truncate middle messages rather than the first and last; preserve the opening context and the current trigger
- Add a thread position marker in the prompt: "This is message 7 of 9 in the thread. The user's question is in the final message."
- Test classification accuracy separately for single-email vs 2-4 message vs 5+ message threads

**Phase most at risk:** Phase 2 (thread context). This pitfall does not exist before thread context is added.

---

### Pitfall TC-2: Naive Concatenation Exceeds Token Budget

**What goes wrong:** Thread messages are concatenated in full (subject + headers + body for every message) without token counting. Long threads or threads with quoted reply chains hit the model's context limit. The API either hard-errors, silently truncates, or returns degraded output.

**Why it happens:** Token limits are invisible during development (short test threads fit easily). Production threads from active email accounts can be 50+ messages with quoted text that multiplies content.

**Warning signs:**
- Occasional API errors with 400/413 status on long threads
- Inconsistent classification quality that correlates with thread length
- No token counting in the prompt construction code

**Prevention:**
- Count tokens before sending (use a tokenizer library or estimate at 4 chars/token for a safe budget)
- Define a hard budget: system prompt tokens + thread tokens + output buffer must be under 80% of the model's context limit (leaving room for the model's output)
- Implement a tiered truncation strategy: (1) strip quoted reply blocks first, (2) drop middle messages, (3) truncate bodies to first 500 chars each — never truncate the newest message
- Log the token count of every LLM call to detect when threads approach the budget

**Phase most at risk:** Phase 2 (thread context). The current single-email classifier has no token budget concern; adding threads makes this an immediate risk.

---

### Pitfall TC-3: Quoted Reply Chain Inflation

**What goes wrong:** Most email clients include the entire prior conversation as a quoted block in each reply ("> On Jan 1, John wrote: ..."). Concatenating raw thread messages without stripping quoted blocks means the content is repeated 2-10x, consuming the token budget with duplicate information.

**Why it happens:** Email bodies are taken as-is. The reply chain quoting convention is not stripped before passing to the LLM.

**Warning signs:**
- Token counts for threads are much higher than expected for the number of messages
- LLM output references the same event multiple times (because it appears in every quoted block)
- Thread with 3 messages uses more tokens than a single long email

**Prevention:**
- Strip quoted blocks from email bodies before assembling thread context — look for lines beginning with `>`, `On [date], [name] wrote:`, `--- Original Message ---`, and similar patterns
- Keep only the "new content" added by each message in the thread
- This stripping should be a dedicated utility function (`skills/email-parse.ts` in CLAUDE.md architecture) with its own unit tests
- Verify after stripping that each message still contains substantive content (not empty after stripping)

**Phase most at risk:** Phase 2 (thread context). Critical to get right before the first thread-aware classification ships to production.

---

### Pitfall TC-4: Message Ordering Confusion in Multi-Sender Threads

**What goes wrong:** Thread messages are assembled in the wrong order (e.g., provider returns them newest-first, prompt is built without reversing). The LLM reads the thread backwards: conclusion before premise, reply before question.

**Why it happens:** IMAP fetch order varies by provider and query. Code assumes oldest-first without verifying.

**Warning signs:**
- LLM summaries describe a strange narrative that does not match the thread
- Classification results feel inverted ("action-needed" on a resolved thread)
- Thread assembly code has no explicit sort step

**Prevention:**
- Always sort thread messages by `date` header ascending (oldest first) before assembly
- Add a unit test that verifies thread assembly order using messages with different timestamps
- Include message timestamps in the prompt context so the LLM can detect ordering anomalies

**Phase most at risk:** Phase 2 (thread context) — specifically the thread assembly implementation.

---

## User Feedback Loop Pitfalls

### Pitfall FL-1: Storing Corrections Without Acting on Them

**What goes wrong:** The UI allows users to mark a classification as wrong. The correction is stored in the database. Nothing ever reads it. The system keeps making the same mistake. Users feel unheard and stop correcting.

**Why it happens:** Building the correction UI and storage is straightforward. Closing the loop — using corrections to improve classification — is harder and often deferred indefinitely.

**Warning signs:**
- `feedback` or `corrections` table has rows but no code reads from it downstream
- Prompt templates were last updated before the feedback table was created
- No metric tracks "how often are corrections for the same category made repeatedly?"

**Prevention:**
- Before building the feedback UI, define explicitly what happens after feedback is received: (a) immediate re-classification with the corrected label, (b) periodic review in admin UI, (c) used to build labeled eval corpus — pick at least one
- Ship the feedback storage and the feedback consumer in the same phase, not separate phases
- A correction that is stored but never consumed is worse than no feedback system: it creates false confidence

**Phase most at risk:** Phase 3 (user feedback loop) — this is the defining risk of that phase.

---

### Pitfall FL-2: Selection Bias in Corrections (Negative Skew)

**What goes wrong:** Users correct obvious wrong classifications ("this is not FYI, it's financial") but accept borderline-correct or mediocre results without clicking anything. The correction dataset over-represents dramatic failures and under-represents the more common subtle errors. Prompt changes based solely on corrections improve dramatic failures but leave subtle quality issues untouched.

**Why it happens:** Implicit feedback is always biased toward negative signal. Happy users don't engage with feedback mechanisms. Corrections skew toward the cases that were most visibly wrong, not the cases that most need improvement.

**Warning signs:**
- Correction dataset has 90%+ of corrections in 2-3 categories, with others unrepresented
- Users correct "wrong category" frequently but never rate summary quality
- Improvement cycles make the worst cases better but do not move aggregate quality metrics

**Prevention:**
- Treat corrections as one signal among several, not as ground truth
- Supplement with periodic random sampling: every N classifications, log the full output for manual review regardless of user correction
- Add a lightweight quality rating ("Was this summary helpful? Y/N") separate from correction, to capture satisfaction on correct classifications
- Monitor correction rate per category — a drop in corrections for a category could mean improvement or could mean users gave up

**Phase most at risk:** Phase 3 (user feedback loop) — the design of what feedback to collect.

---

### Pitfall FL-3: Noisy Signal Used for Prompt Changes Too Quickly

**What goes wrong:** After 10 corrections, the prompt is changed to accommodate them. 3 of those 10 corrections were mis-taps, user errors, or genuinely ambiguous cases. The prompt change makes classification worse on the majority to satisfy a noisy minority.

**Why it happens:** Corrections feel authoritative (the user said so). The volume is low enough that each one feels significant. The team acts on them before enough signal has accumulated.

**Warning signs:**
- Prompt changes triggered after fewer than 20-30 corrections in a category
- No review step between "correction received" and "prompt changed"
- Same email classified differently by two users (indicating the case is genuinely ambiguous)

**Prevention:**
- Require a minimum threshold of corrections per category before treating them as a signal (suggested: 20+ corrections in a category before acting)
- Add a human review step: a team member reviews batched corrections before any prompt changes
- Flag edge cases where multiple users disagree on the correct category — these are ambiguous by definition and should not drive prompt changes
- Build the correction review UI before building the correction-to-improvement pipeline

**Phase most at risk:** Phase 3 (feedback loop) — especially the "act on feedback" step.

---

### Pitfall FL-4: Feedback Loop Amplifying Existing Bias

**What goes wrong:** The LLM cascade has a systematic bias — for example, it over-classifies cold sales emails as "pitch_deck". Users in a specific demographic or with a specific mailbox type correct this more often. The correction dataset reflects their correction patterns. Prompt changes fix their case but introduce a new bias for a different user segment.

**Why it happens:** ML feedback loops are well-documented amplifiers of existing bias. Training on biased correction data produces a biased updated model. This applies equally to prompt engineering driven by correction data.

**Warning signs:**
- Correction rate varies significantly across users (some users correct constantly, others never)
- Corrections cluster around one user or one account type
- Fixing one systematic error introduces a new one in a different category

**Prevention:**
- Stratify correction data by user when reviewing — do not treat all corrections as equally representative
- Track correction rate per user and flag users who generate disproportionate correction volume (outliers may indicate misuse, atypical mailbox, or a legitimate systematic error worth its own investigation)
- Test prompt changes on a diverse set of email samples, not just the samples that generated corrections

**Phase most at risk:** Phase 3 (feedback loop) at scale. Lower risk early when correction volume is small; grows as the user base grows.

---

## Production LLM Pitfalls

### Pitfall PR-1: Silent Quality Failure — 200 OK With Wrong Output

**What goes wrong:** A provider returns HTTP 200 with a valid JSON body, but the category field is an unexpected string (`"action_needed"` instead of `"action-needed"`), or the urgency is `null`, or the summary is empty. The classifier's sanitization layer catches some of these but not all. The email is stored with a bad classification. No error is logged. No alert fires.

**Why it happens:** The circuit breaker and error handling in `router.js` only trip on HTTP errors and exceptions — not on semantic failures within a valid response. The current `parseProviderResponse` in `providers/base.js` does sanitize category and urgency, but the sanitization boundary is the only guard.

**Warning signs:**
- Classification stored as `null` or `"other"` at rates higher than expected
- Summary field empty in stored records when emails clearly have content
- Provider health shows no errors but user-facing quality is poor

**Prevention:**
- Add a post-parse validation step that asserts the minimum output contract: category must be one of the 8 valid categories, urgency must be 1-5, summary must be non-empty if the email body was non-empty
- If any field fails validation, treat it as a soft failure and try the next provider in the cascade (not just HTTP errors)
- Log every soft failure with the raw provider response so the pattern is detectable
- Add a monitoring query: "what % of classifications in the last 24h have summary=empty or category=other?" and alert if above a threshold

**Phase most at risk:** Phase 4 (provider observability) — but the underlying risk exists now. The observability phase surfaces it; the fix needs to happen regardless.

---

### Pitfall PR-2: Cost Runaway From Retry Amplification

**What goes wrong:** Provider A fails. Provider B is tried. Provider B times out at 30s. Provider C is tried. All three fail. The email is re-queued. On re-queue, the same cascade runs again. A burst of 50 emails during a provider outage generates 150+ LLM API calls instead of 50. With thread context added (Phase 2), each call is 3-5x larger. Token burn multiplies.

**Why it happens:** The in-memory queue does not track how many times an email has been attempted. The cascade does not have a per-email retry cap. Thread context dramatically increases tokens per call.

**Warning signs:**
- LLM API billing spikes correlate with provider outage windows
- Classification queue depth grows but does not drain during outages
- No per-email attempt counter in the queue state

**Prevention:**
- Add a per-email attempt counter to the in-memory queue; cap retries at 3 total across all providers
- After exhausting retries, mark the email as `classification_failed` with a reason, not as pending
- Implement token-count budgeting per user per day — alert before the budget is exhausted, not after
- When thread context is added, log token counts per call so the cost increase is visible from day one
- Consider truncating thread context more aggressively (fewer messages) during provider cascade fallback to reduce per-call cost on retry

**Phase most at risk:** Phase 2 (thread context adds cost) and Phase 4 (provider observability makes this visible). The retry amplification risk exists now but is lower without thread context.

---

### Pitfall PR-3: Circuit Breaker State Lost on Restart

**What goes wrong:** Provider A has been failing for 10 minutes. The circuit breaker is open. The server process is restarted (deploy, crash, systemd restart). Circuit breaker state is in-memory and is reset. All 50 pending emails immediately cascade through Provider A again, hit the same failure, and generate 50 new errors before the breaker re-trips.

**Why it happens:** The circuit breaker in `router.js` is stored in a `Map` on the router instance. The in-memory classification queue has the same issue (`CONCERNS.md` documents this). Restart wipes all runtime state.

**Warning signs:**
- Error spikes immediately after deploys that correlate with a provider being in a failed state
- `CONCERNS.md` documents "In-memory classification queue: Map-based queue lost on restart"
- No mechanism to persist breaker state between restarts

**Prevention:**
- On startup, do not immediately classify all pending emails — add a short warm-up delay (30-60 seconds) and a health probe of each provider before resuming the cascade
- Alternatively, persist breaker state to SQLite (a single row per provider) so restarts inherit the last known state
- The `classifyAllUnclassifiedForUser` startup behavior should check provider health before dispatching the full queue

**Phase most at risk:** Phase 4 (provider observability) — health state persistence is a natural part of that phase.

---

### Pitfall PR-4: Rate Limit Storm on Cascade Exhaustion

**What goes wrong:** During high-traffic periods, all four providers are rate-limited simultaneously. The cascade tries Provider A (429), Provider B (429), Provider C (429), Provider D (429) for every email in rapid succession. Each attempt consumes a rate-limit token. The token buckets drain immediately. The system enters a state where every email immediately exhausts the cascade and the queue backs up unboundedly.

**Why it happens:** The token bucket per-provider per-user rate limits individual users correctly, but if many users trigger classification simultaneously (e.g., after IMAP IDLE push for a bulk email blast), the aggregate rate across all users can saturate provider limits.

**Warning signs:**
- Classification queue depth grows monotonically during busy periods
- All four providers show 429 errors in logs simultaneously
- No global rate limit or backpressure at the queue dispatch level

**Prevention:**
- Add global (cross-user) rate limiting in addition to per-user limits — the providers have aggregate limits, not just per-user limits
- Implement exponential backoff with jitter before retry attempts, not just a fixed cascade sequence
- Add backpressure at the queue: if more than N emails are in-flight across all users, defer new additions rather than dispatching immediately

**Phase most at risk:** Phase 4 (provider observability surfaces this), but the architectural fix belongs in the core classification pipeline regardless of phase.

---

### Pitfall PR-5: No Structured Logging Makes Failures Invisible

**What goes wrong:** `console.log` and `console.error` write to `server.log` (which is already committed to the repo and will grow unboundedly). There are no log levels, no request IDs, and no structured fields. When a classification fails silently, there is no way to query "how many emails failed classification in the last hour?" or "which provider had the most errors today?"

**Why it happens:** `CONCERNS.md` documents this explicitly: "No structured logging: console.log/console.error only. No log levels, no request IDs, no centralized error tracking." It has been deferred. It becomes critically important when adding observability features.

**Warning signs:**
- `server.log` is a flat text file with no queryable structure
- Debugging a production issue requires `grep`-ing through the log file
- Cannot answer operational questions ("is Provider X healthy right now?") without reading code or running manual checks

**Prevention:**
- Before shipping provider observability UI, add structured logging (JSON lines to stderr) for at minimum: every LLM call attempt (provider, user_id, email_id, token_count, outcome, latency_ms)
- Use a log level field (`info`, `warn`, `error`) so noise can be filtered
- The existing `router.js` already writes JSON to stderr (`process.stderr.write(JSON.stringify(...))`) — extend this pattern to classifier.js and all LLM providers
- Store provider health summary in SQLite (one row per provider, updated after each call) so the UI can query it without log parsing

**Phase most at risk:** Phase 4 (provider observability) — you cannot build a health UI without structured data to query.

---

## UI / UX Pitfalls

### Pitfall UI-1: Showing AI Confidence as Absolute Certainty

**What goes wrong:** The UI displays AI category labels with no indication that they might be wrong. Users treat the label as authoritative. When it is wrong, trust collapses disproportionately — "the AI said this was financial, so I didn't read it, and I missed a deadline."

**Why it happens:** Showing a flat label is the simplest implementation. Adding nuance (confidence indicators, "review this" flags) requires design work and feels like adding noise.

**Warning signs:**
- Every classified email shows the same visual treatment regardless of the LLM's output confidence
- No distinction between a regex-tier classification (high confidence) and an LLM cascade classification (variable confidence)
- User complaints about high-confidence-sounding labels being wrong

**Prevention:**
- Surface the classification tier (rules vs LLM) as a subtle signal — rules-classified items can be shown with higher visual confidence than LLM-classified items
- For emails where the LLM returned a low urgency score but a high-stakes category (e.g., "legal"), add a "verify this" prompt rather than acting as if classification is certain
- Do not use language like "This email is financial" — prefer "Classified as: Financial" to signal that it is a classification, not a certainty
- Reserve correction UI affordances for LLM-classified items; rules-classified items are high-enough confidence that correction UX adds noise

**Phase most at risk:** Phase 5 (richer AI output UI) — when summaries and extracted data are displayed with the same flat authority as the category label.

---

### Pitfall UI-2: Correction Interaction Too Subtle or Too Disruptive

**What goes wrong:** Either (a) the correction affordance is so subtle users cannot find it (a tiny grey "wrong?" link), causing low correction volume and sparse feedback, or (b) the correction flow interrupts the email reading experience with a modal or long form, causing users to dismiss it rather than complete it.

**Why it happens:** UI friction for corrections is a known design tradeoff. Err too far toward invisible and the feedback loop has no data. Err too far toward intrusive and users learn to dismiss the prompt.

**Warning signs:**
- Correction rate is near zero despite known classification errors (too subtle)
- Users report being interrupted while reading email by correction prompts (too disruptive)
- Correction UI is a multi-step form (too much friction)

**Prevention:**
- Correction should be a single-click action: the current label is shown with a small "Not [category]?" affordance that expands inline to a category picker — no modal, no page navigation
- Show the correction affordance only after the email has been open for > 3 seconds (user has read it) to reduce accidental corrections
- Provide immediate visual feedback after correction ("Updated to: Financial") so the user knows it worked
- Do not ask "why was this wrong?" in the correction flow — collect the corrected label only; reasoning questions belong in optional, asynchronous surveys

**Phase most at risk:** Phase 3 (user feedback loop) — the correction UI design.

---

### Pitfall UI-3: Alert Fatigue From AI Annotations on Every Email

**What goes wrong:** Every email shows urgency score, category badge, summary, extracted data, and a draft reply suggestion. The inbox becomes visually overwhelming. Users stop reading any of the AI annotations because there is too much noise. The AI layer becomes decoration.

**Why it happens:** When building AI features, each individual feature seems useful. The aggregate cognitive load of showing all features simultaneously is not evaluated until the full UI is built.

**Warning signs:**
- The email list shows more AI annotation than email subject/sender
- Users report the inbox feels "cluttered" or "confusing"
- AI annotations are ignored (measurable by zero interaction with correction/draft features)

**Prevention:**
- Apply progressive disclosure: show category and urgency in the list view; show summary only when the email is opened; show draft reply only when compose/reply is initiated
- High-urgency emails (score 4-5) can surface a visual distinction; low-urgency emails should look quieter, not busier
- Test the UI with the full inbox loaded — not just individual email cards — before deciding what to display at each level
- The 8-category system already provides structure; do not layer additional urgency, tone, and sentiment signals on top without validating that users find them actionable

**Phase most at risk:** Phase 5 (richer AI output UI) — this phase explicitly adds more AI output to the UI.

---

### Pitfall UI-4: Draft Reply Shown as Ready-to-Send

**What goes wrong:** The AI draft reply is displayed pre-populated in the compose window with no visual indication it is AI-generated. Users send it without reading it. The draft is generic ("Thank you for your email. I will review and respond shortly.") and sounds robotic. Recipients notice. The user is embarrassed and loses trust in the feature.

**Why it happens:** The templates in `src/llm/templates.js` are placeholder-quality templates, not personalized drafts. If the UI presents them in the compose window with the send button active, users may send without reviewing.

**Warning signs:**
- Draft is inserted at the top of the compose window with cursor at the end (ready to send)
- No AI attribution label on the draft text
- Template text is visually identical to user-typed text

**Prevention:**
- Label AI-generated drafts clearly: "AI draft — review before sending" with a distinct background color or border
- Place the draft below a separator in the compose window, not in the active editing area
- The tone check (`pre-send.ts` in CLAUDE.md) should apply to AI-generated drafts too — do not disable the pre-send hook for drafts
- For the current template-based drafts (`templates.js`), the label should be even more prominent since these are not personalized

**Phase most at risk:** Phase 5 (richer AI output UI) when drafts are given a more prominent role.

---

### Pitfall UI-5: Provider Health Display Creating User Anxiety

**What goes wrong:** The provider health UI shows all four providers with their last error, last success, and circuit breaker state. A user sees "NVIDIA: circuit open, Groq: last error 2m ago" and panics — they do not understand what this means for their email. They contact support. The health display was intended for operators, not end users.

**Why it happens:** Observability features are built for operators and developers, then exposed in the same UI that end users see because it is the only UI that exists.

**Prevention:**
- Separate admin/operator views from user-facing views before building provider health UI
- The user-facing signal should be a single indicator: "AI features working normally" / "AI features degraded — classifications may be slower"
- Detailed provider health (per-provider status, error types, circuit breaker state) belongs in an admin-only view, not the settings panel that all users see
- Map provider state to user-facing language: "circuit open" = "temporarily unavailable", not the internal term

**Phase most at risk:** Phase 4 (provider observability) — specifically the decision of what to expose and to whom.

---

## Phase Risk Map

| Phase | Primary Risk | Pitfall(s) | Risk Level |
|-------|-------------|------------|------------|
| Phase 1: Prompt Improvement | Prompt regression with no safety net | PE-1, PE-2, PE-3 | HIGH — no eval harness exists today |
| Phase 2: Thread Context | Token budget exceeded, lost-in-middle, quoted chain inflation | TC-1, TC-2, TC-3, TC-4 | HIGH — entirely new code surface, no tests for thread assembly |
| Phase 3: User Feedback Loop | Collecting feedback that is never acted on; acting on noisy signal too quickly | FL-1, FL-2, FL-3, FL-4 | MEDIUM — design risk more than technical risk |
| Phase 4: Provider Observability | Silent failures not surfaced; health UI causing user confusion | PR-1, PR-5, UI-5 | MEDIUM — existing structured logging gap makes this harder |
| Phase 5: Richer AI Output UI | Alert fatigue, overclaiming confidence, draft shown as ready-to-send | UI-1, UI-2, UI-3, UI-4 | MEDIUM — UX decisions with low reversibility once users form habits |
| All phases | Cost runaway from retry amplification with thread context | PR-2, PR-4 | HIGH when Phase 2 + production load combine |
| All phases | Circuit breaker state lost on restart | PR-3 | LOW-MEDIUM — known risk, manageable with startup probe |

### Cross-Phase Dependencies

- Phase 1 must establish a prompt eval corpus before Phase 2 adds thread context (otherwise regressions from thread context changes are undetectable)
- Phase 3 feedback loop is only useful if Phase 1 has improved prompts enough that corrections reflect real classification errors, not systematic prompt failures
- Phase 4 observability requires structured logging (a prerequisite fix) before any health UI can be built from real data
- Phase 5 UI should not ship before Phase 3 correction UI — users need a correction path before more AI output is added to the UI

### Pitfalls That Require Fixes Before Phase Work Begins

| Prerequisite Fix | Required Before |
|------------------|----------------|
| Freeze a 30-email labeled eval corpus | Phase 1 prompt work |
| Add token counting to prompt construction | Phase 2 thread context |
| Add quoted-block stripping to email parse | Phase 2 thread context |
| Extend structured logging to classifier.js | Phase 4 observability |
| Add per-email attempt counter to queue | Phase 2 (cost runaway prevention) |

---

*Sources consulted: evidentlyai.com LLM regression testing guide; portkey.ai LLM observability guide; getmaxim.ai LLM resilience production guide; arxiv.org feedback loop bias classification paper; smashingmagazine.com AI UX trust design; pair.withgoogle.com explainability chapter; agenta.ai context length management; IntelliMail codebase — src/classifier.js, src/llm/router.js, src/llm/templates.js, .planning/codebase/CONCERNS.md, .planning/codebase/TESTING.md*
