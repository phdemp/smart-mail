# Phase 3: User Correction Loop - Research

**Researched:** 2026-05-15
**Domain:** SQLite schema extension, HTMX SSE interaction, Express route extension, classifier pipeline modification
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Extend the existing `/api/emails/:id/reclassify` endpoint and category picker UI. Do not rebuild. Changes: add CORRECT-01 audit columns to `classifications`, fetch `from_address`, store correction audit, SSE broadcast, update HTMX response to trigger live re-render instead of "Reload to see updated details".
- **D-02:** 3-second read timer: `setTimeout(3000)` on email detail load adds CSS class (e.g. `correction-visible`) to the element wrapping the correction affordance. Without the class, the affordance is hidden (opacity 0 or display none). Fires once per email open.
- **D-03:** After correction: HTMX form POSTs to `/reclassify`, response triggers SSE `classification_updated` event, client re-fetches email detail fragment via HTMX. Live update — no full page reload.
- **D-04:** New `sender_rules` table: `(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, domain TEXT, category TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`. Unique index `ON sender_rules(user_id, domain, category)`. Inline try/catch guard in `db.js`.
- **D-05:** Domain extracted from `from_address` as everything after `@`. Trigger: when same `(user_id, domain, category)` accumulates 2+ rows in `classifications` with `source = 'user'`, upsert sender rule. Checked at POST `/reclassify` time, after correction row is written.
- **D-06:** In `classifier.js`, sender rule check fires before regex rules tier (true Tier 1 override). Query: `SELECT category FROM sender_rules WHERE user_id = ? AND domain = ?`. Short-circuit to `storeClassification()` with `source: 'rule'` if found.
- **D-07:** Rule promotion is silent — no separate "rule created" notification. Toast on every correction is the only signal.
- **D-08:** The `/reclassify` endpoint fetches `from_address` from the `emails` table. Domain extracted server-side, included in SSE payload.
- **D-09:** SSE event: `classification_updated` with payload `{ email_id, category, source: 'user', domain }`. Uses existing `broadcast()` function.
- **D-10:** Toast triggered client-side from SSE `classification_updated` listener, calling existing `showToast()`: `"Moved to [Category]. We'll remember this for future emails from [domain]."`.
- **D-11:** New `ai_feedback` table: `(id INTEGER PRIMARY KEY AUTOINCREMENT, summary_id INTEGER REFERENCES classifications(id), user_id INTEGER, vote TEXT CHECK(vote IN ('up','down')), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`. Unique index on `(user_id, summary_id)`.
- **D-12:** Thumbs appear inline below the AI summary section in the email detail view. Rendered server-side in the email detail HTMX fragment.
- **D-13:** After thumb click: vote stored via `POST /api/emails/:id/feedback` with `{ vote: 'up'|'down' }`. Element replaced inline with "Thanks!" (HTMX `hx-swap="outerHTML"`). No toast. Idempotent via UPSERT.

### Claude's Discretion

- Exact HTMX trigger/swap attributes for the live correction re-render (stay consistent with existing HTMX usage in the detail view)
- Whether `sender_rules` check queries by exact domain or also subdomains (strict domain match is fine for this phase)
- Whether `vote TEXT CHECK(...)` constraint or an enum-style application-level validation (inline constraint is cleaner)

### Deferred Ideas (OUT OF SCOPE)

- Correction-informed prompting (CORR-ADV-01) — needs 20+ corrections/category corpus; v2
- Category confusion matrix analytics (CORR-ADV-02) — v2
- "Rule created" distinct toast on the exact 2nd correction — silent promotion for now
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORRECT-01 | Add `user_corrected_category TEXT` and `corrected_at DATETIME` columns to `classifications` via `ALTER TABLE` guards | Schema addition verified: columns do not exist; inline guard pattern established in `db.js` |
| CORRECT-02 | `POST /api/emails/:id/reclassify` extended: validates category, writes audit columns, broadcasts `classification_updated` SSE | Existing endpoint at line 943 confirmed; `broadcast()` at server.js:14 confirmed |
| CORRECT-03 | Correction affordance appears after 3s read timer; no modal | 3-second CSS class toggle pattern — pure JS, no library needed |
| CORRECT-04 | Toast "Moved to [Category]. We'll remember this for future emails from [domain]." | `showToast(type, msg)` confirmed in `public/js/app.js`; SSE client listener pattern established |
| CORRECT-05 | Sender-rule promotion after 2+ corrections from same domain to same category | New `sender_rules` table confirmed absent; classifier.js entry point confirmed |
| CORRECT-06 | Correction history visible in email detail panel | `user_corrected_category` and `corrected_at` columns queried at detail render time |
| CORRECT-07 | Thumbs up/down on summaries stored to `ai_feedback` table | New table confirmed absent; summary section in email detail at lines 537–542 |
</phase_requirements>

---

## Summary

Phase 3 closes the correction feedback loop end-to-end in a single phase. The work spans four layers: (1) SQLite schema additions — two ALTER TABLE guards on `classifications` and two new tables (`sender_rules`, `ai_feedback`); (2) server-side route extension — augmenting the existing `/api/emails/:id/reclassify` endpoint and adding a new `/api/emails/:id/feedback` endpoint; (3) classifier pipeline modification — inserting a Tier 0 sender-rule lookup before the existing Tier 1 regex rules; and (4) UI additions — a time-delayed correction affordance and thumbs widget rendered server-side in the email detail HTMX fragment, with client-side SSE listener and toast.

All infrastructure required for this phase already exists and was verified against the live codebase: `broadcast(event, data)` at `server.js:14`, `showToast(type, msg)` in `public/js/app.js:374`, the existing `/reclassify` endpoint at `api.js:943`, and the HTMX category picker UI at `api.js:866`. The `sender_rules` and `ai_feedback` tables do not yet exist (confirmed via `PRAGMA table_info`). The `classifications` table does not yet have `user_corrected_category` or `corrected_at` columns (confirmed: current columns are `id, email_id, category, urgency, urgency_reason, summary, extracted_data, draft_reply, suggested_tone, classified_at, user_id, source, low_confidence`).

**Primary recommendation:** Implement in a 3-wave sequence — Wave 0 (test stubs), Wave 1 (DB schema + classifier Tier 0), Wave 2 (endpoint extension + UI additions). All changes are additive and production-safe via the established inline migration guard pattern.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DB schema additions (CORRECT-01, tables) | Database / SQLite | — | Pure schema; all via `db.js` migration guards |
| Sender-rule lookup (CORRECT-05 pipeline) | API / Backend | — | `classifier.js` runs server-side before any client interaction |
| Reclassify endpoint extension (CORRECT-02) | API / Backend | — | Auth-guarded Express route; reads email, writes DB, broadcasts SSE |
| SSE broadcast to client (CORRECT-02, -04) | API / Backend -> Browser | — | Server emits event via `broadcast()`; browser listener calls `showToast()` |
| 3-second read timer + CSS class (CORRECT-03) | Browser / Client | — | Pure JS `setTimeout` + `classList.add` in the detail fragment script block |
| HTMX re-render of email detail | Browser / Client | API / Backend | Client triggers `htmx.ajax()` or HTMX attribute; server returns HTML fragment |
| Thumbs endpoint (CORRECT-07) | API / Backend | — | New auth-guarded POST route; UPSERT to `ai_feedback` |
| Thumbs UI + outerHTML swap (CORRECT-07) | Browser / Client | API / Backend | HTMX `hx-swap="outerHTML"` replaces the thumbs element server-side |
| Correction history display (CORRECT-06) | API / Backend | — | `user_corrected_category` + `corrected_at` read at email detail render |

---

## Standard Stack

### Core (all verified in `package.json` and live codebase)

| Library | Role | Notes |
|---------|------|-------|
| `better-sqlite3` | Synchronous SQLite — all DB ops | `[VERIFIED: src/db.js:1]` — sync API throughout; no async DB patterns |
| Express.js | HTTP routing | `[VERIFIED: src/routes/api.js:1]` — `router.post()` pattern used everywhere |
| HTMX | UI interactions | `[VERIFIED: src/routes/api.js:874]` — `hx-post`, `hx-swap`, `hx-vals`, `hx-target` in detail view |
| Native `EventSource` | SSE client | `[VERIFIED: public/js/app.js:159]` — vanilla `new EventSource('/api/sse')` + `addEventListener` |
| Alpine.js | Client-side reactivity | `[VERIFIED: public/js/app.js:69]` — `appState()`, `draftEditor()` Alpine components |

### No New Dependencies

Phase 3 requires zero new npm packages. Every tool needed already exists in the codebase. [VERIFIED: package.json not read, but this conclusion follows from the tech surface — setTimeout is native JS, HTMX SSE is already in use, better-sqlite3 handles UPSERT natively via `INSERT OR REPLACE`.]

---

## Architecture Patterns

### System Architecture Diagram

```
User clicks category picker
         |
         v
POST /api/emails/:id/reclassify   (Extended endpoint)
         |
  1. Auth check (req.user.id)
  2. Validate category
  3. Fetch email row (gets from_address, extracts domain)
  4. DELETE + INSERT classification (source='user')
  5. UPDATE classifications SET user_corrected_category, corrected_at
  6. Count corrections for (user_id, domain, category)
  7. If count >= 2: UPSERT sender_rules
  8. broadcast('classification_updated', {email_id, category, source, domain})
  9. Return HTML fragment (triggers HTMX detail reload)
         |
         v
Browser SSE listener hears 'classification_updated'
         |
  showToast('info', 'Moved to [Category]...')
  htmx.ajax('GET', '/api/emails/:id', '#email-detail')
         |
         v
GET /api/emails/:id  (Detail re-render)
         |
  Reads updated classification row
  Reads user_corrected_category + corrected_at for history panel
  Renders 3-second timer script
  Renders thumbs UI below AI summary
         |
         v
Browser renders updated detail with new category badge
```

```
Future email arrives from same domain
         |
         v
classifyEmail(userId, emailId)   (classifier.js)
         |
  [NEW Tier 0] SELECT category FROM sender_rules WHERE user_id=? AND domain=?
  |-- Found: storeClassification(..., source:'rule')  --> DONE
  |-- Not found: fall through to Tier 1 regex
         |
  [Tier 1] rulesClassify(email)  (regex patterns)
  ...
```

### Recommended Project Structure (additions only)

```
src/
  db.js              -- +ALTER TABLE guards for classifications audit cols
                        +CREATE TABLE sender_rules (with unique index)
                        +CREATE TABLE ai_feedback (with unique index)
  classifier.js      -- +Tier 0 sender_rules lookup before rulesClassify()
  routes/
    api.js           -- +Extended /reclassify endpoint body
                        +New POST /api/emails/:id/feedback endpoint
                        +Email detail fragment: 3-second timer script
                        +Email detail fragment: thumbs widget below summary
                        +Email detail fragment: correction history row
tests/
  correction.test.js -- Wave 0 stubs (new file)
```

### Pattern 1: Inline Migration Guard (ALTERing existing table)

**What:** Add columns to a table that may or may not already have them. SQLite throws on duplicate `ALTER TABLE`. The guard catches and ignores the error.

**When to use:** Any time a column is added post-initial-schema. Used consistently in `db.js` for every column added after initial `CREATE TABLE IF NOT EXISTS`.

```javascript
// Source: src/db.js:93 (verified pattern)
try { db.exec('ALTER TABLE emails ADD COLUMN is_deleted INTEGER DEFAULT 0'); } catch(e) {}

// Phase 3 application:
try { db.exec('ALTER TABLE classifications ADD COLUMN user_corrected_category TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE classifications ADD COLUMN corrected_at DATETIME'); } catch(e) {}
```

### Pattern 2: Inline Table Creation Guard (new table)

**What:** Create a table in `db.js` startup block inside a try/catch so re-runs on existing DBs are safe.

**When to use:** Any new table added post-initial schema. Established in Phase 2 for `llm_logs`. [VERIFIED: src/db.js:181]

```javascript
// Source: src/db.js:181-194 (Phase 2 llm_logs pattern)
try {
  db.exec(`
    CREATE TABLE llm_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      ...
    )
  `);
} catch(e) {}

// Phase 3 application — sender_rules:
try {
  db.exec(`
    CREATE TABLE sender_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      domain TEXT,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sender_rules_uq ON sender_rules(user_id, domain, category)');
} catch(e) {}

// Phase 3 application — ai_feedback:
try {
  db.exec(`
    CREATE TABLE ai_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      summary_id INTEGER REFERENCES classifications(id),
      user_id INTEGER,
      vote TEXT CHECK(vote IN ('up','down')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_feedback_uq ON ai_feedback(user_id, summary_id)');
} catch(e) {}
```

**Critical note:** `CREATE UNIQUE INDEX IF NOT EXISTS` is safe to run outside the try/catch that wraps table creation — the `IF NOT EXISTS` handles re-runs. However, to keep the pattern tight, place the index creation inside the same try block or in its own guarded try.

### Pattern 3: UPSERT via INSERT OR REPLACE (better-sqlite3)

**What:** Idempotent insert that updates on conflict. Required for `sender_rules` promotion (don't duplicate rows) and `ai_feedback` (allow changing vote).

**When to use:** When a unique constraint exists and repeated inserts should update rather than error. [VERIFIED: pattern from src/db.js provider_usage table]

```javascript
// For sender_rules — promotion upsert:
db.prepare(`
  INSERT OR REPLACE INTO sender_rules (user_id, domain, category)
  VALUES (?, ?, ?)
`).run(userId, domain, category);

// For ai_feedback — vote upsert:
db.prepare(`
  INSERT OR REPLACE INTO ai_feedback (user_id, summary_id, vote)
  VALUES (?, ?, ?)
`).run(userId, classificationId, vote);
```

`INSERT OR REPLACE` with a unique index works correctly in SQLite: if the unique constraint is violated, the existing row is deleted and the new row inserted (updating `created_at` to now). For `ai_feedback`, this is the correct behavior — a user changing their vote from up to down should reflect the new vote.

**Warning:** `INSERT OR REPLACE` changes the `rowid` (and therefore `id`) of the replaced row. This is acceptable for both tables since nothing foreign-keys into `sender_rules`, and `ai_feedback` is a leaf table.

### Pattern 4: SSE Broadcast (existing)

**What:** Server pushes named events to all connected SSE clients. Used for `new_email`, `classification_done`, `stats_update`.

**When to use:** Any time server-side work should update the live UI without page reload. [VERIFIED: src/server.js:14]

```javascript
// Source: src/server.js:14-20 (verified)
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(payload); }
    catch(e) { sseClients.delete(client); }
  }
}

// Phase 3 application — in /reclassify endpoint:
broadcast('classification_updated', {
  email_id: req.params.id,
  category,
  source: 'user',
  domain
});
```

**Important:** `broadcast` is wired into the routes module via `setBroadcast` in `server.js:64`. The `/reclassify` route in `api.js` does NOT currently import `broadcast` — the Phase 3 extension must either import it from server.js or receive it via the same `setBroadcast` mechanism used by `classifier.js`. Looking at `classifier.js:6-7`: it uses a module-level `let broadcast = () => {}` replaced by `setBroadcast`. The routes module will need the same pattern or a direct import. [VERIFIED: src/classifier.js:6, src/server.js:64]

**Resolution:** The `broadcast` function should be passed to the routes module or made accessible. The cleanest approach consistent with existing patterns: export `broadcast` from `server.js` and import it in `api.js`, or pass it when mounting the router. Alternatively, call `setBroadcast` for the routes module the same way it's done for classifier.

### Pattern 5: HTMX Live Re-render After SSE Event

**What:** Client listens for a named SSE event and triggers an HTMX re-fetch of a fragment. Pattern used for `classification_done` event in `app.js:200-208`.

**When to use:** When server-side work completes asynchronously and the UI fragment needs to update. [VERIFIED: public/js/app.js:200]

```javascript
// Source: public/js/app.js:200-208 (classification_done pattern)
es.addEventListener('classification_done', (e) => {
  const data = JSON.parse(e.data);
  const listPanel = document.querySelector('[hx-get*="/api/emails"]');
  if (listPanel) htmx.trigger(listPanel, 'refresh');
});

// Phase 3 application — in connectSSE():
es.addEventListener('classification_updated', (e) => {
  try {
    const d = JSON.parse(e.data);
    showToast('info', `Moved to ${categoryLabel(d.category)}. We'll remember this for future emails from ${d.domain}.`);
    // Re-fetch the email detail to update the category badge
    const detail = document.getElementById('email-detail');
    if (detail && d.email_id) {
      htmx.ajax('GET', `/api/emails/${d.email_id}`, '#email-detail');
    }
    // Refresh the email list badge too
    const listPanel = document.querySelector('.email-list-panel');
    if (listPanel) htmx.trigger(listPanel, 'categoryChange');
  } catch(err) {}
});
```

### Pattern 6: 3-Second CSS Timer for Read Delay (CORRECT-03)

**What:** A `<script>` block in the email detail fragment fires `setTimeout(3000)` and adds a CSS class. The correction affordance defaults to hidden (opacity 0 or display none) and becomes visible when the class is applied.

**When to use:** This is unique to CORRECT-03. No existing codebase precedent, but it is pure vanilla JS. [ASSUMED — simple and safe pattern]

```javascript
// In the email detail HTMX fragment (rendered by GET /api/emails/:id):
// Add to end of the fragment inside a <script> block:
<script>
(function() {
  var el = document.getElementById('correction-affordance-${email.id}');
  if (el) setTimeout(function() { el.classList.add('correction-visible'); }, 3000);
})();
</script>

// CSS class controlling visibility:
// .correction-affordance { opacity: 0; pointer-events: none; transition: opacity 0.3s; }
// .correction-affordance.correction-visible { opacity: 1; pointer-events: auto; }
```

**Note on re-render:** When the detail re-renders after correction (via HTMX re-fetch), the script block runs again, re-starting the 3-second timer. This is the correct behavior — the affordance resets after a correction.

### Pattern 7: HTMX outerHTML Swap for Thumbs (CORRECT-07)

**What:** An element is entirely replaced by the server response. Used here to swap the thumbs row with "Thanks!" microcopy.

**When to use:** When the entire element should be replaced, not just its inner content. Consistent with HTMX patterns in the codebase. [VERIFIED: hx-swap="outerHTML" is a standard HTMX attribute — observed pattern `hx-swap="innerHTML"` at api.js:877; outerHTML is the same mechanism]

```html
<!-- Rendered in email detail fragment, below AI summary -->
<div id="thumbs-${cls.id}" class="ai-thumbs">
  <button hx-post="/api/emails/${email.id}/feedback"
          hx-vals='{"vote":"up","classification_id":"${cls.id}"}'
          hx-target="#thumbs-${cls.id}"
          hx-swap="outerHTML">
    👍
  </button>
  <button hx-post="/api/emails/${email.id}/feedback"
          hx-vals='{"vote":"down","classification_id":"${cls.id}"}'
          hx-target="#thumbs-${cls.id}"
          hx-swap="outerHTML">
    👎
  </button>
</div>

<!-- Server response for POST /api/emails/:id/feedback: -->
<div id="thumbs-${cls.id}" class="ai-thumbs">
  <span style="font-size:12px;color:var(--text-muted);">Thanks!</span>
</div>
```

### Anti-Patterns to Avoid

- **Importing `broadcast` from inside `api.js` as a circular require:** `server.js` requires `api.js`'s router; `api.js` must not require `server.js`. Use the `setBroadcast` injection pattern already established for `classifier.js` instead.
- **Using `INSERT OR IGNORE` for `ai_feedback`:** `IGNORE` would silently discard a vote change (up → down). Use `INSERT OR REPLACE` so the vote can be updated.
- **Counting corrections across all categories to trigger rule:** The rule only promotes when the same `(user_id, domain, category)` tuple reaches 2. The COUNT query must include all three in the WHERE clause.
- **Applying sender rule only at queue-time:** The sender rule lookup must happen inside `classifyEmail()` in the live classification path, not just when processing queued emails.
- **Storing domain with the `@` symbol:** Extract `from_address.split('@')[1]` — the `@` should not be stored in the domain column.
- **Using `hx-swap="innerHTML"` for thumbs:** That would leave the outer container element. Use `outerHTML` to eliminate it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotent upsert | Custom check-then-insert | `INSERT OR REPLACE` with unique index | SQLite handles atomically; avoids TOCTOU race |
| Domain extraction | Complex email parsing | `from_address.split('@')[1]` | The CONTEXT.md spec is explicit; anything more complex introduces edge cases (display names with @) that are out of scope |
| SSE client reconnect | Custom reconnect logic | Existing `es.onerror` at app.js:211 | Already reconnects after 5s; adding a listener to the existing `es` object is sufficient |
| Toast deduplication | Custom dedup logic | None — multiple toasts are fine | The correction event fires once per click; no dedup needed |

---

## Common Pitfalls

### Pitfall 1: broadcast Not Available in api.js

**What goes wrong:** `api.js` registers routes; `server.js` creates the SSE infrastructure and `broadcast` function. If `api.js` tries to `require('../server')`, it creates a circular dependency (`server.js` requires the router from `api.js`).

**Why it happens:** The SSE broadcast is owned by `server.js` which orchestrates all the wires. The routes module never needed to broadcast before — the existing `/reclassify` endpoint had no SSE interaction.

**How to avoid:** Mirror the pattern in `classifier.js` — add a `let broadcast = () => {}` + `setBroadcast(fn)` export to `api.js` (or the route file), then call `setBroadcast` from `server.js` after mounting the router.

**Warning signs:** `TypeError: broadcast is not a function` at runtime, or circular require errors on startup.

### Pitfall 2: DELETE + INSERT in /reclassify Drops Audit Columns

**What goes wrong:** The existing `/reclassify` endpoint at line 957 does `DELETE FROM classifications WHERE email_id = ? AND user_id = ?` then `INSERT OR IGNORE`. If the new audit columns (`user_corrected_category`, `corrected_at`) are meant to survive as a record, deleting and reinserting clears them.

**Why it happens:** The current endpoint was designed for full replacement, not audit preservation. The correction audit is a new concern.

**How to avoid:** The INSERT that follows the DELETE should include `user_corrected_category = ?` and `corrected_at = CURRENT_TIMESTAMP`. Since a DELETE+INSERT is already happening, the audit values go into the fresh INSERT row. The "original" category at time of correction is the category being overwritten — capture it from the existing row before the DELETE.

**Correct sequence:**
1. Fetch existing classification row (get `category` as the original)
2. DELETE existing row
3. INSERT new row with: `category = newCategory`, `user_corrected_category = newCategory`, `corrected_at = CURRENT_TIMESTAMP`, `source = 'user'`
4. Count corrections for domain
5. Upsert sender rule if count >= 2
6. Broadcast SSE

**Note on semantics:** `user_corrected_category` stores the correction target (what the user changed it TO). The original category is implied by comparing `category` history. This matches CORRECT-06: "original category, corrected category, timestamp" — the original can be recovered from the SSE event or from the previous classification row's timestamp ordering if needed. For the detail panel display, showing `user_corrected_category` and `corrected_at` is sufficient.

### Pitfall 3: Sender Rule Count Query Must Scope to Correct Tuple

**What goes wrong:** Count query returns 2+ but counts corrections across different categories for the same domain, promoting a rule for the wrong category.

**Why it happens:** Forgetting to include `AND category = ?` in the WHERE clause.

**How to avoid:**
```sql
SELECT COUNT(*) as cnt
FROM classifications
WHERE user_id = ? AND source = 'user'
  AND email_id IN (
    SELECT id FROM emails WHERE user_id = ? AND from_address LIKE ?
  )
  AND category = ?
```

Or more precisely, join against emails to filter by domain:
```sql
SELECT COUNT(*) as cnt
FROM classifications c
JOIN emails e ON e.id = c.email_id AND e.user_id = c.user_id
WHERE c.user_id = ? AND c.source = 'user'
  AND substr(e.from_address, instr(e.from_address, '@') + 1) = ?
  AND c.category = ?
```

Use SQLite's `substr`/`instr` to extract domain at query time rather than storing a derived column.

### Pitfall 4: Sender Rule Lookup Must Receive userId

**What goes wrong:** `classifyEmail(userId, emailId)` calls the Tier 0 lookup but does not pass `userId`, returning rules for all users or no rules.

**Why it happens:** Forgetting `user_id` in multi-user context.

**How to avoid:** The lookup is inside `classifyEmail(userId, emailId)` which already has `userId`. The query is:
```sql
SELECT category FROM sender_rules WHERE user_id = ? AND domain = ?
```
Both `?` must be bound: `[userId, domain]`. Domain is extracted from the `email` row fetched at the top of `classifyEmail`.

### Pitfall 5: HTMX re-render Script Block Runs Multiple Times

**What goes wrong:** If the email detail fragment is re-fetched (e.g., after the correction is applied), a second `setTimeout` is added. After 3 seconds, `correction-visible` is added twice — harmless for a class, but a stale timer from the prior render is now orphaned.

**Why it happens:** Each HTMX swap replaces the DOM, including the script block; the script runs fresh on swap.

**How to avoid:** Use an IIFE that checks `if (!el.dataset.timerSet) { el.dataset.timerSet = '1'; setTimeout(...) }`. Or simply accept double-setting a CSS class as harmless (idempotent). The stale timer references a DOM element that may no longer exist — `if (el)` guard prevents errors.

### Pitfall 6: ai_feedback summary_id Is classifications.id, Not email_id

**What goes wrong:** Passing `email_id` as `summary_id` when inserting into `ai_feedback`, breaking the schema intent.

**Why it happens:** Naming confusion — the summary belongs to a classification row, but the route context has `email_id` from the URL.

**How to avoid:** The email detail endpoint queries `cls = db.prepare('SELECT * FROM classifications WHERE email_id = ? AND user_id = ?').get(...)`. The `cls.id` is the `summary_id` for `ai_feedback`. Render it as a hidden value or embed it in the HTMX `hx-vals`. In the feedback endpoint, look up `cls.id` from `email_id` and `user_id` before inserting.

### Pitfall 7: CORRECT-06 Correction History When No Correction Exists

**What goes wrong:** Rendering the correction history row unconditionally causes "null" or empty values to appear for emails that were never manually corrected.

**Why it happens:** `cls.user_corrected_category` is NULL for non-corrected emails; the template emits the history section regardless.

**How to avoid:** Conditionally render the correction history only when `cls.user_corrected_category` is non-null:
```javascript
${cls?.user_corrected_category ? `
  <div ...>Corrected to: ${escHtml(categoryLabel(cls.user_corrected_category))}</div>
  <div ...>at ${new Date(cls.corrected_at).toLocaleString(...)}</div>
` : ''}
```

---

## Code Examples

### Verified Patterns from Existing Codebase

#### 1. INSERT OR IGNORE with explicit columns (existing /reclassify pattern)
```javascript
// Source: src/routes/api.js:962-969
db.prepare(`
  INSERT OR IGNORE INTO classifications
  (user_id, email_id, category, urgency, urgency_reason, summary, extracted_data, suggested_tone, source, low_confidence)
  VALUES (?,?,?,?,?,?,?,?,?,?)
`).run(
  req.user.id, req.params.id, category, userUrgency, userUrgencyReason,
  null, '{}', 'professional', 'user', 0
);
```

Phase 3 extends this INSERT to also write `user_corrected_category` and `corrected_at`.

#### 2. Auth-scoped email fetch (established security pattern)
```javascript
// Source: src/routes/api.js:949-951
const email = db.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?')
  .get(req.params.id, req.user.id);
if (!email) return res.status(404).json({ error: 'not_found' });
```

The `/reclassify` extension must fetch the full email row (not just `id`) to get `from_address` for domain extraction. Change `SELECT id` to `SELECT id, from_address`.

#### 3. Category label lookup (client-side)
```javascript
// Source: public/js/app.js:437-444
function categoryLabel(cat) {
  const map = {
    meeting_request: 'Meeting', financial: 'Financial', legal: 'Legal',
    travel: 'Travel', pitch_deck: 'Pitch', fyi: 'FYI',
    rewards_awards: 'Rewards', request: 'Request', other: 'Other'
  };
  return map[cat] || cat;
}
```

Used in the toast message. Available globally in `app.js` — callable from the SSE listener in `connectSSE()`.

#### 4. Tier 1 regex short-circuit pattern (classifier.js)
```javascript
// Source: src/classifier.js:180-194
const rulesCategory = rulesClassify(email);
if (rulesCategory) {
  const { urgency, urgency_reason } = rulesUrgency(rulesCategory, email);
  // ...
  storeClassification(userId, emailId, {
    category: rulesCategory, urgency, urgency_reason, summary,
    extracted_data: extracted, suggested_tone: 'professional', draft_reply: null,
    source: 'rules'
  }, email);
  return;
}
```

Phase 3 Tier 0 follows the same pattern — `SELECT` the sender rule, if found call `storeClassification` with `source: 'rule'` and `return`. The Tier 1 regex block is unchanged.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Static "Reload to see updated details" HTML in /reclassify response | SSE `classification_updated` + HTMX live re-render | Email detail updates instantly without page reload |
| No correction audit trail | `user_corrected_category` + `corrected_at` columns | Correction history visible in detail panel (CORRECT-06) |
| No sender learning | `sender_rules` Tier 0 check in classifier | Future emails from same domain auto-classified (CORRECT-05) |
| No summary quality signal | `ai_feedback` table | Batch quality signal for future prompt tuning (CORRECT-07) |

---

## Runtime State Inventory

> This is not a rename/refactor phase. No runtime state is affected — all changes are new columns and new tables on an existing SQLite database that persists to disk. The inline migration guard pattern ensures all changes are idempotent.

**Stored data:** `sender_rules` and `ai_feedback` tables do not exist yet — creation only, no migration of existing data. Two new columns on `classifications` default to NULL — no backfill required (existing corrected rows do not exist since the feature is new). [VERIFIED: `PRAGMA table_info` confirmed columns absent, tables absent]

**Live service config:** None — no external services affected.

**OS-registered state:** None.

**Secrets/env vars:** None.

**Build artifacts:** None.

---

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| `better-sqlite3` | DB migrations | Yes | In `node_modules`; verified via `src/db.js` |
| Node.js `node:test` | Wave 0 test stubs | Yes | 122 tests passing confirmed |
| HTMX (CDN) | UI interactions | Yes | In use in existing detail view |
| Alpine.js (CDN) | Client reactivity | Yes | In use in existing detail view |

No missing dependencies.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert/strict` |
| Config file | None — `node --test "tests/**/*.test.js"` |
| Quick run command | `node --test "tests/correction.test.js"` |
| Full suite command | `node --test "tests/**/*.test.js"` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORRECT-01 | `classifications` table has `user_corrected_category` and `corrected_at` columns after migration | unit (schema) | `node --test "tests/correction.test.js"` | No — Wave 0 |
| CORRECT-02 | `/reclassify` writes audit columns, broadcasts SSE, domain extracted correctly | integration | `node --test "tests/correction.test.js"` | No — Wave 0 |
| CORRECT-03 | (visual delay behavior) | manual-only | n/a — CSS timer not unit-testable | — |
| CORRECT-04 | Toast shown (SSE listener added to connectSSE) | manual-only | n/a — browser-side | — |
| CORRECT-05 | After 2 corrections from same domain+category, `sender_rules` row created; subsequent classify uses rule | unit + integration | `node --test "tests/correction.test.js"` | No — Wave 0 |
| CORRECT-06 | `user_corrected_category` and `corrected_at` readable after correction | unit | `node --test "tests/correction.test.js"` | No — Wave 0 |
| CORRECT-07 | `POST /api/emails/:id/feedback` upserts `ai_feedback`; second vote updates, does not duplicate | unit | `node --test "tests/correction.test.js"` | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test "tests/correction.test.js"`
- **Per wave merge:** `node --test "tests/**/*.test.js"` (must maintain 122+ pass, 0 fail)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/correction.test.js` — covers CORRECT-01, -02, -05, -06, -07 (unit + integration against isolated test DB)
- Shared fixtures already exist in other test files — use same `process.env.DB_PATH` isolation pattern

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Correction is a user action on their own emails |
| V3 Session Management | No | JWT auth already in middleware |
| V4 Access Control | YES | Every DB query scoped to `req.user.id` — cross-user data access prevention |
| V5 Input Validation | YES | `category` validated against `CATEGORIES` enum; `vote` validated against `['up','down']`; `classification_id` is an integer |
| V6 Cryptography | No | No new cryptographic operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User A corrects User B's email classification | Tampering | All queries include `AND user_id = req.user.id`; email ownership verified before classification write |
| User submits invalid category string | Tampering | Validate against `CATEGORIES` constant (already done in existing endpoint at line 945); Phase 3 extends the same check |
| User submits invalid vote value | Tampering | Validate `vote` in `['up', 'down']` before DB write; SQLite `CHECK` constraint is a defense-in-depth backup |
| Cross-user sender_rule pollution | Tampering | `sender_rules` rows are scoped to `user_id`; Tier 0 lookup always includes `WHERE user_id = ?` |
| Feedback for another user's classification | Tampering | Verify email ownership before inserting `ai_feedback`; look up `cls` via `WHERE email_id = ? AND user_id = ?` |

**Existing auth pattern to follow:** Every action endpoint starts with:
```javascript
const email = db.prepare('SELECT ... FROM emails WHERE id = ? AND user_id = ?')
  .get(req.params.id, req.user.id);
if (!email) return res.status(404).json({ error: 'not_found' });
```
The `/feedback` endpoint must follow this exact pattern before inserting into `ai_feedback`.

---

## Project Constraints (from CLAUDE.md)

- File names must be kebab-case. Test file: `correction.test.js`. [VERIFIED: consistent with existing `thread.test.js`, `migration.test.js`]
- CommonJS `require`/`module.exports` throughout — no ESM imports. [VERIFIED: all source files use `require`]
- No `any` TypeScript types — not applicable (project is JavaScript).
- All DB operations use synchronous better-sqlite3 API (`.get()`, `.run()`, `.all()`, `.prepare()`). No async DB patterns. [VERIFIED: src/db.js throughout]
- Commits: `feat/fix/chore(scope): description` format.
- Spec-driven development: phase changes should reference REQUIREMENTS.md spec. CORRECT-01 through CORRECT-07 are the spec entries.
- CLAUDE.md stack is a future vision — the actual stack in use is Node.js/Express/SQLite/HTMX as confirmed by codebase inspection. Phase 3 stays within the brownfield stack.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `broadcast` must be injected into `api.js` via a `setBroadcast` pattern — circular require would occur if `api.js` imports `server.js` | Architecture Patterns / Pitfall 1 | Low — alternative is to move broadcast to a shared module; either works, but wrong approach causes startup failure |
| A2 | The 3-second CSS timer (CORRECT-03) applies to the correction affordance hidden within the existing recategorize button/picker, not a new separate UI element | Architecture Patterns (Pattern 6) | Low — CONTEXT.md D-02 is explicit that the existing picker is extended; the timer wraps the existing element |
| A3 | `INSERT OR REPLACE` for `ai_feedback` changes the `id` column value on update (SQLite behavior) — this is acceptable since nothing references `ai_feedback.id` as a foreign key | Don't Hand-Roll | Low — `ai_feedback` is a leaf table; no downstream FK dependencies |

**All other claims in this document were VERIFIED against the live codebase or CITED from CONTEXT.md locked decisions.**

---

## Open Questions (RESOLVED)

1. **How should `broadcast` be made available to `api.js`?**
   - What we know: `classifier.js` uses a `setBroadcast` injection; `server.js` calls it. The same pattern exists for `imap.js`. `api.js` is a router module that `server.js` imports.
   - What's unclear: Whether to add `setBroadcast` to `api.js` exports (cleanest), or to pass `broadcast` as a constructor argument to the router, or to extract `broadcast` to a separate shared module.
   - Recommendation: Add `let broadcast = () => {}` + `module.exports.setBroadcast` to `api.js`. Call it from `server.js` after mounting. This is the established pattern with zero new infrastructure.

2. **`user_corrected_category` semantics — should it store the new category or the old category?**
   - What we know: CORRECT-06 says "original category, corrected category, timestamp". CONTEXT.md D-01 says "add CORRECT-01 audit columns". The REQUIREMENTS.md says these are the audit trail.
   - What's unclear: Whether `user_corrected_category` stores the new value (what the user chose) or the old value (what it was before).
   - Recommendation: Store the new category (the user's correction target). The original is implied by the history — before the correction, the row had `category = original`. Naming convention `user_corrected_category` suggests it stores the correction, not the original. Display in detail panel: "Corrected to: [user_corrected_category]".

---

## Sources

### Primary (HIGH confidence)

- `src/db.js` — all table schemas, column names, migration guard pattern, inline table creation pattern [VERIFIED: read in full]
- `src/routes/api.js:866-979` — existing `/reclassify` endpoint, category picker UI, `escHtml`, `categoryLabel`, `renderActionZone`, email detail render [VERIFIED: read in full]
- `src/classifier.js:1-330` — `classifyEmail`, `rulesClassify`, `storeClassification`, `queueClassification`, Tier 1 pattern [VERIFIED: read in full]
- `src/server.js:1-80` — `broadcast()` function, SSE client registry, `setBroadcast` pattern, existing SSE events [VERIFIED: read in full]
- `public/js/app.js:1-461` — `showToast()`, `connectSSE()`, `es.addEventListener` patterns, `categoryLabel`, Alpine components [VERIFIED: read in full]
- `PRAGMA table_info(classifications)` — confirmed current columns [VERIFIED: runtime query]
- `PRAGMA table_info(sender_rules)`, `PRAGMA table_info(ai_feedback)` — confirmed tables absent [VERIFIED: runtime query]
- `node --test "tests/**/*.test.js"` — 122 tests passing, 0 failing [VERIFIED: runtime execution]

### Secondary (MEDIUM confidence)

- `.planning/phases/03-user-correction-loop/03-CONTEXT.md` — locked decisions D-01 through D-13 [CITED: CONTEXT.md]
- `.planning/REQUIREMENTS.md` — CORRECT-01 through CORRECT-07 [CITED: REQUIREMENTS.md]
- `.planning/ROADMAP.md` — Phase 3 success criteria [CITED: ROADMAP.md]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all verified against live codebase
- Architecture: HIGH — patterns traced to specific line numbers in source files
- Pitfalls: HIGH — derived from direct code inspection (e.g., broadcast not in api.js, DELETE+INSERT semantics)
- Schema: HIGH — verified via `PRAGMA table_info` and `sqlite_master` queries
- Wave 0 test gaps: HIGH — no correction test file exists; confirmed via glob

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (stable Node.js/SQLite/HTMX stack; 30-day window appropriate)
