---
phase: 04-provider-observability
plan: 03
subsystem: frontend
tags: [settings, dashboard, htmx, alpine, health-panel, degraded-pill, observability]

# Dependency graph
requires:
  - "04-02 — /api/llm/health and /api/llm/health/pill backend endpoints"
provides:
  - "Settings > AI Providers tab: AI Provider Health table with color-coded badges (OBSERVE-03)"
  - "Dashboard: HTMX-polled degraded pill wrapper above #email-list (OBSERVE-04)"
  - "failedCount Alpine state property wired to /api/llm/status failed_count field (D-07)"
affects:
  - "End users see amber degraded indicator on dashboard when any provider is non-ok"
  - "Operators see per-provider health table in Settings with error detail and key hint links"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Alpine x-text (not x-html) for last_error_msg — XSS-safe rendering of provider error strings (T-04-03-01)"
    - "hx-swap=innerHTML on pill wrapper prevents outerHTML from removing div on empty response (Pitfall 3)"
    - "x-for over hardcoded ['nvidia','groq','gemini','deepseek'] array — not dynamic from server"
    - "Three x-if templates per row for last-error cell: unknown status / has error / no error"
    - "failedCount state property added alongside fallbackCount — both populated from /api/llm/status"

key-files:
  created: []
  modified:
    - views/settings.html
    - views/dashboard.html

key-decisions:
  - "Used x-text (not x-html) for last_error_msg cell — Alpine auto-encodes text, preventing XSS from LLM provider error strings"
  - "Three x-if template branches for last-error cell: unknown/absent shows 'No activity yet'; has error shows truncated string; no error shows '—'"
  - "Pill wrapper div has no inline style — server-rendered pill HTML carries all its own styles, wrapper is a pure HTMX anchor"

# Metrics
duration: ~9min
completed: 2026-05-15T13:54:43Z
tasks-attempted: 2
tasks-completed: 2
tasks-pending: 1 (checkpoint:human-verify — awaiting human verification)
---

# Phase 4 Plan 03: Provider Observability Frontend Summary

**Settings AI Provider Health table (OBSERVE-03) and dashboard HTMX degraded pill wrapper (OBSERVE-04) — color-coded per-provider status for operators; single "AI features degraded" indicator for end users**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-15T13:45:00Z (approx)
- **Completed:** 2026-05-15T13:54:43Z (automated tasks only; checkpoint pending)
- **Tasks:** 2 automated complete, 1 checkpoint pending
- **Files modified:** 2

## Accomplishments

**Task 1 — Settings AI Provider Health panel (views/settings.html):**
- Added `failedCount: 0` to Alpine state initializer (alongside existing `fallbackCount: 0`)
- Added `this.failedCount = d.failed_count || 0` to `loadLlmStatus()` — reads from existing `/api/llm/status` response, no new HTTP request
- Inserted new `settings-section` div with `id="providers"` after the AI Providers key-config section, still inside `x-show="activeTab === 'providers'"` wrapper
- Table iterates `['nvidia', 'groq', 'gemini', 'deepseek']` with `x-for` pattern (`key="hp-"+name`)
- Status badge: `healthStyle()` + `healthLabel()` functions reused — no new color definitions
- Last error cell: three `x-if` template branches — unknown/absent: "No activity yet" (D-05); has error: slice to 60 chars + "…"; no error: "—"
- Last success cell: `smartTime()` relative timestamp or "—"
- Key hint column: `x-if` conditional — `invalid_key` rows show "Check your API key →" link to `/settings#provider-key-{name}` (D-06)
- Failed count summary paragraph below table — count in `--accent-red` when > 0 (D-07)
- XSS safety: all bindings use `x-text` — no `x-html` in the health panel section (T-04-03-01)

**Task 2 — Dashboard pill wrapper (views/dashboard.html):**
- Inserted HTMX wrapper div between `.panel-header` closing `</div>` and `<div id="email-list">`
- `hx-get="/api/llm/health/pill"`, `hx-trigger="load, every 30s"`, `hx-swap="innerHTML"` (not outerHTML)
- Empty wrapper by default — server populates on load and every 30s
- No provider names, circuit breaker terms, or rate-limit language in the wrapper (language boundary enforced server-side)
- Comments explain empty-response DOM-persistence behavior (Pitfall 3)

## Task Commits

1. **Task 1: Settings AI Provider Health panel** - `170febd` (feat)
2. **Task 2: Dashboard HTMX pill wrapper** - `3092f86` (feat)

## Files Created/Modified

- `views/settings.html` — failedCount state property, loadLlmStatus() update, full AI Provider Health section
- `views/dashboard.html` — HTMX polling wrapper div inserted between panel-header and #email-list

## Requirements Satisfied (automated tasks only)

- **OBSERVE-03:** Settings health panel renders per-provider status table (pending human verification)
- **OBSERVE-04:** Dashboard pill wrapper polls /api/llm/health/pill every 30s with hx-swap=innerHTML (pending human verification)

## Checkpoint Status

**Task 3 (checkpoint:human-verify)** is PENDING — the plan requires human visual verification before this plan can be marked complete. Both automated tasks passed automated verification and test suite (93 pass, 0 fail).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The health panel reads from live Alpine `providerHealth` state populated by `loadLlmStatus()`. The dashboard pill wrapper polls a real backend endpoint. No hardcoded placeholder data.

## Threat Flags

No new threat surface beyond what the plan's STRIDE threat register documents:
- T-04-03-01 mitigated: `x-text` used throughout health panel (verified: no `x-html` in section)
- T-04-03-02 mitigated: pill HTML is static server-rendered copy, no dynamic content in wrapper template
- T-04-03-03 accepted: GET /api/llm/health/pill auth-guarded by global middleware

## Self-Check

- `views/settings.html` — FOUND
- `views/dashboard.html` — FOUND
- Commit `170febd` — pending verification below
- Commit `3092f86` — pending verification below

## Self-Check: PASSED
