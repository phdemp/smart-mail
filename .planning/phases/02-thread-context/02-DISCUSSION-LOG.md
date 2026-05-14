# Phase 2: Thread Context - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 2-thread-context
**Areas discussed:** Thread linking strategy, Token budget enforcement, Log persistence for Phase 4, Quote stripping scope

---

## Thread Linking Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Parse raw_headers on each query | Extract In-Reply-To and References from raw_headers JSON at query time. No schema change. | ✓ |
| Add thread_id column via migration | ALTER TABLE + backfill. Faster lookups, more schema complexity. | |
| Subject normalization fallback | Group by normalized subject. Fast but false-positive risk. | |

**User's choice:** Parse raw_headers on each query (recommended)
**Notes:** No new schema change. Covering index on (message_id, user_id) keeps queries fast.

---

### Thread Linking Fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Subject normalization fallback | Strip Re:/Fwd: prefix, case-insensitive match when header-based yields 0 results. | ✓ |
| Return empty context (no fallback) | Treat thread starters as standalone. Simpler. | |
| You decide | Claude picks safest approach. | |

**User's choice:** Subject normalization fallback
**Notes:** Fires only when In-Reply-To/References matching returns empty set.

---

## Token Budget Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Character-count proxy: chars ÷ 4 | Simple, zero deps, consistent with existing 800-char buildPrompt truncation. | ✓ |
| Word count: words ÷ 0.75 | More accurate for English prose, no dependency. | |
| You decide | Claude picks counting method. | |

**User's choice:** Character-count proxy (chars ÷ 4)
**Notes:** 1500 tokens ≈ 6000 chars. 5 messages × 500 chars = 2500 chars — well under budget for most threads.

---

### Triggering Email Counting

| Option | Description | Selected |
|--------|-------------|----------|
| Triggering email is separate — 5 prior + 1 triggering | Additive. Matches REQUIREMENTS spec (prior messages + triggering email last). | ✓ |
| Triggering email counts as 1 of 5 | Simpler but only 4 prior messages. | |

**User's choice:** Triggering email is separate
**Notes:** 5 prior messages max, triggering email always appended last with explicit label.

---

## Log Persistence for Phase 4

| Option | Description | Selected |
|--------|-------------|----------|
| Console-only now, SQLite table in Phase 4 | THREAD-06 adds format; Phase 4 adds storage. Minimal Phase 2 scope. | |
| Add llm_logs SQLite table in Phase 2 | One migration now. Phase 4 builds UI only. server.log not easily queryable. | ✓ |

**User's choice:** Add llm_logs SQLite table in Phase 2
**Notes:** Both console JSON and DB insert. Phase 4 (OBSERVE-02) just builds the health UI on top.

---

### Log Retention Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Keep last 30 days, pruned on server startup | DELETE on startup, no background job, simple. | ✓ |
| Keep last 10,000 rows per user | Bounded by count, better for low-volume users. | |
| No pruning in Phase 2 — Phase 4 decides | Simplest now; unbounded growth risk. | |

**User's choice:** 30-day retention, pruned on startup

---

## Quote Stripping Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Strip defined patterns only, leave ambiguous | Remove >, On X wrote:, --- Original Message --- only. Conservative. | ✓ |
| Greedy: strip any quoted-looking line | Also strip From:/To: etc. in quote blocks. Higher false-positive risk. | |
| You decide | Claude picks balance. | |

**User's choice:** Strip defined patterns only
**Notes:** Multi-line attribution headers lose only the first line; continuation stays.

---

### Minimum Content Threshold

| Option | Description | Selected |
|--------|-------------|----------|
| 100 chars minimum — use original if stripped is shorter | Prevents over-stripping edge cases. | ✓ |
| No minimum — always use stripped version | Simpler; stripped content could be near-empty. | |
| You decide | Claude picks threshold. | |

**User's choice:** 100 chars minimum — fall back to original if stripped result is shorter

---

## Claude's Discretion

- Whether `fetchThreadContext()` lives directly in `classifier.js` or a new `src/llm/thread.js` file
- Exact SQL query for header-based retrieval (LIKE match vs. JSON extract from raw_headers)
- Whether `llm_logs` INSERT is synchronous (better-sqlite3 sync API, preferred) or async
- Whether to add a covering index on `(message_id, user_id)` inline or defer to the migration block

## Deferred Ideas

- Per-provider prompt variants (Groq strict mode lighter prompt, DeepSeek heavier rules) — still deferred, needs eval corpus data
- Pre-summarization for threads > 5 messages (THREAD-ADV-02) — v2 scope
- Participant-attributed thread summaries (THREAD-ADV-01) — v2 scope
