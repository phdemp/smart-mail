# Architecture Research — Email AI Improvements

**Project:** IntelliMail AI Quality Milestone
**Researched:** 2026-05-14
**Scope:** Thread context, user correction storage, provider observability

---

## Thread Context Integration

### Current state

`classifyEmail()` in `classifier.js` fetches a single email row and passes it
directly to `llm.router.classify(email, opts)`. The LLM sees only the triggering
email — no previous messages in the thread.

Thread identity is available via `emails.message_id` and headers (`In-Reply-To`,
`References`), but is not yet used by the classifier.

### Recommended approach: thread fetch helper in classifier.js

Add a `fetchThreadContext(userId, email)` function that:

1. Parses the `References` and `In-Reply-To` headers from `email.raw_headers`
   (already stored in the `emails` table as a JSON string or raw text).
2. Issues a single SQLite query: `SELECT subject, from_name, from_address,
   body_text, received_at FROM emails WHERE user_id = ? AND message_id IN (?, ?, ...)`
   to pull the prior messages in the thread, ordered by `received_at ASC`.
3. Returns a trimmed, structured context string.

### Context window budget

LLM providers operate on a shared 4k–8k token budget for the full
classify-plus-draft prompt. Thread context must be bounded:

| Slot | Budget |
|---|---|
| Thread context (prior messages) | 1 500 tokens (~6 000 chars) |
| Triggering email (current) | 1 000 tokens |
| System prompt + output schema | ~500 tokens |
| Draft reply generation | ~500 tokens |

Implementation: truncate each prior message to 500 chars of `body_text`; include
at most 5 prior messages. Prepend each with a header line:
`From: {name} | Date: {date}\n{body_excerpt}`. Total assembly is done in a new
`buildThreadContext(priorMessages, currentEmail)` helper — not inside the
provider adapters. This keeps the providers unchanged.

### Data flow

```
classifyEmail(userId, emailId)
  -> fetch email row (existing)
  -> fetchThreadContext(userId, email)   [NEW — pure SQLite read]
      -> parse References header
      -> SELECT prior messages, ORDER BY received_at ASC, LIMIT 5
      -> buildThreadContext() -> string
  -> llm.router.classify({ ...email, threadContext }, opts)
      -> provider.call() receives threadContext in opts or as merged field
```

The `email` object passed to `classify()` gains a `threadContext` field. Provider
adapters that support it use it; those that do not ignore it. No provider
interface change is required — the field is opt-in at the adapter level.

### What stays the same

- Provider adapters (`nvidia.js`, `groq.js`, `gemini.js`, `deepseek.js`)
  receive the same call signature; only the email object is richer.
- `llm.router.classify()` signature is unchanged.
- Rules tier (Tier 1) is unchanged — thread context is only used in Tier 2.
- Scope gate logic is unchanged.

---

## User Correction Storage

### Recommended approach: corrections column on classifications

Avoid a new table. The existing `classifications` table already has one row per
email per user. Add two columns via `ALTER TABLE` migration guards (same pattern
as every existing migration in `db.js`):

```sql
ALTER TABLE classifications ADD COLUMN user_corrected_category TEXT;
ALTER TABLE classifications ADD COLUMN corrected_at DATETIME;
```

`user_corrected_category` is NULL until the user acts. On correction, write the
new category and timestamp. The original `category` (LLM/rules output) is
preserved for audit and accuracy measurement.

### API endpoint

`POST /api/emails/:id/correct` with body `{ category: "financial" }`.

- Auth via existing `requireAuth` middleware.
- Validates category against the `CATEGORIES` constant from `providers/base.js`.
- Updates `user_corrected_category` and `corrected_at` on the classifications row.
- Returns 200 with the updated classification object.
- Broadcasts `classification_done` SSE event so the UI re-renders without reload.

### How corrections feed back into future classifications

Phase 1 (this milestone): corrections are stored and displayed only. The value is
the audit trail and visible acknowledgement to the user.

Phase 2 (future milestone): corrections can be used as few-shot examples in the
prompt. A query like `SELECT from_address, subject, user_corrected_category FROM
classifications WHERE user_id = ? AND user_corrected_category IS NOT NULL ORDER
BY corrected_at DESC LIMIT 10` provides a per-user correction history that can be
injected into the system prompt as "past corrections" context. This does not
require any schema change — the data is already there.

### UI trigger point

The category badge in the email thread view gets a small edit affordance. On
click, a dropdown of the 8 valid categories appears (rendered as an HTMX partial
from the server). Submit fires the POST; the response swaps the badge. This
matches the existing HTMX + Alpine.js pattern and requires no JS framework
changes.

### What stays the same

- `classifications` table structure (only two columns added)
- `storeClassification()` function — no change
- LLM pipeline — corrections do not block or modify classification at this stage

---

## Provider Observability

### Current state — the data already exists

`router.js` maintains in-memory breaker state per `userId::providerName` key.
`getProviderHealth(userId)` already returns a fully structured object:

```js
{
  nvidia: {
    status: 'ok' | 'breaker_open' | 'rate_limited' | 'service_busy' |
            'invalid_key' | 'timeout' | 'network' | 'http_5xx' | 'unknown',
    last_error: string | null,
    last_error_at: ISO8601 | null,
    last_error_msg: string | null,
    last_success_at: ISO8601 | null
  },
  groq: { ... },
  gemini: { ... },
  deepseek: { ... }
}
```

`getObservedLimits(userId)` returns provider-reported rate limit headers captured
from Groq and DeepSeek responses.

### The only gap: no API endpoint exposes this data

The router instance lives in `src/llm/index.js`. The API routes in
`src/routes/api.js` do not call `getProviderHealth()`.

### Recommended approach: single new endpoint

Add `GET /api/llm/health` to `src/routes/api.js`:

```js
router.get('/llm/health', requireAuth, (req, res) => {
  const health = llm.router.getProviderHealth(req.user.id);
  const limits = llm.router.getObservedLimits(req.user.id);
  res.json({ health, observed_limits: limits });
});
```

This is a two-line addition. No new files. No new dependencies.

### UI surface

Two integration points, both using existing patterns:

1. **Settings page** (`views/settings.html`): An HTMX-polled `<div>` that fetches
   `/api/llm/health` every 30 seconds. Each provider row shows a colored status
   dot, the current status string, and the last-error message truncated to 60
   chars. Alpine.js handles the dot color mapping from status string to CSS class.

2. **Dashboard status pill** (optional, low effort): The existing
   `GET /api/llm/status` endpoint already shows pending/classified counts. A
   simple addition: if any provider has `status !== 'ok'` and
   `status !== 'unknown'`, include a `degraded: true` flag. The dashboard pill
   can show an amber indicator without needing full health detail.

### What stays the same

- `router.js` is unchanged — `getProviderHealth()` already exists.
- Circuit breaker logic is unchanged.
- Breaker state remains in-memory (no persistence needed — state resets on
  restart which is the correct behavior for a transient health signal).

---

## Component Boundaries

### What changes

| Component | Change |
|---|---|
| `src/classifier.js` | Add `fetchThreadContext()` + `buildThreadContext()`; thread object passed to router |
| `src/db.js` | Two `ALTER TABLE` guards for correction columns; no new tables |
| `src/routes/api.js` | Add `GET /api/llm/health`; add `POST /api/emails/:id/correct` |
| `views/settings.html` | Add provider health table (HTMX poll, Alpine.js color) |
| `views/dashboard.html` | Optional: degraded indicator on status pill |

### What stays the same

| Component | Reason |
|---|---|
| `src/llm/router.js` | `getProviderHealth()` already implemented; no changes needed |
| `src/llm/providers/*.js` | Provider adapters unchanged; thread context is an optional field on the email object |
| `src/imap.js` | IMAP sync pipeline unchanged |
| `src/smtp.js` | SMTP send pipeline unchanged |
| `src/auth.js`, `src/middleware/auth.js` | Auth unchanged |
| Rules tier (Tier 1 in classifier) | Thread context not used; no change |
| Scope gate logic | Unchanged |
| SSE push mechanism | Reused for correction broadcast; no change to SSE infrastructure |

---

## Schema Changes

Minimal. Two columns only. Both use the existing `ALTER TABLE` + `try/catch`
migration guard pattern already established throughout `db.js`.

```js
// In src/db.js, appended after existing migrations
try { db.exec(`ALTER TABLE classifications ADD COLUMN user_corrected_category TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE classifications ADD COLUMN corrected_at DATETIME`); } catch(e) {}
```

No new tables. No index changes. No foreign key changes. Safe to deploy against
the live database without downtime — `ALTER TABLE ADD COLUMN` with a NULL default
is atomic in SQLite WAL mode.

An optional index on `(user_id, user_corrected_category)` can be added later when
correction-based few-shot prompting is implemented (Phase 2). Not needed now.

---

## Build Order

Dependencies run left-to-right:

```
1. Schema migration (db.js)
   -> unblocks correction storage + all API reads

2. Thread context (classifier.js)
   -> depends only on existing emails table (no schema change needed)
   -> can be built in parallel with schema migration

3. Provider observability endpoint (api.js)
   -> depends on nothing new; router already has the data
   -> fastest item; build first or in parallel

4. Correction API endpoint (api.js)
   -> depends on schema migration (Step 1)

5. UI: provider health panel (settings.html)
   -> depends on Step 3 endpoint

6. UI: correction affordance (dashboard.html / thread view)
   -> depends on Step 4 endpoint
```

### Recommended phase order

**Phase 1 — Observability (lowest risk, highest value signal)**
Provider health endpoint + settings UI panel. Zero schema changes. Zero
classifier changes. Exposes data that is already being computed.

**Phase 2 — Thread context (medium risk, highest accuracy impact)**
Thread fetch helper + context assembly in `classifier.js`. Requires prompt
template updates to instruct the LLM on how to use thread context. Test against
real threads before enabling for all users.

**Phase 3 — Correction storage (low risk)**
Schema migration + correction API + UI affordance. Self-contained. The correction
data accumulates passively and enables Phase 4 without blocking it.

**Phase 4 — Correction-informed prompting (future milestone)**
Use stored corrections as few-shot examples in the classification prompt. Builds
on correction data from Phase 3.

Rationale: Phase 1 gives immediate operational visibility with zero risk. Phase 2
is the highest-impact accuracy improvement but requires prompt iteration, so it
should be isolated. Phase 3 has no dependencies and can be shipped independently.
Phase 4 requires Phase 3 to have run long enough to accumulate a correction
corpus.
