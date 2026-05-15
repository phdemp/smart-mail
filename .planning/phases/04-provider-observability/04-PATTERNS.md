# Phase 4: Provider Observability - Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 8
**Analogs found:** 8 / 8

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/llm/router.js` | service | request-response | `src/llm/router.js` itself (lines 121-145 error path) | exact — modify existing code |
| `src/routes/api.js` | route/controller | request-response | `src/routes/api.js:1358` (`/api/llm/status`) and `api.js:283` (`/api/sync/status`) | exact — same file, same route pattern |
| `src/server.js` | config/bootstrap | event-driven | `src/server.js:92-98` (`init()` function) | exact — modify one line in the same function |
| `views/settings.html` | component | request-response | `views/settings.html:193-248` (provider list rows) + `settings.html:455-513` (Alpine state) | exact — same file, same section |
| `views/dashboard.html` | component | request-response | `views/dashboard.html:152-192` (email-list-panel) + `views/dashboard.html:34-64` (Alpine banners) | exact — same file, adjacent section |
| `tests/llm/router.test.js` | test | request-response | `tests/llm/router.test.js:108-127` (breaker tests) | exact — same file, same fake-provider pattern |
| `tests/api/health.test.js` | test | request-response | `tests/api/scoping.test.js` (Express test harness) | role-match — same test framework and HTTP helper pattern |
| `tests/server.test.js` | test | event-driven | `tests/llm/router.test.js:1-11` (DB isolation + node:test) | partial-match — same test framework, new mock-timer approach |

---

## Pattern Assignments

### `src/llm/router.js` — soft-failure gate in `_callProviders()`

**Analog:** `src/llm/router.js` lines 94-145 (the existing success path and error path in `_callProviders()`)

**Import addition** (line 1 — add `CATEGORIES` to existing destructure):
```javascript
// CURRENT (router.js:1):
const { parseProviderResponse, DEFAULTS, SYSTEM_PROMPT } = require('./providers/base');

// CHANGE TO:
const { parseProviderResponse, DEFAULTS, SYSTEM_PROMPT, CATEGORIES } = require('./providers/base');
```

**Injection point** (lines 100-120 — after `parsed` is built, before `return mapResult()`):
```javascript
// Current success path (router.js:100-120):
const parsed = typeof rawResult === 'string'
  ? parseProviderResponse(rawResult)
  : { ...DEFAULTS, ...rawResult };
delete parsed._observedLimits;
try {
  if (userId != null) usageApi.increment(userId, name);
  else usageApi.increment(name);
} catch {}
const br = getBreaker(userId, name);
br.fails = 0;
br.lastSuccessAt = Date.now();
br.lastError = null;
br.lastErrorAt = null;
br.lastErrorMsg = null;
log({ provider: name, mode, outcome: 'success', latency_ms: Date.now() - start, email_id: email.id, user_id: userId, token_count: tokenCount });
try {
  db.prepare(
    "INSERT INTO llm_logs (ts, provider, user_id, email_id, token_count, outcome, latency_ms) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)"
  ).run(name, userId != null ? userId : null, email.id, tokenCount, 'success', Date.now() - start);
} catch (_) {}
return mapResult(parsed, name);   // ← INSERT SOFT-FAIL CHECK BEFORE THIS LINE
```

**New soft-fail gate** (insert between the `llm_logs` INSERT and `return mapResult()`):
```javascript
// Only validate semantic correctness for classify mode — draft mode has no category field (Pitfall 2)
const isSoftFail = mode !== 'draft' &&
  (!CATEGORIES.includes(parsed.category) || !parsed.summary || parsed.summary.trim() === '');
if (isSoftFail) {
  log({ provider: name, mode, outcome: 'soft_fail', latency_ms: Date.now() - start, email_id: email.id, user_id: userId, token_count: tokenCount });
  try {
    db.prepare(
      "INSERT INTO llm_logs (ts, provider, user_id, email_id, token_count, outcome, latency_ms) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)"
    ).run(name, userId != null ? userId : null, email.id, tokenCount, 'soft_fail', Date.now() - start);
  } catch (_) {}
  // Do NOT increment br.fails — soft fail is a content issue, not availability (D-13)
  continue;  // try next provider
}
return mapResult(parsed, name);
```

**CRITICAL WARNING:** The existing `llm_logs` INSERT at lines 116-119 logs `'success'` BEFORE the soft-fail check. When soft-fail is inserted, this success INSERT must be REMOVED from the pre-check position and re-added only on the genuinely-good path (after `isSoftFail === false`). Otherwise both `'success'` and `'soft_fail'` get written for the same call. The success INSERT should move to just before `return mapResult(parsed, name)`.

**Error path analog** (router.js:121-145 — same `continue` and `br.fails++` pattern to NOT copy for soft-fail):
```javascript
// This is the ERROR path — shown so the soft-fail gate author knows what NOT to copy.
// Soft-fail does NOT do: br.fails += 1 or br.openedAt = Date.now()
} catch (err) {
  const outcome = classifyError(err);
  log({ provider: name, mode, outcome, ... });
  try { db.prepare("INSERT INTO llm_logs ...").run(..., outcome, ...); } catch (_) {}
  const br = getBreaker(userId, name);
  br.lastError = outcome;
  br.lastErrorAt = Date.now();
  br.lastErrorMsg = String(err.message || '').slice(0, 300);
  // ... br.fails += 1 and br.openedAt = Date.now() on non-429/503 errors
  continue;
}
```

---

### `src/routes/api.js` — two new routes: `GET /api/llm/health` and `GET /api/llm/health/pill`

**Analog 1:** `src/routes/api.js` lines 1358-1426 (`/api/llm/status` — JSON endpoint)

**Route structure pattern** (api.js:1358-1426):
```javascript
// ─── LLM key status + fallback reclassify ───────────────────────────────────
router.get('/api/llm/status', (req, res) => {
  const cfg = getConfig(req.user.id) || {};
  // ...
  const llm = require('../llm');
  const health = llm.router.getProviderHealth(req.user.id) || {};
  // ...
  res.json({
    // ...
    failed_count: db.prepare("SELECT COUNT(*) as n FROM classifications WHERE user_id = ? AND source = 'failed'").get(req.user.id).n,
    provider_health: health,
    // ...
  });
});
```

**New `/api/llm/health` route** (copy structure from above, strip to minimum):
```javascript
// ─── Provider health endpoint (OBSERVE-01) ──────────────────────────────────
router.get('/api/llm/health', (req, res) => {
  const llm = require('../llm');
  const health = llm.router.getProviderHealth(req.user.id) || {};
  const failed = db.prepare(
    "SELECT COUNT(*) as n FROM classifications WHERE user_id = ? AND source = 'failed'"
  ).get(req.user.id).n;
  res.json({ providers: health, failed_count: failed });
});
```

**Auth note:** No explicit `requireAuth` needed — global middleware in `server.js:75-81` already guards all `/api/` paths not in `PUBLIC_API_PATHS`. The new paths must NOT be added to `PUBLIC_API_PATHS`.

**Analog 2:** `src/routes/api.js` lines 283-317 (`/api/sync/status` — HTMX HTML fragment)

**HTML fragment + HTMX polling pattern** (api.js:298-313):
```javascript
router.get('/api/sync/status', (req, res) => {
  // ...
  // Return both JSON (for JS) and HTML partial (for HTMX polling)
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    res.send(`
      <div hx-get="/api/sync/status" hx-trigger="every 10s" hx-swap="outerHTML"
           hx-headers='{"Accept":"text/html"}'
           style="padding:12px 16px;border-top:1px solid var(--border);...">
        ...${escHtml(modeLabel)}...
      </div>
    `);
  } else {
    res.json({ ... });
  }
});
```

**New `/api/llm/health/pill` route** (pill always returns HTML, no JSON dual-mode needed):
```javascript
// ─── End-user AI degraded pill fragment (OBSERVE-04) ────────────────────────
router.get('/api/llm/health/pill', (req, res) => {
  const llm = require('../llm');
  const health = llm.router.getProviderHealth(req.user.id) || {};
  // Pill only on explicitly non-ok, non-unknown statuses (D-01; Pitfall 5)
  const anyDegraded = Object.values(health).some(
    h => h.status && h.status !== 'ok' && h.status !== 'unknown'
  );
  if (!anyDegraded) return res.send('');
  // escHtml NOT needed here — no dynamic content inserted into the pill HTML
  res.send(`
    <div style="padding:8px 16px;background:rgba(245,158,11,0.1);border-bottom:1px solid rgba(245,158,11,0.3);font-size:12px;display:flex;align-items:center;gap:8px;">
      <span style="color:var(--accent-amber);">⚠</span>
      <span style="color:var(--text-primary);">AI features degraded</span>
      <a href="/settings#providers" style="color:var(--accent-amber);font-size:11px;margin-left:auto;text-decoration:none;">View status →</a>
    </div>
  `);
});
```

**Helpers to use** — already defined in api.js, available in scope:
- `escHtml()` at api.js:21 — use on `last_error_msg` in any Settings-panel HTML fragment
- `smartTime()` at api.js:43 — use for `last_success_at` display ("2 min ago")

---

### `src/server.js` — setTimeout warmup in `init()`

**Analog:** `src/server.js` lines 92-98 (current `init()` — the exact function being modified)

**Current code** (server.js:92-98):
```javascript
async function init() {
  const users = db.prepare('SELECT id FROM users').all();
  for (const u of users) {
    classifyAllUnclassifiedForUser(u.id);
    startSyncForUser(u.id);
  }
}
```

**Modified code** (D-09: wrap only the classify flush, not `startSyncForUser`):
```javascript
async function init() {
  const users = db.prepare('SELECT id FROM users').all();
  for (const u of users) {
    startSyncForUser(u.id);  // IMAP sync starts immediately
  }
  // Delay startup classification flush 30s to absorb post-restart provider instability (D-09)
  setTimeout(() => {
    for (const u of users) {
      classifyAllUnclassifiedForUser(u.id);
    }
  }, 30000);
}
```

**Note:** `startSyncForUser` is moved out of the loop above the timeout so IMAP sync begins immediately. Only the classification flush is delayed.

---

### `views/settings.html` — new health panel section in providers tab

**Analog 1:** `views/settings.html` lines 162-256 (existing `settings-section` div — structural container)

**Section container pattern** (settings.html:162-165):
```html
<div class="settings-section">
  <h3>🧠 AI Providers</h3>
  <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">...</p>
  <!-- content rows -->
</div>
```

**Analog 2:** `views/settings.html` lines 193-248 (provider list rows — Alpine `x-for` + inline styles)

**Provider row structure** (settings.html:198-248):
```html
<template x-for="(p, idx) in providerList" :key="p.name">
  <div style="display:grid;grid-template-columns:24px 24px 1fr auto;...">
    <!-- columns using x-text, :style, x-model -->
  </div>
</template>
```

**Analog 3:** `views/settings.html` lines 461-477 (`healthLabel()` and `healthStyle()` — Alpine methods already in scope)

**healthLabel and healthStyle** (settings.html:461-477):
```javascript
healthLabel(s) {
  const m = {
    ok: '✓ healthy', rate_limited: '⚠ rate-limited', service_busy: '⚠ service busy',
    invalid_key: '✕ invalid key', breaker_open: '⚠ breaker open',
    http_5xx: '⚠ 5xx', timeout: '⚠ timeout', network: '⚠ network',
    invalid_json: '⚠ parse error', unknown: '· untested'
  };
  return m[s] || '';
},
healthStyle(s) {
  if (s === 'ok') return 'background:rgba(16,185,129,0.15);color:var(--accent-green);';
  if (s === 'rate_limited' || s === 'breaker_open' || s === 'service_busy')
    return 'background:rgba(245,158,11,0.15);color:var(--accent-amber);';
  if (s === 'invalid_key' || s === 'http_5xx' || s === 'timeout' || s === 'network' || s === 'invalid_json')
    return 'background:rgba(239,68,68,0.15);color:var(--accent-red);';
  if (s === 'unknown') return 'background:rgba(148,163,184,0.15);color:var(--text-muted);';
  return 'display:none;';
},
```

**Analog 4:** `views/settings.html` lines 503-513 (`loadLlmStatus()` — populates `providerHealth` that the new panel reads)

```javascript
async loadLlmStatus() {
  try {
    const res = await authFetch('/api/llm/status');
    if (res.ok) {
      const d = await res.json();
      this.fallbackCount = d.fallback_count || 0;
      this.providerHealth = d.provider_health || {};   // ← this is the data source for the new panel
      this.anyProviderUsable = d.any_provider_usable !== false;
    }
  } catch {}
},
```

**New health panel placement:** Insert a new `<div class="settings-section">` AFTER the closing `</div>` of the existing "AI Providers" `settings-section` (after line 256), still inside `<div x-show="activeTab === 'providers'">`. The new section reads from the existing `providerHealth` Alpine state — no new HTMX fetch needed from Settings (per RESEARCH.md Open Question 2 recommendation).

**New health panel table row pattern** (Claude's discretion — mirrors existing badge style):
```html
<!-- Health panel: table row for each provider -->
<!-- providerHealth is keyed by provider name: { nvidia: {status, last_error_msg, last_success_at, ...}, ... } -->
<template x-for="name in ['nvidia', 'groq', 'gemini', 'deepseek']" :key="'hp-'+name">
  <tr>
    <td style="font-weight:600;text-transform:capitalize;padding:6px 8px;" x-text="name"></td>
    <td style="padding:6px 8px;">
      <span :style="'font-size:11px;padding:2px 8px;border-radius:4px;' + healthStyle((providerHealth[name] || {}).status)"
            x-text="healthLabel((providerHealth[name] || {}).status || 'unknown')"></span>
    </td>
    <td style="font-size:11px;color:var(--text-muted);padding:6px 8px;"
        x-text="(providerHealth[name] && providerHealth[name].last_error_msg)
                  ? providerHealth[name].last_error_msg.slice(0,60) + (providerHealth[name].last_error_msg.length > 60 ? '…' : '')
                  : '—'">
    </td>
    <td style="font-size:11px;color:var(--text-muted);padding:6px 8px;"
        x-text="(providerHealth[name] && providerHealth[name].last_success_at) ? smartTime(providerHealth[name].last_success_at) : '—'">
    </td>
    <template x-if="(providerHealth[name] || {}).status === 'invalid_key'">
      <td style="padding:6px 8px;">
        <a :href="'/settings#provider-key-' + name"
           style="font-size:11px;color:var(--accent-amber);text-decoration:none;">
          Check your API key →
        </a>
      </td>
    </template>
    <template x-if="(providerHealth[name] || {}).status !== 'invalid_key'">
      <td></td>
    </template>
  </tr>
</template>
```

**failed_count display** (D-07 — shown below the table, reads from existing `llmStatus` Alpine state which already has `failed_count` from `/api/llm/status`):
- `failbackCount` is already in `settingsApp()` state (settings.html:458: `fallbackCount: 0`)
- For `failed_count` specifically, check if it comes through `loadLlmStatus()` — the `/api/llm/status` endpoint at api.js:1421 already returns `failed_count`. If `loadLlmStatus()` is updated to also store `this.failedCount = d.failed_count || 0`, the panel can render `<span x-text="failedCount"></span> emails exhausted retries`.

---

### `views/dashboard.html` — HTMX-polled pill div above `#email-list`

**Analog 1:** `views/dashboard.html` lines 152-192 (email-list-panel structure — insertion point)

**Current email-list-panel structure** (dashboard.html:152-192):
```html
<section class="email-list-panel">

  <!-- Panel Header with search -->
  <div class="panel-header">
    <input class="search-input" ... hx-get="/api/emails" ...>
    ...
  </div>

  <!-- Email List -->
  <div id="email-list"
       hx-get="/api/emails?folder=INBOX&category=all"
       hx-trigger="load, categoryChange from:body, refresh"
       hx-swap="innerHTML"
       style="flex:1;overflow-y:auto;">
    ...
  </div>

</section>
```

**Insertion point:** Between the closing `</div>` of `.panel-header` (line 174) and the opening `<div id="email-list"` (line 177). Insert:
```html
<!-- AI degraded pill — polled every 30s; server returns "" when all providers ok (D-02, D-04) -->
<!-- hx-swap="innerHTML" keeps the wrapper div in DOM so polling continues (Pitfall 3) -->
<div hx-get="/api/llm/health/pill"
     hx-trigger="load, every 30s"
     hx-swap="innerHTML">
</div>
```

**Analog 2:** `views/dashboard.html` lines 34-64 (existing Alpine banners — shows pattern for conditional top-of-panel notices using CSS variable colors)

**Existing banner color pattern** (dashboard.html:35, 50):
```html
<!-- amber banner: background:rgba(245,158,11,0.12); border-bottom:1px solid rgba(245,158,11,0.35) -->
<!-- red banner:   background:rgba(239,68,68,0.12);  border-bottom:1px solid rgba(239,68,68,0.35)  -->
```

The pill endpoint uses `rgba(245,158,11,0.1)` (amber fill) and `rgba(245,158,11,0.3)` (amber border) — consistent with the existing amber banner convention. No Alpine needed for the pill itself.

**End-user language constraint (D-03, specifics):** Pill text must be exactly `"AI features degraded"`. Never expose provider names, "circuit breaker", or "rate limited" in the pill.

---

### `tests/llm/router.test.js` — new test cases for soft-failure cascade

**Analog:** `tests/llm/router.test.js` lines 1-252 (existing test file — the complete pattern to extend)

**Test file header pattern** (router.test.js:1-13 — DB isolation setup used by all tests in this file):
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// DB isolation — set BEFORE requiring src/db or src/llm/router
const dbPath = path.join(__dirname, '..', '..', 'intellimail-router-test.db');
process.env.DB_PATH = dbPath;

test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch (_) {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch (_) {} });

const { createRouter } = require('../../src/llm/router');
```

**`fake()` helper pattern** (router.test.js:15-20 — used by ALL existing tests, copy exactly):
```javascript
function fake(name, impl) {
  return {
    name, defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: impl
  };
}
```

**`getConfig` pattern for two-provider cascade** (router.test.js:39-46):
```javascript
const r = createRouter({
  providers: [a, b],
  getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
});
const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
assert.equal(out._provider, 'b');
```

**Breaker-not-tripped assertion pattern** (router.test.js:90-106 — copy structure for "breaker not tripped on soft_fail" test):
```javascript
// Existing pattern: 5 calls to a provider that throws 429 — breaker must NOT trip
let calls = 0;
const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
  call: async () => { calls++; const e = new Error('rate'); e.status = 429; throw e; } };
// ...
for (let i = 0; i < 5; i++) {
  await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
}
assert.equal(calls, 5, 'every call should still reach a (breaker not tripped on 429)');
```

**New tests to add** (4 tests, each using `fake()` and the standard `createRouter` pattern):
1. `'router cascades on soft failure (null category)'` — provider returns `{ category: null, summary: 'ok', ... }`, assert `out._provider === 'b'`
2. `'router cascades on soft failure (empty summary)'` — provider returns `{ category: 'fyi', summary: '', ... }`, assert `out._provider === 'b'`
3. `'router does NOT cascade on low_confidence alone'` — provider returns valid category+summary with `low_confidence: true`, assert `out._provider === 'a'` (not cascaded)
4. `'router does NOT trip breaker on soft_fail'` — 4 calls with provider returning null category, assert call count is 4 (breaker never tripped)

**For llm_logs soft_fail row test** — follow the exact DB-seeding pattern of the existing `'classify inserts row into llm_logs on success'` test (router.test.js:197-223): insert user + email into DB, call `r.classify()`, query `llm_logs WHERE outcome = 'soft_fail'`.

---

### `tests/api/health.test.js` — NEW file for health endpoint tests

**Analog:** `tests/api/scoping.test.js` (same directory, same Express + node:test + HTTP helper pattern)

**File setup pattern** (scoping.test.js:1-13 — copy exactly, change db filename):
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET_PATH = path.join(__dirname, '..', '..', 'data-test-health', 'jwt.secret');
process.env.DB_PATH = path.join(__dirname, '..', '..', 'intellimail-health-test.db');
try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}
```

**Express test app pattern** (scoping.test.js:22-32):
```javascript
function app() {
  const a = express();
  a.use(express.json());
  a.get('/api/emails/:id', requireAuth, (req, res) => { ... });
  return a;
}
```

**HTTP request helper** (scoping.test.js:34-48 — copy verbatim, this is the project's standard HTTP test helper):
```javascript
function request(application, method, url, token) {
  return new Promise((resolve) => {
    const server = application.listen(0, () => {
      const port = server.address().port;
      const req = require('http').request({
        method, hostname: 'localhost', port, path: url,
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        });
      });
      req.end();
    });
  });
}
```

**Auth token pattern** (scoping.test.js:55 — create a real user + JWT, not a mock):
```javascript
const { signToken } = require('../../src/auth');
// ...seed user into db...
const tok = signToken(userId, 'test@test.com');
```

**Tests to implement in health.test.js:**
1. `GET /api/llm/health` returns 401 without token
2. `GET /api/llm/health` returns `{ providers: {...}, failed_count: N }` shape with valid token
3. `GET /api/llm/health/pill` returns empty string when no degraded providers
4. `GET /api/llm/health/pill` returns amber pill HTML when a provider has non-ok status

For tests 3 and 4: the test app's route handler must inject a mock `llm.router.getProviderHealth` that returns controllable health data. The simplest approach is to mount the route inline in the test app (rather than importing all of `api.js`) and inject a mock `getProviderHealth` function.

---

### `tests/server.test.js` — NEW file for startup warmup test

**Analog:** `tests/llm/router.test.js` lines 1-11 (node:test framework setup — same pattern)

**Framework setup** (no DB isolation needed for this test):
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
```

**Test strategy for `setTimeout` warmup:**
The `init()` function in `server.js` uses the real `setTimeout`. To test that `classifyAllUnclassifiedForUser` is NOT called immediately and IS called after the delay, the test must either:
- Use Node.js built-in `timers/promises` with fake timers (Node 24 supports `mock.timers`), OR
- Inject a `classifyAllUnclassifiedForUser` spy by refactoring `init()` to accept dependencies

The simplest approach consistent with the codebase: extract the core of `init()` into a testable function that accepts `classifyFn` and `syncFn` as parameters, or test by checking that the function has NOT been called synchronously after `init()` returns, then advancing fake timers.

**Node.js 24 fake timer pattern** (no external dependency):
```javascript
test('classifyAllUnclassifiedForUser is not called immediately on init', async () => {
  const { mock } = require('node:test');  // Node 24 built-in mock
  mock.timers.enable(['setTimeout']);

  let classifyCalled = false;
  // ... call init() with injected classify spy ...
  assert.equal(classifyCalled, false, 'classify should not run immediately');

  mock.timers.tick(30000);
  assert.equal(classifyCalled, true, 'classify should run after 30s tick');

  mock.timers.reset();
});
```

---

## Shared Patterns

### Auth Guard
**Source:** `src/server.js` lines 69-81
**Apply to:** `GET /api/llm/health` and `GET /api/llm/health/pill`
```javascript
// Global middleware — automatically applies to ALL /api/* not in PUBLIC_API_PATHS.
// Do NOT add requireAuth explicitly to the new routes (it's already covered).
// Do NOT add the new routes to PUBLIC_API_PATHS.
const PUBLIC_API_PATHS = new Set([
  '/api/auth/signup', '/api/auth/login', '/api/auth/logout', '/api/auth/check',
  '/api/users/any',
  '/api/account/test-imap', '/api/account/test-smtp', '/api/account/test'
]);
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  return requireAuth(req, res, next);
});
```

### XSS-Safe HTML Rendering
**Source:** `src/routes/api.js` lines 21-29
**Apply to:** Any server-rendered HTML fragment that includes `last_error_msg` or other provider-returned strings
```javascript
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Usage: escHtml(h.last_error_msg)  — never trust LLM provider error strings as safe HTML
```

### Relative Timestamp Display
**Source:** `src/routes/api.js` lines 43-57
**Apply to:** `last_success_at` display in the Settings health panel
```javascript
function smartTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH  = Math.floor(diffMs / 3600000);
  const diffD  = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24)  return `${diffH}h ago`;
  if (diffD === 1) return 'Yesterday';
  if (diffD < 7)   return `${diffD}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
```

### HTMX Polling Pattern
**Source:** `views/dashboard.html` lines 177-181 and `src/routes/api.js` lines 301-302
**Apply to:** Dashboard pill div and any Settings panel HTMX polling
```html
<!-- Use hx-swap="innerHTML" (NOT "outerHTML") for the wrapper div.
     outerHTML removes the element on empty response, stopping future polls. (Pitfall 3) -->
<div hx-get="/api/endpoint"
     hx-trigger="load, every 30s"
     hx-swap="innerHTML">
</div>
```

### llm_logs INSERT Pattern
**Source:** `src/llm/router.js` lines 115-119
**Apply to:** The new `soft_fail` INSERT in `_callProviders()`
```javascript
try {
  db.prepare(
    "INSERT INTO llm_logs (ts, provider, user_id, email_id, token_count, outcome, latency_ms) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)"
  ).run(name, userId != null ? userId : null, email.id, tokenCount, 'soft_fail', Date.now() - start);
} catch (_) {}
// Wrapped in try/catch — log failures must never crash the classify path
```

---

## No Analog Found

None. All 8 files have direct analogs in the codebase.

---

## Metadata

**Analog search scope:** `src/llm/`, `src/routes/`, `src/`, `views/`, `tests/`
**Files read:** `src/llm/router.js`, `src/server.js`, `src/routes/api.js` (lines 1-57, 280-320, 1355-1426), `views/dashboard.html` (lines 30-192), `views/settings.html` (lines 155-256, 455-513), `tests/llm/router.test.js`, `tests/api/scoping.test.js`, `src/llm/providers/base.js` (lines 1-30)
**Pattern extraction date:** 2026-05-15
