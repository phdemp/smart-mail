---
phase: 05-ai-output-ui
verified: 2026-05-18T12:00:00Z
status: human_needed
score: 7/7
overrides_applied: 0
human_verification:
  - test: "Progressive disclosure across the full inbox flow"
    expected: "List view shows only category badge + urgency badge + tier badge (no summary, no draft); opening an email reveals AI summary; clicking Reply reveals the draft section with tone picker"
    why_human: "Requires browser interaction to confirm Alpine x-show draftVisible=false actually hides the section on load and that the Reply button correctly reveals it"
  - test: "Urgency tooltip renders correctly"
    expected: "Hovering or focusing the urgency badge shows a native tooltip with the urgency_reason text from the database"
    why_human: "Native browser tooltip (title attribute) requires visual inspection; cannot be verified by code scanning alone"
  - test: "Attribution footer appears only for AI-classified emails"
    expected: "An email classified with source='llm' or source='fallback' shows 'AI by [Provider] · [N]ms' at the bottom of the detail view; an email classified with source='rule' or source='failed' shows no footer"
    why_human: "Requires live database records and a real browser render to confirm conditional logic works end-to-end"
  - test: "Tier badge neomorphic shadow is visually convex (not flat)"
    expected: "Tier badges (.badge-tier-rule, .badge-tier-ai, .badge-tier-failed) appear raised/convex, not flat, in both light and dark themes"
    why_human: "CSS shadow appearance requires visual inspection against the neomorphic design spec"
  - test: "Tone selection triggers immediate draft generation"
    expected: "Clicking a tone chip (Brief/Formal/Warm) immediately fires POST /api/emails/:id/draft/regen with the selected tone — no separate Generate button needed"
    why_human: "Requires network tab inspection to confirm the POST fires on chip click, not on a separate button"
---

# Phase 5: AI Output UI Verification Report

**Phase Goal:** Every AI annotation in the inbox follows progressive disclosure — category and urgency in list view, summary on open, draft only on reply — with transparent attribution so users understand what classified each email and why

**Verified:** 2026-05-18T12:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every email in list and detail views shows a tier attribution badge (Rule/AI/Failed) sourced from the source column | VERIFIED | `tierBadge()` at lines 89-105 in api.js; called at line 438 in list row and line 566 in detail header; CSS classes present in app.css lines 350-377 |
| 2 | Hovering the urgency badge shows a tooltip with urgency_reason from the database | VERIFIED | Line 567 in api.js: `tabindex="0"${cls?.urgency_reason ? ` title="${escHtml(cls.urgency_reason)}"` : ''}` — title only rendered when non-empty |
| 3 | Extracted structured data is visible in the email list (travel PNR/flight, financial due/amount, meetings) without opening the email | VERIFIED | `keyFactLine()` at lines 107-133; injected at line 457 between preview div and badge row; returns empty string for non-applicable categories |
| 4 | Draft replies are visually distinguished with "AI draft — review before sending" label and blue-tinted background; never pre-populated without user action | VERIFIED | draftVisible starts false (line 668), draft section has x-cloak + CSS rule `.draft-section[x-cloak] { display: none !important; }` (app.css line 487); `.draft-attribution-label` present inside section (line 688); `.draft-section` has blue rgba background (app.css line 393) |
| 5 | Tone selector (Brief/Formal/Warm) appears before draft generation; selecting a chip triggers changeTone() which immediately calls regenerateDraft() | VERIFIED | x-for loop over ['Brief','Formal','Warm'] at line 693; @click="changeTone(t.toLowerCase())" wired; changeTone() calls regenerateDraft() immediately (app.js lines 319-322); warm tone entries present in all 8 categories in templates.js |
| 6 | Email detail shows provider attribution footer "AI by [Provider] · [latency]ms" for LLM-classified emails | VERIFIED | llmLog query at lines 499-501 (conditional on source=llm/fallback); footer rendered at line 736: `${llmLog ? '<div class="attribution-footer">AI by ${escHtml(llmLog.provider)} · ${llmLog.latency_ms}ms</div>' : ''}` |
| 7 | All renderActionZone draft buttons trigger the Reply reveal flow, not direct textarea focus; draftEditor.init() no longer auto-regens on open | VERIFIED | 9 occurrences of `draft-reply-trigger` in api.js; 0 occurrences of old `.draft-editor textarea` focus pattern; auto-regen block removed from app.js init() (confirmed by `noAutoRegen=true` check) |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `public/css/app.css` | Neomorphic shadow scale vars + all Phase 5 component classes | VERIFIED | All 25 expected identifiers present; --shadow-convex-sm through --radius-pill in :root; 10 class blocks from .tier-dot to .attribution-footer; @keyframes draft-slide-in; .draft-section[x-cloak] rule |
| `src/routes/api.js` | tierBadge() helper, keyFactLine() helper, SQL SELECT patch, list row template update, detail header, llm_logs JOIN, attribution footer, draft restructure, renderActionZone() updates | VERIFIED | All 8 functional additions confirmed at specific line numbers |
| `src/llm/templates.js` | warm tone entries in GENERIC and all 7 TABLE categories | VERIFIED | 9 `warm:` entries present; buildTemplateReply returns non-undefined string for all 8 categories with 'warm' tone |
| `public/js/app.js` | draftEditor() with tone=['brief'], skipAI(), init() auto-regen removed, skipMode state | VERIFIED | `tone: initialTone || 'brief'` (line 266), skipMode: false (line 272), skipAI() method (lines 389-394), needsRegen block absent |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `public/css/app.css :root` | `.badge-tier-rule, .badge-tier-ai, .badge-tier-failed` | `var(--shadow-convex-sm)` | WIRED | All three tier badge classes reference `box-shadow: var(--shadow-convex-sm)`; .badge-tier-failed confirmed at app.css line 375 |
| `public/css/app.css :root` | `.tone-chip` | `var(--shadow-convex-sm), var(--shadow-hover), var(--shadow-pressed)` | WIRED | Default uses convex-sm (line 439), :hover uses shadow-hover (line 443), :active uses shadow-pressed (line 447), .tone-chip--selected uses shadow-pressed (line 450) |
| GET /api/emails SQL SELECT | `email.source, email.low_confidence` | `c.source, c.low_confidence` added to SELECT | WIRED | Line 399: `SELECT e.*, c.category, c.urgency, c.urgency_reason, c.summary, c.extracted_data, c.suggested_tone, c.source, c.low_confidence` |
| list row map() callback | `tierBadge(email.source, email.low_confidence)` | helper call in template literal | WIRED | Line 438 declares `tierBadgeHtml`, line 460 renders `${tierBadgeHtml}` after category badge |
| list row map() callback | `keyFactLine(cat, email.extracted_data)` | helper call in template literal | WIRED | Line 439 declares `keyFact`, line 457 renders `${keyFact}` between preview div and badge div |
| Reply button in detail view | draft section x-show | draftVisible Alpine property on shared ancestor div | WIRED | Outer div at line 668 has `x-data="{ draftVisible: false }"`; Reply button at line 670 sets `draftVisible = true`; draft-section div at line 675 has `x-show="draftVisible"` |
| llm_logs JOIN query | attribution-footer div | conditional render on llmLog non-null | WIRED | Lines 499-501 set llmLog (only for llm/fallback); line 736 conditionally renders footer using llmLog |
| changeTone(t) | POST /api/emails/:id/draft/regen | this.regenerateDraft() called immediately in changeTone() | WIRED | app.js lines 319-322: `async changeTone(newTone) { this.tone = newTone; await this.regenerateDraft(); }` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| List row template (api.js) | `email.source, email.low_confidence` | `classifications` table via LEFT JOIN (lines 399-405) | Yes — DB query with WHERE user_id scope | FLOWING |
| List row template (api.js) | `email.extracted_data` | Same LEFT JOIN SELECT | Yes — JSON blob from DB | FLOWING |
| Detail template (api.js) | `llmLog.provider, llmLog.latency_ms` | `llm_logs` table query at lines 499-501 | Yes — conditional DB query, returns null when not applicable | FLOWING |
| Detail template (api.js) | `cls.urgency_reason` | `classifications SELECT *` at line 497 | Yes — live DB read | FLOWING |
| draftEditor Alpine (app.js) | `draftBody` | Initially empty (''); populated on first tone-chip click via POST /api/emails/:id/draft/regen | Yes — API call fills it; no pre-population | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| tierBadge('rule', 0) returns Rule badge | `node -e "..."` | `<span class="badge badge-tier-rule">...Rule</span>` | PASS |
| tierBadge('llm', 1) returns AI ? badge | node eval | Returns badge-tier-ai badge-tier-ai--uncertain with tier-lc-suffix span | PASS |
| keyFactLine('financial', '{"amount_due":"$450","due_date":"Apr 30"}') returns key-fact div | node eval | Returns `<div class="email-key-fact">Due · $450 · Apr 30</div>` | PASS |
| keyFactLine('fyi', '{"topic":"Update"}') returns empty string | node eval | Returns '' | PASS |
| buildTemplateReply({category:'meeting_request'}, 'warm') returns string | `node -e "const {buildTemplateReply}=require('./src/llm/templates');..."` | 'Thanks for the invite — I\'ll check my calendar and confirm shortly.' | PASS |
| All 21 Phase 5 CSS identifiers present | `node -e "const fs=require('fs')..."` | All present: 0 missing | PASS |
| Test suite passes | `node --test "tests/**/*.test.js"` | 183 tests: 183 pass, 0 fail, 1 todo | PASS |

---

### Probe Execution

No conventional probe scripts found in `scripts/*/tests/probe-*.sh`. No probes declared in plan frontmatter. Step 7c: SKIPPED (no probe files).

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| UI-01 | 05-01, 05-02, 05-03 | Tier attribution badge (Rule/AI/Failed) in list and detail views | SATISFIED | tierBadge() helper + CSS classes + SQL SELECT + both template locations wired |
| UI-02 | 05-03 | Urgency badge tooltip showing urgency_reason | SATISFIED | tabindex="0" + conditional title attribute in detail header (api.js line 567) |
| UI-03 | 05-01, 05-02 | Extracted structured data visible in list without opening | SATISFIED | keyFactLine() + CSS .email-key-fact + list row template injection |
| UI-04 | 05-01, 05-03 | Draft visually distinguished, never pre-populated without user action | SATISFIED | .draft-section blue background + .draft-attribution-label + draftVisible:false + x-cloak |
| UI-05 | 05-01, 05-03 | Tone selector (Brief/Formal/Warm) before generation | SATISFIED | x-for ['Brief','Formal','Warm'] tone chips; changeTone() fires regen immediately; warm entries in templates.js |
| UI-06 | 05-01, 05-03 | Provider attribution footer "AI by [Provider] · [latency]ms" | SATISFIED | llm_logs conditional JOIN + attribution-footer CSS + conditional render |
| UI-07 | 05-01, 05-02, 05-03 | Progressive disclosure: category+urgency in list, summary on open, draft on reply | SATISFIED | List: category badge + tier badge only; detail: summary visible on load; draft: x-cloak+draftVisible:false hides until Reply click |

All 7 Phase 5 requirements accounted for. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/routes/api.js` | 167, 1266 | "placeholder" in comments | Info | Pre-existing code comments unrelated to Phase 5 work — `// Clear current user's demo/placeholder data` and `// "Leave blank to keep existing" placeholder.` — not new introductions |
| `public/css/app.css` | 31-35 | Hardcoded hex in shadow variable definitions | Info | Hex values `#d1d1d1`, `#c8c8c8`, `#ffffff` appear in `:root` shadow variable VALUES — this is the accepted approach documented in the plan's decisions: "rgba() backgrounds only, using known hex values from :root where no CSS variable exists for opacity variants." Shadow offsets require actual color values; no CSS variable for these intermediate grays exists. This is a plan-approved pattern, not a violation. |

No TBD, FIXME, or XXX markers found in any Phase 5 modified file. No unreferenced debt markers.

---

### Human Verification Required

#### 1. Progressive Disclosure Full Flow

**Test:** Open the app in a browser. Load the inbox. Confirm: (a) list rows show category badge + tier badge but NO AI summary text, no draft section. (b) Click an email — detail view loads with AI summary visible. (c) Do NOT click Reply — confirm no draft section is visible. (d) Click Reply — confirm draft section slides in with tone picker (Brief/Formal/Warm) visible before any draft content appears.

**Expected:** Strict progressive disclosure — summary only on open, draft only on Reply click. The draft section must be completely invisible (not just collapsed) before Reply is clicked.

**Why human:** Alpine x-show + x-cloak hide/show behavior requires browser JS execution. Static code analysis confirmed the CSS and x-show directives are correct, but the actual hide-before-hydration behavior depends on the CSS rule `.draft-section[x-cloak] { display: none !important; }` being processed before Alpine initializes — requires visual confirmation.

#### 2. Urgency Tooltip

**Test:** Open an email that has urgency=urgent or urgency=moderate AND a non-empty urgency_reason in the database. Hover over or keyboard-focus the urgency badge (it has tabindex="0"). Confirm a native browser tooltip appears showing the urgency_reason text.

**Expected:** Native browser tooltip (not a custom popup) appears on hover/focus showing the exact urgency_reason text from the database.

**Why human:** Native title attribute tooltip cannot be triggered or inspected programmatically; requires visual inspection.

#### 3. Attribution Footer Conditionality

**Test:** Find one email classified with source='rule' and one with source='llm'. Open each in the detail view. The rule-classified email must show NO attribution footer. The llm-classified email must show "AI by [Provider] · [N]ms" at the bottom.

**Expected:** Strict conditionality — footer present for llm/fallback only, absent for rule/failed.

**Why human:** Requires live database data with known source values to confirm the conditional rendering works at runtime.

#### 4. Neomorphic Shadow Visual Quality

**Test:** Open the inbox in a browser with the default light theme. Inspect the tier badges (Rule, AI, Failed) and tone chips (Brief, Formal, Warm). They should appear slightly raised/convex, not flat.

**Expected:** Badges and chips have visible convex shadow depth matching the neomorphic design spec from 05-UI-SPEC.md.

**Why human:** CSS shadow appearance is a visual judgment requiring comparison against the design spec.

#### 5. Tone Chip Triggers Immediate Draft Generation

**Test:** Open an email, click Reply to reveal the draft section. Without clicking any other button, click one of the tone chips (e.g., "Brief"). Confirm: (a) the draft section shows a loading/regenerating state, (b) a network request to POST /api/emails/:id/draft/regen fires immediately, (c) draft content appears in the textarea after the response.

**Expected:** No separate "Generate" button needed — tone chip click alone triggers generation.

**Why human:** Requires browser network tab inspection to confirm the POST fires on chip click and not on some other trigger.

---

### Gaps Summary

No gaps found. All 7 requirements satisfied. All 7 observable truths verified. All artifacts present, substantive, wired, and data-flowing.

The 5 human verification items above are functional behavior checks requiring a running browser — they do not represent code gaps, but are behavioral confirmations that cannot be completed programmatically.

---

_Verified: 2026-05-18T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
