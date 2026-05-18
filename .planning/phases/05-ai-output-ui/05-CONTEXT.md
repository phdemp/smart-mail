# Phase 5: AI Output UI - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Surface AI annotations throughout the inbox with progressive disclosure and transparent attribution — tier badges (Rule/AI/Failed), urgency tooltips, extracted structured data in list rows, draft UX gated behind Reply, provider attribution footer, and the `low_confidence` indicator. No new data collection — every field displayed is already stored in `classifications` or `llm_logs`.

</domain>

<decisions>
## Implementation Decisions

### Tier Attribution Badge (UI-01)

- **D-01:** Tier badge (dot + label) appears **after the category badge** in the email list row. Inline in the existing badge row — additive, no layout restructure.
- **D-02:** Source-to-badge mapping (display layer only, no DB change):
  - `rule`, `rules` → **"Rule"** (green dot). The inconsistent `rules` value is normalized in the rendering function, not in the DB or classifier.
  - `llm`, `fallback` → **"AI"** (blue dot). `fallback` (all LLM providers soft-failed, rule-based fallback fired) is treated as an AI result — users don't need to see the internal cascade distinction.
  - `failed` → **"Failed"** (red dot).
- **D-03:** When `low_confidence = 1` (from `PROMPT-07`), the AI badge gets a `?` suffix: **"AI ?"**. Amber-tinted to signal uncertainty without alarming. Only applies to the `llm`/`fallback` tier — never to Rule or Failed.
- **D-04:** Tier badge also appears in the email **detail header** alongside the category badge (same position convention as list row).

### Urgency Tooltip (UI-02)

- **D-05:** Urgency badge in email detail gets a **CSS `title` attribute** set to `urgency_reason`. Native browser tooltip — zero JS, zero new components. Works immediately on hover. Styling is browser-native (acceptable trade-off vs neomorphism polish).
- **D-06:** The **existing urgency banner** (URGENT / MODERATE full-width strip) is **kept**. Banner communicates severity; tooltip adds the "why" on hover. Purely additive — no removal.

### Extracted Data in List Row (UI-03)

- **D-07:** List row shows **one key fact per relevant category** as a 3rd text line below the preview text. Rendered in 11px IBM Plex Mono, `color:var(--text-muted)`.
  - `travel`: departure date (or flight number if no date)
  - `financial`: amount due + due date (e.g., "Due $450 · Apr 30")
  - `meeting_request`: meeting date + time (e.g., "Meeting Thu 3pm")
  - All other categories (`fyi`, `legal`, `other`, `pitch`, `rewards_awards`): no 3rd line — current row unchanged.
- **D-08:** Categories with no structured extracted data show nothing extra in the list row. Rows without data look the same as today.

### Draft UX (UI-04 + UI-05)

- **D-09:** Draft section is **hidden by default** in email detail. It becomes visible when the user clicks the existing **Reply button**. No new affordance added.
- **D-10:** Draft reveal flow: Reply click → **tone picker (Brief / Formal / Warm)** → selecting a tone **immediately fires** `POST /api/emails/:id/draft/regen` with the selected tone. One tap to get a draft. No separate "Generate" button.
- **D-11:** Tone labels updated to **Brief / Formal / Warm** (per UI-05 spec). The existing `draftEditor()` Alpine component's tone options are updated. Backend tone values the endpoint accepts are updated to match.
- **D-12:** Below the tone picker, a **"Write yourself →"** link skips AI generation and opens an empty textarea for manual composition. Secondary affordance, not primary.
- **D-13:** The draft area never pre-populates on email open — it only renders after the user triggers the Reply flow. Pre-existing drafts saved via autosave also only load after Reply is clicked (they replace the AI-generated content).

### Provider Attribution Footer (UI-06)

- **D-14:** Provider data sourced by **JOINing `llm_logs`** at email detail render time — no schema change to `classifications`. Query: latest `outcome='success'` row in `llm_logs` WHERE `email_id = ?`.
- **D-15:** Footer format: **"AI by [Provider] · [latency]ms"**. Model name omitted — `model_id` is not stored anywhere in `llm_logs`. Model name can be added when tracking is added.
- **D-16:** Attribution footer only shows for **emails with `source = 'llm'` or `source = 'fallback'`**. Rule-classified and Failed emails show no footer.

### Summary Progressive Disclosure (UI-07)

- **D-17:** **No change needed** to summary display. The AI summary callout is already in the email detail view and appears on email open — this satisfies UI-07's "summary shown on email open." The current behavior is correct.

### Claude's Discretion

- Exact pixel values for the tier badge dot size and gap (stay within 4-point spacing scale: 4/8px gap, 6-8px dot)
- Which data field to show first when `travel` has both PNR and departure date (prefer departure date; PNR as fallback if no date)
- HTML element for the "Write yourself →" link (likely a `<button>` styled as a ghost link, consistent with existing ghost button pattern)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §AI Output UI — 7 requirements (UI-01 through UI-07); all must be covered
- `.planning/ROADMAP.md` §Phase 5 — goal, success criteria, dependencies, risks

### Core source files (read before editing)
- `src/routes/api.js` — email list rendering (~line 388-420) and email detail rendering (~line 448-640); add tier badge to list HTML, add tooltip to urgency badge, add extracted-data key-fact line, add attribution footer, restructure draft section reveal
- `src/classifier.js` — `storeClassification()` function (~line 251); the `source` and `low_confidence` fields stored here drive tier badge and `low_confidence` indicator
- `src/db.js` — `classifications` table schema (~line 62); `llm_logs` table schema (added Phase 4); confirm `low_confidence` column exists
- `public/js/app.js` — `draftEditor()` Alpine component; update tone options from professional/friendly/formal/brief → Brief/Formal/Warm; add hide-by-default / Reply-reveal logic

### Design system
- `.claude/skills/sketch-findings-NeuralInbox/SKILL.md` — MANDATORY. Neomorphism design direction, shadow scale, color palette, typography. Every new UI element must follow this.
  - Background: always `#f0f0f0`; no white fills on surfaces
  - Shadow: convex-sm for badges/buttons, concave-sm for inputs
  - Fonts: IBM Plex Mono for badges/metadata, Syne for UI labels, Literata for email body
  - Tier badge dot: convex-sm shadow; FAILED badge must be convex (not flat)

### Existing UI patterns (inline in api.js)
- Email list row template: `src/routes/api.js` ~line 394 — server-rendered HTMX HTML; badge HTML pattern using `badge badge-{category}` CSS classes
- Email detail structure: `src/routes/api.js` ~line 448 — urgency banner, AI summary callout, extracted data cards, action zone, draft editor wiring

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `badge badge-{category}` CSS class system — already in `views/css/` or inlined in api.js; tier badge should use the same pattern with new `badge-tier-rule`, `badge-tier-ai`, `badge-tier-failed` classes
- `escHtml(str)` — XSS-safe HTML escaping function at api.js line ~21; use for any user-sourced data in new HTML
- `smartTime(dateStr)` — relative timestamp formatter at api.js ~line 43; reuse for extracted meeting dates
- `parsedExtractedData(cls?.extracted_data)` — JSON-safe extracted_data parser already in api.js ~line 455; reuse to extract key facts for list row
- `draftEditor({...})` Alpine component in `public/js/app.js` — tone selector, autosave, regen, send; update tone values, add hidden-by-default behavior
- `showToast(type, message)` — client-side toast function; available for feedback on draft generation start/complete

### Established Patterns
- Server-rendered HTMX HTML (not Alpine templates) for email list and detail — new UI elements go into template literal strings in `src/routes/api.js`
- `db.prepare().get()` + `db.prepare().all()` (better-sqlite3 sync API) — use for the `llm_logs` JOIN query at detail render time
- CSS variables: `var(--text-muted)`, `var(--text-secondary)`, `var(--accent-indigo)`, `var(--accent-red)`, `var(--accent-amber)` — use these, don't hardcode hex values

### Integration Points
- Email list row rendered by `GET /api/emails` in `src/routes/api.js` (~line 353): SELECT already fetches `c.source`, `c.urgency`, `c.extracted_data`, `c.low_confidence` — tier badge and extracted key fact can be added directly to the template literal
- Email detail rendered by `GET /api/emails/:id` in `src/routes/api.js` (~line 448): urgency badge render point (~line 512), draft editor mount point (~line 616) — add `title=` to urgency badge, restructure draft section, add attribution footer after draft section
- `llm_logs` table: `provider`, `email_id`, `latency_ms`, `outcome` — JOIN query for attribution footer: `SELECT provider, latency_ms FROM llm_logs WHERE email_id = ? AND outcome = 'success' ORDER BY ts DESC LIMIT 1`

</code_context>

<specifics>
## Specific Ideas

- **Tier badge dot shape**: 6-8px circle dot before the text label. "· Rule", "· AI", "· AI ?", "· Failed" format. Matches the Phase 4 health panel dot convention.
- **"AI ?" badge**: When `low_confidence = 1`, render `· AI ?` with the `?` in `color:var(--accent-amber)`. Not a separate badge — a suffix on the existing AI badge.
- **Draft reveal animation**: When Reply is clicked, the draft section slides in (CSS max-height transition, consistent with existing accordion patterns in the action zone). Tone chips appear immediately; draft textarea appears after regen completes.
- **Extracted key fact format examples**: "Flight · BA456 · Dec 3", "Due · $450 · Apr 30", "Meeting · Thu 3:00pm". All in IBM Plex Mono 11px `var(--text-muted)`.

</specifics>

<deferred>
## Deferred Ideas

- **Model name in attribution footer**: `_provider` model ID (e.g., `llama-3.3-70b`) is not stored anywhere. Add `model_id` to `llm_logs` + provider adapter changes — a follow-up data layer task, not Phase 5.
- **`low_confidence` analytics view**: Category confusion matrix, top-uncertain sender domains — deferred to a future admin/analytics phase (noted in REQUIREMENTS.md as CORR-ADV-02).
- **Per-category extracted data completeness check**: Before surfacing the extracted data panel (UI-03), verify `extracted_data` is populated consistently for each category — deferred; Phase 5 surfaces what exists, Phase 6 could validate completeness.

</deferred>

---

*Phase: 5-AI Output UI*
*Context gathered: 2026-05-18*
