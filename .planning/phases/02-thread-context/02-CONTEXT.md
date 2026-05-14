# Phase 2: Thread Context - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Pass full conversation history to both LLM calls (Call A classification and Call B draft generation) so accuracy improves for reply threads and drafts reference actual prior messages. Deliverables: a thread-fetching helper, a context-assembly helper, a quote-stripping utility, prompt injection under a labeled section heading, a token budget enforcer, structured JSON logging to console + a new `llm_logs` SQLite table, and thread context wired into both `classify()` and `generateDraft()`.

No architecture changes. No new npm dependencies. Works with the existing SQLite database — the emails table already stores `raw_headers TEXT` with In-Reply-To and References values.

</domain>

<decisions>
## Implementation Decisions

### Thread Linking Strategy

- **D-01:** `fetchThreadContext(userId, email)` identifies thread members by parsing `In-Reply-To` and `References` from the `raw_headers` JSON column in the `emails` table. No new `thread_id` column — resolve headers at query time.
- **D-02:** Fallback when header-based matching returns 0 results: normalized subject matching — strip `Re:` / `Fwd:` prefixes, case-insensitive. This catches thread starters and emails missing headers. Subject fallback fires only when header matching returns empty.
- **D-03:** A covering index on `(message_id, user_id)` should exist or be added to keep the header parse queries fast. Claude's call on whether to add it inline or defer to `db.js` migration block.

### Token Budget Enforcement

- **D-04:** Token counting uses a character-count proxy: `chars ÷ 4 ≈ tokens`. No external tokenizer. This matches the existing `buildPrompt()` approach (800-char body truncation). Budget cap: ~1500 tokens ≈ 6000 chars of prior context.
- **D-05:** The triggering email is NOT counted against the 5-message limit. `buildThreadContext()` assembles up to 5 **prior** messages (oldest-first), then the triggering email is appended last with an explicit label. Total: 5 prior + 1 triggering.
- **D-06:** Each prior message is truncated to 500 chars after quote stripping. If the total assembled prior context exceeds 6000 chars, truncate from the oldest end (drop the oldest message first, then shorten if still over budget).

### Quote Stripping

- **D-07:** `stripQuotedReplies(text)` removes lines matching exactly these three patterns (in order):
  1. Lines starting with `>` (standard email quoting)
  2. Lines matching `/^On .{10,80} wrote:$/i` (single-line attribution headers)
  3. Lines matching `/^-{3,} ?original message/i`
  Leave all other lines intact. Multi-line attribution headers (`On date\nAlice wrote:`) lose the first line only — the continuation stays.
- **D-08:** Minimum content threshold: if the stripped result is fewer than 100 chars and the original was longer, use the original text instead. This prevents over-stripping when the entire body was a quote with a one-liner response.

### Structured Logging

- **D-09:** Every LLM call (both `classify()` and `generateDraft()` in `router.js`) logs structured JSON to console **and** inserts a row into a new `llm_logs` SQLite table. Console logging format: `{ ts, provider, user_id, email_id, token_count, outcome, latency_ms }`. DB table has the same columns plus `id INTEGER PRIMARY KEY AUTOINCREMENT`.
- **D-10:** `llm_logs` table is created via the standard inline `try { db.exec(...) } catch(e) {}` migration guard in `db.js`. No migration file needed.
- **D-11:** Retention policy: on server startup, delete rows older than 30 days: `DELETE FROM llm_logs WHERE ts < datetime('now', '-30 days')`. Runs once at startup, synchronous, no background job.
- **D-12:** `token_count` is estimated using the same chars ÷ 4 proxy applied to the assembled prompt string (SYSTEM_PROMPT + thread context + email). Not exact, but consistent with D-04's approach.

### Prompt Injection

- **D-13:** Thread context is injected into the Call A prompt under a `## Prior thread context` section heading immediately before the triggering email section. Format per message: `[From: {from_name} <{from_address}>]\n[Subject: {subject}]\n{body_snippet}`. Triggering email follows under `## Current email`.
- **D-14:** Call B (`buildDraftPrompt`) receives the same assembled thread context prepended identically. This was deferred from Phase 1 (D-09); Phase 2 wires it in.
- **D-15:** `buildPrompt()` and `buildDraftPrompt()` in `base.js` accept an optional `opts.threadContext` string. When present, inject it under the labeled heading. When absent (single email, no prior messages), the prompt is unchanged — backward-compatible.

### Claude's Discretion

- Whether `fetchThreadContext()` lives in `classifier.js` directly or as a helper in a new `src/llm/thread.js` file (requirements say `classifier.js` — follow the spec unless a separate file is cleaner)
- Exact SQL query for header-based thread retrieval (message_id LIKE match vs. JSON extract from raw_headers)
- Whether the `llm_logs` INSERT is fire-and-forget (no await on a wrapped async) or synchronous via better-sqlite3's sync API (synchronous preferred for consistency with existing DB patterns)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Thread Context — 7 requirements (THREAD-01 through THREAD-07); ALL must be covered
- `.planning/ROADMAP.md` §Phase 2 — goal, success criteria, dependencies, and risks

### Core source files (read before editing)
- `src/classifier.js` — `classifyEmail()`, `generateDraft()`, `storeClassification()`; thread helpers go here or alongside
- `src/llm/router.js` — `classify()` and `generateDraft()`; logging added to both call sites
- `src/llm/providers/base.js` — `buildPrompt()` and `buildDraftPrompt()`; both need `opts.threadContext` parameter
- `src/db.js` — `emails` table schema (has `raw_headers TEXT`, `message_id TEXT UNIQUE`); `llm_logs` migration goes here
- `src/imap.js` — how `raw_headers` is stored (JSON string); needed to understand parse format

### Phase 1 context (decisions that constrain Phase 2)
- `.planning/phases/01-prompt-quality-baseline/01-CONTEXT.md` — D-06 through D-09 (prompt split decisions, Call A/B split, draft-on-demand)

### Existing test patterns
- `tests/classifier_validation.test.js` — DB isolation pattern, router mock pattern (use for thread helper tests)
- `tests/llm/base.test.js` — `buildPrompt()` test structure (mirror for `opts.threadContext` tests)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildPrompt(email, opts)` and `buildDraftPrompt(email, opts)` in `base.js` — extend with `opts.threadContext`; both already use the same `lines.push()` + `lines.join('\n')` assembly pattern
- `INSERT OR IGNORE` pattern in `storeClassification()` — use same pattern for `llm_logs` INSERT
- `raw_headers TEXT` column in `emails` table — already stores IMAP headers as JSON string; parse with `JSON.parse(email.raw_headers || '{}')`
- `message_id TEXT UNIQUE` column — the reference point for In-Reply-To/References lookups

### Established Patterns
- CommonJS `require`/`module.exports` throughout — no ESM
- All DB ops via `better-sqlite3` synchronous API — `llm_logs` INSERT should be synchronous too
- Inline migration guard: `try { db.exec('ALTER TABLE...') } catch(e) {}` — use for `llm_logs` CREATE TABLE
- `opts` parameter bag pattern on `buildPrompt(email, opts = {})` — extend without breaking existing callers

### Integration Points
- `classifyEmail()` → calls `buildPrompt()` (via router provider calls) → add thread context fetch before router call
- `generateDraft()` in `classifier.js` → calls `router.generateDraft()` → add thread context to opts
- `router.js classify()` and `generateDraft()` → add `llm_logs` INSERT after each provider call resolves
- `src/db.js` startup block → add `llm_logs` migration + 30-day pruning

</code_context>

<specifics>
## Specific Ideas

- The `## Prior thread context` / `## Current email` labeled sections are important — the LLM needs to understand which message it's being asked to classify. Make the current email label explicit.
- The subject normalization fallback (strip Re:/Fwd:) should be case-insensitive and handle both `Re:` and `RE:` and `Fwd:` and `FWD:` and `Fw:`.
- `token_count` in `llm_logs` should reflect the assembled prompt sent to the provider, not just the email body. This makes Phase 4 latency/cost analysis meaningful.

</specifics>

<deferred>
## Deferred Ideas

- Per-provider prompt variants (lighter system prompt for Groq strict mode, heavier rules for DeepSeek) — Phase 1 deferred item; still deferred, needs eval corpus data first
- Pre-summarization for threads > 5 messages (THREAD-ADV-02) — v2; not in current milestone
- Participant-attributed thread summaries (THREAD-ADV-01) — v2; not in current milestone

</deferred>

---

*Phase: 2-Thread Context*
*Context gathered: 2026-05-14*
