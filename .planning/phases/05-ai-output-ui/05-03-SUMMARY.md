---
phase: 05-ai-output-ui
plan: "03"
subsystem: ui
tags: [htmx, server-rendered, alpine, draft-ux, attribution, tier-badge, detail-view]
dependency_graph:
  requires:
    - phase: 05-ai-output-ui/01
      provides: neomorphic CSS classes (.draft-section, .draft-attribution-label, .tone-chip, .attribution-footer, .draft-skip-link) in public/css/app.css
    - phase: 05-ai-output-ui/02
      provides: tierBadge() helper available in src/routes/api.js scope
  provides:
    - Detail header tier badge via tierBadge(cls?.source, cls?.low_confidence)
    - Urgency badge tooltip: tabindex="0" + conditional title="${escHtml(cls.urgency_reason)}"
    - llm_logs JOIN query at detail render time (source=llm/fallback only)
    - Attribution footer "AI by {Provider} · {N}ms" for llm/fallback emails
    - Draft section hidden by default (draftVisible: false Alpine scope)
    - Reply trigger button (draft-reply-trigger) reveals draft section
    - Tone picker with Brief/Formal/Warm chips calling changeTone(t.toLowerCase())
    - "Write yourself" skip link calling skipAI()
    - Updated renderActionZone() — all 6 action-zone draft buttons click draft-reply-trigger
    - skipAI() method in draftEditor() Alpine component
    - auto-regen removed from draftEditor.init()
  affects:
    - src/routes/api.js — detail route and renderActionZone()
    - public/js/app.js — draftEditor() Alpine component
tech_stack:
  added: []
  patterns:
    - "Alpine x-data scoping: draftVisible on outer wrapper div; draftEditor on inner .draft-section div — two separate Alpine scopes on same branch"
    - "FOUC prevention: style='display:none' alongside x-show on .draft-section — Alpine hides before JS executes"
    - "llm_logs conditional JOIN: only fires when cls.source is llm or fallback — reduces unnecessary DB reads"
    - "escHtml() on llmLog.provider (T-05-03-02 mitigated); latency_ms integer rendered directly (T-05-03-03 accepted)"
    - "tabindex='0' on urgency badge enables keyboard-triggered browser tooltip (accessibility)"
key_files:
  created: []
  modified:
    - src/routes/api.js
    - public/js/app.js
decisions:
  - "draftVisible scope on outer border-top wrapper div — common ancestor of both Reply button and .draft-section (Alpine scoping constraint from PATTERNS.md note 4)"
  - "pitch_deck HTMX regen buttons replaced with draft-reply-trigger click + showToast — tone selection is now the generate trigger (D-10)"
  - "Emoji characters in server-rendered HTML switched to HTML entities to avoid encoding issues in template literals"
  - "skipAI() is not async — it only mutates local Alpine reactive state, no server call (T-05-03-06 accepted)"
  - "auto-regen removal is load-bearing for D-13 — prevents silent API quota consumption on every email open"
metrics:
  duration: "4m 4s"
  completed: "2026-05-18"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 2
  lines_changed: ~85
requirements:
  - UI-01
  - UI-02
  - UI-04
  - UI-05
  - UI-06
  - UI-07
---

# Phase 05 Plan 03: Detail View + Draft UX Summary

Detail view wired with tier badge in header, urgency tooltip, llm_logs attribution footer, and full draft reveal/hide flow — tone picker (Brief/Formal/Warm) as the generation trigger, progressive disclosure via Reply button, skip link for manual composition.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Detail header tier badge, urgency tooltip, and llm_logs attribution footer | 25a2cea | src/routes/api.js |
| 2 | Draft section hide-by-default restructure and renderActionZone() button updates | 428a9c7 | src/routes/api.js |
| 3 | Update draftEditor() Alpine component for new tone values and hidden-by-default | 40ecde3 | public/js/app.js |

## What Was Built

### Task 1 — src/routes/api.js (4 edits)

**EDIT 1 — llm_logs conditional query:**
Added after existing draft query:
```js
const llmLog = (cls?.source === 'llm' || cls?.source === 'fallback')
  ? db.prepare('SELECT provider, latency_ms FROM llm_logs WHERE email_id = ? AND outcome = ? ORDER BY ts DESC LIMIT 1').get(email.id, 'success')
  : null;
```
Parameterized `outcome` value (no interpolation) — T-05-03-01 mitigated.

**EDIT 2 — Tier badge in detail header:**
`${tierBadge(cls?.source, cls?.low_confidence)}` inserted after category badge in the header badge row. Reuses the tierBadge() helper established in Plan 02.

**EDIT 3 — Urgency badge tooltip:**
Added `tabindex="0"` (always) and conditional `title="${escHtml(cls.urgency_reason)}"` (only when non-empty). Native browser tooltip — zero JS (D-05).

**EDIT 4 — Attribution footer:**
`${llmLog ? '<div class="attribution-footer">AI by ${escHtml(llmLog.provider)} · ${llmLog.latency_ms}ms</div>' : ''}` rendered after draft section, before outer padding div closes. Only renders for llm/fallback sources (D-16).

### Task 2 — src/routes/api.js (2 edits)

**EDIT 1 — Draft section restructure:**
Replaced the old always-visible `div.draft-editor` block with a new structure:
- Outer wrapper: `x-data="{ draftVisible: false }"` + border-top
- Reply trigger button: `class="action-btn btn-primary draft-reply-trigger"` — always visible; sets `draftVisible = true` on click
- Inner `.draft-section`: `x-show="draftVisible"` + `style="display:none"` (FOUC prevention) + `x-data="draftEditor({...})"`
- Inside `.draft-section`: attribution label → tone picker (Brief/Formal/Warm) → skip link → draft content (shown only when draftBody || regenerating)
- Old Regen button removed; old 4-tone template removed

**EDIT 2 — renderActionZone() updates (6 cases):**
- `financial`, `legal`, `travel`, `fyi`, `rewards_awards`, `default` (other): replaced `document.querySelector('.draft-editor textarea')?.focus()` with `document.getElementById('email-detail').querySelector('.draft-reply-trigger')?.click()`
- `pitch_deck`: removed `hx-post` HTMX regen buttons; replaced with `.draft-reply-trigger` click + `showToast('info','Click a tone to draft your reply')`
- `meeting_request` Accept/Decline/Calendar buttons: unchanged (no draft focus)

### Task 3 — public/js/app.js (4 edits)

- Tone default: `'professional'` → `'brief'`
- Added `skipMode: false` to initial state properties
- Removed auto-regen block from `init()` (7 lines: comment + needsRegen logic)
- Added `skipAI()` method: sets `draftBody=''`, `source='user'`, `skipMode=true`, `saveStatus=''`

## Verification Results

All three task-level node checks passed:
- Detail route check (14 required strings present): PASS
- Old textarea focus pattern removed check: PASS
- app.js check (3 required strings present, 1 forbidden string absent): PASS
- Test suite: 183/183 pass, 1 todo, 0 failures

## Deviations from Plan

### Auto-fixed — Emoji encoding in template literals

- **Found during:** Task 2 implementation
- **Issue:** Emoji characters (↩️, 💾, 📤, 👍, 👎) inside server-rendered template literal strings risk encoding issues on certain Node.js/file system configurations
- **Fix:** Switched emoji in the newly-written draft section and action-zone buttons to HTML entities (&#x21A9;, &#x1F4BE;, &#x1F4E4;, &#x1F44D;, &#x1F44E;)
- **Classification:** [Rule 2 - Missing robustness] Preventive fix — existing code kept existing emoji patterns, only new code uses entities
- **Files modified:** src/routes/api.js

Otherwise: plan executed exactly as written. All 3 tasks completed; no architectural decisions required.

## Known Stubs

None. All new UI elements render from live DB data:
- `tierBadge()` uses `cls.source` and `cls.low_confidence` from classifications (live SELECT *)
- `llmLog` uses live JOIN on llm_logs table
- Tone picker is UI state — no stub data
- `skipAI()` mutates local Alpine state only

## Threat Flags

No new threat surface beyond the plan's `<threat_model>`:
- T-05-03-01 (urgency_reason XSS via title attribute): mitigated — escHtml() wraps urgency_reason
- T-05-03-02 (attribution footer provider XSS): mitigated — escHtml(llmLog.provider)
- T-05-03-03 (latency_ms injection): accepted — integer column, no escape needed
- T-05-03-04 (renderActionZone draft trigger elevation): accepted — UI-only state change
- T-05-03-05 (init() auto-regen DoS): mitigated — auto-regen removed
- T-05-03-06 (skipAI() injection): accepted — local state mutation only

## Self-Check: PASSED

- [x] src/routes/api.js exists and contains all required Phase 5-03 strings (verified by node checks)
- [x] public/js/app.js exists and contains skipAI(), skipMode: false, and 'brief' default (verified by node check)
- [x] Commit 25a2cea (Task 1) exists
- [x] Commit 428a9c7 (Task 2) exists
- [x] Commit 40ecde3 (Task 3) exists
- [x] 183/183 tests pass, 0 failures
- [x] No unexpected file deletions in any task commit
