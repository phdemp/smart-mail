# Phase 4: Provider Observability - Research

**Researched:** 2026-05-15
**Domain:** Node.js/Express health endpoint, HTMX polling UI, circuit-breaker soft-failure validation, startup warmup delay
**Confidence:** HIGH (all findings verified directly from codebase)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Dashboard Degraded Pill (D-01 through D-04)**
- D-01: Pill appears when ANY provider (not just primary) has a non-ok status (rate_limited, breaker_open, invalid_key, service_busy). Threshold: one or more non-ok providers.
- D-02: Pill sits at the TOP of the email list panel, above the inbox header — same zone as SSE notifications. Does not block reading flow but is immediately visible.
- D-03: Clicking the pill navigates to Settings > AI Providers section directly. Actionable, not informational-only.
- D-04: Pill is rendered via an HTMX fragment polled every 30 seconds — same cadence as the Settings health panel. No SSE dependency.

**Settings Health Panel (D-05 through D-08)**
- D-05: Provider rows always shown (all 4 providers in the cascade). Unknown status (never used) renders a grey dot + "No activity yet" text. Not hidden, not falsely green.
- D-06: Invalid_key (red) state shows a small "Check your API key →" hint link pointing to the relevant Settings key-config section. One link per red row, not a modal.
- D-07: Panel includes `failed_count` — the number of emails that exhausted retries and landed as `source='failed'`. Already available from the existing `/api/llm/status` endpoint logic. Shown below the per-provider status table.
- D-08: HTMX polls the health endpoint every 30 seconds. The HTMX `hx-trigger="load, every 30s"` pattern is already established in the codebase.

**Startup Warmup Delay (D-09 through D-10)**
- D-09: The delay wraps `classifyAllUnclassifiedForUser(u.id)` in `server.js init()` with `setTimeout(fn, 30000)`. Hard-coded 30 seconds — not configurable. Emails arriving during the warmup window are queued normally via `on-receive` hooks; only the startup flush is delayed.
- D-10: No global "warming up" flag in `classifier.js`. The delay is the minimum-touch implementation — one `setTimeout` in `init()`. The 3-attempt cap (INFRA-02) already prevents runaway retries on newly arriving emails.

**Soft-Failure Cascade (D-11 through D-13)**
- D-11: Cascade triggers when the parsed LLM result has: `category` is null OR `category` is not in the valid CATEGORIES enum, OR `summary` is null/empty string. `low_confidence` is NOT a soft-failure trigger.
- D-12: Soft-failure logs `outcome: 'soft_fail'` to `llm_logs`. This is a new outcome value distinct from `'error'` (HTTP/network failure) and `'success'`. The `llm_logs.outcome` column is TEXT — no migration needed.
- D-13: Soft failures do NOT trip the circuit breaker (`br.fails` is not incremented). A malformed 200 is a parse/content issue, not a provider availability issue.

### Claude's Discretion
- Color values for green/amber/red status dots (use CSS variables consistent with existing badge styles)
- Exact HTML structure of the health panel table (match existing Settings section layout)
- Error message truncation implementation (substring to 60 chars, append "…" if truncated)
- Order of columns in the health panel table
- Whether to expose `last_success_at` as a relative timestamp ("2 min ago") or ISO string

### Deferred Ideas (OUT OF SCOPE)
- Per-provider soft-failure rate tracking (e.g., "NVIDIA returned 15 malformed responses today") — would require aggregating llm_logs; belongs in a future analytics phase.
- Email notification when all providers enter breaker_open simultaneously — out of scope for this phase.
- Configurable warmup delay — deferred; hard-coded 30s is sufficient.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OBSERVE-01 | `GET /api/llm/health` endpoint returns per-provider health data already computed by `router.js` (`getProviderHealth(userId)`) — requires no new computation, only an endpoint and auth guard | `getProviderHealth()` already exists at router.js:182-203; `/api/llm/status` at api.js:1358 is the model to follow for auth and router import pattern |
| OBSERVE-02 | Structured JSON logging added to `classifier.js` so every LLM call emits `{ provider, user_id, email_id, token_count, outcome, latency_ms }` — prerequisite for the health UI to show real data | `router.js` already does this logging at lines 114 and 123; `classifier.js` uses `router.classify()` but the log is emitted inside the router, so OBSERVE-02 is largely already complete — verify whether classifier.js needs any additional logging |
| OBSERVE-03 | A provider health panel in Settings displays color-coded status per provider (green = ok, amber = rate_limited / service_busy, red = invalid_key / breaker_open), last error message truncated to 60 chars, last success timestamp — polled via HTMX every 30 seconds | `healthLabel()` and `healthStyle()` already exist in settings.html:461-478; the AI Providers tab already shows health badges per provider inline; the new health panel is an additional dedicated subsection below the existing key config |
| OBSERVE-04 | A single amber pill "AI features degraded" appears on the dashboard when any provider is in a non-ok state — end users see this, not per-provider detail | Dashboard email-list panel is at dashboard.html:152-192; pill inserts above `<div id="email-list">` via a new HTMX-polled fragment; existing Alpine banners (lines 34-64) show a model for conditional top-of-panel notices |
| OBSERVE-05 | On server startup, classification queue processing is delayed 30–60 seconds (warm-up probe) to prevent a burst of retry errors when a provider was mid-outage at restart | `init()` in server.js:92-98 calls `classifyAllUnclassifiedForUser(u.id)` directly; wrapping in `setTimeout(() => ..., 30000)` is a one-line change |
| OBSERVE-06 | Post-parse semantic validation in the router triggers cascade fallback on soft failures (null or invalid category after parsing, empty summary) — not just HTTP errors | Injection point is in `_callProviders()` at router.js:120 after `mapResult(parsed, name)` is about to be returned; condition is `!CATEGORIES.includes(parsed.category) \|\| !parsed.summary` |
</phase_requirements>

---

## Summary

Phase 4 is an observability and reliability hardening phase that adds zero new database tables. Every piece of state the UI needs already exists in-memory (`breakers` Map in `router.js`) and in the `llm_logs` table (already created in Phase 2). The implementation is a thin wire-up of existing data to new consumers: a health API endpoint, two UI fragments (Settings panel and dashboard pill), a startup delay, and a soft-failure validation gate in the router.

The largest risk is the soft-failure cascade (OBSERVE-06): injection into `_callProviders()` must happen at the right moment — after parsing succeeds but before the result is returned to the caller. The current code at router.js:120 returns `mapResult(parsed, name)` immediately after a successful HTTP call; the validation check and `soft_fail` log must be inserted between the parse and the return. Getting this wrong (e.g., triggering the check on results that went through `mapResult` already) would cause incorrect cascade behavior.

All UI fragments use HTMX polling (`hx-trigger="load, every 30s"`) — the exact pattern already used in the codebase for sync status (`/api/sync/status`) and sidebar updates. The Settings page already renders inline health badges per provider using `healthLabel()` and `healthStyle()` helper functions (settings.html:461-478); the new dedicated health panel is a structured table view of the same data, positioned as a new `settings-section` div below the existing key config section.

**Primary recommendation:** Implement in four discrete units — (1) `/api/llm/health` endpoint + `/api/llm/health/pill` endpoint, (2) Settings health panel HTML fragment, (3) dashboard pill HTML fragment, (4) router.js soft-failure gate + server.js warmup delay. Each unit can be tested in isolation.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Health state computation | API / Backend (`router.js`) | — | Circuit-breaker state lives in the `breakers` Map, server-side only. No client involvement. |
| `/api/llm/health` endpoint | API / Backend (`api.js`) | — | Thin wrapper around `getProviderHealth(userId)`. Auth via existing `requireAuth` middleware. |
| `/api/llm/health/pill` endpoint | API / Backend (`api.js`) | — | Returns HTML fragment for HTMX consumption. Server-side rendering matches existing pattern. |
| Settings health panel display | Frontend Server (SSR HTML via `api.js`) | Client (HTMX polling) | Settings page is an Alpine.js SPA; the health panel is a new `settings-section` inside the existing providers tab — Alpine already holds `providerHealth` state populated from `/api/llm/status`; the new panel can source from the same or from the dedicated `/api/llm/health` endpoint. |
| Dashboard degraded pill | Frontend Server (SSR HTML via `api.js`) | Client (HTMX polling) | An HTMX-polled `<div>` above the email list returns an amber pill HTML fragment or empty string. No Alpine dependency needed for the pill itself. |
| Soft-failure cascade | API / Backend (`router.js`) | — | Post-parse validation inserted into `_callProviders()`. Logs `soft_fail` to `llm_logs`. Does not surface to client. |
| Startup warmup delay | API / Backend (`server.js`) | — | One `setTimeout` in `init()`. No client or database involvement. |

---

## Standard Stack

### Core (all already in use — no new installs required)
[VERIFIED: direct codebase inspection]

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express | 4.18.x | HTTP routing for new endpoints | Already used for all API routes in `api.js` |
| HTMX | 1.9.12 | Polling health endpoint every 30s | Already loaded in `dashboard.html` and `settings.html` |
| Alpine.js | 3.x | Settings page reactive state (`providerHealth`) | Already used in `settingsApp()` and dashboard `appState()` |
| better-sqlite3 | 12.6.x | Query `failed_count` from classifications | Already used for all DB queries |
| Node.js built-in `node:test` | 24.x | Test framework for new router tests | Already used in `tests/llm/router.test.js` |

**No new packages to install.** This phase is entirely implemented with existing dependencies.

### Existing Helpers to Reuse
[VERIFIED: direct codebase inspection, api.js lines 21-29, 34-41]

| Helper | Location | Reuse Purpose |
|--------|----------|---------------|
| `escHtml(str)` | `api.js:21` | XSS-safe rendering of `last_error_msg` in the health panel |
| `smartTime(dateStr)` | `api.js:43` | Render `last_success_at` as "2 min ago" for operator display |
| `requireAuth` | `middleware/auth.js` | Auth-guard the `/api/llm/health` endpoint |
| `healthLabel(s)` | `settings.html:461` | Already maps status strings to display labels — reuse in Settings panel |
| `healthStyle(s)` | `settings.html:470` | Already maps status to CSS inline styles — reuse in Settings panel |
| `CATEGORIES` | `llm/providers/base.js:6` | Soft-failure validation: `CATEGORIES.includes(parsed.category)` |

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (HTMX poll every 30s)
  │
  ├─ GET /api/llm/health/pill ─────────────────────────────────────────────────┐
  │    │                                                                        │
  │    │  [dashboard.html email-list-panel]                                     │
  │    └──► Returns: <empty> | <amber pill "AI features degraded" → /settings#providers>
  │
  ├─ GET /api/llm/health ──────────────────────────────────────────────────────┐
  │    │                                                                        │
  │    │  [settings.html providers tab — health panel section]                  │
  │    └──► Returns: JSON { providers: {...}, failed_count: N }
  │              │
  │              └── llm.router.getProviderHealth(userId) ── breakers Map (in-memory)
  │                  db.query(failed_count) ── classifications table
  │
On email classify (existing flow, modified):
  │
  classifier.js ──► router._callProviders() ──► provider.call()
                                │
                                ├── HTTP error ──► classifyError() ──► br.fails++ (existing)
                                │                  log outcome='error' to llm_logs
                                │
                                └── HTTP 200 ──► parseProviderResponse()
                                                  │
                                                  ├── category valid AND summary non-empty
                                                  │   ──► mapResult() ──► return to caller (existing)
                                                  │
                                                  └── category invalid OR summary empty  [NEW]
                                                      ──► log outcome='soft_fail' to llm_logs
                                                      ──► continue (try next provider)

On server startup:
  init() ──► [30s setTimeout] ──► classifyAllUnclassifiedForUser(u.id)
```

### Recommended Project Structure (no new files needed for most tasks)

```
src/
  llm/
    router.js          — soft-failure gate added to _callProviders() (OBSERVE-06)
  routes/
    api.js             — two new routes: GET /api/llm/health, GET /api/llm/health/pill (OBSERVE-01)
  server.js            — setTimeout warmup in init() (OBSERVE-05)
views/
  settings.html        — new health panel section in providers tab (OBSERVE-03)
  dashboard.html       — HTMX-polled pill div above #email-list (OBSERVE-04)
tests/
  llm/
    router.test.js     — new test cases for soft-failure cascade
  api/
    health.test.js     — new test file for /api/llm/health endpoint
```

### Pattern 1: New API Endpoint (OBSERVE-01)
**What:** Thin wrapper around `getProviderHealth()` — auth-guarded, user-scoped.
**When to use:** Anytime health data is needed by an HTMX polling consumer.

```javascript
// Source: verified from api.js:1357-1426 (/api/llm/status pattern)
router.get('/api/llm/health', (req, res) => {
  const llm = require('../llm');
  const health = llm.router.getProviderHealth(req.user.id) || {};
  const failedCount = db.prepare(
    "SELECT COUNT(*) as n FROM classifications WHERE user_id = ? AND source = 'failed'"
  ).get(req.user.id).n;
  res.json({ providers: health, failed_count: failedCount });
});
```

The `requireAuth` guard is already applied globally at `server.js:74-81` — any route under `/api/` that is not in `PUBLIC_API_PATHS` is automatically auth-guarded. No per-route `requireAuth` call is needed. [VERIFIED: server.js:70-81]

### Pattern 2: HTMX Pill Fragment Endpoint (OBSERVE-04)
**What:** Returns an HTML fragment (amber pill or empty string). HTMX swaps it into the dashboard above `#email-list`.
**When to use:** End-user facing; never exposes provider names or circuit-breaker terminology.

```javascript
// Source: verified from sync status HTMX partial (api.js:299-316)
router.get('/api/llm/health/pill', (req, res) => {
  const llm = require('../llm');
  const health = llm.router.getProviderHealth(req.user.id) || {};
  const anyDegraded = Object.values(health).some(
    h => h.status && h.status !== 'ok' && h.status !== 'unknown'
  );
  if (!anyDegraded) return res.send('');
  res.send(`
    <div style="padding:8px 16px;background:rgba(245,158,11,0.1);border-bottom:1px solid rgba(245,158,11,0.3);font-size:12px;display:flex;align-items:center;gap:8px;">
      <span style="color:var(--accent-amber);">⚠</span>
      <span style="color:var(--text-primary);">AI features degraded</span>
      <a href="/settings#providers" style="color:var(--accent-amber);font-size:11px;margin-left:auto;text-decoration:none;">View status →</a>
    </div>
  `);
});
```

### Pattern 3: Dashboard Pill Insertion Point (OBSERVE-04)
**What:** Where in `dashboard.html` the HTMX polling div lives.
**When to use:** Must be placed between `.panel-header` and `#email-list`.

```html
<!-- Source: verified from dashboard.html:152-192 (email-list-panel structure) -->
<section class="email-list-panel">

  <!-- Panel Header with search -->
  <div class="panel-header"><!-- ... existing search input ... --></div>

  <!-- NEW: AI degraded pill (polled every 30s, server returns "" when all ok) -->
  <div hx-get="/api/llm/health/pill"
       hx-trigger="load, every 30s"
       hx-swap="innerHTML">
  </div>

  <!-- Email List -->
  <div id="email-list" ...><!-- ... existing content ... --></div>

</section>
```

### Pattern 4: Soft-Failure Gate in `_callProviders()` (OBSERVE-06)
**What:** Post-parse validation after a provider returns HTTP 200. If the parsed result is semantically invalid, log `soft_fail` and fall through to the next provider WITHOUT tripping the circuit breaker.
**When to use:** Replaces the current `return mapResult(parsed, name)` at router.js:120.

```javascript
// Source: verified from router.js:94-120 — current success path
// CURRENT (router.js:120):
//   return mapResult(parsed, name);
//
// REPLACE WITH (D-11, D-12, D-13):
const isSoftFail = !CATEGORIES.includes(parsed.category) || !parsed.summary || parsed.summary.trim() === '';
if (isSoftFail) {
  log({ provider: name, mode, outcome: 'soft_fail', latency_ms: Date.now() - start, email_id: email.id, user_id: userId, token_count: tokenCount });
  try {
    db.prepare(
      "INSERT INTO llm_logs (ts, provider, user_id, email_id, token_count, outcome, latency_ms) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)"
    ).run(name, userId != null ? userId : null, email.id, tokenCount, 'soft_fail', Date.now() - start);
  } catch (_) {}
  // Do NOT increment br.fails — soft fail is a content issue, not a provider availability issue (D-13)
  // Reset success state is NOT changed either — keep last_success_at as-is
  continue;  // Try next provider
}
// Only reach here if result is semantically valid
return mapResult(parsed, name);
```

**Critical note:** The `CATEGORIES` import is already present at the top of `classifier.js` but NOT in `router.js`. The router must import `CATEGORIES` from `./providers/base` to perform this check. [VERIFIED: router.js:1 — only imports `parseProviderResponse, DEFAULTS, SYSTEM_PROMPT`; `CATEGORIES` must be added to this import]

### Pattern 5: Startup Warmup Delay (OBSERVE-05)
**What:** Wraps the startup classification flush in a 30-second setTimeout.
**When to use:** Applied only to the startup flush — not to the on-receive classification path.

```javascript
// Source: verified from server.js:92-98
// CURRENT:
async function init() {
  const users = db.prepare('SELECT id FROM users').all();
  for (const u of users) {
    classifyAllUnclassifiedForUser(u.id);   // ← immediate call
    startSyncForUser(u.id);
  }
}

// REPLACE WITH (D-09):
async function init() {
  const users = db.prepare('SELECT id FROM users').all();
  for (const u of users) {
    startSyncForUser(u.id);                 // IMAP sync starts immediately
  }
  // Delay startup classification flush 30s to absorb post-restart provider instability
  setTimeout(() => {
    for (const u of users) {
      classifyAllUnclassifiedForUser(u.id);
    }
  }, 30000);
}
```

Note: `startSyncForUser` is moved before the timeout so IMAP sync begins immediately, which is the correct order. New emails received during the 30s warmup are queued via the `on-receive` hook (normal path), not via the startup flush.

### Pattern 6: Settings Health Panel (OBSERVE-03)
**What:** A new `settings-section` div inside the AI Providers tab, placed after the existing provider key config rows. Uses HTMX polling to refresh the data.
**Implementation options:**
- Option A (pure HTMX): Add a new `<div hx-get="/api/llm/health" hx-trigger="load, every 30s">` that fetches a rendered HTML fragment.
- Option B (Alpine): Extend `loadLlmStatus()` in `settingsApp()` to populate a new `providerHealthDetailed` object rendered by Alpine template.

Option B is preferred because `providerHealth` data is already loaded into Alpine's `settingsApp()` state via `loadLlmStatus()` (settings.html:503-513). The health panel can use the same data without a second HTTP request. [VERIFIED: settings.html:459, 503-513]

### Anti-Patterns to Avoid

- **Exposing circuit-breaker terminology to end users:** The dashboard pill must say "AI features degraded", never "circuit breaker", "rate limited", or provider names. This is explicitly required in CONTEXT.md specifics.
- **Calling `requireAuth` explicitly on the new routes:** The global middleware in `server.js:74-81` already applies `requireAuth` to all `/api/` routes not in `PUBLIC_API_PATHS`. Adding it again is redundant but harmless — just follow the pattern of the existing `/api/llm/status` route which does NOT add `requireAuth` explicitly.
- **Incrementing `br.fails` on soft failures:** CONTEXT.md D-13 explicitly prohibits this. The circuit breaker tracks provider availability; a malformed 200 is not an availability failure.
- **Importing `CATEGORIES` into router.js without updating the require statement at line 1:** The current import is `const { parseProviderResponse, DEFAULTS, SYSTEM_PROMPT } = require('./providers/base');` — `CATEGORIES` must be added here.
- **Putting the warmup timeout after `startSyncForUser`:** IMAP sync should begin immediately; only the classification flush is delayed. The timeout must not wrap `startSyncForUser`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Health status color coding | Custom CSS class logic | Existing `healthStyle(s)` and `healthLabel(s)` in `settings.html` | Already covers all 8 status strings with correct color semantics |
| Error message sanitization for HTML display | Custom escaping | `escHtml()` at `api.js:21` | Full HTML entity escaping including `&`, `<`, `>`, `"`, `'` |
| Relative time display ("2 min ago") | Custom time formatting | `smartTime()` at `api.js:43` | Already handles minutes/hours/days with locale-aware formatting |
| Auth checking on new routes | Per-route middleware | Global middleware in `server.js:74-81` | Already applied to all `/api/*` routes |
| `failed_count` query | New query | Copy the exact query from `/api/llm/status` at api.js:1421 | `SELECT COUNT(*) as n FROM classifications WHERE user_id = ? AND source = 'failed'` is already correct |
| HTMX polling setup | Custom JS polling | `hx-trigger="load, every 30s"` attribute | HTMX 1.9.12 already loaded; this is the established project pattern |

---

## Common Pitfalls

### Pitfall 1: `CATEGORIES` not imported in router.js
**What goes wrong:** `CATEGORIES.includes(parsed.category)` throws `ReferenceError: CATEGORIES is not defined` at runtime.
**Why it happens:** `router.js` currently imports only `{ parseProviderResponse, DEFAULTS, SYSTEM_PROMPT }` from `./providers/base`. `CATEGORIES` is exported from the same file but not currently destructured in the router.
**How to avoid:** Update the import at router.js:1 to `const { parseProviderResponse, DEFAULTS, SYSTEM_PROMPT, CATEGORIES } = require('./providers/base');`
**Warning signs:** Tests for soft-failure cascade fail with ReferenceError, not assertion error.

### Pitfall 2: Soft-failure check position — checking `mapResult` output instead of `parsed`
**What goes wrong:** `mapResult` for `classify` is `(parsed, name) => ({ ...parsed, _provider: name })`, so the check would work there too — but for `generateDraft`, `mapResult` is `(parsed, name) => ({ draft_reply: parsed.draft_reply || null, _provider: name })`. Checking on the mapResult output for draft mode would fail to find `category`.
**Why it happens:** The validation is called from the shared `_callProviders()` function used by both `classify` and `generateDraft`.
**How to avoid:** Check `parsed` (the output of `parseProviderResponse`) BEFORE calling `mapResult`, not after. The `parsed` object always has `category` and `summary` fields regardless of mode. Only apply the soft-failure check when `mode !== 'draft'` since draft generation does not produce a `category` field.
**Warning signs:** `generateDraft` begins cascading on all providers unexpectedly.

**Refined soft-failure condition:**
```javascript
// Only validate semantic correctness for classify mode (not draft mode)
const isSoftFail = mode !== 'draft' &&
  (!CATEGORIES.includes(parsed.category) || !parsed.summary || parsed.summary.trim() === '');
```

### Pitfall 3: Dashboard pill `hx-swap` target conflicts with HTMX indicators
**What goes wrong:** If the pill div uses `hx-swap="outerHTML"`, a successful empty response (`''`) removes the div from the DOM, and the next poll interval never fires.
**Why it happens:** HTMX removes the target element on `outerHTML` swap when the response is empty, then there is no element to poll from.
**How to avoid:** Use `hx-swap="innerHTML"` on the wrapper div. The wrapper div persists; HTMX replaces its contents with either empty string (when all providers are ok) or the amber pill HTML. The wrapper always remains in the DOM for subsequent polling.

### Pitfall 4: Settings health panel timing vs Alpine init
**What goes wrong:** If the health panel depends on Alpine data that is loaded asynchronously, the panel renders before `loadLlmStatus()` completes, showing "No activity yet" for all providers even when health data exists.
**Why it happens:** `settingsApp.init()` calls `loadLlmStatus()` with `await`, but Alpine `x-init` runs the init function asynchronously — there is no loading state for the health panel specifically.
**How to avoid:** Use the existing `providerHealth` object already populated by `loadLlmStatus()`. The Settings page already shows health badges inline in the provider list from this data (settings.html:211-213). The new health panel table simply re-reads the same `providerHealth` object — no additional fetch needed.

### Pitfall 5: `getProviderHealth` returns `unknown` for providers never called
**What goes wrong:** A provider that has never been called has no entry in `breakers` Map, so `getProviderHealth` returns `{ status: 'unknown', ... }` (router.js:186). The pill endpoint must not trigger on `unknown` status — only on explicitly non-ok statuses.
**Why it happens:** Unknown is the default for fresh installs or unused providers.
**How to avoid:** Pill condition: `h.status && h.status !== 'ok' && h.status !== 'unknown'`. Settings panel D-05: render `unknown` as grey dot + "No activity yet" — never as red or amber. [Already per CONTEXT.md D-05]

### Pitfall 6: `soft_fail` outcome breaking existing test assertions in router.test.js
**What goes wrong:** Existing router tests that assert on `outcome` values in `llm_logs` may fail if a test uses a provider that returns a parsed result with an invalid category (which would now trigger `soft_fail` before the result reaches the test's `mapResult`).
**Why it happens:** The existing test providers return `{ category: 'fyi', ... }` which is a valid category — so most existing tests are unaffected. But any test returning `{ category: 'unknown_cat', ... }` or `{}` would now trigger soft-fail cascade.
**How to avoid:** Review existing router tests; ensure all fake providers return valid `category` values from the `CATEGORIES` enum when testing non-error paths. New tests for soft-fail should explicitly use invalid categories.

---

## Code Examples

### Health Endpoint — Minimal Implementation
```javascript
// Source: verified pattern from api.js:1357-1426
router.get('/api/llm/health', (req, res) => {
  const llm = require('../llm');
  const health = llm.router.getProviderHealth(req.user.id) || {};
  const failed = db.prepare(
    "SELECT COUNT(*) as n FROM classifications WHERE user_id = ? AND source = 'failed'"
  ).get(req.user.id).n;
  res.json({ providers: health, failed_count: failed });
});
```

### Error Truncation (Claude's Discretion)
```javascript
// Source: pattern consistent with escHtml usage in api.js
function truncateError(msg, max = 60) {
  if (!msg) return '';
  const s = String(msg);
  return s.length > max ? s.slice(0, max) + '…' : s;
}
// Usage in HTML: escHtml(truncateError(h.last_error_msg))
```

### Settings Health Panel Table Row (OBSERVE-03)
```html
<!-- Source: consistent with existing settings-section layout and healthStyle()/healthLabel() -->
<tr>
  <td style="font-weight:600;text-transform:capitalize;" x-text="name"></td>
  <td>
    <span :style="'font-size:11px;padding:2px 8px;border-radius:4px;' + healthStyle(h.status)"
          x-text="healthLabel(h.status)"></span>
  </td>
  <td style="font-size:11px;color:var(--text-muted);"
      x-text="h.last_error_msg ? h.last_error_msg.slice(0,60) + (h.last_error_msg.length > 60 ? '…' : '') : '—'">
  </td>
  <td style="font-size:11px;color:var(--text-muted);"
      x-text="h.last_success_at ? smartTime(h.last_success_at) : '—'">
  </td>
  <template x-if="h.status === 'invalid_key'">
    <td>
      <a :href="'/settings#provider-key-' + name"
         style="font-size:11px;color:var(--accent-amber);text-decoration:none;">
        Check your API key →
      </a>
    </td>
  </template>
</tr>
```

### Test Pattern for Soft-Failure Cascade
```javascript
// Source: consistent with tests/llm/router.test.js pattern
test('router cascades on soft failure (null category)', async () => {
  let calls = [];
  const a = fake('a', async () => ({ category: null, summary: 'ok', urgency: 'normal', draft_reply: 'r' }));
  const b = fake('b', async () => ({ category: 'fyi', summary: 'good summary', urgency: 'normal', draft_reply: 'r' }));
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.equal(out._provider, 'b');  // 'a' was skipped for soft fail
  assert.equal(out.category, 'fyi');
});

test('router cascades on soft failure (empty summary)', async () => {
  const a = fake('a', async () => ({ category: 'fyi', summary: '', urgency: 'normal', draft_reply: 'r' }));
  const b = fake('b', async () => ({ category: 'legal', summary: 'a summary', urgency: 'urgent', draft_reply: 'r' }));
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.equal(out._provider, 'b');
  assert.equal(out.category, 'legal');
});

test('router does NOT cascade on low_confidence alone (not a soft fail)', async () => {
  const a = fake('a', async () => ({ category: 'fyi', summary: 'ok', urgency: 'normal', low_confidence: true, draft_reply: 'r' }));
  const r = createRouter({
    providers: [a],
    getConfig: () => ({ order: ['a'], enabled: ['a'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.equal(out._provider, 'a');  // low_confidence alone does NOT cascade
});

test('router does NOT trip breaker on soft_fail', async () => {
  let callCount = 0;
  const a = fake('a', async () => {
    callCount++;
    return { category: null, summary: '', urgency: 'normal', draft_reply: 'r' };
  });
  const b = fake('b', async () => ({ category: 'fyi', summary: 'ok', urgency: 'normal', draft_reply: 'r' }));
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  // 4 calls — if breaker tripped after 3 fails, 4th would skip 'a'. It should not.
  for (let i = 0; i < 4; i++) {
    await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  }
  assert.equal(callCount, 4, 'breaker must not trip on soft failures');
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hard error only cascade | Cascade on HTTP errors + soft semantic failures | Phase 4 | Prevents malformed 200 responses silently degrading classification quality |
| Immediate startup classify flush | 30s delayed startup classify flush | Phase 5 | Prevents post-restart retry storms |
| Health data only in `/api/llm/status` | Dedicated `/api/llm/health` + `/api/llm/health/pill` endpoints | Phase 4 | Separation of concerns: status used by Alpine app state; health used by HTMX polling fragments |

**Key observation about OBSERVE-02:** The REQUIREMENTS.md lists OBSERVE-02 as "Structured JSON logging added to `classifier.js`". However, inspecting `router.js:114` and `router.js:123`, structured JSON logging to `llm_logs` is already implemented in the router — it emits `{ provider, user_id, email_id, token_count, outcome, latency_ms }` on every call. The planner should verify whether OBSERVE-02 requires additional logging in `classifier.js` specifically (e.g., before routing), or whether the existing router-level logging satisfies the requirement. If the existing logging already satisfies OBSERVE-02, this requirement may be a verify-only task.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `generateDraft` should not apply soft-failure validation (because it does not produce a `category` field in `mapResult`) | Soft-Failure Cascade Pattern, Pitfall 2 | If draft mode IS supposed to validate (e.g., empty `draft_reply`), the condition must be updated — but CONTEXT.md D-11 only lists `category` and `summary` as triggers, which are classification fields. LOW risk. |
| A2 | The Settings health panel should source data from the existing `providerHealth` Alpine state (already populated by `loadLlmStatus()`) rather than from a new HTMX fetch | Architecture Patterns, Pattern 6 | If the planner prefers a standalone HTMX-polled health section independent of Alpine, the implementation changes to a server-rendered HTML fragment endpoint. Functionally equivalent; the Alpine approach avoids a second HTTP request. |
| A3 | OBSERVE-02 is largely already satisfied by the existing `llm_logs` INSERTs in `router.js` (lines 114-119 and 123-128) | State of the Art | If OBSERVE-02 requires logging in `classifier.js` before it reaches the router (e.g., to capture queue-level events), additional work is needed. Planner should verify. |

---

## Open Questions

1. **Does OBSERVE-02 require classifier-level logging or is router-level logging sufficient?**
   - What we know: `router.js` already logs structured JSON to `llm_logs` on every call. The log schema matches THREAD-06's specification exactly: `{ provider, user_id, email_id, token_count, outcome, latency_ms }`.
   - What's unclear: OBSERVE-02 says "added to `classifier.js`" but the implementation already exists in `router.js`. This may be a documentation artifact from when the logging location was undecided.
   - Recommendation: Treat OBSERVE-02 as a verify-and-confirm task. If the router-level logging satisfies the requirement, the task is "confirm logs are flowing to llm_logs and add `soft_fail` as a new outcome value."

2. **Should the `/api/llm/health` endpoint response shape match `/api/llm/status` `provider_health` key for Alpine compatibility?**
   - What we know: `/api/llm/status` returns `{ ..., provider_health: health }`. The Settings page reads this at `d.provider_health` (settings.html:509). The new `/api/llm/health` returns `{ providers: health, failed_count: N }`.
   - What's unclear: If the Settings health panel reuses Alpine's existing `providerHealth` state (populated from `/api/llm/status`), there's no need to poll `/api/llm/health` from Settings at all — just add the new panel below the existing rows. The `/api/llm/health` endpoint is primarily for the HTMX pill and operator tooling.
   - Recommendation: Settings health panel reads from existing `providerHealth` Alpine state. `/api/llm/health` serves the pill fragment and external tooling only.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code changes with no new external dependencies. All required tools (Node.js 24.11.1, better-sqlite3, Express, HTMX) are already installed and verified operational.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (no vitest — project uses native test runner) |
| Config file | None — uses `"test": "node --test \"tests/**/*.test.js\""` in package.json |
| Quick run command | `node --test "tests/llm/router.test.js"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBSERVE-01 | `/api/llm/health` returns correct shape with auth | unit (mock router) | `node --test "tests/api/health.test.js"` | ❌ Wave 0 |
| OBSERVE-02 | `soft_fail` outcome appears in llm_logs after soft failure | unit | `node --test "tests/llm/router.test.js"` | ✅ (extend) |
| OBSERVE-03 | Settings health panel renders correct color per status | manual (visual) | — | manual-only |
| OBSERVE-04 | Pill returns amber HTML when any provider non-ok; empty when all ok | unit (mock router) | `node --test "tests/api/health.test.js"` | ❌ Wave 0 |
| OBSERVE-05 | `classifyAllUnclassifiedForUser` not called until 30s after init | unit (mock timers) | `node --test "tests/server.test.js"` | ❌ Wave 0 |
| OBSERVE-06 | Router cascades to next provider on null category; on empty summary; does NOT trip breaker; does NOT cascade on low_confidence | unit | `node --test "tests/llm/router.test.js"` | ✅ (extend) |

### Sampling Rate
- **Per task commit:** `node --test "tests/llm/router.test.js"`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/api/health.test.js` — covers OBSERVE-01 (health endpoint shape) and OBSERVE-04 (pill fragment content)
- [ ] `tests/server.test.js` — covers OBSERVE-05 (warmup delay); requires mocking `setTimeout` or using fake timers

*(Existing `tests/llm/router.test.js` covers OBSERVE-02 and OBSERVE-06 with new test cases added in the implementation wave.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireAuth` middleware — already applied globally to all `/api/*` routes in `server.js:74-81` |
| V3 Session Management | no | No new session state introduced |
| V4 Access Control | yes | Health data is user-scoped: `getProviderHealth(req.user.id)` — operators see only their own provider state |
| V5 Input Validation | partial | `last_error_msg` is server-generated, not user input; `escHtml()` is used when rendering it in HTML |
| V6 Cryptography | no | No cryptographic operations in this phase |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via `last_error_msg` in health panel HTML | Tampering | `escHtml()` already in codebase — use it on all dynamic text in HTML fragments |
| Information disclosure via health endpoint (unauthenticated) | Information Disclosure | Global `requireAuth` in server.js covers this automatically; new endpoints must not be added to `PUBLIC_API_PATHS` |
| User A seeing User B's provider health | Elevation of Privilege | `getProviderHealth(req.user.id)` is user-scoped — the `key()` function in router.js prefixes all breaker keys with `userId::providerName` |

**Security note:** The `last_error_msg` field (truncated to 300 chars in router.js:132) contains LLM provider error messages. These may include API quota details or provider-specific error text. This is appropriate for operators (Settings page) but must never be shown in the end-user dashboard pill — the pill must only show "AI features degraded". [VERIFIED: CONTEXT.md specifics section]

---

## Sources

### Primary (HIGH confidence)
All findings in this research are verified directly from the codebase — no external sources were consulted because this phase is entirely implemented within the existing stack.

- `src/llm/router.js` — `getProviderHealth()` at lines 182-203; `_callProviders()` at lines 54-148; existing `llm_logs` INSERT pattern at lines 116-119 and 125-128
- `src/server.js` — `init()` at lines 92-98; global `requireAuth` middleware at lines 74-81; `PUBLIC_API_PATHS` set at lines 70-74
- `src/routes/api.js` — `/api/llm/status` endpoint at lines 1358-1426; `escHtml()` at lines 21-29; `smartTime()` at lines 43-57; HTMX sync status pattern at lines 299-316
- `src/db.js` — `llm_logs` table schema at lines 181-194; `outcome TEXT` column (no migration needed for `soft_fail`)
- `src/llm/providers/base.js` — `CATEGORIES` array at line 6; `DEFAULTS` at lines 13-21; `parseProviderResponse()` at lines 113-138
- `views/dashboard.html` — email-list-panel structure at lines 152-192; existing Alpine banners at lines 34-64
- `views/settings.html` — AI Providers tab at lines 158-313; `healthLabel()` at lines 461-469; `healthStyle()` at lines 470-478; `loadLlmStatus()` at lines 503-513
- `tests/llm/router.test.js` — test patterns at lines 1-140 (test framework and fake provider pattern)
- `src/classifier.js` — `CATEGORIES` import at line 3; queue and retry structure at lines 7-18

### Secondary (MEDIUM confidence)
- HTMX 1.9.12 documentation for `hx-trigger="load, every 30s"` — consistent with existing usage observed in the codebase [ASSUMED: behavior matches observed usage pattern]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified as currently installed and in use
- Architecture: HIGH — all patterns verified from existing working code in the same codebase
- Pitfalls: HIGH — Pitfall 1 (CATEGORIES import) and Pitfall 2 (mapResult vs parsed) are verified code-reading findings, not theoretical concerns
- Test patterns: HIGH — test framework and fake provider pattern verified from `tests/llm/router.test.js`

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (stable brownfield codebase; no external dependencies changing)
