# Phase 2: Thread Context - Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 7 (5 modified + 2 new)
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/llm/thread.js` | utility/service | CRUD (read-only DB + transform) | `src/classifier.js` | role-match |
| `src/classifier.js` | service | request-response | `src/classifier.js` itself | self — extend |
| `src/llm/router.js` | service | request-response | `src/llm/router.js` itself | self — extend |
| `src/llm/providers/base.js` | utility | transform | `src/llm/providers/base.js` itself | self — extend |
| `src/db.js` | config/migration | CRUD | `src/db.js` itself | self — extend |
| `src/imap.js` | service | CRUD | `src/imap.js` itself | self — extend |
| `tests/llm/thread.test.js` | test | — | `tests/llm/base.test.js` + `tests/classifier_validation.test.js` | exact |

---

## Pattern Assignments

### `src/llm/thread.js` (utility, transform + CRUD read)

**Analog:** `src/classifier.js` (DB query pattern) + `src/llm/providers/base.js` (pure transform pattern)

**Imports pattern** — mirror `classifier.js` lines 1-2, `db.js` require only:
```javascript
const { db } = require('../db');
```
CommonJS only. No ESM. Export all three functions via `module.exports`.

**Core module.exports pattern** — mirror `src/llm/providers/base.js` lines 124-128:
```javascript
module.exports = {
  fetchThreadContext,
  buildThreadContext,
  stripQuotedReplies
};
```

**DB query pattern** — mirror `src/classifier.js` lines 141-152 (`isInClassificationScope`): `db.prepare(...).get()` / `.all()` with `userId` always in the WHERE predicate. Synchronous, no async/await on the DB calls themselves.

```javascript
// Pattern: synchronous better-sqlite3 query, user_id always scoped
function fetchThreadContext(userId, email) {
  // header-based path (future emails with raw_headers populated)
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
        ORDER BY received_at ASC LIMIT 5
      `).all(userId, ...refIds);
      if (rows.length > 0) return rows;
    }
  }

  // subject-normalized fallback (primary strategy for all existing 800 emails)
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
    ORDER BY received_at ASC LIMIT 5
  `).all(userId, email.id, normalized);
}
```

**Pure-transform pattern** — mirror `src/llm/providers/base.js` lines 59-68 (`buildPrompt` lines.push assembly). Constants declared at module top, same as `BODY_SNIPPET_LEN` at line 4:
```javascript
const THREAD_BUDGET_CHARS = 6000;   // ~1500 tokens at chars÷4
const THREAD_MAX_MESSAGES = 5;
const THREAD_MSG_MAX_CHARS = 500;

function buildThreadContext(priorMessages) {
  if (!priorMessages || priorMessages.length === 0) return null;
  const msgs = priorMessages.slice(-THREAD_MAX_MESSAGES).map(msg => {
    const stripped = stripQuotedReplies(msg.body_text || '');
    const body = stripped.slice(0, THREAD_MSG_MAX_CHARS);
    return `[From: ${msg.from_name || ''} <${msg.from_address || ''}>]\n[Subject: ${msg.subject || ''}]\n${body}`;
  });
  // D-06: drop oldest first when over budget
  while (msgs.length > 1 && msgs.join('\n\n').length > THREAD_BUDGET_CHARS) {
    msgs.shift();
  }
  let combined = msgs.join('\n\n');
  if (combined.length > THREAD_BUDGET_CHARS) combined = combined.slice(0, THREAD_BUDGET_CHARS);
  return combined;
}

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
  // D-08: minimum content threshold — fall back to original if over-stripped
  if (stripped.length < 100 && original.length > stripped.length) return original;
  return stripped;
}
```

**Error handling pattern** — no throws; return empty array or null as sentinels (same pattern as `rulesClassify` returning `null` at line 72, `fetchSinceUID` returning `[]` at line 143 of imap.js).

---

### `src/classifier.js` (service, request-response — extend)

**Analog:** `src/classifier.js` lines 156-219 (`classifyEmail`) and lines 313-326 (`generateDraft`)

**Integration points to add:**

1. Add `require` at top (lines 1-3), after existing requires:
```javascript
const { fetchThreadContext, buildThreadContext } = require('./llm/thread');
```

2. In `classifyEmail` (line 197), before the `llm.router.classify` call — mirror the pattern of the already-fetched `email` variable being reused (IN-02 pattern, line 157):
```javascript
// fetch thread context (synchronous DB call — no await needed)
const priorMessages = fetchThreadContext(userId, email);
const threadContext = buildThreadContext(priorMessages) || undefined;
// pass threadContext into opts — opts already accepts arbitrary keys (D-15 backward-compat)
const routed = await llm.router.classify(email, { mode: 'full', userId, threadContext });
```

3. In `generateDraft` (line 317), before the `llm.router.generateDraft` call:
```javascript
const priorMessages = fetchThreadContext(userId, email);
const threadContext = buildThreadContext(priorMessages) || undefined;
const routed = await llm.router.generateDraft(email, { mode: 'draft', userId, threadContext });
```

**Error handling pattern** — mirror lines 214-218: `catch (err) { console.error(...) }` wrapping the await. Thread-fetch errors must not propagate — wrap `fetchThreadContext` in try/catch that returns `[]` on failure.

---

### `src/llm/router.js` (service, request-response — extend)

**Analog:** `src/llm/router.js` lines 53-133 (`_callProviders`)

**New require at top** (after line 2, existing requires):
```javascript
const { db } = require('../db');
```
Path from `src/llm/router.js` to `src/db.js` is `'../db'`. See RESEARCH.md Pitfall 6.

**Log INSERT pattern** — add after existing `log(...)` calls at lines 109 and 113. Mirror the `try { db.prepare(...).run(...) } catch(e) {}` guard from `db.js` lines 93, 178:

Success path (after line 109):
```javascript
log({ provider: name, mode, outcome: 'success', latency_ms: Date.now() - start,
      email_id: email.id, user_id: userId, token_count: tokenCount });
try {
  db.prepare(`INSERT INTO llm_logs (ts, provider, user_id, email_id, token_count, outcome, latency_ms)
              VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)`)
    .run(name, userId, email.id, tokenCount, 'success', Date.now() - start);
} catch(e) {}
```

Error path (after line 113):
```javascript
log({ provider: name, mode, outcome, latency_ms: Date.now() - start,
      email_id: email.id, user_id: userId, token_count: tokenCount, err: err.message });
try {
  db.prepare(`INSERT INTO llm_logs (ts, provider, user_id, email_id, token_count, outcome, latency_ms)
              VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)`)
    .run(name, userId, email.id, tokenCount, outcome, Date.now() - start);
} catch(e) {}
```

**Token count estimation** — compute before `provider.call()` at line 90, using assembled opts as proxy (D-12 / RESEARCH.md Pitfall 3). The SYSTEM_PROMPT is not directly accessible in router scope; use email body + threadContext as the approximation:
```javascript
// Before provider.call() — chars÷4 proxy per D-04
const { SYSTEM_PROMPT } = require('./providers/base');
const promptApprox = (SYSTEM_PROMPT || '').length
  + JSON.stringify(email).length
  + (opts.threadContext ? opts.threadContext.length : 0);
const tokenCount = Math.ceil(promptApprox / 4);
```
Note: `SYSTEM_PROMPT` is already exported from `base.js` line 127. The `require` at the top of `router.js` line 1 already pulls from `./providers/base` — add `SYSTEM_PROMPT` to the destructure.

**Existing log call signatures** (lines 68, 76, 80, 84 — skipped-* outcomes) do NOT get `token_count` or `llm_logs` INSERT — those are pre-call outcomes with no prompt built yet. Only the success and error paths inside the try/catch (lines 109, 113) get the INSERT.

---

### `src/llm/providers/base.js` (utility, transform — extend)

**Analog:** `src/llm/providers/base.js` lines 59-68 (`buildPrompt`) and lines 70-81 (`buildDraftPrompt`)

**`buildPrompt` extension** — D-13/D-15. Current function at lines 59-68, inject after `lines.push('')` on line 61:
```javascript
function buildPrompt(email, opts = {}) {
  const lines = [];
  lines.push(SYSTEM_PROMPT);
  lines.push('');
  // NEW (Phase 2 D-13/D-15): inject thread context under labeled section
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

**`buildDraftPrompt` extension** — D-14/D-15. Current function at lines 70-81. Same injection point — after the opening system lines, before the From/Subject fields:
```javascript
function buildDraftPrompt(email, opts = {}) {
  const lines = [];
  lines.push('You are drafting a reply email on behalf of the recipient.');
  lines.push('Write a direct, complete reply. 2-4 sentences. No subject line. No placeholder text.');
  lines.push('');
  // NEW (Phase 2 D-14/D-15): inject thread context under labeled section
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
  if (opts.tone) lines.push('', `Write in a ${opts.tone} tone.`);
  return lines.join('\n');
}
```

**Backward-compatibility guarantee:** When `opts.threadContext` is absent or falsy (single email, no thread), the prompt is byte-for-byte identical to current output. No existing tests break.

---

### `src/db.js` (config/migration — extend)

**Analog:** `src/db.js` lines 92-93 (ALTER TABLE migration guard) and lines 177-178 (startup pruning)

**`llm_logs` table creation** — add after line 178 (after `provider_usage` pruning), before the multi-user auth block at line 180. Follow the exact `try { db.exec(...) } catch(e) {}` guard pattern:
```javascript
// Phase 2: llm_logs table (D-10)
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

// Phase 2: 30-day retention pruning on boot (D-11)
try {
  db.prepare("DELETE FROM llm_logs WHERE ts < datetime('now', '-30 days')").run();
} catch(e) {}
```

**Covering index for thread queries** — add to the `db.exec(` block at lines 229-236 (the `CREATE INDEX IF NOT EXISTS` block). D-03: composite index on `(user_id, message_id)` to support header-based thread lookups:
```javascript
CREATE INDEX IF NOT EXISTS idx_emails_msgid_user ON emails(user_id, message_id);
```
The `IF NOT EXISTS` guard makes it safe on repeated startup. The existing `sqlite_autoindex_emails_1` covers `message_id` alone (UNIQUE constraint) — this new index covers the composite predicate `WHERE user_id = ? AND message_id IN (...)`.

---

### `src/imap.js` (service, CRUD — extend)

**Analog:** `src/imap.js` lines 62-95 (`storeEmail`)

**`storeEmail` INSERT extension** — add `raw_headers` population. The `mailparser` library exposes `parsed.inReplyTo` (string) and `parsed.references` (array of strings, verify field names at implementation time per RESEARCH.md assumption A2).

Current INSERT at lines 65-82 omits `raw_headers`. Extend the INSERT OR IGNORE to include it:
```javascript
// Pattern: extend the existing INSERT OR IGNORE column list and VALUES list
// Current INSERT columns (lines 67-69): user_id, message_id, uid, folder, from_address,
//   from_name, to_address, cc_address, subject, body_text, body_html, received_at, is_read
// ADD: raw_headers as 14th column

const rawHeadersJson = JSON.stringify({
  'in-reply-to': parsed.inReplyTo || '',
  'references': Array.isArray(parsed.references)
    ? parsed.references.join(' ')
    : (parsed.references || '')
});

// Then add raw_headers to INSERT columns and ?, to VALUES
// The result.changes === 0 branch (lines 83-89) is unchanged — no raw_headers update needed
// on duplicate message_id (idempotent by design).
```

**Error handling pattern** — mirror lines 91-94: `catch (e) { console.error('Email store error:', e.message); return null; }`. The `raw_headers` serialization must NOT throw — wrap `JSON.stringify` in try/catch or use a default of `'{}'` on failure.

---

### `tests/llm/thread.test.js` (test — NEW file)

**Analog:** `tests/llm/base.test.js` (pure-function unit test pattern) + `tests/classifier_validation.test.js` (DB isolation pattern)

**File header / DB isolation pattern** — mirror `tests/classifier_validation.test.js` lines 1-11. For `thread.test.js`, the DB path must be unique to this file:
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Isolated DB — set BEFORE requiring src/db or src/llm/thread
const dbPath = path.join(__dirname, '..', '..', 'intellimail-thread-test.db');
process.env.DB_PATH = dbPath;

test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
```

**DB seeding pattern** — mirror `classifier_validation.test.js` lines 14-25 (`test.before` async block that requires modules and seeds a user):
```javascript
let db, fetchThreadContext, buildThreadContext, stripQuotedReplies;

test.before(async () => {
  ({ db } = require('../../src/db'));
  ({ fetchThreadContext, buildThreadContext, stripQuotedReplies } = require('../../src/llm/thread'));

  // seed user
  db.prepare('INSERT INTO users (email) VALUES (?)').run('thread@test.com');
  global.__threadUserId = db.prepare('SELECT id FROM users WHERE email = ?').get('thread@test.com').id;
});
```

**Pure-function unit test pattern** — mirror `tests/llm/base.test.js` lines 13-26 (no DB, just assert on return value):
```javascript
// stripQuotedReplies tests — no DB needed
test('stripQuotedReplies removes > lines', () => {
  const input = 'Hello\n> quoted line\nWorld';
  assert.equal(stripQuotedReplies(input), 'Hello\nWorld');
});

test('stripQuotedReplies removes On...wrote: attribution header', () => {
  const line = 'On Mon, Jan 1, 2024, Alice wrote:';
  const input = `Reply text\n${line}\n> original`;
  const result = stripQuotedReplies(input);
  assert.ok(!result.includes(line));
});

test('stripQuotedReplies falls back to original when stripped < 100 chars', () => {
  const quoted = Array(10).fill('> ' + 'x'.repeat(20)).join('\n');
  const original = quoted;
  assert.equal(stripQuotedReplies(original), original);
});
```

**DB integration test pattern** — mirror `classifier_validation.test.js` lines 28-63 (seed email rows, call function, assert on result):
```javascript
// fetchThreadContext tests — need DB
test('fetchThreadContext returns prior emails via subject fallback', () => {
  const userId = global.__threadUserId;
  // seed two emails with same normalized subject
  db.prepare(`INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-prior-1', 'INBOX', 'Hello', 'prior body', datetime('now', '-1 day'))`).run(userId);
  db.prepare(`INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-current', 'INBOX', 'Re: Hello', 'current body', datetime('now'))`).run(userId);
  const current = db.prepare("SELECT * FROM emails WHERE message_id = 'mid-current'").get();
  const result = fetchThreadContext(userId, current);
  assert.ok(Array.isArray(result));
  assert.ok(result.some(r => r.subject === 'Hello'));
});
```

**buildThreadContext budget tests** — pure-function, no DB:
```javascript
test('buildThreadContext limits to 5 prior messages oldest-first', () => {
  const msgs = Array.from({ length: 7 }, (_, i) => ({
    from_name: 'A', from_address: 'a@b.com',
    subject: 'S', body_text: 'x'.repeat(10)
  }));
  const ctx = buildThreadContext(msgs);
  // Should contain at most 5 message blocks
  const blockCount = (ctx.match(/\[From:/g) || []).length;
  assert.ok(blockCount <= 5);
});

test('buildThreadContext enforces 6000 char budget', () => {
  const msgs = Array.from({ length: 5 }, () => ({
    from_name: 'A', from_address: 'a@b.com',
    subject: 'S', body_text: 'x'.repeat(600)
  }));
  const ctx = buildThreadContext(msgs);
  assert.ok(ctx.length <= 6000);
});

test('buildThreadContext returns null for empty prior messages', () => {
  assert.equal(buildThreadContext([]), null);
  assert.equal(buildThreadContext(null), null);
});
```

---

## Shared Patterns

### CommonJS module pattern
**Source:** All files in `src/` — `require`/`module.exports` throughout.
**Apply to:** `src/llm/thread.js` (new file must use CommonJS, not ESM).
```javascript
// Correct
const { db } = require('../db');
module.exports = { fetchThreadContext, buildThreadContext, stripQuotedReplies };

// Wrong — do not use
import { db } from '../db';
export function fetchThreadContext() {}
```

### Synchronous DB API pattern
**Source:** `src/db.js` line 178, `src/classifier.js` lines 141-152, `src/imap.js` lines 65-82.
**Apply to:** `src/llm/thread.js` (fetchThreadContext), `src/llm/router.js` (llm_logs INSERT).
```javascript
// Correct — better-sqlite3 synchronous API
const rows = db.prepare('SELECT ... WHERE user_id = ?').all(userId);
db.prepare('INSERT INTO llm_logs (...) VALUES (...)').run(...values);

// Wrong — never use async for DB ops in this codebase
const rows = await db.prepare(...).all(userId);
```

### Inline migration guard
**Source:** `src/db.js` line 93 (ALTER TABLE guard) and line 178 (pruning).
**Apply to:** `src/db.js` — `llm_logs` CREATE TABLE and index additions.
```javascript
try { db.exec('...DDL...'); } catch(e) {}
try { db.prepare('DELETE FROM ...').run(); } catch(e) {}
```

### user_id predicate on all DB queries
**Source:** `src/classifier.js` lines 141-152 (`isInClassificationScope`), `src/db.js` lines 288-308 (`getStats`).
**Apply to:** `src/llm/thread.js` — every SELECT in `fetchThreadContext` must include `AND user_id = ?`.
Security requirement from RESEARCH.md V4 Access Control: cross-user thread leakage is a known threat.

### Error boundary / silent-fallback pattern
**Source:** `src/classifier.js` lines 214-218, `src/imap.js` lines 91-94.
**Apply to:** `src/llm/thread.js` (return `[]` on DB error, never throw), `src/llm/router.js` (wrap llm_logs INSERT in `try {} catch(e) {}`), `src/imap.js` (wrap JSON.stringify for raw_headers).
```javascript
// Pattern: non-critical operations silently swallowed
try { db.prepare('INSERT INTO llm_logs ...').run(...); } catch(e) {}
```

### opts parameter bag extension
**Source:** `src/llm/providers/base.js` lines 59, 70 (`opts = {}`), `src/llm/router.js` lines 135, 146.
**Apply to:** `buildPrompt` and `buildDraftPrompt` in `base.js` — add `opts.threadContext` without breaking existing callers who pass `{ mode: 'full' }` or `{ tone: 'friendly' }`.

### Test DB isolation pattern
**Source:** `tests/classifier_validation.test.js` lines 6-11.
**Apply to:** `tests/llm/thread.test.js` — unique `DB_PATH` set before any `require` of `src/db` or `src/llm/thread`. The `process.env.DB_PATH` assignment MUST come before the module requires.

### Router mock pattern
**Source:** `tests/classifier_validation.test.js` lines 43-58 (replace `llm.router.classify`, restore in finally).
**Apply to:** `tests/llm/thread.test.js` — if any thread test needs to invoke classify with a mocked router, use the same replace-then-restore-in-finally approach (upgraded to async/await per IN-04 fix at line 65).

---

## No Analog Found

All 7 files have analogs in the codebase. No RESEARCH.md fallback needed.

| File | Reason |
|------|---------|
| (none) | All files are modifications to or peers of existing files in the same directory tree |

---

## Metadata

**Analog search scope:** `src/`, `src/llm/`, `src/llm/providers/`, `tests/`, `tests/llm/`
**Files read:** 7 source files + 3 test files
**Pattern extraction date:** 2026-05-14
