# Phase 4: Provider Observability - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers three things: (1) a `/api/llm/health` endpoint exposing per-provider health state already computed by `router.js`; (2) operator-facing UI in Settings and an end-user amber pill on the dashboard; (3) two reliability fixes — soft-failure semantic validation before accepting LLM results, and a 30-second startup warmup delay to absorb post-restart provider instability.

No new database tables. No new data collection. All state is derived from the in-memory `breakers` Map in `router.js` and the existing `llm_logs` table.

</domain>

<decisions>
## Implementation Decisions

### Dashboard Degraded Pill (D-01 through D-04)
- **D-01:** Pill appears when ANY provider (not just primary) has a non-ok status (rate_limited, breaker_open, invalid_key, service_busy). Threshold: one or more non-ok providers.
- **D-02:** Pill sits at the TOP of the email list panel, above the inbox header — same zone as SSE notifications. Does not block reading flow but is immediately visible.
- **D-03:** Clicking the pill navigates to Settings > AI Providers section directly. Actionable, not informational-only.
- **D-04:** Pill is rendered via an HTMX fragment polled every 30 seconds — same cadence as the Settings health panel. No SSE dependency.

### Settings Health Panel (D-05 through D-08)
- **D-05:** Provider rows always shown (all 4 providers in the cascade). Unknown status (never used) renders a grey dot + "No activity yet" text. Not hidden, not falsely green.
- **D-06:** Invalid_key (red) state shows a small "Check your API key →" hint link pointing to the relevant Settings key-config section. One link per red row, not a modal.
- **D-07:** Panel includes `failed_count` — the number of emails that exhausted retries and landed as `source='failed'`. Already available from the existing `/api/llm/status` endpoint logic. Shown below the per-provider status table.
- **D-08:** HTMX polls the health endpoint every 30 seconds. The HTMX `hx-trigger="load, every 30s"` pattern is already established in the codebase.

### Startup Warmup Delay (D-09 through D-10)
- **D-09:** The delay wraps `classifyAllUnclassifiedForUser(u.id)` in `server.js init()` with `setTimeout(fn, 30000)`. Hard-coded 30 seconds — not configurable. Emails arriving during the warmup window are queued normally via `on-receive` hooks; only the startup flush is delayed.
- **D-10:** No global "warming up" flag in `classifier.js`. The delay is the minimum-touch implementation — one `setTimeout` in `init()`. The 3-attempt cap (INFRA-02) already prevents runaway retries on newly arriving emails.

### Soft-Failure Cascade (D-11 through D-13)
- **D-11:** Cascade triggers when the parsed LLM result has: `category` is null OR `category` is not in the valid CATEGORIES enum, OR `summary` is null/empty string. `low_confidence` is NOT a soft-failure trigger — it is a valid (if uncertain) result.
- **D-12:** Soft-failure logs `outcome: 'soft_fail'` to `llm_logs`. This is a new outcome value distinct from `'error'` (HTTP/network failure) and `'success'`. The `llm_logs.outcome` column is TEXT — no migration needed.
- **D-13:** Soft failures do NOT trip the circuit breaker (`br.fails` is not incremented). A malformed 200 is a parse/content issue, not a provider availability issue. The cascade tries the next provider without penalizing the current one.

### Claude's Discretion
- Color values for green/amber/red status dots (use CSS variables consistent with existing badge styles)
- Exact HTML structure of the health panel table (match existing Settings section layout)
- Error message truncation implementation (substring to 60 chars, append "…" if truncated)
- Order of columns in the health panel table
- Whether to expose `last_success_at` as a relative timestamp ("2 min ago") or ISO string

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Router and health state
- `src/llm/router.js` — `getProviderHealth(userId)` (lines 181-205) — already computes per-provider status; health endpoint wraps this. `_callProviders()` is where soft-failure validation must be injected (line ~50-130).

### Server startup and classification queue
- `src/server.js` — `init()` function — `classifyAllUnclassifiedForUser(u.id)` call is the target of the 30s warmup delay. `broadcast()` function wiring is the model for any new SSE event.

### Existing endpoints and UI patterns
- `src/routes/api.js` — `/api/llm/status` (line 1358) — existing endpoint to extend or reference for health data. HTMX polling pattern (e.g., `hx-trigger="load, every 30s"`) visible in Settings section. Dashboard layout at line ~499 for pill insertion point.

### Database
- `src/db.js` — `llm_logs` table schema (CREATE TABLE block, lines ~181-194). No new tables for Phase 4. `outcome TEXT` column accepts 'soft_fail' without migration.

### Requirements
- `.planning/REQUIREMENTS.md` — OBSERVE-01 through OBSERVE-06

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getProviderHealth(userId)` in `router.js` — returns `{ nvidia: { status, last_error, last_error_at, last_error_msg, last_success_at }, ... }`. Health endpoint is a thin wrapper around this.
- `/api/llm/status` endpoint (api.js:1358) — already has `failed_count` logic via `db.prepare(... source='failed' ...)`. Reuse or mirror this query for the health panel's `failed_count`.
- HTMX `hx-trigger="load, every 30s"` — established pattern in Settings; copy for dashboard pill and health panel polling.
- `escHtml()` helper in `api.js` — use for `last_error_msg` display to prevent XSS in the Settings panel.

### Established Patterns
- Inline try/catch migration guard — not needed here (no new tables or columns).
- `requireAuth` middleware — health endpoint must be auth-guarded. Add `requireAuth` inline on the route (the SSE route precedence bug, CR-02, shows what happens when you don't).
- Status color convention: green = ok, amber = rate_limited/service_busy, red = invalid_key/breaker_open, grey = unknown. Keep these consistent with existing badge CSS.

### Integration Points
- Dashboard email-list panel (api.js GET /api/emails, lines ~499+) — insert the degraded pill fragment above the inbox header using an HTMX-polled `<div hx-get="/api/llm/health/pill" hx-trigger="load, every 30s">`.
- Settings page provider section (api.js GET /api/settings render) — add health panel as a new subsection after the existing key config fields.
- `_callProviders()` in router.js (lines ~50-130) — soft-failure validation goes into the `mapResult` callback or immediately after `parsed` is returned, before the result is returned to the caller.

</code_context>

<specifics>
## Specific Ideas

- End-user language must be "AI features degraded" — never "circuit breaker", "rate limited", or provider names. This language boundary is explicit in ROADMAP.md risks.
- The amber pill is a single indicator regardless of how many providers are non-ok. One pill, one message.
- `soft_fail` as a distinct `llm_logs.outcome` value enables future queries: "how many soft failures per provider in the last 7 days?" without touching the breaker stats.
- The health panel's "Check your API key →" link for `invalid_key` state should anchor to the relevant provider's key input in the Settings form — not a generic Settings link.

</specifics>

<deferred>
## Deferred Ideas

- Per-provider soft-failure rate tracking (e.g., "NVIDIA returned 15 malformed responses today") — would require aggregating llm_logs; belongs in a future analytics phase.
- Email notification when all providers enter breaker_open simultaneously — out of scope for this phase.
- Configurable warmup delay — deferred; hard-coded 30s is sufficient.

</deferred>

---

*Phase: 4-provider-observability*
*Context gathered: 2026-05-15*
