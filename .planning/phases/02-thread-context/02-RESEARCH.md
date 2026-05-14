# Phase 2: Thread Context - Research

**Researched:** 2026-05-14
**Domain:** SQLite thread linking, token budget enforcement, structured logging, prompt injection
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Thread Linking Strategy**
- D-01: `fetchThreadContext(userId, email)` identifies thread members by parsing `In-Reply-To` and `References` from the `raw_headers` JSON column in the `emails` table. No new `thread_id` column — resolve headers at query time.
- D-02: Fallback when header-based matching returns 0 results: normalized subject matching — strip `Re:` / `Fwd:` prefixes, case-insensitive. This catches thread starters and emails missing headers. Subject fallback fires only when header matching returns empty.
- D-03: A covering index on `(message_id, user_id)` should exist or be added to keep the header parse queries fast. Claude's call on whether to add it inline or defer to `db.js` migration block.

**Token Budget Enforcement**
- D-04: Token counting uses a character-count proxy: `chars ÷ 4 ≈ tokens`. No external tokenizer.
- D-05: The triggering email is NOT counted against the 5-message limit. `buildThreadContext()` assembles up to 5 prior messages (oldest-first), then the triggering email is appended last with an explicit label.
- D-06: Each prior message is truncated to 500 chars after quote stripping. If total assembled prior context exceeds 6000 chars, truncate from the oldest end (drop the oldest message first, then shorten if still over budget).

**Quote Stripping**
- D-07: `stripQuotedReplies(text)` removes lines matching exactly these three patterns (in order): (1) lines starting with `>`, (2) lines matching `/^On .{10,80} wrote:$/i`, (3) lines matching `/^-{3,} ?original message/i`. Leave all other lines intact.
- D-08: Minimum content threshold: if stripped result is fewer than 100 chars and original was longer, use the original text instead.

**Structured Logging**
- D-09: Every LLM call logs structured JSON to console AND inserts a row into a new `llm_logs` SQLite table. Console format: `{ ts, provider, user_id, email_id, token_count, outcome, latency_ms }`. DB table has the same columns plus `id INTEGER PRIMARY KEY AUTOINCREMENT`.
- D-10: `llm_logs` table created via inline `try { db.exec(...) } catch(e) {}` migration guard in `db.js`.
- D-11: Retention: delete rows older than 30 days on server startup. Synchronous, no background job.
- D-12: `token_count` = chars ÷ 4 applied to assembled prompt string (SYSTEM_PROMPT + thread context + email body).

**Prompt Injection**
- D-13: Thread context injected into Call A prompt under `## Prior thread context` section heading. Per-message format: `[From: {from_name} <{from_address}>]\n[Subject: {subject}]\n{body_snippet}`. Triggering email follows under `## Current email`.
- D-14: Call B (`buildDraftPrompt`) receives the same assembled thread context, prepended identically.
- D-15: `buildPrompt()` and `buildDraftPrompt()` in `base.js` accept optional `opts.threadContext` string. When present, inject under labeled heading. When absent, prompt unchanged — backward-compatible.

### Claude's Discretion

- Whether `fetchThreadContext()` lives in `classifier.js` directly or as a helper in a new `src/llm/thread.js` file (requirements say `classifier.js` — follow the spec unless a separate file is cleaner)
- Exact SQL query for header-based thread retrieval (message_id LIKE match vs. JSON extract from raw_headers)
- Whether the `llm_logs` INSERT is fire-and-forget or synchronous via better-sqlite3's sync API (synchronous preferred for consistency with existing DB patterns)

### Deferred Ideas (OUT OF SCOPE)

- Per-provider prompt variants — still deferred, needs eval corpus data first
- Pre-summarization for threads > 5 messages (THREAD-ADV-02) — v2
- Participant-attributed thread summaries (THREAD-ADV-01) — v2
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| THREAD-01 | `fetchThreadContext(userId, email)` retrieves prior emails in same thread from SQLite using In-Reply-To / References headers | D-01/D-02: header parse + subject fallback strategy documented with SQL patterns below |
| THREAD-02 | `buildThreadContext(messages)` assembles thread context: 5 prior max, 500 chars each, oldest-first, triggering email last and labeled | D-05/D-06: budget math and truncation strategy; exact char limits verified against existing BODY_SNIPPET_LEN=800 pattern |
| THREAD-03 | Quote-stripping utility removes `>`, `On [date] wrote:`, `--- Original Message ---` | D-07/D-08: three regex patterns locked; minimum content threshold prevents over-stripping |
| THREAD-04 | Assembled thread context injected into Call A prompt under `## Prior thread context` labeled section | D-13: exact section heading and per-message format locked |
| THREAD-05 | Total prior-context token budget enforced at ~1500 tokens; messages truncated from oldest end | D-04/D-06: chars÷4 proxy; 6000 char cap; oldest-first drop order |
| THREAD-06 | Every LLM call logs structured JSON to console: `{ provider, user_id, email_id, token_count, outcome, latency_ms }` | D-09/D-10/D-11/D-12: llm_logs table schema, startup pruning, prompt-length token estimate |
| THREAD-07 | Call B (draft generation) receives assembled thread context | D-14/D-15: buildDraftPrompt gets opts.threadContext; backward-compatible |
</phase_requirements>

---

## Summary

Phase 2 adds thread context to both LLM calls (classification and draft) and wires structured logging to every LLM call site. The implementation is entirely contained within the existing codebase — no new npm packages, no architecture changes, no migration files beyond inline guards.

**Critical discovery:** `raw_headers` is NULL for all 800 emails in the live database. The storeEmail() function in `imap.js` never populates this column — it stores parsed fields from `mailparser` but does not persist the raw headers object as JSON. This means D-01 (header-based thread linking via `In-Reply-To`/`References` parsing from `raw_headers`) cannot work on existing data. The `storeEmail()` function must be updated to persist `In-Reply-To` and `References` values extracted by mailparser, AND D-02's subject fallback must be the primary strategy for all currently-stored emails. [VERIFIED: live DB query confirmed 0 rows with non-NULL raw_headers; storeEmail() code confirmed no raw_headers insertion]

**Primary recommendation:** Implement `fetchThreadContext()` using subject-normalized matching as the primary strategy (because raw_headers is unpopulated), and add `in_reply_to` / `references` column population to `storeEmail()` so header-based linking works for future emails. The two-column index (D-03) on `(user_id, message_id)` is needed for the header lookups — add it inline in `db.js`.

The logging work (THREAD-06) integrates into `router.js`'s `_callProviders()` helper, which already calls `log()` at success and error paths — the token count calculation needs to be added before calling `log()`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Thread fetching (fetchThreadContext) | DB layer (db.js schema + classifier.js query) | — | Pure SQLite SELECT; no external I/O |
| Context assembly (buildThreadContext) | Business logic (classifier.js or thread.js) | — | Pure JS transformation; no I/O |
| Quote stripping (stripQuotedReplies) | Utility (classifier.js or thread.js) | — | Pure regex; no I/O |
| Prompt injection (opts.threadContext) | LLM layer (base.js) | — | Prompt is assembled in base.js |
| Token budget enforcement | Business logic (buildThreadContext) | — | Runs before prompt assembly |
| Structured console logging | Router layer (router.js) | — | Already has log() hook; extend it |
| llm_logs DB insertion | Router layer (router.js) | DB layer (db.js migration) | Router owns the log call; db.js owns schema |
| llm_logs schema + pruning | DB layer (db.js) | — | All schema migrations live in db.js |
| storeEmail raw header backfill | IMAP layer (imap.js) | — | storeEmail() must extract headers from mailparser output |

---

## Standard Stack

### Core (already in project — no new installs)
| Library | Version | Purpose | Phase 2 role |
|---------|---------|---------|--------------|
| better-sqlite3 | installed | SQLite synchronous API | llm_logs table, thread SELECT queries |
| node:test | built-in (Node v24) | Test runner | Thread helper tests |
| node:assert/strict | built-in | Test assertions | Mirror existing test pattern |

**No new npm dependencies.** [VERIFIED: CONTEXT.md constraint + package.json confirmed no vitest; test runner is node --test]

### Environment
| Item | Status | Value |
|------|--------|-------|
| Node.js | Available | v24.11.1 |
| better-sqlite3 | Available | confirmed loadable |
| Test suite baseline | Passing | 103/103 tests green |
| llm_logs table | Not yet created | No row in DB |
| raw_headers column | Exists (TEXT) | NULL for all 800 emails |

---

## Architecture Patterns

### System Architecture Diagram

```
classifyEmail(userId, emailId)
        │
        ├──► fetchThreadContext(userId, email)
        │         │
        │         ├── [In-Reply-To / References parse from emails.raw_headers]  ← future emails
        │         └── [Subject normalized match fallback]  ← all current emails (raw_headers=NULL)
        │                   │
        │                   └── SELECT emails WHERE subject_normalized LIKE ? AND user_id = ?
        │                              (ORDER BY received_at ASC, LIMIT 5+1)
        │
        ├──► buildThreadContext(priorMessages)
        │         │
        │         ├── stripQuotedReplies(body_text)  ← per message
        │         ├── truncate each to 500 chars
        │         ├── enforce 6000 char total (drop oldest)
        │         └── format: [From: ...]\n[Subject: ...]\nbody_snippet
        │
        └──► llm.router.classify(email, { threadContext })
                  │
                  └── _callProviders(email, opts, ...)
                            │
                            ├── buildPrompt(email, { threadContext })
                            │       └── inject "## Prior thread context" + "## Current email"
                            │
                            ├── provider.call(email, opts, cfg)
                            │
                            ├── [success] → log({ ts, provider, user_id, email_id, token_count, outcome:'success', latency_ms })
                            │               INSERT INTO llm_logs (...)
                            │
                            └── [error]   → log({ ..., outcome:'http_429'|'timeout'|..., latency_ms })
                                            INSERT INTO llm_logs (...)
```

### Recommended File Touch Points
```
src/
├── classifier.js          — fetchThreadContext(), buildThreadContext(), wire into classifyEmail() + generateDraft()
├── llm/
│   ├── providers/
│   │   └── base.js        — buildPrompt(email, opts) and buildDraftPrompt(email, opts) get opts.threadContext
│   └── router.js          — _callProviders() adds token_count + INSERT INTO llm_logs
├── db.js                  — llm_logs CREATE TABLE + startup pruning; covering index on (user_id, message_id)
└── imap.js                — storeEmail() must save in_reply_to + references from mailparser output

tests/
├── llm/
│   ├── thread.test.js     — NEW: fetchThreadContext, buildThreadContext, stripQuotedReplies tests
│   └── base.test.js       — EXTEND: opts.threadContext injection tests for buildPrompt + buildDraftPrompt
└── llm/
    └── router.test.js     — EXTEND: llm_logs insert + token_count tests
```

### Pattern 1: Inline Migration Guard (existing pattern — use for llm_logs)
**What:** DDL wrapped in try/catch so re-runs are safe on existing DBs.
**When to use:** Any new table or column added in Phase 2.
```javascript
// Source: [VERIFIED: src/db.js lines 93, 201-207]
try {
  db.exec(`
    CREATE TABLE llm_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      provider TEXT,
      user_id INTEGER,
      email_id INTEGER,
      token_count INTEGER,
      outcome TEXT,
      latency_ms INTEGER
    )
  `);
} catch(e) {}
```

### Pattern 2: Startup Pruning (existing pattern — mirror for llm_logs)
**What:** One synchronous DELETE on DB load to expire old rows.
**When to use:** Any log/audit table with a retention policy.
```javascript
// Source: [VERIFIED: src/db.js line 178 — provider_usage pruning]
try {
  db.prepare("DELETE FROM provider_usage WHERE day < date('now', '-7 days')").run();
} catch(e) {}

// Phase 2 equivalent:
try {
  db.prepare("DELETE FROM llm_logs WHERE ts < datetime('now', '-30 days')").run();
} catch(e) {}
```

### Pattern 3: opts Parameter Bag Extension (existing pattern — extend for threadContext)
**What:** Optional named parameters via `opts = {}` default; new params added without breaking existing callers.
**When to use:** Extending `buildPrompt()` and `buildDraftPrompt()`.
```javascript
// Source: [VERIFIED: src/llm/providers/base.js lines 59, 70]
function buildPrompt(email, opts = {}) {
  const lines = [];
  lines.push(SYSTEM_PROMPT);
  lines.push('');
  // NEW: inject thread context when present
  if (opts.threadContext) {
    lines.push('## Prior thread context');
    lines.push(opts.threadContext);
    lines.push('');
    lines.push('## Current email');
  }
  lines.push(`From: ${email.from_name || ''} <${email.from_address || ''}>`);
  lines.push(`Subject: ${email.subject || ''}`);
  const body = (email.body_text || email.preview || '').slice(0, BODY_SNIPPET_LEN);
  if (body) lines.push('', body);
  return lines.join('\n');
}
```

### Pattern 4: Router log() Integration
**What:** `router.js` already calls `log()` at success and error paths. Token count must be added before the log call.
**When to use:** THREAD-06 structured logging.
```javascript
// Source: [VERIFIED: src/llm/router.js lines 109, 113]
// Existing (success path):
log({ provider: name, mode, outcome: 'success', latency_ms: Date.now() - start, email_id: email.id, user_id: userId });

// Phase 2 extension — compute token_count before the call:
const promptText = provider.buildPrompt ? provider.buildPrompt(email, opts) : '';  // or assembled prompt
const tokenCount = Math.ceil(promptText.length / 4);
// Then on success:
log({ provider: name, mode, outcome: 'success', latency_ms: Date.now() - start,
      email_id: email.id, user_id: userId, token_count: tokenCount });
// INSERT INTO llm_logs synchronously
try {
  db.prepare(`INSERT INTO llm_logs (ts, provider, user_id, email_id, token_count, outcome, latency_ms)
              VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)`)
    .run(name, userId, email.id, tokenCount, 'success', Date.now() - start);
} catch(e) {}
```

### Pattern 5: Subject Normalization Fallback
**What:** Strip threading prefixes from subject for cross-thread matching.
**When to use:** D-02 fallback when header-based matching returns 0 results (i.e., all current 800 emails since raw_headers=NULL).
```javascript
// Source: [ASSUMED] — standard email threading pattern
function normalizeSubject(subject) {
  return (subject || '')
    .replace(/^(re|RE|Re|fwd?|FWD?|Fw|FW)\s*:\s*/gi, '')
    .trim()
    .toLowerCase();
}
// SQL query using LOWER() for case-insensitive comparison:
// SELECT * FROM emails WHERE user_id = ? AND id != ?
//   AND LOWER(TRIM(
//     REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(subject,'Re:',''),'RE:',''),'Fwd:',''),'FWD:',''),'Fw:','')
//   )) = LOWER(?)
//   ORDER BY received_at ASC LIMIT 5
```

### Pattern 6: router.js llm_logs insertion — require db from outside
**What:** `router.js` is a pure factory function (`createRouter()`); it doesn't currently `require('./db')`. For `llm_logs` INSERT, either (a) inject `db` as a constructor dependency, or (b) require it at the top of `router.js`.
**Decision guidance:** Option (b) is simpler and consistent with how `router.js` already imports `usage` internally. Option (a) is cleaner for testing. Given test patterns use module-level require mocking (not DI), option (b) is the path of least resistance.

### Anti-Patterns to Avoid
- **Fetching thread headers from mailparser at classification time:** Emails arrive via `storeEmail()` in imap.js. By the time `classifyEmail()` runs, the raw IMAP message is gone. Headers must be stored at ingest time.
- **Async DB inserts for llm_logs:** The existing codebase uses `better-sqlite3`'s synchronous API everywhere. A fire-and-forget async insert would be inconsistent and untestable with the existing test patterns.
- **Token count from email body only:** D-12 requires the count from the full assembled prompt (SYSTEM_PROMPT + threadContext + email). Using just the email body underestimates by ~5x.
- **Shared module state for `db` in tests:** Each test file sets `process.env.DB_PATH` to an isolated path before requiring `./src/db`. Any new test file that touches `llm_logs` must follow this same isolation pattern.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON parsing of LLM responses | Custom regex parser | `extractJsonBlock()` in base.js | Already handles fence blocks, trailing chatter, and nested objects |
| Token counting | Tokenizer library | `chars ÷ 4` proxy | Locked by D-04; consistent with existing BODY_SNIPPET_LEN=800 truncation |
| DB migration versioning | Schema version table | Inline `try { db.exec(...) } catch {}` | Established pattern in db.js; safe on re-run |
| Rate limiting | Custom delay loop | Existing `TokenBucket` + `breakers` in router.js | Already handles RPM, RPD, circuit-breaker |

---

## Common Pitfalls

### Pitfall 1: raw_headers is NULL for all existing emails
**What goes wrong:** `fetchThreadContext()` using `JSON.parse(email.raw_headers)` returns `{}` for all 800 existing emails, so In-Reply-To / References matching returns 0 results for every email.
**Why it happens:** `storeEmail()` in `imap.js` never writes to the `raw_headers` column. The `mailparser` library does expose `inReplyTo` and `references` fields on the parsed object but they are silently discarded.
**How to avoid:** (1) Update `storeEmail()` to write In-Reply-To and References into dedicated columns or into `raw_headers` as JSON. (2) Make subject-normalized matching the primary strategy for the foreseeable future (all 800 existing emails lack headers). The planner should include a `storeEmail()` update task — without it, THREAD-01 delivers header linking that never fires on real data.
**Warning signs:** Tests pass but no thread context ever appears in logs; `token_count` in `llm_logs` never increases beyond single-email prompt size.

### Pitfall 2: The covering index on (user_id, message_id) already partially exists
**What goes wrong:** D-03 says "add covering index on (message_id, user_id)". The autoindex `sqlite_autoindex_emails_1` covers `message_id` alone (for the UNIQUE constraint). There is no composite index on `(user_id, message_id)`.
**Why it happens:** The UNIQUE constraint on `message_id` creates a single-column index; the planner may assume this satisfies D-03.
**How to avoid:** Add `CREATE INDEX IF NOT EXISTS idx_emails_msgid_user ON emails(user_id, message_id)` in `db.js`. The `IF NOT EXISTS` guard makes it safe on re-run.
**Warning signs:** Thread queries run full table scans on large inboxes; EXPLAIN QUERY PLAN shows "SCAN TABLE emails".

### Pitfall 3: `_callProviders` doesn't expose the assembled prompt for token counting
**What goes wrong:** `_callProviders` in `router.js` calls `provider.call(email, opts, providerCfg)` — it does not build the prompt itself. The prompt is built inside each provider's `call()` method. There is no `promptText` variable visible in router scope.
**Why it happens:** The prompt building was intentionally encapsulated inside each provider adapter.
**How to avoid:** Two valid approaches — (a) count tokens from `JSON.stringify(email) + JSON.stringify(opts.threadContext || '')` as an approximation in the router, or (b) have each provider return `_tokenCount` in its result alongside `_observedLimits`. Option (a) is simpler. The char-count proxy means approximation is acceptable.
**Warning signs:** `token_count` in `llm_logs` is 0 or undefined; Phase 4 cost analysis shows no data.

### Pitfall 4: Quote stripping removes entire short bodies
**What goes wrong:** `stripQuotedReplies()` applied to a 90-char email that quotes a prior message returns an empty string (every line was a `>` quote). D-08 minimum content threshold (100 chars) saves this, but only if the check correctly compares stripped.length < 100 AND original.length > stripped.length.
**Why it happens:** The condition is easy to write as `stripped.length < 100` without the `original.length > stripped.length` guard, which would incorrectly fall back on already-short emails (e.g., 80-char emails that had nothing to strip).
**Warning signs:** Test with a 90-char body that is entirely `>` quotes — stripped result should be the original, not empty.

### Pitfall 5: Subject fallback matches unrelated emails
**What goes wrong:** Normalizing "Re: Hi" to "hi" matches every email with subject "Hi", "RE: Hi", "FWD: Hi" across all threads — potentially pulling in emails from completely different conversations.
**Why it happens:** Common subjects like "Hi", "Follow up", "Question" are generic.
**How to avoid:** The subject fallback SQL query should also include a date proximity filter (e.g., within 90 days) AND limit to 5 results. For very generic subjects, thread context quality is lower — this is acceptable given the budget cap protects token spend.
**Warning signs:** Test emails with subject "Hi" returning many unrelated thread members.

### Pitfall 6: llm_logs INSERT in router.js requires db but router.js doesn't currently import db
**What goes wrong:** Adding `const { db } = require('../db')` to `router.js` — the path depends on where `router.js` sits relative to `db.js`.
**Why it happens:** `router.js` is at `src/llm/router.js`; `db.js` is at `src/db.js`. The require path is `require('../db')`.
**Warning signs:** `Cannot find module '../db'` at startup; confirm with: `require.resolve('../db')` from the `src/llm/` directory.

---

## Code Examples

Verified patterns from official sources (codebase):

### Thread context injection in buildPrompt (D-13/D-15)
```javascript
// Source: [VERIFIED: src/llm/providers/base.js lines 59-68 — extend this function]
function buildPrompt(email, opts = {}) {
  const lines = [];
  lines.push(SYSTEM_PROMPT);
  lines.push('');
  if (opts.threadContext) {
    lines.push('## Prior thread context');
    lines.push('');
    lines.push(opts.threadContext);
    lines.push('');
    lines.push('## Current email');
    lines.push('');
  }
  lines.push(`From: ${email.from_name || ''} <${email.from_address || ''}>`);
  lines.push(`Subject: ${email.subject || ''}`);
  const body = (email.body_text || email.preview || '').slice(0, BODY_SNIPPET_LEN);
  if (body) lines.push('', body);
  return lines.join('\n');
}
```

### fetchThreadContext — subject normalized SQL (D-01/D-02)
```javascript
// Source: [ASSUMED] — query shape; subject normalization pattern
function fetchThreadContext(userId, email) {
  // Phase 1: try header-based matching (only works if raw_headers populated)
  const headers = {};
  try { Object.assign(headers, JSON.parse(email.raw_headers || '{}')); } catch {}
  const inReplyTo = headers['in-reply-to'] || headers['In-Reply-To'] || '';
  const references = headers['references'] || headers['References'] || '';

  if (inReplyTo || references) {
    const refIds = [inReplyTo, ...references.split(/\s+/)]
      .map(s => s.trim()).filter(Boolean);
    if (refIds.length > 0) {
      const placeholders = refIds.map(() => '?').join(', ');
      const rows = db.prepare(`
        SELECT id, from_name, from_address, subject, body_text, received_at
        FROM emails
        WHERE user_id = ? AND message_id IN (${placeholders})
        ORDER BY received_at ASC
        LIMIT 5
      `).all(userId, ...refIds);
      if (rows.length > 0) return rows;
    }
  }

  // Phase 2: subject normalized fallback
  const normalized = (email.subject || '')
    .replace(/^(re|fwd?|fw)\s*:?\s*/gi, '')
    .trim()
    .toLowerCase();
  if (!normalized) return [];

  return db.prepare(`
    SELECT id, from_name, from_address, subject, body_text, received_at
    FROM emails
    WHERE user_id = ? AND id != ?
      AND LOWER(TRIM(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          REPLACE(REPLACE(subject,'Re:',''),'RE:',''),'re:',''),
          'Fwd:',''),'FWD:',''),'Fw:',''),'FW:','')
      )) = ?
      AND received_at >= datetime('now', '-90 days')
    ORDER BY received_at ASC
    LIMIT 5
  `).all(userId, email.id, normalized);
}
```

### buildThreadContext with budget enforcement (D-02/D-04/D-05/D-06)
```javascript
// Source: [ASSUMED] — implements locked decisions D-04 through D-06
const THREAD_BUDGET_CHARS = 6000;   // ~1500 tokens at chars÷4
const THREAD_MAX_MESSAGES = 5;
const THREAD_MSG_MAX_CHARS = 500;

function buildThreadContext(priorMessages, triggeringEmail) {
  if (!priorMessages || priorMessages.length === 0) return null;

  const msgs = priorMessages.slice(-THREAD_MAX_MESSAGES).map(msg => {
    const stripped = stripQuotedReplies(msg.body_text || '');
    const body = stripped.slice(0, THREAD_MSG_MAX_CHARS);
    return `[From: ${msg.from_name || ''} <${msg.from_address || ''}>]\n[Subject: ${msg.subject || ''}]\n${body}`;
  });

  // Enforce total prior budget: drop oldest first
  let combined = msgs.join('\n\n');
  while (combined.length > THREAD_BUDGET_CHARS && msgs.length > 1) {
    msgs.shift();
    combined = msgs.join('\n\n');
  }
  // If still over budget with one message, truncate it
  if (combined.length > THREAD_BUDGET_CHARS) {
    combined = combined.slice(0, THREAD_BUDGET_CHARS);
  }

  return combined;
}
```

### stripQuotedReplies (D-07/D-08)
```javascript
// Source: [ASSUMED] — implements exactly D-07 and D-08
function stripQuotedReplies(text) {
  if (!text) return '';
  const original = text;
  const lines = text.split('\n');
  const filtered = lines.filter(line => {
    if (line.startsWith('>')) return false;
    if (/^On .{10,80} wrote:$/i.test(line)) return false;
    if (/^-{3,} ?original message/i.test(line)) return false;
    return true;
  });
  const stripped = filtered.join('\n').trim();
  // D-08: minimum content threshold
  if (stripped.length < 100 && original.length > stripped.length) {
    return original;
  }
  return stripped;
}
```

### llm_logs schema migration in db.js (D-10)
```javascript
// Source: [VERIFIED: src/db.js lines 93, 177-178 — exact guard pattern]
try {
  db.exec(`
    CREATE TABLE llm_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      provider TEXT,
      user_id INTEGER,
      email_id INTEGER,
      token_count INTEGER,
      outcome TEXT,
      latency_ms INTEGER
    )
  `);
} catch(e) {}

// Startup pruning (D-11)
try {
  db.prepare("DELETE FROM llm_logs WHERE ts < datetime('now', '-30 days')").run();
} catch(e) {}
```

### storeEmail raw_headers backfill (imap.js fix)
```javascript
// Source: [VERIFIED: src/imap.js lines 63-94 — must extend this INSERT]
// mailparser exposes: parsed.inReplyTo (string), parsed.references (string[])
// These must be persisted to enable D-01 header-based thread linking for future emails.

// Option A: store as JSON in raw_headers column (D-01 referenced raw_headers JSON):
const rawHeaders = JSON.stringify({
  'in-reply-to': parsed.inReplyTo || '',
  'references': (parsed.references || []).join(' ')
});
// Then add raw_headers to the INSERT OR IGNORE in storeEmail()
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Single-email context for classification | Full thread context (Phase 2) | LLM accuracy improves for reply emails |
| No LLM call logging | Structured JSON to console + llm_logs table | Prerequisite for Phase 4 observability |

---

## Runtime State Inventory

> Phase 2 is not a rename/migration phase. Included only to document the raw_headers data gap.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | 800 emails with raw_headers=NULL; 134 reply/forward emails identified by subject pattern | storeEmail() must be updated to persist in-reply-to/references for future emails; existing emails rely on subject fallback |
| Live service config | No external service config changes | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | None | None |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Subject-normalized SQL using nested REPLACE() performs acceptably on 800 rows | Code Examples (fetchThreadContext) | Query may be slow at 10k+ emails; add index on subject column if perf degrades |
| A2 | mailparser sets `parsed.inReplyTo` (string) and `parsed.references` (array of strings) on the parsed object | Code Examples (storeEmail fix) | Column names differ — must verify against mailparser docs at implementation time |
| A3 | `router.js` can safely `require('../db')` for llm_logs INSERT without circular dependency issues | Architecture Patterns (Pitfall 6) | Circular require would throw at startup; verify module graph before adding |
| A4 | `_callProviders` can approximate token count by measuring the accumulated opts (email body + threadContext) before provider.call() | Pitfall 3 | Token estimate may be systematically low if SYSTEM_PROMPT is not included; use `(SYSTEM_PROMPT.length + promptBodyLength) / 4` |

---

## Open Questions

1. **Where does the db import land in router.js?**
   - What we know: `router.js` does not currently import `db.js`; it receives `getConfig` via constructor injection but not `db`.
   - What's unclear: Does adding `require('../db')` to router.js create a circular import (`db.js` → `db-migration.js` → anything that reaches back to router)?
   - Recommendation: Check dependency graph at implementation start with `node -e "require('./src/llm/router')"` — if it loads without error after adding the require, no circular issue.

2. **Should fetchThreadContext live in classifier.js or src/llm/thread.js?**
   - What we know: REQUIREMENTS.md says "helper in classifier.js"; CONTEXT.md says Claude's discretion on file placement.
   - What's unclear: `classifier.js` is already 338 lines; adding 4+ new functions will push it toward 500. Phase 3 adds more.
   - Recommendation: Create `src/llm/thread.js` that exports `{ fetchThreadContext, buildThreadContext, stripQuotedReplies }`. `classifier.js` requires and uses them. Smaller, testable module with a focused concern. Tests in `tests/llm/thread.test.js`.

3. **How to handle the storeEmail raw_headers update with existing IMAP sync tests?**
   - What we know: `storeEmail()` uses `INSERT OR IGNORE`; adding a new column write is additive and non-breaking.
   - What's unclear: Whether smoke tests or integration tests mock the emails table schema and would need updating.
   - Recommendation: Check `tests/smoke.test.js` before modifying `storeEmail()`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All JS | Yes | v24.11.1 | — |
| better-sqlite3 | DB ops | Yes | installed | — |
| node:test (built-in) | Tests | Yes | built-in (Node v24) | — |
| intellimail.db | Thread lookups | Yes | 800 emails | — |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in) |
| Config file | none — run via `node --test "tests/**/*.test.js"` |
| Quick run command | `node --test "tests/llm/thread.test.js" "tests/llm/base.test.js"` |
| Full suite command | `node --test "tests/**/*.test.js"` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| THREAD-01 | fetchThreadContext returns prior emails via header match | unit | `node --test "tests/llm/thread.test.js"` | No — Wave 0 |
| THREAD-01 | fetchThreadContext falls back to subject when headers empty | unit | `node --test "tests/llm/thread.test.js"` | No — Wave 0 |
| THREAD-02 | buildThreadContext limits to 5 prior messages, oldest-first | unit | `node --test "tests/llm/thread.test.js"` | No — Wave 0 |
| THREAD-02 | buildThreadContext enforces 500-char per-message limit | unit | `node --test "tests/llm/thread.test.js"` | No — Wave 0 |
| THREAD-03 | stripQuotedReplies removes `>` lines, attribution headers | unit | `node --test "tests/llm/thread.test.js"` | No — Wave 0 |
| THREAD-03 | stripQuotedReplies falls back to original when < 100 chars remain | unit | `node --test "tests/llm/thread.test.js"` | No — Wave 0 |
| THREAD-04 | buildPrompt with opts.threadContext injects ## sections | unit | `node --test "tests/llm/base.test.js"` | Extend existing |
| THREAD-04 | buildPrompt without opts.threadContext unchanged | unit | `node --test "tests/llm/base.test.js"` | Extend existing |
| THREAD-05 | buildThreadContext drops oldest messages to stay under 6000 chars | unit | `node --test "tests/llm/thread.test.js"` | No — Wave 0 |
| THREAD-06 | llm_logs row inserted after successful classify call | integration | `node --test "tests/llm/router.test.js"` | Extend existing |
| THREAD-06 | llm_logs row inserted after failed classify call | integration | `node --test "tests/llm/router.test.js"` | Extend existing |
| THREAD-07 | buildDraftPrompt with opts.threadContext injects ## sections | unit | `node --test "tests/llm/base.test.js"` | Extend existing |

### Sampling Rate
- **Per task commit:** `node --test "tests/llm/thread.test.js" "tests/llm/base.test.js" "tests/llm/router.test.js"`
- **Per wave merge:** `node --test "tests/**/*.test.js"` (full 103+ suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/llm/thread.test.js` — covers THREAD-01 through THREAD-05 (fetchThreadContext, buildThreadContext, stripQuotedReplies)
- [ ] `tests/llm/base.test.js` — extend with THREAD-04 and THREAD-07 opts.threadContext tests (file exists, add tests)
- [ ] `tests/llm/router.test.js` — extend with THREAD-06 llm_logs INSERT tests (file exists, add tests)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | Yes | All DB queries include `user_id = ?` predicate — thread context must be scoped per user |
| V5 Input Validation | Yes | Thread body text passed to LLM — already truncated; no additional sanitization needed |
| V6 Cryptography | No | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-user thread leakage | Information Disclosure | Every `fetchThreadContext` SQL query must include `AND user_id = ?`; never query threads without user scope |
| Prompt injection via thread body | Tampering | Thread body truncated to 500 chars per message; `## Prior thread context` / `## Current email` section headers provide structural separation — LLM sees labeled sections, not raw untrusted text |
| llm_logs unbounded growth | Denial of Service | 30-day pruning at startup (D-11); single synchronous DELETE |

---

## Project Constraints (from CLAUDE.md)

The following CLAUDE.md directives are directly relevant to Phase 2. The actual codebase (Node.js/Express/SQLite) takes precedence over the CLAUDE.md target architecture (Next.js/Supabase).

| Directive | Enforced By |
|-----------|-------------|
| No new npm dependencies | CONTEXT.md D-04; confirmed: no tokenizer library |
| CommonJS require/module.exports throughout | All code examples use require/module.exports |
| All DB ops via better-sqlite3 synchronous API | llm_logs INSERT is synchronous; no async DB paths |
| File names: kebab-case | `thread.js`, `thread.test.js` |
| Commits: `feat/fix/chore(scope): description` | For planner reference |
| No `any` type (N/A — JS project) | JS; no TypeScript in this codebase |

---

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: src/db.js]` — emails table schema, raw_headers column, inline migration guard pattern, startup pruning pattern, existing indexes
- `[VERIFIED: src/llm/providers/base.js]` — buildPrompt/buildDraftPrompt opts pattern, BODY_SNIPPET_LEN=800, lines.push() assembly
- `[VERIFIED: src/llm/router.js]` — _callProviders() log() call sites, success/error paths, module structure
- `[VERIFIED: src/classifier.js]` — classifyEmail(), generateDraft(), storeClassification(), queue pattern
- `[VERIFIED: src/imap.js]` — storeEmail() INSERT columns — confirmed raw_headers NOT written
- `[VERIFIED: live DB query]` — 800 emails, 0 with raw_headers populated, 800 with message_id
- `[VERIFIED: node --test]` — 103 tests passing before Phase 2

### Secondary (MEDIUM confidence)
- `[ASSUMED]` — mailparser `inReplyTo` / `references` field names (need verification at implementation time)
- `[ASSUMED]` — Subject REPLACE() chain SQL pattern — standard approach, unverified against SQLite quirks

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; verified against package.json and live environment
- Architecture: HIGH — all integration points read directly from source files
- Pitfalls: HIGH — raw_headers=NULL confirmed via live DB query; other pitfalls derived from code inspection
- SQL patterns: MEDIUM — query shapes verified against schema; performance on large datasets assumed

**Research date:** 2026-05-14
**Valid until:** 2026-06-14 (stable brownfield codebase; only risk is if Phase 1 plans modify base.js signatures)
