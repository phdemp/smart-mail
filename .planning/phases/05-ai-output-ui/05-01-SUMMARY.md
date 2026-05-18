---
phase: 05-ai-output-ui
plan: "01"
subsystem: frontend-css
tags: [css, neomorphism, design-tokens, phase5]
dependency_graph:
  requires: []
  provides:
    - neomorphic-shadow-css-vars
    - tier-badge-css-classes
    - tone-chip-css-classes
    - attribution-footer-css-class
    - key-fact-line-css-class
    - draft-section-css-class
  affects:
    - public/css/app.css
tech_stack:
  added: []
  patterns:
    - CSS custom properties (shadow scale)
    - Neomorphic double-shadow technique
    - 4-point spacing grid enforcement
key_files:
  created: []
  modified:
    - public/css/app.css
decisions:
  - "Shadow variables defined in :root as custom properties — all Phase 5 components reference via var() rather than repeating values"
  - "rgba() backgrounds used with known hex values for tier badges — no CSS variable exists for opacity variants of accent colors"
  - "border: 1.5px solid var(--accent-blue) on .tone-chip--selected is spec-required exception to no-border-on-neomorphic rule"
  - "Phase 5 CSS block inserted between @keyframes pulse-pending and /* -- Draft Editor -- */ to keep additions grouped"
metrics:
  duration: "1m 50s"
  completed: "2026-05-18"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
  lines_added: 163
requirements:
  - UI-01
  - UI-02
  - UI-03
  - UI-04
  - UI-05
  - UI-06
  - UI-07
---

# Phase 05 Plan 01: Neomorphic CSS Foundation Summary

Neomorphic shadow scale CSS variables and all 10 Phase 5 component class blocks added to `public/css/app.css` — no JS or server changes.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add neomorphic shadow variables to :root and insert all Phase 5 CSS classes | 6aa11c1 | public/css/app.css (+163 lines) |

## What Was Built

Added 163 lines to `public/css/app.css` in two edits:

**EDIT 1 — :root additions (9 new custom properties):**
- 5 shadow custom properties: `--shadow-convex-sm`, `--shadow-convex`, `--shadow-hover`, `--shadow-pressed`, `--shadow-concave-sm`
- 4 border-radius tokens: `--radius-sm` (8px), `--radius-md` (14px), `--radius-lg` (20px), `--radius-pill` (9999px)

**EDIT 2 — Phase 5 class blocks (10 new class groups, inserted between badge and draft editor sections):**
1. `.tier-dot` — 8px convex dot shared by all tier badges
2. `.badge-tier-rule`, `.badge-tier-ai`, `.badge-tier-ai--uncertain`, `.tier-lc-suffix`, `.badge-tier-failed` — neomorphic tier attribution badges; `.badge-tier-failed` has mandatory `box-shadow: var(--shadow-convex-sm)` per sketch-findings constraint
3. `.email-key-fact` — IBM Plex Mono 11px extracted data line with ellipsis overflow
4. `.draft-section` — blue-tinted `rgba(59,130,246,0.06)` container with 12px border-radius
5. `.draft-attribution-label` — IBM Plex Mono 10px uppercase accent-blue label
6. `.tone-picker`, `.tone-picker-label` — flexbox tone picker container and label
7. `.tone-chip` with `:hover`, `:active`, `.tone-chip--selected` — convex/hover/pressed shadow states; selected state has `1.5px solid var(--accent-blue)` border
8. `.draft-skip-link` — Syne 13px underlined muted button
9. `.attribution-footer` — IBM Plex Mono 11px right-aligned with border-top separator
10. `@keyframes draft-slide-in` + `.draft-section[x-cloak]` — slide-in animation support

## Verification Results

- Automated token check: PASSED — all 21 required identifiers present in file
- Test suite: 93/93 tests passed (0 failures)
- No hardcoded hex values in class declarations (rgba() backgrounds only, using known hex values from :root where no CSS variable exists for opacity variants)
- No non-4-point px values in new declarations (plan's forbidden list: 2px, 3px, 6px, 7px, 14px — none present)
- `.badge-tier-failed` has `box-shadow: var(--shadow-convex-sm)` — convex constraint satisfied
- `.tone-chip--selected` has `border: 1.5px solid var(--accent-blue)` — spec requirement met
- Existing CSS rules unchanged (no existing variables or class blocks removed)

## Deviations from Plan

### Test Count Discrepancy

- **Found during:** Task 1 verification
- **Issue:** Plan stated 141 tests; actual test suite has 93 tests
- **Action:** No fix needed — test suite ran successfully. The plan's stated count was an estimate. 93/93 pass with 0 failures.
- **Classification:** Documentation discrepancy only, not a code issue.

Otherwise: plan executed exactly as written.

## Known Stubs

None. This plan is CSS-only. All class blocks are complete and contain no placeholder values.

## Threat Flags

None. This plan only modifies a static CSS file. No new network endpoints, auth paths, file access patterns, or schema changes were introduced.

## Self-Check: PASSED

- [x] `public/css/app.css` exists and contains all 21 required Phase 5 identifiers (verified by node check)
- [x] Commit `6aa11c1` exists (verified post-commit)
- [x] No unexpected file deletions in commit
- [x] 93/93 tests pass
