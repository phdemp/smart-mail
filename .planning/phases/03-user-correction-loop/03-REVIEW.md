---
phase: 03-user-correction-loop
reviewed: 2026-05-15T10:16:36Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - tests/correction.test.js
  - src/db.js
  - src/classifier.js
  - src/routes/api.js
  - src/server.js
  - public/js/app.js
findings:
  critical: 4
  warning: 6
  info: 3
  total: 13
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-05-15T10:16:36Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

This review covers the Phase 3 user-correction loop: reclassify endpoint, sender-rule promotion, ai_feedback UPSERT, SSE broadcast for correction events, schema migrations, and related test coverage. The core schema design is sound and the UPSERT logic for `sender_rules` and `ai_feedback` is correct. The main problems are: (1) a credential-leak vector in `/api/settings` that spreads the full DB row — including `claude_api_key` and `password` — before only blanking four fields; (2) the SSE endpoint in server.js has no authentication, exposing all broadcast events to unauthenticated clients; (3) `INSERT OR IGNORE` in `reclassify` silently discards the update when a race condition means the row already exists; (4) the `classification_updated` SSE event carries a numeric `email_id` from the URL param but the client receives it as a string, breaking the `htmx.ajax` re-render. Several warnings around error masking, domain extraction edge cases, and missing test coverage are also noted.

---

## Critical Issues

### CR-01: `/api/settings` leaks `claude_api_key` and `password` via object spread

**File:** `src/routes/api.js:1210-1235`

**Issue:** `getConfig()` returns a `SELECT *` row from `account_config`, which includes `claude_api_key` (defined in `src/db.js:32`) and `password` (plaintext, acknowledged in `db.js:31`). The response object is built with `...cfg` then only four LLM keys and `password` are explicitly blanked. `claude_api_key` is never blanked, so it is sent verbatim to any authenticated client. If a future migration adds another sensitive column to `account_config`, it will also leak automatically. Using `SELECT *` + spread-then-redact is an inherently unsafe pattern.

```js
// Current (leaks claude_api_key and any future sensitive columns)
const out = {
  ...cfg,          // <-- includes claude_api_key
  password: undefined,
  nvidia_api_key: '',
  // claude_api_key is never overwritten
  ...
};

// Fix: allowlist only the columns the client legitimately needs
const out = {
  id:                  cfg.id,
  display_name:        cfg.display_name,
  email:               cfg.email,
  imap_host:           cfg.imap_host,
  imap_port:           cfg.imap_port,
  imap_tls:            cfg.imap_tls,
  smtp_host:           cfg.smtp_host,
  smtp_port:           cfg.smtp_port,
  smtp_tls:            cfg.smtp_tls,
  username:            cfg.username,
  sync_interval:       cfg.sync_interval,
  has_password:        !!cfg.password,
  has_nvidia_key:      !!cfg.nvidia_api_key,
  has_groq_key:        !!cfg.groq_api_key,
  has_gemini_key:      !!cfg.gemini_api_key,
  has_deepseek_key:    !!cfg.deepseek_api_key,
  nvidia_api_key:      '',
  groq_api_key:        '',
  gemini_api_key:      '',
  deepseek_api_key:    '',
  // ... rest of explicit fields
};
```

---

### CR-02: SSE endpoint (`/api/sse`) is unauthenticated — all broadcasts are visible to any HTTP client

**File:** `src/server.js:22-49`

**Issue:** The auth middleware at `src/server.js:75-81` correctly protects all `/api/*` routes. However, the SSE route is registered **before** the auth middleware is wired (`app.get('/api/sse', ...)` at line 23, middleware at line 75). Express routes are matched in registration order; the SSE route is already registered and handled before `requireAuth` is called. Any unauthenticated client — or a logged-in user from a different account — can open `/api/sse` and receive every `classification_done`, `classification_updated`, `new_email`, and `stats_update` broadcast for every user on the server. This is a cross-user data leak.

```js
// Fix: add requireAuth before the SSE route registration, or inline it:
app.get('/api/sse', requireAuth, (req, res) => {
  // ... existing handler, but filter broadcasts by req.user.id
});

// Additionally, the broadcast function must filter by userId:
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    // Only send to the client whose userId matches the event's user_id field
    if (data.user_id !== undefined && client.userId !== data.user_id) continue;
    try { client.res.write(payload); }
    catch(e) { sseClients.delete(client); }
  }
}
// Store userId on the client object at connection time:
const client = { id: Date.now(), res, userId: req.user.id };
```

---

### CR-03: `INSERT OR IGNORE` in `/api/emails/:id/reclassify` silently fails on race condition

**File:** `src/routes/api.js:997-1010`

**Issue:** The reclassify handler first does `DELETE FROM classifications WHERE email_id = ? AND user_id = ?` (line 997), then immediately does `INSERT OR IGNORE INTO classifications ...` (line 1003). The `INSERT OR IGNORE` form is designed to skip inserting when a UNIQUE constraint would fire. The `classifications` table has no explicit UNIQUE index shown (unlike `sender_rules` and `ai_feedback`), but the `OR IGNORE` is still wrong intent here: if a concurrent classifier queued for the same email runs between the DELETE and INSERT and writes a new row first, this INSERT will be silently dropped and the user's correction is lost without any error response. The handler returns HTTP 200 with a success fragment regardless. The correct operation for overwrite-or-create is `INSERT OR REPLACE`, or better, the preceding DELETE followed by a plain `INSERT`.

```js
// Fix: replace INSERT OR IGNORE with INSERT OR REPLACE so the user's
// category is never silently discarded:
db.prepare(`
  INSERT OR REPLACE INTO classifications
  (user_id, email_id, category, urgency, urgency_reason, summary, extracted_data,
   suggested_tone, source, low_confidence, user_corrected_category, corrected_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
`).run(
  req.user.id, req.params.id, category, userUrgency, userUrgencyReason,
  null, '{}', 'professional', 'user', 0, category
);
```

---

### CR-04: `classification_updated` SSE event sends `email_id` as a string; client type-checks against integer IDs

**File:** `src/routes/api.js:1031-1036` and `public/js/app.js:210-223`

**Issue:** In the `reclassify` handler, `broadcast('classification_updated', { email_id: req.params.id, ... })` is called at line 1031. `req.params.id` is always a **string** (Express URL parameters are strings). In the SSE client handler in `app.js:217`, the code uses `d.email_id` to build a URL for `htmx.ajax` which works fine. However, the `classification_done` handler at `app.js:201` implicitly compares the SSE `email_id` value against DOM `data-email-id` attributes to trigger refresh. If the DOM stores the ID as an integer (common in HTMX template rendering) and the SSE value is a string, the comparison in `classification_updated` logic (line 217 `if (detail && d.email_id)`) will make the HTMX call to `/api/emails/undefined` or produce a URL like `/api/emails/5` where `d.email_id` is `"5"` — the URL works but the inconsistency can cascade. More critically, the `email_id` in the `classification_done` event is also a string from classifier.js (line 281: `email_id: emailId` where `emailId` comes from a DB integer), whereas `req.params.id` is always a string. To prevent future breakage as this field is used for comparisons, all numeric IDs in broadcast payloads should be coerced with `parseInt()`.

```js
// Fix in api.js reclassify handler:
broadcast('classification_updated', {
  email_id: parseInt(req.params.id, 10),  // coerce to integer
  category,
  source: 'user',
  domain
});
```

---

## Warnings

### WR-01: Domain extraction does not handle email addresses with multiple `@` signs (RFC 5321 quoted local parts)

**File:** `src/routes/api.js:993` and `src/classifier.js:180`

**Issue:** Both sites use `.split('@')[1]` to extract the domain. If `from_address` is `"user@alias"@example.com` (a quoted local-part with an embedded `@`, which is valid per RFC 5321), `.split('@')` produces `['"user', 'alias"', 'example.com']` and `[1]` yields `'alias"'` — a non-existent domain. The sender-rule promotion will create a `sender_rules` row with `domain = 'alias"'` and never match future emails. More practically, some mail servers mangle addresses and can emit `user@@domain.com` style artifacts; `.split('@')[1]` gives an empty string. This silently creates a broken sender rule for `domain = ''` which would match ALL emails with no `@` in their from address.

```js
// Fix: take the last segment after @ to be robust against edge cases
function extractDomain(fromAddress) {
  if (!fromAddress) return '';
  const parts = fromAddress.trim().split('@');
  return parts.length >= 2 ? parts[parts.length - 1].toLowerCase() : '';
}
```

---

### WR-02: `saveConfig()` in `db.js` always writes to `id = 1` regardless of user, and `getConfig()` called without userId defaults to first row

**File:** `src/db.js:326-344`

**Issue:** `saveConfig()` at line 329 always calls `getConfig()` with no argument (falling back to "first row"), then UPDATEs `WHERE id=1` (line 332). This function is exported and could be called from any code path with a multi-user DB. If user A has `id=1` and user B saves config, user A's config is overwritten. Although `saveConfig` does not appear to be called from the Phase 3 routes, it remains exported (`module.exports` line 392) and is a latent data-corruption hazard. The `getConfig()` no-argument path (line 323, "legacy callers") with the same vulnerability is commented as acceptable, but `saveConfig()` is more dangerous because it writes.

```js
// Fix: add userId parameter and scope correctly
function saveConfig(userId, cfg) {
  const existing = getConfig(userId);
  if (existing) {
    db.prepare(`UPDATE account_config SET ... WHERE user_id = ?`)
      .run(..., userId);
  } else {
    db.prepare(`INSERT INTO account_config (user_id, ...) VALUES (?, ...)`)
      .run(userId, ...);
  }
}
```

---

### WR-03: `storeClassification` uses `INSERT OR IGNORE` — a concurrent reclassify followed by a queued LLM classification silently discards the LLM result

**File:** `src/classifier.js:265-275`

**Issue:** After a user corrects a category via `/api/emails/:id/reclassify`, the classifier queue may still have the email pending. When the queued LLM job finishes, `storeClassification` calls `INSERT OR IGNORE` which fires and finds the row inserted by reclassify — so the LLM result is silently dropped. This is intentional for _fresh_ classification (prevent double-write), but the check at `classifyEmail` line 161 (`if (existing) return`) should prevent re-entry when a row exists. However, there is a TOCTOU window: the existence check happens at queue-pickup time, not at INSERT time, and the queue is processed in batches of 5 with `Promise.all`. If two emails are processed in the same batch and both resolve after the other's INSERT, only one warning fires. The real risk is that after a user correction, a concurrent LLM job that already passed the `if (existing) return` guard will attempt `INSERT OR IGNORE` and silently be dropped — no log, no notification, correct outcome by accident. This is fragile: if the INSERT is ever changed to `INSERT OR REPLACE`, user corrections will be clobbered by LLM output.

**Fix:** After a user reclassification, explicitly delete the queue entry for that emailId to prevent the race from occurring:
```js
// In /api/emails/:id/reclassify, after deleting and re-inserting the classification:
// Remove from the in-memory queue if still pending
const { drainQueueFor } = require('../classifier'); // add this export
drainQueueFor(req.user.id, parseInt(req.params.id, 10));
```

---

### WR-04: `/api/emails/:id/reclassify` re-uses `INSERT OR IGNORE` but the domain promotion count query counts the row just inserted

**File:** `src/routes/api.js:1013-1027`

**Issue:** The sender-rule promotion COUNT at line 1014 runs after the new classification row has already been inserted (line 1002). This means the very first user correction for a domain produces a count of 1, the second produces 2 — threshold is `>= 2`. This is the intended behavior. However, the COUNT query at line 1014 queries `c.source = 'user'` and joins `emails e` — but the new classification row just inserted at line 1002 uses `source = 'user'`. If the INSERT was skipped (because `INSERT OR IGNORE` found a conflicting row, per CR-03), the count still includes whatever was there before, and promotion could fire incorrectly on stale rows. The correctness of the promotion logic is contingent on the INSERT actually succeeding, which ties back to CR-03.

**Fix:** Resolve CR-03 first (use `INSERT OR REPLACE`). Then verify the count strictly reflects the user's intent by also filtering `user_corrected_category = category` rather than just `c.category = category`:

```sql
SELECT COUNT(*) as cnt
FROM classifications c
JOIN emails e ON e.id = c.email_id AND e.user_id = c.user_id
WHERE c.user_id = ? AND c.source = 'user'
  AND substr(e.from_address, instr(e.from_address, '@') + 1) = ?
  AND c.user_corrected_category = ?   -- match the explicit correction column
```

---

### WR-05: SSE initial `stats_update` in server.js calls `getStats()` with no userId argument, sending aggregate stats to the connecting client

**File:** `src/server.js:34-37`

**Issue:** When a client connects to `/api/sse`, the handler sends initial stats at line 35: `const stats = getStats();` (no argument). `getStats()` called without `userId` generates cross-user stats for the entire database (the `where` clause in `getStats()` is conditional on `userId != null`). The connecting client receives everyone's email counts, not just their own. After SSE is properly authenticated (per CR-02), this should pass `req.user.id` here too.

```js
// Fix:
const stats = getStats(req.user.id);
```

---

### WR-06: `db.js` ALTER TABLE migration loop uses unparameterized column/type interpolation

**File:** `src/db.js:122-124`

**Issue:** The PROVIDER_COLS migration loop at line 122 does `db.exec(`ALTER TABLE account_config ADD COLUMN ${col} ${type}`)`. The `col` and `type` values come from the hardcoded `PROVIDER_COLS` array — not user input — so there is no injection risk today. However, if this pattern is copied by a future developer for a migration that reads column names from a config file or environment variable, it will create a SQL injection path. The pattern should be noted as unsafe to generalize.

**Fix:** For any future migration where column names or types might be derived from external input, validate against an allowlist before interpolation. As-is, add a comment warning against extending this pattern with untrusted values.

---

## Info

### IN-01: Test suite has no coverage for the `classification_updated` SSE broadcast data shape

**File:** `tests/correction.test.js`

**Issue:** The test suite validates schema, UPSERT deduplication, the COUNT query shape for sender-rule promotion, and vote CHECK constraints. There is no test that calls through the `/api/emails/:id/reclassify` HTTP handler and verifies the SSE broadcast payload (i.e., that `email_id` is present, `category` is valid, and `domain` is a non-empty string). The broadcast is fire-and-forget so test failures at the broadcast level would be invisible. Given CR-04 (string vs integer `email_id`), this gap directly contributed to the bug going undetected.

**Fix:** Add an integration test that calls the reclassify route with a mock `broadcast` spy and asserts on the payload fields including the type of `email_id`.

---

### IN-02: `correction-affordance` div is only rendered inside the `default` case of `renderActionZone`, making reclassification unavailable for classified emails

**File:** `src/routes/api.js:903-925`

**Issue:** The Recategorize modal and the `correction-affordance` element (lines 903-925) are only rendered when `cat === 'other'` (the `default` branch of the switch). A user who wants to correct an email that was classified as `financial` into `travel` has no UI affordance to do so — the correction mechanism is invisible for all non-`other` categories. The 3-second timer script at line 648-658 also only finds `correction-affordance-${email.id}` in this scenario. This means sender-rule promotion via user correction is effectively limited to emails that land in `other`, defeating much of the feature's value.

**Fix:** Move the `correction-affordance` block outside the switch (render it unconditionally after the action zone) so all categories expose the recategorize UI.

---

### IN-03: `connectSSE()` in `app.js` does not reconnect with exponential backoff — rapid reconnect loop on sustained server outage

**File:** `public/js/app.js:226-230`

**Issue:** On SSE error, the handler does `setTimeout(() => this.connectSSE(), 5000)` — a fixed 5-second retry. Each reconnect opens a new `EventSource`, which immediately tries to connect, fails, and schedules another 5-second retry. Under a sustained outage with many browser tabs open, every tab generates a reconnect attempt every 5 seconds. There is no jitter, no backoff cap. While not a security issue, it represents a correctness gap (duplicate event listeners can accumulate if `es.close()` is missed in some paths) and a reliability concern.

**Fix:** Implement exponential backoff with jitter:
```js
let _sseRetryMs = 5000;
es.onerror = () => {
  this.syncMode = 'disconnected';
  es.close();
  setTimeout(() => {
    this.connectSSE();
    _sseRetryMs = Math.min(_sseRetryMs * 2, 60000);
  }, _sseRetryMs + Math.random() * 1000);
};
// Reset delay on successful open:
es.onopen = () => { _sseRetryMs = 5000; ... };
```

---

_Reviewed: 2026-05-15T10:16:36Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
