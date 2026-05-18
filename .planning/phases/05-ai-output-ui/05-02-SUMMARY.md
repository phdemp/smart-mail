---
phase: 05-ai-output-ui
plan: 02
subsystem: ui
tags: [htmx, server-rendered, template-literal, xss-escaping, tier-badge, key-fact, warm-tone]

# Dependency graph
requires:
  - phase: 05-ai-output-ui/01
    provides: neomorphic CSS classes (.badge-tier-rule, .badge-tier-ai, .badge-tier-failed, .tier-dot, .email-key-fact) in public/css/app.css

provides:
  - tierBadge() helper in src/routes/api.js — maps DB source/low_confidence to tier badge HTML
  - keyFactLine() helper in src/routes/api.js — extracts and renders key fact for travel/financial/meeting_request
  - SQL SELECT patch — GET /api/emails now selects c.source and c.low_confidence
  - List row template update — renders ${keyFact} and ${tierBadgeHtml} in each row
  - warm tone entries in src/llm/templates.js — all 8 categories + GENERIC now have warm key

affects:
  - 05-ai-output-ui/03 (detail view — tierBadge() and keyFactLine() reusable there too)
  - Any future plan that calls buildTemplateReply with 'warm' tone

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "tierBadge() rendering helper: server-side HTML string generator with escHtml() safety, no user data in label strings"
    - "keyFactLine() rendering helper: parsedExtractedData() + escHtml() on all field values, empty string when no data (T-05-02-01 mitigation)"
    - "SQL SELECT expansion: add new classification columns to existing LEFT JOIN query"
    - "TDD RED/GREEN cycle: failing source-level + behavioral tests committed before implementation"

key-files:
  created:
    - tests/api/list-row-helpers.test.js — 23 behavioral and source-verification tests for tierBadge() and keyFactLine()
  modified:
    - src/routes/api.js — added tierBadge(), keyFactLine() helpers; patched SQL SELECT; updated list row template
    - src/llm/templates.js — added warm tone entries to GENERIC and all 7 TABLE categories
    - tests/llm/templates.test.js — extended with 20 warm tone tests

key-decisions:
  - "null/unknown source treated as AI badge (D-02 display normalization, not DB change)"
  - "rules DB value normalized to Rule in tierBadge() rendering layer"
  - "escHtml() applied to all extracted_data field values (T-05-02-01) but NOT to tierBadge label strings (T-05-02-02 accepted)"
  - "warm tone is friendly-professional register: warmer than professional, more measured than friendly"

patterns-established:
  - "tierBadge(source, lowConfidence): pure function returning HTML string, safe to interpolate directly"
  - "keyFactLine(cat, extractedDataStr): returns empty string for excluded categories, div.email-key-fact for included"
  - "TDD with source-level fs.readFileSync verification: tests check both behavior and that code is in the right file"

requirements-completed:
  - UI-01
  - UI-03

# Metrics
duration: 35min
completed: 2026-05-18
---

# Phase 5 Plan 02: List View — Tier Badge + Key-Fact Line Summary

**Tier attribution badge (Rule/AI/Failed) and extracted key-fact 3rd line wired into email list rows via tierBadge() and keyFactLine() helpers; warm tone added to all template reply categories**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-18T06:28:00Z
- **Completed:** 2026-05-18T07:03:24Z
- **Tasks:** 2 (each with RED/GREEN TDD cycle)
- **Files modified:** 4

## Accomplishments
- GET /api/emails SQL SELECT now fetches c.source and c.low_confidence from classifications table
- tierBadge() maps all source values per D-02: rule/rules → Rule (green), failed → Failed (red), llm/fallback/null → AI (blue); low_confidence=1 adds "AI ?" uncertain suffix
- keyFactLine() renders one key fact for travel/financial/meeting_request; returns empty string for all other categories (D-08); escHtml() applied to all extracted_data field values (T-05-02-01)
- List row template interpolates ${keyFact} between preview div and badge row, ${tierBadgeHtml} after category badge
- buildTemplateReply({category: X}, 'warm') now returns a defined string for all 8 categories (D-11)

## Task Commits

Each task was committed atomically with RED before GREEN:

1. **Task 1 RED: Failing tests for tierBadge() and keyFactLine()** - `c87e705` (test)
2. **Task 1 GREEN: Add helpers + patch SQL SELECT + update list row** - `cdd00d7` (feat)
3. **Task 2 RED: Failing tests for warm tone entries** - `314820a` (test)
4. **Task 2 GREEN: Add warm entries to GENERIC and all 7 TABLE categories** - `78df1a2` (feat)

**Plan metadata:** (committed after this SUMMARY)

_TDD tasks have two commits each: test (RED) → feat (GREEN)_

## Files Created/Modified
- `src/routes/api.js` — added tierBadge() and keyFactLine() helpers after parsedExtractedData(); patched SQL SELECT with c.source, c.low_confidence; added tierBadgeHtml + keyFact constants in map() callback; updated template literal
- `src/llm/templates.js` — added warm key to GENERIC and to meeting_request, financial, legal, travel, pitch_deck, fyi, rewards_awards in TABLE
- `tests/api/list-row-helpers.test.js` — 23 tests: source-level string checks + behavioral tests for all tierBadge source mappings and all keyFactLine category cases
- `tests/llm/templates.test.js` — extended from 4 to 24 tests: warm key presence + buildTemplateReply warm fallback + existing tone regression

## Decisions Made
- D-02 source normalization happens in tierBadge() rendering layer (not DB or classifier) — display concern only
- escHtml() applied to all extracted_data field values per T-05-02-01 threat; tierBadge labels are static strings so no escHtml needed (T-05-02-02 accepted)
- warm tone TABLE.legal.warm = professional value because buildTemplateReply always returns professional for legal regardless of tone parameter

## Deviations from Plan

None - plan executed exactly as written. All three edits to api.js and the templates.js warm entries implemented as specified.

## Issues Encountered
None. The test extraction approach (using `new Function()` to extract helpers from api.js source) required careful regex matching for multi-line function bodies, but worked cleanly.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None. tierBadge() and keyFactLine() use live data from the SQL SELECT query. Templates return real strings.

## Threat Flags
None. All threat register items from the plan's `<threat_model>` were addressed:
- T-05-02-01 (XSS via extracted_data): mitigated — escHtml() on all d.field values in keyFactLine()
- T-05-02-02 (XSS via source column): accepted — label strings are static, source is enum-controlled
- T-05-02-03 (info disclosure via low_confidence): accepted — boolean scoped by existing WHERE clause

## Next Phase Readiness
- Wave 1 plan 02 complete. Wave 1 plan 01 (CSS foundation) and plan 02 (list row) are both done.
- Wave 2 plan 03 (detail view + draft UX) can proceed: tierBadge() is already usable in detail header, same function signature.
- No blockers.

---
*Phase: 05-ai-output-ui*
*Completed: 2026-05-18*
