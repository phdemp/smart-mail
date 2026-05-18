# Phase 5: AI Output UI - Pattern Map

**Mapped:** 2026-05-18
**Files analyzed:** 3 (src/routes/api.js, public/js/app.js, public/css/app.css)
**Analogs found:** 3 / 3 — all files are modifications of existing files; no new files created

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog (within same file) | Match Quality |
|---------------|------|-----------|-----------------------------------|---------------|
| `src/routes/api.js` | route/template | request-response | existing list row (~line 386–418) and detail template (~line 499–689) | exact — same file |
| `public/js/app.js` | Alpine component | event-driven | existing `draftEditor()` (~line 251–385) | exact — same component |
| `public/css/app.css` | config/style | — | existing `.badge` block (~line 292–324), `.idle-pill` (~line 361–406) | exact — same file |

---

## Pattern Assignments

### `src/routes/api.js` — Email List Row Template (lines 386–418)

**Role:** server-rendered HTMX HTML fragment returned by `GET /api/emails`

**Existing badge row pattern** (lines 409–413):
```js
<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
  <span class="badge badge-${escHtml(cat)}">${escHtml(categoryLabel(cat))}</span>
  ${urg === 'urgent' ? '<span style="font-size:10px;color:var(--accent-red);font-family:\'IBM Plex Mono\',monospace;font-weight:600;">URGENT</span>' : ''}
  ${email.is_starred ? '<span style="font-size:11px;">⭐</span>' : ''}
</div>
```

**Where tier badge inserts (UI-01):** immediately after `<span class="badge badge-${escHtml(cat)}">` inside that `<div>`. The gap is already `gap:6px` — no layout change needed.

**Where extracted key-fact line inserts (UI-03):** between the preview `<div>` (line 408) and the badge `<div>` (line 409). The preview div pattern to anchor before:
```js
<div style="font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:6px;font-family:'Literata',serif;">${escHtml(preview)}</div>
```

**CRITICAL — missing SELECT columns:** The list query at lines 352–359 does NOT include `c.source` or `c.low_confidence`. The executor MUST add these two columns to the SELECT to enable tier badge rendering:
```js
// Current (line 353):
SELECT e.*, c.category, c.urgency, c.urgency_reason, c.summary, c.extracted_data, c.suggested_tone

// Required after patch:
SELECT e.*, c.category, c.urgency, c.urgency_reason, c.summary, c.extracted_data, c.suggested_tone, c.source, c.low_confidence
```

**Helper functions already available in scope** (lines 21–87, no imports needed):
- `escHtml(str)` — lines 21–29; use for all user-sourced data in template literals
- `smartTime(dateStr)` — lines 43–57; available but not needed for key-fact (key-fact uses raw extracted strings, not relative times)
- `parsedExtractedData(str)` — lines 85–87; call this on `email.extracted_data` in the list row to extract key facts
- `avatarColor()`, `initials()`, `categoryLabel()` — already called in same map() callback

**Key-fact rendering function pattern** — add as a new helper in the helpers section (after `parsedExtractedData` at line 87, before the account routes at line 91):
```js
function keyFactLine(cat, extractedDataStr) {
  const d = parsedExtractedData(extractedDataStr);
  let fact = '';
  if (cat === 'travel') {
    if (d.departure_date) fact = `Flight · ${escHtml(d.flight_number || '')} · ${escHtml(d.departure_date)}`.replace(' · ·', ' ·').replace(/·\s+·/g, '·');
    else if (d.pnr) fact = `PNR · ${escHtml(d.pnr)}`;
  } else if (cat === 'financial') {
    fact = d.amount_due ? (d.due_date ? `Due · ${escHtml(d.amount_due)} · ${escHtml(d.due_date)}` : `Due · ${escHtml(d.amount_due)}`) : '';
  } else if (cat === 'meeting_request') {
    fact = d.meeting_date ? (d.meeting_time ? `Meeting · ${escHtml(d.meeting_date)} · ${escHtml(d.meeting_time)}` : `Meeting · ${escHtml(d.meeting_date)}`) : '';
  }
  return fact ? `<div class="email-key-fact">${fact}</div>` : '';
}
```

**tierBadge rendering function pattern** — add alongside `keyFactLine` in the helpers section:
```js
function tierBadge(source, lowConfidence) {
  const src = (source || '').toLowerCase();
  let cls, label;
  if (src === 'rule' || src === 'rules') {
    cls = 'badge-tier-rule'; label = 'Rule';
  } else if (src === 'failed') {
    cls = 'badge-tier-failed'; label = 'Failed';
  } else {
    cls = 'badge-tier-ai';
    label = lowConfidence
      ? `AI <span class="tier-lc-suffix">?</span>`
      : 'AI';
    if (lowConfidence) cls += ' badge-tier-ai--uncertain';
  }
  return `<span class="badge ${cls}"><span class="tier-dot"></span>${label}</span>`;
}
```

**Usage in list row map() callback:**
```js
// After: const preview = ...
// Add:
const tierBadgeHtml = tierBadge(email.source, email.low_confidence);
const keyFact = keyFactLine(cat, email.extracted_data);
```

Then in the template:
```js
${keyFact}   // insert between preview div and badge div
// Inside badge div, after category badge:
${tierBadgeHtml}
```

---

### `src/routes/api.js` — Email Detail Template (lines 443–689)

**Role:** server-rendered HTMX HTML for `GET /api/emails/:id`

**Existing detail query** (line 447) — already fetches full `classifications` row via `SELECT *`, so `cls.source`, `cls.low_confidence`, and `cls.urgency_reason` are all available without query changes.

**Attribution footer data query** — add immediately after existing draft query (line 448, after `const draft = ...`):
```js
const llmLog = (cls?.source === 'llm' || cls?.source === 'fallback')
  ? db.prepare('SELECT provider, latency_ms FROM llm_logs WHERE email_id = ? AND outcome = \'success\' ORDER BY ts DESC LIMIT 1').get(email.id)
  : null;
```
Pattern: `db.prepare().get()` — sync better-sqlite3 API, matching line 447's `db.prepare(...).get(...)` pattern exactly.

**Urgency badge pattern** (line 513) — existing:
```js
${urg !== 'normal' ? `<span class="badge" style="background:${urg === 'urgent' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)'};color:${urg === 'urgent' ? 'var(--accent-red)' : 'var(--accent-amber)'};border-color:${urg === 'urgent' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'};">${urg.toUpperCase()}</span>` : ''}
```

**Urgency tooltip change (UI-02):** Add `title` and `tabindex="0"` to the urgency badge span:
```js
${urg !== 'normal' ? `<span class="badge" tabindex="0"
  ${cls?.urgency_reason ? `title="${escHtml(cls.urgency_reason)}"` : ''}
  style="...existing styles...">${urg.toUpperCase()}</span>` : ''}
```
Note: `title` attribute only rendered when `cls?.urgency_reason` is non-empty — omit entirely otherwise.

**Tier badge in detail header (UI-01):** Insert `${tierBadge(cls?.source, cls?.low_confidence)}` immediately after the category badge `<span>` at line 512:
```js
<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
  <span class="badge badge-${escHtml(cat)}">${escHtml(categoryLabel(cat))}</span>
  ${tierBadge(cls?.source, cls?.low_confidence)}   <!-- INSERT HERE -->
  ${urg !== 'normal' ? `<span ...>` : ''}
  ...
</div>
```

**Existing draft editor section** (lines 613–672) — this entire block is replaced by the new hide-by-default structure. The anchor is the outer container div at line 614:
```js
<!-- Draft Editor -->
<div style="border-top:1px solid var(--border);padding-top:20px;margin-top:8px;">
  <div style="font-size:11px;...">— AI Draft Response —</div>
  <div class="draft-editor" x-data="draftEditor({...})">
    ...
  </div>
</div>
```

**Reply button placement:** The Reply button goes into the action zone buttons, replacing the existing `↩️ Draft Reply` ghost buttons scattered in `renderActionZone()` (lines ~755, 810, 864, 897, 923). The existing pattern shows:
```js
<button class="action-btn btn-ghost" onclick="document.querySelector('.draft-editor textarea')?.focus()">
  ↩️ Draft Reply
</button>
```
Each of these becomes the new Reply trigger (or is removed in favor of one unified Reply button above the draft section).

**Draft section restructure — new outer HTML pattern:**
```js
<!-- Reply trigger — always visible above draft section -->
<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
  <button class="action-btn btn-primary draft-reply-trigger"
          x-data="{ draftVisible: false }"
          @click="draftVisible = true; $nextTick(() => $el.nextElementSibling.scrollIntoView({behavior:'smooth', block:'nearest'}))">
    ↩ Reply
  </button>

  <!-- Draft section — hidden by default -->
  <div class="draft-section"
       x-data="draftEditor({ emailId: '${email.id}', initialBody: \`${escHtml(draftBody).replace(/`/g, '\\`')}\`, initialTone: '${escHtml(draftTone)}', initialSource: ${JSON.stringify(draftSource)}, toAddress: '${escHtml(draftTo)}', subject: '${escHtml(draftSubject)}' })"
       x-show="$el.previousElementSibling.getAttribute('x-data') && false"
       style="display:none;">
    ...
  </div>
</div>
```
NOTE: The draftVisible state needs careful scoping — see Alpine component section below.

**Attribution footer placement (UI-06):** Render after the closing `</div>` of the draft section, before the final `</div>` that closes the outer `padding:24px` div (line 674):
```js
${llmLog ? `
  <div class="attribution-footer">
    AI by ${escHtml(llmLog.provider)} · ${llmLog.latency_ms}ms
  </div>
` : ''}
```

---

### `public/js/app.js` — `draftEditor()` Alpine Component (lines 251–385)

**Role:** Alpine.js reactive component; manages tone, draft body, save/send lifecycle

**Existing component signature** (line 251):
```js
function draftEditor({ emailId, initialBody, initialTone, initialSource, toAddress, subject }) {
  return {
    emailId,
    draftBody: initialBody || '',
    tone: initialTone || 'professional',
    ...
```

**Tone value change (UI-05 / D-11):** The `tone` default and the tone options template both change. In the component:
```js
// Current:
tone: initialTone || 'professional',

// Replace with:
tone: initialTone || 'brief',
```

The template literal in api.js at line 630 changes from:
```js
<template x-for="t in ['formal','professional','friendly','brief']">
```
to the new tone picker component structure (see UI-SPEC component 6).

**New state properties to add to component return object:**
```js
// Add after existing state properties:
generating: false,   // true while POST /draft/regen is in flight (distinct from regenerating)
skipMode: false,     // true when user clicked "Write yourself →"
```

**`changeTone(t)` — existing** (lines 315–318):
```js
async changeTone(newTone) {
  this.tone = newTone;
  await this.regenerateDraft();
},
```
This pattern is already correct for D-10 (tone tap = generate immediately). No change to logic; only the valid tone values change to `'brief'|'formal'|'warm'`.

**New `skipAI()` method to add** — follows same pattern as other methods (async, modifies reactive state):
```js
skipAI() {
  this.draftBody = '';
  this.source = 'user';
  this.skipMode = true;
  this.saveStatus = '';
},
```

**`init()` change (D-13):** Remove or gate the auto-regen-on-open logic. Currently (lines 280–286):
```js
const needsRegen = !this.draftBody || !this.draftBody.trim() || this.source === 'template';
if (needsRegen) {
  this.tone = this.tone || 'professional';
  this.regenerateDraft();
}
```
This must be removed — draft section is hidden until Reply is clicked (D-13). Auto-regen must not fire on email open. The regen fires only via `changeTone()` after the user picks a tone chip.

**`regenerateDraft()` — existing** (lines 320–352): No changes to the fetch logic. The method already posts `{ tone: this.tone }` and updates `this.draftBody`. The tone values sent to the backend become `'brief'|'formal'|'warm'` instead of the old set.

**Hide-by-default / Reply-reveal state:** The `draftVisible` boolean is a parent-scope concern, not inside `draftEditor()`. The cleanest pattern matching existing Alpine usage in the file: add `x-data="{ draftVisible: false }"` to the outer container div (the one that holds both the Reply button and the draft section), and `x-show="draftVisible"` on the draft section div.

---

### `public/css/app.css` — New CSS Classes

**Role:** static CSS additions to `:root` and new class blocks

**Existing `:root` block** (lines 7–29) — add the neomorphic shadow variables at the end of the `:root` block, before the closing `}`:
```css
/* Neomorphic shadow scale — Phase 5 additions */
--shadow-convex-sm:  3px 3px 6px #d1d1d1, -3px -3px 6px #ffffff;
--shadow-convex:     6px 6px 12px #d1d1d1, -6px -6px 12px #ffffff;
--shadow-hover:      8px 8px 16px #c8c8c8, -8px -8px 16px #ffffff;
--shadow-pressed:    inset 2px 2px 6px #c8c8c8, inset -2px -2px 6px #ffffff;
--shadow-concave-sm: inset 2px 2px 5px #d1d1d1, inset -2px -2px 5px #ffffff;
/* Border-radius additions */
--radius-sm:  8px;
--radius-md:  14px;
--radius-lg:  20px;
--radius-pill: 9999px;
```

**Existing `.badge` block** (lines 292–303) — new tier classes append after the last existing badge class (`.badge-pending` at line 314). Pattern match: all existing category badges use `rgba()` backgrounds with matching `color` and optional `border`. The tier badges follow the same pattern with `box-shadow` added instead of `border`:
```css
/* Existing pattern to follow: */
.badge-meeting_request { background: rgba(59,130,246,0.15);  color: #3b82f6; border: 1px solid rgba(59,130,246,0.3); }
.badge-financial       { background: rgba(16,185,129,0.15);  color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
```

**Existing `.idle-pill` / `.polling-pill` / `.offline-pill` blocks** (lines 361–406) — the tier badge dot pattern mirrors the dot in these pills. Those pills use inline `gap:3px` and colored `background` on the container. The new `.tier-dot` is a separate element rather than a pseudo-element, but the color-from-parent pattern is the same.

**Existing `.draft-editor textarea`** (lines 327–345) — the draft section wraps this. New `.draft-section` class adds a distinct background on the container (rgba blue tint) without touching the textarea styles.

**Existing animation pattern** (lines 271–283 for `urgency-pulse`, 424–440 for `toast-in`/`toast-out`) — the draft slide-in animation follows the same `@keyframes` + class pattern:
```css
/* Follow same pattern as: */
@keyframes urgency-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
  50%       { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
}
```

**Insert point for all Phase 5 CSS:** after the `@keyframes pulse-pending` block (line 324), before `/* ── Draft Editor ── */` (line 326). This keeps Phase 5 additions grouped before the draft editor block, which is being restructured anyway.

---

## Shared Patterns

### XSS Safety
**Source:** `escHtml()` at `src/routes/api.js` lines 21–29
**Apply to:** Every new template literal string that renders user-sourced data: `llmLog.provider`, `llmLog.latency_ms`, extracted data fields in key-fact line, `cls.urgency_reason` in title attribute
```js
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

### Database Query Pattern
**Source:** `src/routes/api.js` lines 447–448
**Apply to:** Attribution footer llm_logs JOIN query
```js
// Sync better-sqlite3 pattern — always .get() for single row, .all() for multiple
const cls = db.prepare('SELECT * FROM classifications WHERE email_id = ? AND user_id = ?').get(email.id, req.user.id);
const draft = db.prepare('SELECT * FROM drafts WHERE email_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(email.id, req.user.id);
// Attribution query follows the same form:
const llmLog = db.prepare('SELECT provider, latency_ms FROM llm_logs WHERE email_id = ? AND outcome = ? ORDER BY ts DESC LIMIT 1').get(email.id, 'success');
```

### CSS Variable Usage
**Source:** `public/css/app.css` lines 7–29 (`:root`) and throughout
**Apply to:** All new CSS — never hardcode hex values, always reference variables
```css
/* DO: */
color: var(--text-muted);
background: rgba(59, 130, 246, 0.12);  /* accent-blue at 12% opacity */
border-top: 1px solid var(--border);

/* DON'T: */
color: #7a86a8;
```
Key variables confirmed in `:root`: `--text-muted`, `--text-secondary`, `--text-primary`, `--accent-blue` (#3b82f6), `--accent-green` (#10b981), `--accent-red` (#ef4444), `--accent-amber` (#f59e0b), `--bg-raised` (#e8ecf5), `--border`.

### Alpine Event Pattern
**Source:** `public/js/app.js` `draftEditor()` lines 293–312 (`saveDraft()`)
**Apply to:** `skipAI()` method — same `async` pattern, direct state mutation, no separate store
```js
async saveDraft() {
  this.saveStatus = 'Saving...';
  try {
    await authFetch(`/api/emails/${this.emailId}/draft/save`, { method: 'POST', ... });
    this.source = 'user';
    this.saveStatus = 'Saved';
  } catch(e) {
    this.saveStatus = 'Save failed';
  }
},
```

### Toast Feedback Pattern
**Source:** `public/js/app.js` lines 339–343
**Apply to:** Draft regen start/complete toast (already used in `regenerateDraft()`)
```js
showToast('success', '↻ Draft regenerated (' + (data.source || 'llm') + ')');
showToast('warning', '⚠ ' + data.warning);
showToast('error', '❌ Regen failed: ' + (err.error || 'Unknown error'));
```

---

## No Analog Found

None. All Phase 5 work is additive modification of the three existing files. The `llm_logs` JOIN query is a new query pattern, but follows the exact same better-sqlite3 sync API as all other queries in `src/routes/api.js`.

---

## Critical Implementation Notes for Planner

1. **SQL SELECT patch is required before tier badge works in list rows.** The `GET /api/emails` query (line 353) must add `c.source, c.low_confidence` — these are not currently fetched. The detail query (`SELECT *` at line 447) already has them.

2. **`init()` auto-regen removal is load-bearing for D-13.** The current `init()` calls `regenerateDraft()` on open (lines 281–285). This MUST be removed or guarded. If left in, drafts will be generated silently on every email open, violating D-13 and consuming API quota.

3. **"Draft Reply" buttons in `renderActionZone()` need updating.** There are 5+ instances of `onclick="document.querySelector('.draft-editor textarea')?.focus()"` that will no longer work when the draft section is hidden. These become the Reply trigger or are removed — the planner must address each location in `renderActionZone()` (lines 694+).

4. **`draftVisible` Alpine scope:** The `x-data="{ draftVisible: false }"` must be on a div that is the common ancestor of both the Reply button and the draft section. If the Reply button is inside `renderActionZone()` and the draft section is outside it, they cannot share scope via Alpine's `x-data`. The cleanest fix: move `draftVisible` to the outer `padding:24px` container div, or pass it as a shared Alpine store.

5. **Tone backend acceptance:** `POST /api/emails/:id/draft/regen` receives `{ tone }` and passes it to `llm.router.generateDraft`. The backend tone validation (if any) must accept `'brief'|'formal'|'warm'`. Check `src/classifier.js` and `src/llm/` for any enum validation before finalizing.

---

## Metadata

**Analog search scope:** `src/routes/api.js` (full file), `public/js/app.js` (lines 240–430), `public/css/app.css` (full file), `src/db.js` (grep for `low_confidence`, `source`)
**Files scanned:** 4
**Pattern extraction date:** 2026-05-18
