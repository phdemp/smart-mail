---
phase: 03-user-correction-loop
verified: 2026-05-15T11:30:00Z
status: gaps_found
score: 4/5 roadmap truths verified
overrides_applied: 0
gaps:
  - truth: "A user can correct a wrong category directly from the category badge in the email detail view — no modal, no navigation — and the badge updates live without a page reload"
    status: partial
    reason: "The correction affordance (correction-affordance div + Recategorize picker) is only rendered in the 'default' (other) case of renderActionZone(). Emails classified as meeting_request, financial, legal, travel, pitch_deck, fyi, or rewards_awards have no correction UI at all — 7 of 8 categories are blocked. The backend /reclassify endpoint and SSE live-update are fully implemented; only the UI rendering is gated to 'other'."
    artifacts:
      - path: "src/routes/api.js"
        issue: "correction-affordance div (lines 903-925) lives inside the default: branch of renderActionZone(). Lines 667-872 cover meeting_request, financial, legal, travel, pitch_deck, fyi, and rewards_awards without any correction affordance element."
    missing:
      - "Move the correction-affordance div and its Recategorize button outside the switch statement in renderActionZone() so it renders for all categories, not just 'other'"
      - "The 3-second timer script at lines 647-659 already guards with `if (el && ...)` — no change needed there once the element is rendered for all categories"
human_verification:
  - test: "Correction affordance availability across categories"
    expected: "Open an email classified as 'financial' (or any non-other category). After 3 seconds, a correction affordance / Recategorize option should appear. Select a different category; the badge should update live and a toast should show the domain memory message."
    why_human: "The correction-affordance div is absent from all non-'other' categories — this cannot be triggered programmatically without a running browser. A human must confirm the current broken state and verify any fix."
  - test: "Sender rule promotion applies to emails that arrive classified into any category"
    expected: "After correcting 2 emails from the same domain (regardless of original category), the sender_rules row should be created and future emails from that domain should be auto-classified via Tier 0."
    why_human: "Since corrections can only currently be made for 'other' category emails, the sender-rule loop is narrowed to that category only. A human should verify whether the domain accumulation goal is met in practice."
---

# Phase 3: User Correction Loop Verification Report

**Phase Goal:** Users can mark a wrong classification, the system confirms the correction visibly, and corrections from the same sender accumulate into a persistent rule — closing the feedback loop with a real downstream consumer
**Verified:** 2026-05-15T11:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can correct wrong category from email detail, badge updates live without reload | PARTIAL | Backend wired; UI affordance only renders for `other` category emails (7 of 8 categories blocked) |
| 2 | Toast confirms "Moved to [Category]. We'll remember this for future emails from [domain]." | VERIFIED | `app.js:214` — `showToast('info', \`Moved to ${categoryLabel(d.category)}. We'll remember this for future emails from ${d.domain}.\`)` |
| 3 | After 2+ corrections same sender domain/category, sender-rule stored and applied before regex/LLM | VERIFIED | `src/db.js:287-300` (sender_rules table), `src/routes/api.js:1013-1027` (COUNT + UPSERT), `src/classifier.js:179-197` (Tier 0 lookup before rulesClassify) |
| 4 | Correction history (corrected category, timestamp) visible in email detail panel | VERIFIED | `src/routes/api.js:533-538` — conditional `cls?.user_corrected_category` row rendered in email header |
| 5 | Thumbs up/down stored to ai_feedback table; no re-generation triggered | VERIFIED | `src/routes/api.js:1045-1070` — `/feedback` endpoint with vote validation, UPSERT on cls.id, outerHTML "Thanks!" swap |

**Score:** 4/5 truths verified (1 partial — counts as failed for gate purposes)

---

### Requirement Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| CORRECT-01 | `user_corrected_category TEXT` and `corrected_at DATETIME` added to classifications via ALTER TABLE guards | VERIFIED | `src/db.js:283-284` — `ALTER TABLE classifications ADD COLUMN user_corrected_category TEXT` and `ALTER TABLE classifications ADD COLUMN corrected_at DATETIME` |
| CORRECT-02 | POST endpoint accepts category, validates against CATEGORIES enum, writes both columns, broadcasts classification_updated SSE | VERIFIED | `src/routes/api.js:983-1043` — endpoint exists, validates `validCategories`, writes `user_corrected_category` + `corrected_at`, calls `broadcast('classification_updated', ...)`. Note: endpoint is `/reclassify` (existing, extended) not `/correct` (new) per D-01 context decision |
| CORRECT-03 | Correction affordance on category badge, inline picker, no modal, visible after 3-second read timer | PARTIAL | 3-second timer script present (api.js:647-659), correction-affordance div present (api.js:903-925), but ONLY rendered for `other` category. All other categories (meeting_request, financial, legal, travel, pitch_deck, fyi, rewards_awards) have no affordance element. |
| CORRECT-04 | Toast confirms "Moved to [Category]. We'll remember this for future emails from [sender domain]." | VERIFIED | `public/js/app.js:214` — exact message format with `categoryLabel(d.category)` and `d.domain` |
| CORRECT-05 | After 2+ corrections from same sender domain to same category, Tier 1 sender-rule stored; applied before regex rules on future emails | VERIFIED | sender_rules table in db.js; COUNT JOIN query in api.js; Tier 0 in classifier.js before `rulesClassify()` call |
| CORRECT-06 | Correction history visible in email detail panel | VERIFIED | `src/routes/api.js:533-538` — conditional row shows "Corrected to: [Category] at [timestamp]" |
| CORRECT-07 | Thumbs up/down stored to ai_feedback table; UPSERT; no re-generation | VERIFIED | ai_feedback table in db.js with CHECK constraint; `/feedback` endpoint with UPSERT; "Thanks!" outerHTML response |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tests/correction.test.js` | 10-test Wave 0 contract | VERIFIED | 200 lines, 10 passing tests confirmed by `node --test tests/correction.test.js` — 10/10 pass |
| `src/db.js` | Phase 3 migration blocks | VERIFIED | Lines 280-316: ALTER TABLE for audit columns, CREATE TABLE sender_rules + UNIQUE INDEX, CREATE TABLE ai_feedback + UNIQUE INDEX |
| `src/classifier.js` | Tier 0 sender-rule lookup before Tier 1 | VERIFIED | Lines 179-197 — domain extraction, sender_rules SELECT, storeClassification with source='rule', return |
| `src/routes/api.js` | Extended /reclassify + /feedback endpoint + correction history + thumbs widget | PARTIAL | /reclassify extended (lines 983-1043), /feedback added (lines 1045-1070), thumbs widget present (lines 551-564), correction history present (lines 533-538), setBroadcast exported (line 1529). PARTIAL because correction-affordance div only in default case |
| `src/server.js` | setApiBroadcast injection | VERIFIED | Lines 65-66 — `const { setBroadcast: setApiBroadcast } = require('./routes/api')` + `setApiBroadcast(broadcast)` |
| `public/js/app.js` | classification_updated SSE listener | VERIFIED | Lines 210-224 — listener calls showToast, htmx.ajax detail re-render, htmx.trigger categoryChange |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/server.js` | `src/routes/api.js` | `setApiBroadcast(broadcast)` after router mount | WIRED | `server.js:65-66` imports and calls setApiBroadcast |
| `src/routes/api.js /reclassify` | `broadcast()` | module-level broadcast stub | WIRED | `api.js:10` — `let broadcast = () => {};`; called at line 1031 |
| `public/js/app.js connectSSE()` | showToast + htmx.ajax | `es.addEventListener('classification_updated', ...)` | WIRED | `app.js:210-224` |
| `src/classifier.js classifyEmail()` | sender_rules table | `db.prepare().get(userId, domain)` | WIRED | `classifier.js:182-184` — SELECT with both user_id and domain bound |
| `src/routes/api.js /reclassify` | sender_rules table | COUNT JOIN + INSERT OR REPLACE | WIRED | `api.js:1013-1027` |
| `src/routes/api.js /feedback` | ai_feedback table | `INSERT OR REPLACE` with cls.id as summary_id | WIRED | `api.js:1061-1064` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/routes/api.js` correction history row | `cls.user_corrected_category`, `cls.corrected_at` | `classifications` table SELECT in email detail handler | Yes — populated by /reclassify INSERT | FLOWING |
| `public/js/app.js` SSE classification_updated | `d.category`, `d.domain` | broadcast payload from /reclassify endpoint | Yes — domain from email.from_address, category from req.body | FLOWING |
| `src/routes/api.js` thumbs widget | `cls.id` | classifications SELECT in email detail handler | Yes — actual classification row id | FLOWING |
| `src/classifier.js` Tier 0 | `senderRule.category` | `sender_rules` SELECT by (userId, domain) | Yes — populated by /reclassify UPSERT after 2 corrections | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| correction.test.js — 10 schema + DB-layer tests | `node --test tests/correction.test.js` | 10/10 pass, exit 0, 207ms | PASS |
| Full test suite — no regressions | `node --test "tests/**/*.test.js"` | 132/132 pass, exit 0, 3361ms | PASS |
| db.js idempotent re-require | `node -e "require('./src/db')"` | Cannot run without full server context on Windows shell; confirmed by SUMMARY.md self-check and test suite which exercises db.js | SKIP |
| classifier.js loadable | `node -e "require('./src/classifier')"` | Cannot run cleanly without imap dependencies on this shell; confirmed by test suite passing | SKIP |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/routes/api.js` | 1003 | `INSERT OR IGNORE` in /reclassify — silently discards user correction on race condition | Warning | If concurrent classifier queued job writes first between DELETE+INSERT, user correction is silently lost (CR-03 from code review) |
| `src/routes/api.js` | 1031 | `email_id: req.params.id` — string type in SSE payload; client may compare against integer IDs | Info | htmx.ajax URL works, but type inconsistency is fragile (CR-04 from code review) |
| `src/routes/api.js` | 903-925 | correction-affordance div only in `default` case of renderActionZone | Blocker | 7 of 8 categories cannot be corrected via UI |

Note: No TBD, FIXME, or XXX markers found in any of the 5 Phase 3 modified files.

---

### Human Verification Required

#### 1. Correction Affordance for Non-'other' Categories

**Test:** Open any email classified as financial, meeting_request, legal, travel, pitch_deck, fyi, or rewards_awards. Wait 3 seconds. Check whether a correction UI (Recategorize button + category picker) appears.

**Expected:** A correction affordance should appear after 3 seconds for ALL category emails.

**Why human:** The code shows the correction-affordance div is only rendered in the `default:` (other) case of `renderActionZone()`. For all other categories this UI element is absent. Human must confirm the broken state before fix.

#### 2. End-to-End Correction Flow (Happy Path)

**Test:** Open an email classified as 'other'. Wait 3 seconds. Click Recategorize. Select 'financial'. Observe: (a) badge update without page reload, (b) toast with domain memory message, (c) on re-open: correction history row showing "Corrected to: Financial at [timestamp]".

**Expected:** All three visible signals appear. The correction affordance is interactive after 3 seconds, not before.

**Why human:** Visual rendering, 3-second timer behavior, and HTMX live-update can only be confirmed in a running browser.

#### 3. Sender Rule Downstream Effect

**Test:** Correct 2 emails from the same domain (e.g., alice@example.com and bob@example.com) to the same category. Then trigger classification of a new email from that domain. Check: `sqlite3 intellimail.db "SELECT source FROM classifications WHERE email_id = <new_email_id>"` should return `rule`.

**Expected:** source = 'rule' confirms Tier 0 fired.

**Why human:** Requires actual email ingestion + classification cycle; cannot automate without server running.

---

## Gaps Summary

**Root cause:** The correction affordance UI (`correction-affordance` div + Recategorize button + category picker) was placed inside the `default:` branch of `renderActionZone()` — the branch that handles only the 'other' category. All seven other named categories (meeting_request, financial, legal, travel, pitch_deck, fyi, rewards_awards) return their action zones without any correction UI.

**Impact:** The phase goal "Users can mark a wrong classification" is technically satisfied only for emails that land in the 'other' bucket — the least common outcome for well-functioning classification. The sender-rule promotion feature (CORRECT-05), while correctly implemented in the backend, is only reachable through corrections on 'other' emails, limiting its practical value.

**Fix scope:** Single change in `src/routes/api.js` — move the correction-affordance div and Recategorize button from inside `renderActionZone()` `default:` case to the outer email detail template (after the `actionZone` section). The 3-second timer script already lives in the outer template and correctly no-ops when the element is absent; it will work correctly once the element is unconditionally rendered.

The backend (API endpoint, SSE broadcast, sender-rule logic, Tier 0 classifier, ai_feedback table) is fully implemented and tested. The gap is purely in the HTML template rendering path.

---

*Verified: 2026-05-15T11:30:00Z*
*Verifier: Claude (gsd-verifier)*
