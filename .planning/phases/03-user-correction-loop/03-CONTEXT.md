# Phase 3: User Correction Loop - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can correct a wrong category directly from the email detail view. The correction is stored as an audit record, triggers a live badge update via SSE, shows a toast confirming the action and the sender-domain memory. After 2+ corrections from the same sender domain to the same category, a Tier 1 sender rule is promoted to the database and checked before any regex or LLM processing on future emails from that domain. Thumbs up/down on summaries is stored to an `ai_feedback` table as a batch quality signal.

This phase delivers both the storage layer (DB columns + new tables) and the end-to-end user experience (live badge update, toast, thumbs). No architecture changes. All new DB objects use existing inline migration guard pattern.

</domain>

<decisions>
## Implementation Decisions

### Correction Affordance

- **D-01:** Extend the **existing** `/api/emails/:id/reclassify` endpoint and category picker UI — do not rebuild as a new inline badge picker. The picker panel in the email detail view stays; changes are: (a) add CORRECT-01 audit columns to `classifications`, (b) endpoint fetches `from_address` and stores correction audit, (c) SSE broadcast, (d) updated HTMX response triggers live email-detail re-render instead of "Reload to see updated details".
- **D-02:** 3-second read timer: on email detail load, a `setTimeout(3000)` runs that adds a CSS class (e.g., `correction-visible`) to the element wrapping the correction affordance. Without the class, the correction affordance is hidden (opacity 0 or display none). The timer fires once per email open.
- **D-03:** After correction is submitted: the HTMX form posts to `/reclassify`, the response triggers an SSE `classification_updated` event, and the client re-fetches the email detail fragment via HTMX `hx-trigger="sse:classification_updated"`. The email detail updates live with the new category badge — no full page reload required.

### Sender Rule Promotion

- **D-04:** New `sender_rules` table: `(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, domain TEXT, category TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`. Add unique index `ON sender_rules(user_id, domain, category)`. Created via standard inline try/catch guard in `db.js`.
- **D-05:** Domain is extracted from `from_address` as everything after `@`. Trigger condition: when the same `(user_id, domain, category)` tuple accumulates **2 or more** rows in `classifications` with `source = 'user'`, a sender rule for that tuple is upserted into `sender_rules`. Checked at POST `/reclassify` time, after the correction row is written.
- **D-06:** In `classifier.js`, sender rule check fires **before** the regex rules tier (true Tier 1 override). Query: `SELECT category FROM sender_rules WHERE user_id = ? AND domain = ?`. If a row is found, short-circuit directly to `storeClassification()` with `source: 'rule'`. This is the first check on incoming email.
- **D-07:** Rule promotion is **silent** — no separate "rule created" notification. The normal correction toast ("We'll remember this for future emails from [domain]") is the only signal, whether it's the 1st or 2nd correction. The user doesn't need to know the threshold was reached.

### SSE + Toast

- **D-08:** The `/reclassify` endpoint fetches `from_address` from the `emails` table (it already queries this table for the auth check: `WHERE id = ? AND user_id = ?`). Domain extracted server-side and included in the SSE event data.
- **D-09:** SSE event: `classification_updated` with payload `{ email_id, category, source: 'user', domain }`. The existing `broadcast(event, data)` function in `server.js` handles dispatch. Consistent with existing event naming (`new_email`, `stats_update`).
- **D-10:** Toast triggered **client-side** when the SSE `classification_updated` event is received by the browser. The existing `showToast()` function is called with the message: `"Moved to [Category]. We'll remember this for future emails from [domain]."`. This keeps toast logic in the browser where `showToast()` already lives.

### Summary Thumbs

- **D-11:** New `ai_feedback` table per CORRECT-07: `(id INTEGER PRIMARY KEY AUTOINCREMENT, summary_id INTEGER REFERENCES classifications(id), user_id INTEGER, vote TEXT CHECK(vote IN ('up','down')), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`. `summary_id` = `classifications.id` (the summary belongs to a classification row, no new ID column needed). Add unique index on `(user_id, summary_id)` so each user submits at most one vote per classification.
- **D-12:** Thumbs appear **inline below the AI summary section** in the email detail view — a small 👍 👎 row below the summary text. The element is rendered server-side in the email detail HTMX fragment.
- **D-13:** After thumb click: vote is stored via `POST /api/emails/:id/feedback` with `{ vote: 'up'|'down' }`. The thumbs element is **replaced inline** with brief "Thanks!" microcopy (HTMX `hx-swap="outerHTML"`). No toast, no re-generation, no page change. Idempotent endpoint (UPSERT so repeated clicks don't error).

### Claude's Discretion

- Exact HTMX trigger/swap attributes for the live correction re-render (stay consistent with existing HTMX usage in the detail view)
- Whether `sender_rules` check queries by exact domain or also subdomains (strict domain match is fine for this phase)
- Whether `vote TEXT CHECK(...)` constraint or an enum-style application-level validation (inline constraint is cleaner)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §User Correction Loop — 7 requirements (CORRECT-01 through CORRECT-07); ALL must be covered
- `.planning/ROADMAP.md` §Phase 3 — goal, success criteria, dependencies, risks

### Core source files (read before editing)
- `src/routes/api.js` — existing `/api/emails/:id/reclassify` at line 943 (extend, don't replace); email detail view HTML (category badge, summary section)
- `src/db.js` — `classifications` table schema (add audit columns); startup migration block (add sender_rules + ai_feedback tables + ALTER TABLE guards)
- `src/classifier.js` — classification pipeline entry point (add sender rule check before regex tier)
- `src/server.js` — `broadcast(event, data)` function (SSE dispatch, already wired); `sseClients` Set

### Existing correction infrastructure (already built — extend, don't rebuild)
- Existing `/api/emails/:id/reclassify` endpoint (`src/routes/api.js:943`) — validates category, auth-checks email ownership, deletes + reinserts classification with `source='user'`. Needs: correction audit columns, sender rule count check, SSE broadcast, domain extraction.
- Existing category picker UI (inline HTMX form, `src/routes/api.js:869`) — works, just needs the HTMX response updated to trigger live re-render instead of static "Reload" message.
- `showToast(type, message)` — client-side toast function already exists; called for trash/archive actions; use same pattern for correction + summary feedback toasts.

### Phase 2 context (decisions that constrain Phase 3)
- `.planning/phases/02-thread-context/02-CONTEXT.md` — D-09 to D-12 (llm_logs table structure, inline migration guard pattern, synchronous better-sqlite3 pattern)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `/api/emails/:id/reclassify` endpoint (`src/routes/api.js:943`) — fully working, extend rather than replace
- `broadcast(event, data)` in `src/server.js:14` — SSE dispatch ready; accepts any event name + JSON data
- `showToast(type, message)` — client-side toast function in use for trash/archive; same pattern for correction toast
- Inline migration guard pattern: `try { db.exec('ALTER TABLE ... ADD COLUMN ...') } catch(e) {}` — use for `user_corrected_category` and `corrected_at` on classifications; `try { db.exec('CREATE TABLE sender_rules ...') } catch(e) {}` for new tables

### Established Patterns
- HTMX for all UI interactions — `hx-post`, `hx-swap`, `hx-vals`, `hx-trigger` used throughout the email detail view
- SSE client-side via native EventSource + `addEventlistener('classification_updated', ...)` — HTMX SSE extension or vanilla JS
- CommonJS `require`/`module.exports` throughout — no ESM
- better-sqlite3 sync API for all DB ops — INSERT, UPDATE, SELECT are synchronous
- `req.user.id` for authenticated user ID from JWT middleware (already on all protected routes)

### Integration Points
- `classifier.js` classifyEmail() entry point → add `sender_rules` SELECT before regex tier
- `/reclassify` endpoint → add `classifications` audit columns write + sender rule count query + SSE broadcast
- Email detail HTMX fragment → add 3-second CSS timer on load + thumbs UI below summary
- SSE client script (in page `<script>`) → add `classification_updated` listener that calls `showToast()` and triggers HTMX re-render of email detail

</code_context>

<specifics>
## Specific Ideas

- The toast message "Moved to [Category]. We'll remember this for future emails from [sender domain]." should appear on **every** correction (not just when a rule is promoted). Consistent experience regardless of correction count.
- The 3-second timer approach is simple JavaScript — `setTimeout(() => el.classList.add('correction-visible'), 3000)` in the email detail script block.
- The `ai_feedback` unique index on `(user_id, summary_id)` means a user can change their thumb from up to down or vice versa via UPSERT — that's fine for this phase.
- SSE `classification_updated` event listener on the client should also update the email list badge if the email is visible in the list pane (the list re-render pattern already exists via `categoryChange` trigger).

</specifics>

<deferred>
## Deferred Ideas

- Correction-informed prompting (CORR-ADV-01) — needs 20+ corrections/category corpus before useful; v2 requirement
- Category confusion matrix analytics (CORR-ADV-02) — v2 requirement
- "Rule created" distinct toast on the exact 2nd correction — kept simple as silent promotion for now; could add distinct messaging in Phase 5 UI polish if needed

</deferred>

---

*Phase: 3-User Correction Loop*
*Context gathered: 2026-05-15*
