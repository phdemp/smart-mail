---
phase: 04-provider-observability
reviewed: 2026-05-18T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/llm/router.js
  - src/routes/api.js
  - src/server.js
  - tests/api/health.test.js
  - tests/llm/router.test.js
  - tests/server.test.js
  - views/dashboard.html
  - views/settings.html
findings:
  critical: 3
  warning: 5
  info: 4
  total: 12
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-05-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

This phase delivers provider observability — circuit breaker state, soft-fail cascade, a health API, a pill banner for the dashboard, and a health table in Settings. The routing logic in `router.js` is well-structured and the test suite is thorough for the new soft-fail paths. However, three security defects require fixing before this ships: credentials are transmitted in GET query-string parameters (logged by servers and proxies), the JOIN in the email-list query is missing a `user_id` scope on the `classifications` table (cross-user data exposure), and the `/api/account/reset` POST endpoint from Settings does not return an HTMX-compatible response, causing the "Clear Cache" flow to silently break. Three of the five Warnings are also behaviorally incorrect rather than merely stylistic.

---

## Critical Issues

### CR-01: Password sent in plaintext GET query string — logged in server access logs and proxy history

**File:** `src/routes/api.js:154-192` and `views/settings.html:820-855`

**Issue:** `testImap()`, `testSmtpConn()`, and the combined `testAccount()` helpers in the Settings UI build a `URLSearchParams` that includes `password: this.cfg.password` and append it to a GET request (`/api/account/test?...`). The server handler (`buildCfg(req.query)` at lines 154, 170, 186) reads the password out of `req.query`. GET query strings are persisted in: browser history, server access logs, reverse-proxy/CDN logs, Referrer headers on any subsequent navigation, and HTMX `hx-include` if the element is ever reused. A password that lives as a query parameter is effectively leaked to every logging layer between the browser and the server.

**Fix:**
```js
// Change the three test endpoints from GET to POST and read credentials from req.body.
// In api.js:
router.post('/api/account/test-imap', async (req, res) => {
  const cfg = buildCfg(req.body);   // body, not query
  ...
});
router.post('/api/account/test-smtp', async (req, res) => {
  const cfg = buildCfg(req.body);
  ...
});
router.post('/api/account/test', async (req, res) => {
  const cfg = buildCfg(req.body);
  ...
});

// In settings.html testImap() / testSmtpConn():
const res = await authFetch('/api/account/test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ imap_host: ..., password: this.cfg.password, ... })
});
```
Also remove these three routes from `PUBLIC_API_PATHS` in `server.js` (they already don't require auth by name but there is no reason to keep them public — the logged-in user's saved config should be the source of truth, not client-supplied credentials).

---

### CR-02: LEFT JOIN on `classifications` not scoped to `user_id` — cross-user classification data can bleed onto email rows

**File:** `src/routes/api.js:355, 363`

**Issue:** Both the email-list query and the count query join `classifications` on `c.email_id = e.id` only. The `emails` table is already user-scoped via `e.user_id = ?`, but the `classifications` table is not filtered by `c.user_id`. In a multi-user SQLite database, if two users have emails with the same integer `id` (which happens whenever a row is reused after deletion, or if the schema uses separate sequences per user), one user's classification row could match the other user's email row. The server would then return the wrong `category`, `urgency`, `summary`, and `extracted_data` for that email.

**Fix:**
```sql
-- Both occurrences of the LEFT JOIN, lines 355 and 363:
LEFT JOIN classifications c ON c.email_id = e.id AND c.user_id = e.user_id
```
This is a one-character-per-line addition that closes the join to the same user as the email.

---

### CR-03: `clearCache()` in Settings calls a POST endpoint that responds with a redirect — the JavaScript `fetch` silently follows the redirect to `/setup`, the caller receives an opaque 200, and no data is actually cleared

**File:** `views/settings.html:865-874` and `src/routes/api.js:256-268`

**Issue:** `clearCache()` calls `authFetch('/api/account/reset', { method: 'POST' })`. The handler at line 264 of `api.js` ends with `res.redirect('/setup')`. The Fetch API follows redirects automatically and does NOT throw — `res.ok` is `true` and the status is 200 (the redirect destination). The `clearCache()` function does not check anything about the response body; it shows "Cache cleared — reloading…" and reloads `location.reload()`. However because the fetch already followed the redirect internally the page reload goes to whatever URL the tab is currently on, not `/setup`. If anything in the reset throws a 500, the caller has no way to detect it. More critically: because the route deletes the user's own DB row (`DELETE FROM users WHERE id = ?`) and then redirects, subsequent reloads after the page reload will hit a now-deleted user, causing auth failures with no useful error message.

**Fix (two-part):**
```js
// api.js — return JSON instead of redirecting
router.post('/api/account/reset', (req, res) => {
  try {
    db.prepare('DELETE FROM emails WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM classifications WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM drafts WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM sync_log WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM account_config WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    res.json({ ok: true });  // caller navigates to /setup explicitly
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// settings.html clearCache()
async clearCache() {
  if (!confirm('Delete all emails and classifications? Config will be kept.')) return;
  try {
    const res = await authFetch('/api/account/reset', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      localStorage.removeItem('intellimail_token');
      location.href = '/setup';
    } else {
      showToast('error', '❌ ' + (data.error || 'Reset failed'));
    }
  } catch(e) {
    showToast('error', '❌ ' + e.message);
  }
}
```

---

## Warnings

### WR-01: `getProviderHealth()` status logic has a gap — `rate_limited` and `service_busy` statuses are never set unless the very last error was a 429/503, but the breaker resets `br.lastError` on success; transient 429 after a run of successes will show `ok` instead of `rate_limited`

**File:** `src/llm/router.js:196-217`

**Issue:** `getProviderHealth()` checks `br.lastError === 'http_429'` to assign `rate_limited`. But on a successful call (lines 108-113) `br.lastError` is set to `null` (`br.lastError = null`). So the sequence: 429 → success → health check returns `ok`, not `rate_limited`. The `isUsable()` function in `api.js` line 1402 relies on `h.status === 'rate_limited'` to apply the 10-minute cooldown; with this gap, the cooldown is never applied after any success, even if the last 429 was 30 seconds ago.

**Fix:** Track rate-limit errors separately from generic errors so a success doesn't wipe the 429 timestamp:
```js
// In the success block (after line 109), preserve last 429 timestamp:
br.fails = 0;
br.lastSuccessAt = Date.now();
// Do NOT clear lastError/lastErrorAt unconditionally:
if (br.lastError !== 'http_429' && br.lastError !== 'http_503') {
  br.lastError = null;
  br.lastErrorAt = null;
  br.lastErrorMsg = null;
}
```
Then in `getProviderHealth()`, the existing `rate_limited`/`service_busy` checks will fire correctly even after a success because the error timestamp is preserved.

---

### WR-02: `classify()` passes `opts.mode || 'full'` as the `mode` option, but `opts.mode` is already `'regen'` in regen calls — this silently overrides the `maxWaitMs` chosen by `classify()` itself

**File:** `src/llm/router.js:164-173`

**Issue:** `classify()` calculates `maxWaitMs = opts.mode === 'regen' ? 2000 : 30000` (correct), then calls `_callProviders` with `mode: opts.mode || 'full'`. When `opts.mode === 'regen'`, the `mode` passed to `_callProviders` is `'regen'`, not `'full'`. Inside `_callProviders` the `mode` value is used only for logging and the soft-fail gate (`mode !== 'draft'`). The soft-fail gate is still correct because `'regen' !== 'draft'` is `true`. However, the log entries for regen classify calls will show `mode: 'regen'` rather than `mode: 'full'`, making log analysis confusing. More importantly, if `_callProviders`'s soft-fail gate is ever expanded to also exclude `'regen'` mode (a plausible future change), this will silently skip soft-fail validation for regen calls.

**Fix:**
```js
async function classify(email, opts = {}) {
  const maxWaitMs = opts.mode === 'regen' ? 2000 : 30000;
  return _callProviders(email, opts, {
    mode: 'full',   // always 'full' for classify — regen is a scheduling hint, not a mode
    maxWaitMs,
    extraProviderCfg: null,
    mapResult: (parsed, name) => ({ ...parsed, _provider: name })
  });
}
```

---

### WR-03: `setObservedLimits()` is exposed as a public method on the router and called directly by the `/api/providers/:name/test` route — this allows any authenticated user to inject arbitrary `_observedLimits` data into any provider's state for any other user via the `userId` derived from `req.user.id`

**File:** `src/routes/api.js:224-226` and `src/llm/router.js:228-232`

**Issue:** The test endpoint at line 224 of `api.js` calls `llm.router.setObservedLimits(req.user.id, name, result._observedLimits)`. This is scoped to `req.user.id` (correct). However, `setObservedLimits()` does no type-checking on the `limits` object beyond `typeof limits === 'object'`. A malicious response from a configured provider could set `rpd_remaining` and `rpd_limit` to arbitrary values (e.g., `Number.MAX_SAFE_INTEGER`, `Infinity`, `null`) that would cause the UI to display false quota headroom. This is a trust-boundary issue: provider responses should never directly populate shared router state without sanitization.

**Fix:** Add numeric bounds validation in `setObservedLimits()`:
```js
function setObservedLimits(userId, providerName, limits) {
  if (!limits || typeof limits !== 'object') return;
  const safe = {};
  for (const k of ['rpd_remaining', 'rpd_limit', 'tpd_remaining', 'tpd_limit']) {
    const v = limits[k];
    safe[k] = (typeof v === 'number' && isFinite(v) && v >= 0) ? v : null;
  }
  if (typeof limits.reset_tokens === 'string') {
    safe.reset_tokens = limits.reset_tokens.slice(0, 32);
  }
  observedLimits.set(key(userId, providerName), safe);
}
```

---

### WR-04: `server.js` SSE heartbeat interval is never cleared if the write fails on the heartbeat path — the `catch` deletes the client from the Set but does not clear the interval, causing a zombie `setInterval` that writes to a closed socket every 30 seconds

**File:** `src/server.js:40-43`

**Issue:**
```js
const heartbeat = setInterval(() => {
  try { res.write('event: heartbeat\ndata: {}\n\n'); }
  catch(e) { sseClients.delete(client); clearInterval(heartbeat); }  // ← correct
}, 30000);
```
This particular path does clear the interval in the catch — that part is actually fine. However, the `broadcast()` function at line 14-19 also calls `client.res.write()` and on failure does `sseClients.delete(client)` but does NOT clear the client's heartbeat interval. There is no reference to the interval stored on the client object, so the interval for a client whose connection failed during a broadcast continues firing every 30 seconds, attempts to write to the already-closed response, and silently swallows the error.

**Fix:** Store the interval reference on the client object so `broadcast()` can clean it up:
```js
const client = { id: Date.now(), res, heartbeat: null };
sseClients.add(client);
// ...
client.heartbeat = setInterval(() => { ... }, 30000);

// In broadcast():
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(payload); }
    catch(e) {
      sseClients.delete(client);
      if (client.heartbeat) clearInterval(client.heartbeat);
    }
  }
}
```

---

### WR-05: `_callProviders()` in `regen` mode passes `opts.mode === 'regen'` into the outer `opts` but the soft-fail gate uses the inner `mode` parameter — a regen call that soft-fails will try the next provider with the same 2-second bucket wait; if all providers return bad content the caller gets `null` with no differentiation from "all providers hard-failed"

**File:** `src/llm/router.js:164-173`

**Issue:** When `classify()` is called with `opts.mode === 'regen'`, the `maxWaitMs` is 2 seconds. If provider A soft-fails, the router tries provider B with the same 2-second wait. This is intentional. However, the return value for "all providers soft-failed" is `null`, which is the same as "all providers threw exceptions". The caller (`classifyEmail` in `classifier.js`, presumably) cannot distinguish between "no provider was available" and "all providers returned unusable content". This may be acceptable for the current implementation, but the lack of distinction makes the fallback path ambiguous — worth documenting or differentiating with a sentinel value.

**Fix:** At minimum, add a comment to the return statement at line 161 clarifying that `null` covers both hard-failure (all threw) and soft-failure (all returned bad content) exhaustion. If the classifier needs to differentiate, return a typed result:
```js
// At end of _callProviders loop:
return null;  // exhausted: covers both hard-failures (thrown) and soft-failures (bad content)
```

---

## Info

### IN-01: `server.test.js` contains only a `.todo` test — the 30s warmup delay behavior is completely untested

**File:** `tests/server.test.js:13`

**Issue:** The test file for `server.js` is a stub with a single `test.todo(...)` call. The 30-second startup classification delay (`setTimeout(() => { ... }, 30000)` in `server.js`) has no test coverage. The comment says "Uses Node.js built-in mock.timers (Node 24)" but nothing is implemented.

**Fix:** Implement the test using `mock.timers` as described in the comment. The behavior to verify: `startSyncForUser` is called immediately; `classifyAllUnclassifiedForUser` is not called until after the 30-second timer fires.

---

### IN-02: `views/settings.html` hardcodes `gemini-flash-latest` as the default Gemini model in the client-side provider list (line 510), but `api.js` line 1225 defaults to `gemini-1.5-flash-latest` — the two defaults are inconsistent

**File:** `views/settings.html:510` vs `src/routes/api.js:1225`

**Issue:** The client-side `providerList` initializer uses `model: 'gemini-flash-latest'` while `loadProviders()` will overwrite this with whatever the server returns. The server defaults to `'gemini-1.5-flash-latest'`. The client default is only visible during the brief window before `loadProviders()` resolves, and if `loadProviders()` fails, the stale client default is used. `gemini-flash-latest` is not a valid Gemini API model ID.

**Fix:** Align the client-side default to match the server:
```js
// settings.html line 510:
{ name: 'gemini', label: 'Gemini Flash', ..., model: 'gemini-1.5-flash-latest', ... }
```

---

### IN-03: `dashboard.html` and `settings.html` load third-party scripts from unpkg and CDN with no Subresource Integrity (SRI) hashes

**File:** `views/dashboard.html:20-26`, `views/settings.html:20-24`

**Issue:** htmx, Alpine.js, Tailwind CSS, and lodash are loaded from `unpkg.com` and `cdn.tailwindcss.com` with no `integrity` attributes. A CDN compromise or unpkg serve of a malicious version would execute arbitrary JavaScript in all user sessions. The lodash load (`cdn.jsdelivr.net/npm/lodash`) is particularly notable — lodash is a high-value CDN hijacking target.

**Fix:** Add SRI hashes for pinned versions, e.g.:
```html
<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js"
        integrity="sha384-<hash>" crossorigin="anonymous"></script>
```
Pin `alpinejs` to a specific patch version (`@3.14.1` or similar) rather than `@3.x.x` (floating major.x is effectively `latest`).

---

### IN-04: `views/settings.html` provider health table (lines 337-344) has a logic gap — the "No activity yet" cell and the "last error message" cell are controlled by two `x-if` conditions that both check `status !== 'unknown'`, but neither branch renders anything when `status` is a known error AND `last_error_msg` is null/empty, leaving the cell blank with no visible indicator

**File:** `views/settings.html:337-345`

**Issue:** The three `x-if` conditions for the last-error cell are:
1. `status === 'unknown' || !providerHealth[name]` → shows "No activity yet"
2. `status !== 'unknown' && last_error_msg` → shows truncated message
3. `status !== 'unknown' && !last_error_msg` → shows "—"

Condition 3 is correct for the "no message" case. However condition 1 also fires for `!providerHealth[name]` (null), which overlaps with condition 3 when the object exists but `status` is something like `'ok'` and `last_error_msg` is null. The display is not broken but the intent is slightly unclear — condition 1 should not conflate "status is unknown" with "no health record at all".

**Fix:** Tighten condition 1 to only fire when the object is absent:
```html
<template x-if="!providerHealth[name]">
  <span style="color:var(--text-muted);">No activity yet</span>
</template>
<template x-if="providerHealth[name] && (providerHealth[name].status === 'unknown' || !providerHealth[name].last_error_msg)">
  <span>—</span>
</template>
<template x-if="providerHealth[name] && providerHealth[name].status !== 'unknown' && providerHealth[name].last_error_msg">
  <span x-text="..."></span>
</template>
```

---

_Reviewed: 2026-05-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
