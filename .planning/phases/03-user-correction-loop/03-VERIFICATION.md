---
phase: 03-user-correction-loop
verified: 2026-05-15T13:00:00Z
status: human_needed
score: 5/5 roadmap truths verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "CORRECT-03: correction-affordance div moved from renderActionZone() default: case to outer email detail template — now unconditionally rendered for all 8 categories"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Correction affordance renders for non-'other' category emails"
    expected: "Open an email classified as financial (or meeting_request, legal, travel, pitch_deck, fyi, or rewards_awards). After 3 seconds, the Recategorize button and category picker should become visible. Select a different category; the badge should update live without page reload, and a toast should appear."
    why_human: "The correction-affordance div is now unconditionally in the outer template and the 3-second timer script is unchanged — but visual rendering, timer reveal, and HTMX live-update can only be confirmed in a running browser. The prior blocker (element absent from 7 of 8 categories) is fixed in code."
  - test: "End-to-end correction flow (happy path for any category)"
    expected: "Open any email (any category). After 3 seconds click Recategorize. Choose a different category. Observe: (a) badge updates live, (b) toast shows 'Moved to [Category]. We'll remember this for future emails from [domain].', (c) re-opening the email shows the correction history row."
    why_human: "Visual badge update, toast display, and correction history row are HTMX-driven and cannot be confirmed without a running browser."
  - test: "Sender rule promotion works from any original category"
    expected: "Correct 2 emails from the same domain (any original category) to the same target category. Then receive a new email from that domain. Run: sqlite3 intellimail.db 'SELECT source FROM classifications WHERE email_id = <new_id>' — should return 'rule'."
    why_human: "Requires a live server and actual email ingestion cycle. Backend implementation is confirmed wired; only runtime behavior can confirm the Tier 0 path fires."
---

# Phase 3: User Correction Loop Verification Report

**Phase Goal:** Users can mark a wrong classification, the system confirms the correction visibly, and corrections from the same sender accumulate into a persistent rule — closing the feedback loop with a real downstream consumer
**Verified:** 2026-05-15T13:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure plan 03-05

---

## Re-verification Summary

The single gap from the initial verification (CORRECT-03 — correction affordance only rendered for the `other` category) has been closed. The SUMMARY.md claim is verified against the actual codebase:

- `grep -n "correction-affordance" src/routes/api.js` returns exactly 2 hits: line 585 (outer template, unconditional) and line 678 (timer script getElementById). Zero hits inside the `default:` case.
- The `default:` case (lines 903-929) contains only: domainFromAddress extraction, data-card (DETECTED TYPE / SOURCE DOMAIN), Delete button, Draft Reply button. No Recategorize button, no correction-affordance div.
- 132/132 tests pass with no regressions.

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can correct wrong category from email detail, badge updates live without reload | VERIFIED | correction-affordance div at `api.js:585` unconditionally rendered in outer template for all categories; timer at `api.js:678` reveals it after 3 seconds; /reclassify endpoint broadcasts `classification_updated` SSE; `app.js:210-224` listens and triggers htmx detail re-render |
| 2 | Toast confirms "Moved to [Category]. We'll remember this for future emails from [domain]." | VERIFIED | `app.js:214` — exact format with `categoryLabel(d.category)` and `d.domain` |
| 3 | After 2+ corrections from same sender domain/category, sender-rule stored and applied before regex/LLM | VERIFIED | `db.js:289-299` (sender_rules table + UNIQUE INDEX); `api.js:1013-1027` (COUNT JOIN + INSERT OR REPLACE); `classifier.js:179-197` (Tier 0 SELECT before rulesClassify) |
| 4 | Correction history (corrected category, timestamp) visible in email detail panel | VERIFIED | `api.js:533-538` — conditional row renders "Corrected to: [Category] at [timestamp]" from `cls.user_corrected_category` + `cls.corrected_at` |
| 5 | Thumbs up/down stored to ai_feedback table; no re-generation triggered | VERIFIED | `api.js:1045-1070` — `/feedback` endpoint with vote validation, UPSERT on cls.id, "Thanks!" outerHTML swap with no downstream classification call |

**Score:** 5/5 truths verified

---

### Requirement Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| CORRECT-01 | `user_corrected_category TEXT` and `corrected_at DATETIME` added via ALTER TABLE guards | VERIFIED | `db.js:283-284` — try/catch ALTER TABLE guards for both columns |
| CORRECT-02 | POST endpoint validates category against CATEGORIES enum, writes both columns, broadcasts classification_updated SSE | VERIFIED | `api.js:983-1043` — validCategories check, writes `user_corrected_category` + `corrected_at`, calls `broadcast('classification_updated', ...)` |
| CORRECT-03 | Correction affordance on category badge, inline picker, no modal, visible after 3-second read timer, for ALL categories | VERIFIED | `api.js:584-611` — correction-affordance div in outer template (unconditional); `api.js:676-689` — timer script unchanged; `default:` case (lines 903-929) confirmed clean |
| CORRECT-04 | Toast confirms "Moved to [Category]. We'll remember this for future emails from [sender domain]." | VERIFIED | `app.js:214` — exact message format |
| CORRECT-05 | After 2+ corrections from same domain/category, Tier 1 sender-rule stored; applied before regex rules | VERIFIED | sender_rules table in db.js; COUNT JOIN query in api.js:1013-1027; Tier 0 in classifier.js:179-197 |
| CORRECT-06 | Correction history visible in email detail panel | VERIFIED | `api.js:533-538` — conditional correction history row |
| CORRECT-07 | Thumbs up/down stored to ai_feedback table; UPSERT; no re-generation | VERIFIED | ai_feedback table in db.js; `/feedback` endpoint with UPSERT; "Thanks!" outerHTML response |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/routes/api.js` | correction-affordance div in outer template, default: case clean | VERIFIED | Line 585: div unconditional in outer template; lines 903-929: default: case has no correction UI — only data-card + Delete + Draft Reply |
| `tests/correction.test.js` | 10-test Wave 0 contract | VERIFIED | 10/10 pass (confirmed by full suite run) |
| `src/db.js` | Phase 3 migration blocks | VERIFIED | Lines 280-316: ALTER TABLE guards, sender_rules + UNIQUE INDEX, ai_feedback + UNIQUE INDEX |
| `src/classifier.js` | Tier 0 sender-rule lookup before Tier 1 | VERIFIED | Lines 179-197 — domain extraction, sender_rules SELECT, storeClassification with source='rule' |
| `src/server.js` | setApiBroadcast injection | VERIFIED | Lines 65-66 — imports and calls setApiBroadcast |
| `public/js/app.js` | classification_updated SSE listener | VERIFIED | Lines 210-224 — showToast + htmx.ajax detail re-render |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| outer email detail template (api.js:585) | correction-affordance-${email.id} div | unconditional template interpolation | WIRED | Div renders for every email — confirmed by grep: exactly 2 occurrences total (line 585 and line 678), zero inside default: case |
| 3-second timer script (api.js:678) | correction-affordance-${email.id} div | getElementById with `if (el && !el.dataset.timerSet)` guard | WIRED | Timer script unchanged; guard condition now always resolves to true since element is always in DOM |
| `src/server.js` | `src/routes/api.js` | `setApiBroadcast(broadcast)` after router mount | WIRED | server.js:65-66 |
| `src/routes/api.js /reclassify` | `broadcast()` | module-level broadcast stub replaced at startup | WIRED | api.js:10-11 + api.js:1530 (export) + server.js:66 (injection) |
| `public/js/app.js connectSSE()` | showToast + htmx.ajax | `es.addEventListener('classification_updated', ...)` | WIRED | app.js:210-224 |
| `src/classifier.js classifyEmail()` | sender_rules table | `db.prepare().get(userId, domain)` | WIRED | classifier.js:182-184 |
| `src/routes/api.js /reclassify` | sender_rules table | COUNT JOIN + INSERT OR REPLACE | WIRED | api.js:1013-1027 |
| `src/routes/api.js /feedback` | ai_feedback table | `INSERT OR REPLACE` with cls.id | WIRED | api.js:1061-1064 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| correction-affordance div (api.js:585) | `email.id` | email row from detail handler SELECT | Yes — real email id from DB | FLOWING |
| correction history row (api.js:533-538) | `cls.user_corrected_category`, `cls.corrected_at` | classifications SELECT in email detail handler | Yes — populated by /reclassify INSERT | FLOWING |
| SSE classification_updated (app.js:210-224) | `d.category`, `d.domain` | broadcast payload from /reclassify endpoint | Yes — domain from email.from_address, category from req.body | FLOWING |
| Tier 0 (classifier.js:179-197) | `senderRule.category` | sender_rules SELECT by (userId, domain) | Yes — populated by /reclassify UPSERT after 2 corrections | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| correction-affordance count in api.js | `grep -c "correction-affordance" src/routes/api.js` | 2 | PASS |
| correction-affordance NOT in default: case | `awk '/default: \{/,/^\  \}/' src/routes/api.js | grep "correction-affordance"` | empty (awk warning only, no match) | PASS |
| correction-affordance in outer template at line 585 | `grep -n "correction-affordance" src/routes/api.js` | line 585 (outer template), line 678 (timer) | PASS |
| Full test suite — no regressions | `node --test "tests/**/*.test.js"` | 132/132 pass, exit 0, 2921ms | PASS |
| No debt markers in phase-modified files | `grep -n "TBD\|FIXME\|XXX"` across 5 files | no output | PASS |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/routes/api.js` | 1003 | `INSERT OR IGNORE` in /reclassify — silently discards user correction on race condition (CR-03, carried from initial verification) | Warning | Pre-existing; not introduced by plan 03-05 |
| `src/routes/api.js` | 1031 | `email_id: req.params.id` string type in SSE payload (CR-04, carried from initial verification) | Info | Pre-existing; not introduced by plan 03-05 |

Note: No TBD, FIXME, or XXX markers in any of the phase-modified files. Plan 03-05 introduced no new anti-patterns.

---

### Human Verification Required

#### 1. Correction Affordance Renders for Non-'other' Category Emails

**Test:** Open any email classified as financial, meeting_request, legal, travel, pitch_deck, fyi, or rewards_awards. Wait 3 seconds. Confirm the Recategorize button appears.

**Expected:** The correction affordance becomes visible for all 8 categories after 3 seconds.

**Why human:** The code change is verified — the div is now in the outer template. Visual confirmation in a running browser is required to confirm the Alpine `x-data` toggle and CSS opacity transition work as intended.

#### 2. End-to-End Correction Flow (Happy Path)

**Test:** Open any email. After 3 seconds, click Recategorize. Select a different category. Observe: (a) badge updates live without page reload, (b) toast "Moved to [Category]. We'll remember this for future emails from [domain].", (c) re-open email and see correction history row.

**Expected:** All three visible signals appear. The affordance is interactive only after 3 seconds (pointer-events: none before the timer fires).

**Why human:** Visual rendering, timer gate, HTMX live-update, and toast display require a running browser.

#### 3. Sender Rule Downstream Effect (Any Original Category)

**Test:** Correct 2 emails from the same sender domain (e.g., alice@example.com, bob@example.com) to the same category. Trigger classification of a new email from that domain. Run: `sqlite3 intellimail.db "SELECT source FROM classifications WHERE email_id = <new_id>"` — expect `rule`.

**Expected:** source = 'rule' confirms Tier 0 fired before LLM.

**Why human:** Requires live server + email ingestion cycle. Backend Tier 0 wiring is confirmed; runtime path needs a real email to traverse it.

---

## Gaps Summary

No gaps remain. The single blocker from the initial verification (CORRECT-03: correction affordance restricted to `other` category) is closed. Codebase evidence:

1. `grep -n "correction-affordance" src/routes/api.js` returns 2 hits — line 585 (outer template, unconditional) and line 678 (timer getElementById). No hit inside the `default:` switch case.
2. `renderActionZone()` default: case (lines 903-929) contains only: data-card (DETECTED TYPE, SOURCE DOMAIN), Delete button, Draft Reply button.
3. 132/132 tests pass. No regressions.

All 7 requirements (CORRECT-01 through CORRECT-07) are VERIFIED at the code level. Three human verification items remain for UI/browser-side behavior — this is expected for an HTMX-rendered frontend and does not represent a code defect.

---

*Verified: 2026-05-15T13:00:00Z*
*Verifier: Claude (gsd-verifier)*
