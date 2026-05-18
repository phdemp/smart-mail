---
phase: 05-ai-output-ui
fixed_at: 2026-05-18T00:00:00Z
review_path: .planning/phases/05-ai-output-ui/05-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-05-18T00:00:00Z
**Source review:** .planning/phases/05-ai-output-ui/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (CR-01, CR-02, CR-03, WR-01, WR-02, WR-03, WR-04)
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: Stored XSS via template-literal injection in Alpine x-data attribute

**Files modified:** `src/routes/api.js`, `public/js/app.js`
**Commit:** b36ebcc
**Applied fix:** Replaced the Alpine `x-data` JS template literal that embedded user-sourced values (`draftBody`, `draftTone`, `draftSource`, `draftTo`, `draftSubject`) with `data-*` HTML attributes on the `.draft-section` div. Changed `x-data` to `draftEditor($el.dataset)`. Updated `draftEditor()` in `app.js` to accept the `dataset` object directly, extract values from the camelCased dataset properties, and JSON-parse `initialSource` (which was JSON-stringified and HTML-entity-encoded before storage in the attribute). This removes all user-sourced content from JS evaluation context.

### CR-02: Tone default mismatch — server emits `professional`, client expects `brief`

**Files modified:** `src/routes/api.js`
**Commit:** dbd84ec
**Applied fix:** Changed the fallback value in `const draftTone = draft?.tone || cls?.suggested_tone || 'professional'` to `'brief'` to align with the Phase 5 spec and the `draftEditor` client-side default.

### CR-03: Hardcoded hex colors inside Phase 5 CSS rule bodies

**Files modified:** `public/css/app.css`
**Commit:** 26aaef9
**Applied fix:** Replaced all bare hex color literals in `color:` properties within Phase 5-era rule bodies with the corresponding `var(--accent-*)` CSS custom property tokens. `rgba(...)` background/border values were left as-is per the fix guidance (alpha-channel forms exempt). Specific replacements: badge classes (lines 317-332) — `#3b82f6` → `var(--accent-blue)`, `#10b981` → `var(--accent-green)`, `#ef4444` → `var(--accent-red)`, `#a78bfa` → `var(--accent-purple)`, `#f97316` → `var(--accent-orange)`, `#9ca3af`/`#94a3b8` → `var(--accent-slate)`, `#eab308` → `var(--accent-gold)`, `#fb923c` → `var(--accent-orange)`; banner classes (lines 655-673); `.btn-decline` (line 723).

### WR-01: `classification_done` SSE handler calls `JSON.parse` without a try/catch

**Files modified:** `public/js/app.js`
**Commit:** 1a3d2c7
**Applied fix:** Wrapped the entire body of the `classification_done` event listener in a `try { ... } catch (err) {}` block, matching the pattern used by all other SSE handlers in the same file.

### WR-02: `keyFactLine` travel branch cleanup regex fragile

**Files modified:** `src/routes/api.js`
**Commit:** 4882c32
**Applied fix:** Replaced the post-hoc string-cleanup approach (building `"Flight · [possible empty] · date"` then stripping adjacent separators) with a conditional ternary that builds the fact string correctly from the start: `d.flight_number ? "Flight · {flight} · {date}" : "Flight · {date}"`. This eliminates the fragile literal string replace and regex that could strip spacing incorrectly.

### WR-03: `request` category absent from `TABLE` in `templates.js`

**Files modified:** `src/llm/templates.js`
**Commit:** a8cfd16
**Applied fix:** Added a `request` entry to `TABLE` with all five tone variants (formal, professional, friendly, brief, warm). The request category is now served a dedicated template reply rather than silently falling back to `GENERIC`.

### WR-04: Draft section `display:none` inline style conflicts with Alpine `x-show`

**Files modified:** `src/routes/api.js`
**Commit:** b36ebcc (committed together with CR-01)
**Applied fix:** Replaced `style="display:none;"` with the `x-cloak` attribute on the `.draft-section` div. This leverages the existing `.draft-section[x-cloak] { display: none !important; }` CSS rule, eliminating the dual-mechanism fragility.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-05-18T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
