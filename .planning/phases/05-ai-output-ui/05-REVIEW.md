---
phase: 05-ai-output-ui
reviewed: 2026-05-18T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - public/css/app.css
  - public/js/app.js
  - src/llm/templates.js
  - src/routes/api.js
  - tests/api/list-row-helpers.test.js
  - tests/llm/templates.test.js
findings:
  critical: 3
  warning: 4
  info: 3
  total: 10
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-05-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 5 added neomorphic CSS foundations, tier-attribution badges, a key-fact line helper, a restructured draft section (hidden-by-default, Reply trigger, tone picker, skip link), and warm-tone entries in the template table. The overall structure is sound and the project's XSS-prevention discipline (`escHtml`) is largely followed, but three issues require a fix before this ships: a stored-XSS path through the Alpine `x-data` attribute, a mismatch between the server's default draft tone and the client's default tone, and hardcoded hex colors inside Phase 5 CSS declarations that violate the project's "CSS variables only" constraint. Several lower-severity issues are also documented below.

---

## Critical Issues

### CR-01: Stored XSS via template-literal injection in Alpine x-data attribute

**File:** `src/routes/api.js:681`

**Issue:** The draft body is embedded into an Alpine `x-data` JS expression as a backtick template literal:

```
initialBody: \`${escHtml(draftBody).replace(/`/g, '\\`')}\`,
```

`escHtml()` converts `<`, `>`, `"`, `'`, and `&` into HTML entities, which is correct for rendering text inside HTML elements. However, `x-data` is evaluated as JavaScript, not rendered as HTML. The entity-encoded characters are decoded back to their raw form by the HTML parser *before* Alpine evaluates the expression. This means a draft body containing `${alert(1)}` (or any `${...}` payload) will be evaluated as a JS template literal expression.

Scenario: an attacker sends an email with a subject or body that causes a malicious string to be stored in the `drafts.body` column (via the `/draft/regen` endpoint, which stores LLM or template output verbatim), then the victim opens that email. `escHtml` does not escape `$` or `{`, so `${...}` expressions survive into the evaluated Alpine context.

**Fix:** Do not embed the draft body inside a JS template literal. Use a `data-*` attribute and read it in JavaScript:

```html
<!-- In the server template: -->
<div class="draft-section"
     x-show="draftVisible"
     data-initial-body="${escHtml(draftBody)}"
     data-initial-tone="${escHtml(draftTone)}"
     data-initial-source="${escHtml(JSON.stringify(draftSource))}"
     data-to-address="${escHtml(draftTo)}"
     data-subject="${escHtml(draftSubject)}"
     x-data="draftEditor($el.dataset)">
```

Then read from `dataset` inside `draftEditor()` instead of accepting the values as inline JS literals. This keeps user-sourced content entirely in the HTML attribute domain where `escHtml` is sufficient and no JS evaluation occurs.

---

### CR-02: Tone default mismatch — server emits `professional`, client expects `brief`

**File:** `src/routes/api.js:543` and `public/js/app.js:255`

**Issue:** The server-side detail renderer defaults `draftTone` to `'professional'` when no draft or classification tone exists:

```js
// api.js:543
const draftTone = draft?.tone || cls?.suggested_tone || 'professional';
```

The Alpine `draftEditor` component defaults to `'brief'`:

```js
// app.js:255
tone: initialTone || 'brief',
```

The Phase 5 spec states the tone default was intentionally changed to `'brief'`. The server-side fallback was not updated. When a new email is opened that has no draft and no `suggested_tone`, the tone picker renders with `professional` as the pre-selected chip (because `initialTone='professional'` is passed to the component), but the spec and the `draftEditor` fallback both expect `brief`. The mismatch means tone-change regeneration starts from the wrong baseline and the `tone-chip--selected` highlight shows the wrong chip.

**Fix:**
```js
// api.js:543 — change 'professional' to 'brief'
const draftTone = draft?.tone || cls?.suggested_tone || 'brief';
```

---

### CR-03: Hardcoded hex colors inside Phase 5 CSS rule bodies — violates project CSS-variable constraint

**File:** `public/css/app.css:317-329`, `658`, `668`, `722-727`

**Issue:** The project constraint states "CSS variables only — no hardcoded hex in any new CSS declaration." Multiple Phase 5-era rules in the badge and button blocks (lines 317–329) use bare hex literals (`#3b82f6`, `#10b981`, `#ef4444`, etc.) directly in `color:` and `background:` properties instead of referencing the corresponding `--accent-*` variables that are already defined in `:root`. Lines 658 and 668 (`.banner-urgent` and `.banner-warning`) also use raw hex colors. The `.btn-decline` rule (line 723) and `.btn-send` rule (line 727) do the same.

These are not legacy pre-phase-5 declarations — several of these badge classes were new or modified in Phase 5.

Examples of violations:
```css
/* line 317 — should use var(--accent-blue) */
.badge-meeting_request { color: #3b82f6; }

/* line 319 — should use var(--accent-red) */
.badge-legal           { color: #ef4444; }

/* line 658 — should use var(--accent-red) */
.banner-urgent { color: #ef4444; }

/* line 723 — should use var(--accent-red) */
.btn-decline { color: #ef4444; }
```

**Fix:** Replace every bare hex literal in rule bodies with the appropriate `var(--accent-*)` token. The `:root` variables for all these colors already exist. For `rgba(...)` usages where CSS does not yet support `color-mix`, the convention is to leave the alpha-channel forms as-is (they were present before Phase 5) but all `color:` and opaque `background:` values must use variables.

---

## Warnings

### WR-01: `classification_done` SSE handler calls `JSON.parse` without a try/catch

**File:** `public/js/app.js:201`

**Issue:** Every other SSE event handler wraps `JSON.parse` in a try/catch. The `classification_done` handler does not:

```js
es.addEventListener('classification_done', (e) => {
  const data = JSON.parse(e.data);   // ← no try/catch
  ...
});
```

A malformed SSE payload (network corruption, server bug) will throw an uncaught exception inside the EventSource callback, which silently kills that callback but can also corrupt Alpine's reactive state if the exception propagates into a reactive context.

**Fix:**
```js
es.addEventListener('classification_done', (e) => {
  try {
    const data = JSON.parse(e.data);
    if (this.pendingClassifying > 0) this.pendingClassifying -= 1;
    if (this.pendingClassifying === 0) this.classifyTotal = 0;
    const listPanel = document.querySelector('[hx-get*="/api/emails"]');
    if (listPanel) htmx.trigger(listPanel, 'refresh');
  } catch (err) {}
});
```

---

### WR-02: `keyFactLine` travel branch: cleanup regex does not catch all adjacent-separator cases

**File:** `src/routes/api.js:112-114`

**Issue:** When `d.flight_number` is absent (empty string), the code builds `"Flight ·  · Dec 3"` and then attempts to clean it up:

```js
fact = `Flight · ${escHtml(d.flight_number || '')} · ${escHtml(d.departure_date)}`
  .replace(' ·  ·', ' ·')
  .replace(/·\s+·/g, '·');
```

The first `replace` is a literal string match for exactly two spaces between the dots (`' ·  ·'`). `escHtml('')` returns `''`, so the raw string is `"Flight ·  · Dec 3"` (two spaces). The literal replace works for this specific case, but `escHtml` could produce a non-empty string for other edge inputs (e.g., a flight number of `'&'` → `'&amp;'`). More importantly, the second regex `·\s+·` strips the separator *and both adjacent spaces*, leaving `"Flight·Dec 3"` with no spacing around the dot if the first replace did not fire. The produced string will look like `"Flight·Dec 3"` instead of `"Flight · Dec 3"`.

**Fix:** Build the fact conditionally instead of relying on post-hoc cleanup:

```js
if (d.departure_date) {
  fact = d.flight_number
    ? `Flight · ${escHtml(d.flight_number)} · ${escHtml(d.departure_date)}`
    : `Flight · ${escHtml(d.departure_date)}`;
}
```

---

### WR-03: `request` category exists in `categoryLabel` map but is absent from `TABLE` in `templates.js`

**File:** `src/llm/templates.js:62-67` and `src/routes/api.js:77-83`

**Issue:** `categoryLabel()` in `api.js` (line 77) maps `'request'` to `'Request'`, meaning the application recognizes it as a valid category. `buildTemplateReply()` in `templates.js` calls `TABLE[cat]` which has no `'request'` key. The fallback chain is `TABLE[cat] || GENERIC`, so `request` gets `GENERIC`. This is functionally harmless, but the tone picker will silently serve a generic template for a category the app considers real. If a future phase adds `request` to the DB schema's valid category set, this silent fallback will be a user-facing bug.

**Fix:** Add a `request` entry to `TABLE` in `templates.js`, or add a test that asserts all categories recognised by `categoryLabel` are present in `TABLE`.

---

### WR-04: Draft section `display:none` inline style conflicts with Alpine `x-show`

**File:** `src/routes/api.js:676-678`

**Issue:** The draft section has both `x-show="draftVisible"` (Alpine controls `display`) and an inline `style="display:none;"`. Alpine 3 removes the inline style when `x-show` first evaluates, so in most cases they cooperate. However, the inline `style` attribute has higher specificity than Alpine's runtime style injection in some browsers, and Alpine only processes `x-show` after its initialization pass. If Alpine is slow to initialize (slow network, large DOM), the element flashes as `display:none` correctly — but the reverse is also possible: if HTMX swaps the HTML fragment before Alpine initializes, the `x-show` binding is not yet live and the `style="display:none"` provides the only guard against the draft section appearing. The issue is that the spec and code comment explicitly require the draft NOT to auto-populate, which is currently relying on two mechanisms that can conflict.

The correct pattern for Alpine-controlled visibility when `x-cloak` is not available is the `x-cloak` CSS rule that already exists in the CSS:
```css
.draft-section[x-cloak] { display: none !important; }
```

**Fix:** Replace `style="display:none;"` with `x-cloak` on the `.draft-section` element:

```html
<div class="draft-section"
     x-show="draftVisible"
     x-cloak
     x-transition:enter.duration.200ms
     ...>
```

This is consistent with the existing `x-cloak` CSS rule written specifically for `.draft-section` and removes the fragile dual-mechanism.

---

## Info

### IN-01: `buildTemplateReply` forces `professional` tone for `legal` regardless of caller intent — not tested

**File:** `src/llm/templates.js:65`

**Issue:** `buildTemplateReply` hardcodes `table.professional` for the `legal` category:

```js
if (cat === 'legal') return table.professional;
```

The `TABLE.legal` object now contains a `warm` entry (added in Phase 5), but it is unreachable for the `legal` category. The `tests/llm/templates.test.js` test for `legal warm` (line 53) passes only because it tests that `buildTemplateReply({ category: 'legal' }, 'warm')` returns a non-undefined string — it does, but it silently returns the `professional` string, not the `warm` string. The test does not assert the content matches the `warm` value. This means the test gives a false signal that the warm tone is being served for legal emails.

This behavior is intentional per the legal-tone-lock policy ("legal always professional"), but the warm entry in `TABLE.legal` is dead code and the test is misleading. Either remove `TABLE.legal.warm` and update the test to document the tone-lock, or document the policy with a comment.

---

### IN-02: `draftEditor.wordCount` getter returns 1 for empty string

**File:** `public/js/app.js:264-266`

**Issue:**
```js
get wordCount() {
  return this.draftBody.trim().split(/\s+/).filter(Boolean).length;
}
```

`''.split(/\s+/)` returns `['']` (an array with one empty string). `filter(Boolean)` then filters out falsy values, and `''` is falsy — so `filter(Boolean)` correctly removes it. The word count for an empty body is therefore `0`. This is correct. However when `draftBody` is a single space `' '`, `trim()` produces `''` which then gets `0` via the same path — also correct. This is a false alarm on the surface, but the adjacent `saveStatus` display (shown in the same row as word count) will show `"0 words"` even when `skipMode` is true and the textarea is intentionally blank, which may confuse users into thinking they need to write something.

**Fix (low priority):** Gate the word count display with `x-show="!skipMode"` or change the display text to empty string when `skipMode` is true.

---

### IN-03: Neomorphic shadow variables use hardcoded hex inside `:root` variable definitions — acceptable but dark-mode unaware

**File:** `public/css/app.css:31-35`

**Issue:** The Phase 5 neomorphic shadow variables are defined in `:root` with hardcoded light-theme hex values:

```css
--shadow-convex-sm:  3px 3px 6px #d1d1d1, -3px -3px 6px #ffffff;
```

The `[data-theme="dark"]` block (lines 45-56) does not override these shadow variables. In dark mode the neomorphic shadows will use the light-theme palette (`#d1d1d1` / `#ffffff`), which produces a strongly visible white glow on dark backgrounds — making the tier badges and tone chips visually incorrect in dark mode.

**Fix:** Add dark-mode overrides in `[data-theme="dark"]`:

```css
[data-theme="dark"] {
  --shadow-convex-sm:  3px 3px 6px #050810, -3px -3px 6px #1b2238;
  --shadow-convex:     6px 6px 12px #050810, -6px -6px 12px #1b2238;
  --shadow-hover:      8px 8px 16px #040710, -8px -8px 16px #1c243a;
  --shadow-pressed:    inset 2px 2px 6px #050810, inset -2px -2px 6px #1b2238;
  --shadow-concave-sm: inset 2px 2px 5px #050810, inset -2px -2px 5px #1b2238;
}
```

---

_Reviewed: 2026-05-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
