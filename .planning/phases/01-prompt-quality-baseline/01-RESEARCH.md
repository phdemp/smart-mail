# Phase 1: Prompt Quality Baseline - Research

**Researched:** 2026-05-14
**Domain:** LLM prompt engineering, provider JSON modes, classification reliability, eval corpus design — brownfield Node.js/CommonJS
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Source emails from the live `intellimail.db` via a DB export script. Real production emails — not synthetic.
- **D-02:** Ground-truth labels are set manually by the user. Do not use existing `classifications` rows as ground truth and do not use LLM-as-judge labeling.
- **D-03:** Corpus schema: `{ id, subject, from, body_snippet, ground_truth_category }`. No urgency ground truth, no notes field in v1.
- **D-04:** Baseline scoring via `scripts/eval-corpus.js` Node.js script. Outputs category accuracy % to stdout. Must be run before and after every prompt change.
- **D-05:** Corpus file lives at `.planning/eval/corpus.json`. Baseline scores recorded in `.planning/eval/baseline.md`.
- **D-06:** Add `buildDraftPrompt(email, opts)` to `src/llm/providers/base.js`. `buildPrompt()` becomes Call A (classification only, no draft_reply). `buildDraftPrompt()` is Call B.
- **D-07:** Add `router.generateDraft(email, opts)` to `src/llm/router.js`. `classifier.js generateDraft()` calls `router.generateDraft()` instead of `router.classify()`.
- **D-08:** Draft generation is triggered on-demand when user clicks Reply. Never during email sync.
- **D-09:** Call B receives email fields only (subject, from, body_text). Thread context is Phase 2.
- **D-10:** `storeClassification()` continues to create a placeholder draft row (`body = ''`). When user clicks Reply, API calls `router.generateDraft()` and updates the row body. UI shows "Generating…" state.
- **D-11:** Add one-line definitions for all 8 categories in `SYSTEM_PROMPT`, plus explicit disambiguation rules for 3 confused pairs: fyi vs other, rewards_awards vs fyi, meeting_request vs other.
- **D-12:** Few-shot examples go at the end of `SYSTEM_PROMPT`, after the rules section. 1–2 examples per confused pair.
- **D-13:** Example format: `Subject: [subject], From: [sender] → [category] (not [confused_category]: [one-line reason])`.
- **D-14:** Update each provider file individually. No centralized abstraction in base.js.
- **D-15:** NVIDIA — already has `response_format: { type: 'json_object' }` and `temperature: 0.1`. No changes needed.
- **D-16:** Groq — add `response_format: { type: 'json_object' }` (basic mode first). Upgrade to strict schema only if parse errors observed in production after rollout.
- **D-17:** Gemini — add `responseMimeType: 'application/json'` to `generationConfig`. No `responseSchema` in Phase 1.
- **D-18:** DeepSeek — add `response_format: { type: 'json_object' }` (OpenAI-compatible, same pattern as NVIDIA/Groq).
- **D-19:** `parseProviderResponse()` gets a 4th path: when `extractJsonBlock()` returns null, store DEFAULTS with `error: 'parse_failure'` and log at WARN with provider name and raw response excerpt (first 200 chars). No throw.
- **D-20:** Classification queue gets a per-email attempt counter. After 3 failed attempts, store `source: 'failed'` and stop retrying. UI treats `source: 'failed'` as "Classification failed".

### Claude's Discretion

- Body field truncation length for `buildDraftPrompt()` (research suggests 800–1000 chars; match or slightly exceed `buildPrompt()`'s current 800-char limit)
- Exact wording of category one-liners in `SYSTEM_PROMPT` (keep concise, avoid verbose definitions)
- Whether `low_confidence: true` flag is stored as a column on `classifications` or only returned in the router response (REQUIREMENTS.md says attach to result; storage decision is Claude's call)

### Deferred Ideas (OUT OF SCOPE)

- Thread context for Call B (draft prompt) — Phase 2
- Per-provider prompt variants (lighter system prompt for Groq strict mode, more explicit rules for DeepSeek) — deferred
- Correction-informed prompting — needs correction corpus from Phase 3 first
- Groq strict schema mode upgrade — deferred until parse error data from Phase 1 rollout
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVAL-01 | Corpus of 30–50 real emails with ground-truth category labels in `.planning/eval/corpus.json` before any prompt is changed | DB export script reads emails table; schema defined below |
| EVAL-02 | Baseline accuracy scores recorded in `.planning/eval/baseline.md`; re-run after every prompt change | eval-corpus.js runs classifier.classifyEmail equivalent against corpus; compares category output |
| PROMPT-01 | Monolithic 7-field prompt split into Call A (classification) + Call B (draft, on-demand only) | base.js line-by-line analysis shows exactly what to add/remove |
| PROMPT-02 | System prompt includes one-line boundary definitions for each of the 8 categories | SYSTEM_PROMPT in base.js is single source of truth; all 4 providers import it |
| PROMPT-03 | 1–2 few-shot examples for each of the 3 most confused boundaries | Examples appended at end of SYSTEM_PROMPT after rules section |
| PROMPT-04 | Temperature set explicitly on all 4 providers: 0.0–0.1 for Call A, 0.3–0.5 for Call B | CRITICAL DISCOVERY: All 4 providers already have temperature: 0.1; Call B needs 0.3–0.5 |
| PROMPT-05 | Summary output constrained structurally ("one sentence that states what action is needed") | SYSTEM_PROMPT schema comment for summary field updated; no length limit |
| PROMPT-06 | Provider-native JSON output modes enabled on all 4 adapters; extractJsonBlock() fallback retained | CRITICAL DISCOVERY: Groq, DeepSeek, NVIDIA already have response_format; Gemini has responseMimeType |
| PROMPT-07 | `low_confidence: true` flag attached to any parsed result where category fell back to default | parseProviderResponse() tracks when category was out-of-enum; flag added to return value |
| INFRA-01 | 4th parse fallback path: on parse failure store DEFAULTS with error: 'parse_failure', log WARN | Currently parseProviderResponse() throws on null JSON — change to return DEFAULTS + WARN |
| INFRA-02 | Per-email retry cap of 3 total attempts; exhausted emails stored with source: 'failed' | Queue state lives in classifier.js Map; attempt counter added per email entry |
</phase_requirements>

---

## Summary

This phase is a deep codebase modification task, not a research-from-scratch task. The prior project research (`.planning/research/SUMMARY.md`) has already resolved all external questions at HIGH confidence. The researcher's value here is exact current-state analysis of every file to be touched.

**Two critical discoveries change the work scope from what CONTEXT.md describes:**

1. **Groq, DeepSeek, and NVIDIA already have `response_format: { type: 'json_object' }` and `temperature: 0.1`.** These three providers are done for PROMPT-04 and PROMPT-06. Only Gemini needs a change (it already has `responseMimeType` but is missing the `temperature` field for Call B). The CONTEXT.md said "NVIDIA already correct; Groq and DeepSeek need response_format added" — but the actual source shows Groq and DeepSeek already have it too.

2. **`parseProviderResponse()` currently throws on JSON parse failure** (line 68–71 of base.js). The 4th fallback path (INFRA-01) requires changing a throw to a WARN + return DEFAULTS. The existing `extractJsonBlock()` already handles 3 paths; the 4th is purely additive.

**Primary recommendation:** Wave 0 of planning must create the eval corpus before touching any prompt. The sequencing constraint is hard: EVAL-01 and EVAL-02 must complete before PROMPT-01 through PROMPT-07 can be validated.

[VERIFIED: direct codebase read of all 5 provider/base/router/classifier files]

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Eval corpus export | Scripts (offline) | DB (SQLite read) | One-time export from live DB; not a server endpoint |
| Eval scoring | Scripts (offline) | LLM router | Runs current classifier logic against corpus; no server needed |
| SYSTEM_PROMPT (category definitions, few-shot) | LLM layer (base.js) | All 4 providers (import it) | Single source of truth; changes propagate to all providers automatically |
| buildPrompt / buildDraftPrompt | LLM layer (base.js) | Provider adapters (call it) | Prompt construction is provider-agnostic; providers pass opts through |
| JSON output mode per provider | Provider adapter (per file) | — | D-14: no centralized abstraction; each file controls its own request body |
| generateDraft() routing | LLM router (router.js) | classifier.js (calls it) | New method alongside classify(); same cascade pattern |
| Draft generation trigger | API route (api.js) | classifier.js (generateDraft) | POST /api/emails/:id/draft/regen already exists and calls classifier.generateDraft() |
| parseProviderResponse() 4th path | LLM layer (base.js) | — | INFRA-01: change throw to WARN + return DEFAULTS |
| Per-email retry cap | classifier.js (queue state) | — | INFRA-02: Map-based queue already exists; add attempts counter per email |
| low_confidence flag | base.js (parseProviderResponse) | router.js (pass-through) | Derived from enum-miss detection; attached to parsed result |
| DB column for low_confidence (if stored) | db.js (inline migration) | classifier.js (storeClassification) | Use addColumn() guard pattern — identical to how source was added |

---

## Standard Stack

### Core (unchanged — no new dependencies)

| Component | Current Version | Purpose | Status |
|-----------|----------------|---------|--------|
| Node.js built-in test runner | v24.11.1 (confirmed) | All tests use `node:test` + `node:assert/strict` | No install needed |
| better-sqlite3 | ^12.6.2 | Synchronous SQLite — used for all DB ops including eval script | Already installed |
| CommonJS (`require`/`module.exports`) | N/A | Module system throughout — eval script must use require, not import | Convention |

**Installation:** None. Zero new dependencies for Phase 1. [VERIFIED: package.json]

### Key Constants (from base.js — already exist)

```javascript
// [VERIFIED: src/llm/providers/base.js lines 1-16]
const CATEGORIES = [
  'meeting_request', 'financial', 'legal', 'travel',
  'pitch_deck', 'fyi', 'rewards_awards', 'other'
];
const URGENCIES = ['urgent', 'moderate', 'normal'];
const TONES = ['formal', 'professional', 'friendly', 'brief'];
const DEFAULTS = {
  category: 'other',
  urgency: 'normal',
  urgency_reason: null,
  summary: 'Classification unavailable.',
  extracted_data: {},
  suggested_tone: 'professional',
  draft_reply: 'Thank you for your email. I will review and respond shortly.'
};
```

---

## Architecture Patterns

### System Architecture Diagram

```
[User clicks Reply]
       |
       v
POST /api/emails/:id/draft/regen (api.js:999)
       |
       v
classifier.generateDraft(userId, emailId)   <-- CURRENTLY calls router.classify({mode:'regen'})
       |                                         WILL call router.generateDraft() after Phase 1
       v
router.generateDraft(email, opts)          <-- NEW method in router.js (alongside classify())
       |
       v
provider.call(email, {mode:'draft'}, cfg)  <-- Uses buildDraftPrompt() — Call B (temperature 0.3-0.5)
       |
       v
parseProviderResponse(raw)                 <-- Extracts draft_reply field only
       |
       v
UPDATE drafts SET body=? WHERE email_id=?  <-- Updates placeholder row (body was '')


[Email sync — NEVER calls generateDraft]
IMAP -> imap.js -> queueClassification(userId, emailId)
       |
       v
classifier.classifyEmail(userId, emailId)
       |
       +-- Tier 1: rulesClassify() (instant, no LLM)
       |
       +-- Tier 2: router.classify(email, {mode:'full'}) -- Call A only
                   |
                   v
              parseProviderResponse()  <-- 4th path: null JSON -> DEFAULTS + WARN (INFRA-01)
                   |
                   v
              storeClassification()   <-- includes attempt tracking (INFRA-02)
                   |
                   v
              storeClassification() also creates placeholder drafts row (body='')


[Eval script — offline]
node scripts/eval-corpus.js
       |
       v
Read .planning/eval/corpus.json
       |
       v
For each email: call provider cascade (same as classifyEmail, but direct)
OR: load SYSTEM_PROMPT + buildPrompt -> call provider API -> parse
       |
       v
Compare output.category vs ground_truth_category
       |
       v
Print accuracy report to stdout; write .planning/eval/baseline.md
```

### Recommended Project Structure (Phase 1 additions)

```
scripts/
  eval-corpus.js       # NEW: offline eval runner
.planning/
  eval/
    corpus.json        # NEW: 30-50 labeled emails (created by eval script, labeled by user)
    baseline.md        # NEW: accuracy scores before/after each prompt change
src/
  llm/
    providers/
      base.js          # MODIFY: buildDraftPrompt(), parseProviderResponse() 4th path, SYSTEM_PROMPT
      gemini.js        # MODIFY: temperature added for Call B support (other 3 already have it)
      groq.js          # NO CHANGE NEEDED (already has response_format + temperature)
      nvidia.js        # NO CHANGE NEEDED (already has response_format + temperature)
      deepseek.js      # NO CHANGE NEEDED (already has response_format + temperature)
    router.js          # MODIFY: add generateDraft() method
  classifier.js        # MODIFY: generateDraft() redirected; INFRA-02 attempt counter
```

### Pattern 1: 4th Parse Fallback Path (INFRA-01)

**What:** Change the throw in `parseProviderResponse()` to return DEFAULTS with a logged WARN.

**Current code (base.js lines 65-71):**
```javascript
// [VERIFIED: src/llm/providers/base.js]
function parseProviderResponse(raw) {
  if (typeof raw !== 'string') {
    throw new Error('could not parse provider response: not a string');   // keep this throw
  }
  const obj = extractJsonBlock(raw);
  if (!obj || typeof obj !== 'object') {
    throw new Error('could not parse provider response: no JSON object found');  // CHANGE THIS
  }
  // ...
}
```

**After Phase 1 (4th fallback):**
```javascript
function parseProviderResponse(raw, opts = {}) {
  if (typeof raw !== 'string') {
    throw new Error('could not parse provider response: not a string');
  }
  const obj = extractJsonBlock(raw);
  if (!obj || typeof obj !== 'object') {
    // 4th path: log WARN, return DEFAULTS — no throw
    const provider = opts.provider || 'unknown';
    const excerpt = raw.slice(0, 200);
    console.warn(`[llm/base] parse_failure provider=${provider} raw="${excerpt}"`);
    return { ...DEFAULTS, error: 'parse_failure', low_confidence: true };
  }
  // ... existing validation logic unchanged ...
  // low_confidence: true when category was out-of-enum (fell back to DEFAULTS.category)
  const categoryMissed = !CATEGORIES.includes(obj.category);
  // ... (set out.low_confidence = categoryMissed) ...
}
```

**Note:** The caller (router.js `classify()`) currently wraps `parseProviderResponse` in a try/catch and maps the error to `'invalid_json'` outcome. After INFRA-01, parse failures no longer throw — they return a valid object. The router catch block still handles the "not a string" throw (raw response absent entirely). The `error: 'parse_failure'` field is stored by `storeClassification()` for INFRA-02 tracking. [VERIFIED: base.js + router.js]

### Pattern 2: router.generateDraft() Alongside classify()

**What:** New method in `createRouter()` that uses buildDraftPrompt() at higher temperature.

**Current state:** `generateDraft()` in classifier.js (line 274-283) calls `router.classify(email, {mode:'regen'})` which routes through the standard `classify()` method. This is wrong because it uses Call A temperature (0.1) and returns a full classification result when only draft_reply is needed.

**After Phase 1:**
```javascript
// router.js — add inside createRouter() alongside classify()
async function generateDraft(email, opts = {}) {
  // Same cascade logic as classify(), but:
  // 1. Uses buildDraftPrompt() via opts.mode='draft'
  // 2. Temperature 0.3-0.5 (passed via opts or set in provider)
  // 3. Only parses draft_reply from the response
  // Implementation mirrors classify() — same breaker/bucket/quota checks
  // Returns: { draft_reply: string, _provider: name } or null
}
```

**classifier.js change (line 278):**
```javascript
// BEFORE:
const routed = await llm.router.classify(email, { mode: 'regen', userId });
return routed?.draft_reply || 'Thank you...';

// AFTER:
const routed = await llm.router.generateDraft(email, { mode: 'draft', tone: opts.tone, userId });
return routed?.draft_reply || 'Thank you...';
```

### Pattern 3: Per-Email Attempt Counter (INFRA-02)

**What:** Add attempt tracking to the in-memory queue state.

**Current queue state (classifier.js line 12):**
```javascript
// [VERIFIED: src/classifier.js]
const queues = new Map(); // userId -> { queue: [], processing: false }
```

**After Phase 1:**
```javascript
const queues = new Map(); // userId -> { queue: [], processing: false }
const attempts = new Map(); // `${userId}::${emailId}` -> attemptCount

const MAX_ATTEMPTS = 3;
```

In `classifyEmail()`, before calling router:
```javascript
const attemptKey = `${userId}::${emailId}`;
const currentAttempts = (attempts.get(attemptKey) || 0) + 1;
attempts.set(attemptKey, currentAttempts);
if (currentAttempts > MAX_ATTEMPTS) {
  storeClassification(userId, emailId, { ...fallbackClassification(), source: 'failed' });
  attempts.delete(attemptKey);
  return;
}
```

**Cleanup:** On successful classification, delete the attempt counter. The Map is in-memory — lost on restart, which is acceptable since `classifyAllUnclassifiedForUser()` re-queues on startup.

### Pattern 4: buildDraftPrompt() — New Function in base.js

**What:** Sibling to `buildPrompt()` for Call B.

```javascript
// [ASSUMED wording — exact temperature range is Claude's discretion]
function buildDraftPrompt(email, opts = {}) {
  const lines = [];
  lines.push('You are drafting a reply email on behalf of the recipient.');
  lines.push('Write a direct, complete reply. 2-4 sentences. No subject line. No placeholder text.');
  lines.push('');
  lines.push(`From: ${email.from_name || ''} <${email.from_address || ''}>`);
  lines.push(`Subject: ${email.subject || ''}`);
  const body = (email.body_text || email.preview || '').slice(0, 800); // 800 matches Call A
  if (body) lines.push('', body);
  if (opts.tone) lines.push('', `Write in a ${opts.tone} tone.`);
  return lines.join('\n');
}
```

**Temperature for Call B:** The provider's `call()` function receives `opts`. The new `generateDraft()` method in router.js passes `temperature: 0.4` (midpoint of 0.3–0.5 range) via providerCfg or opts. Implementation detail: providers currently hardcode temperature. For Call B, the router passes a `temperature` override in opts, and providers read `opts.temperature || 0.1`.

### Pattern 5: SYSTEM_PROMPT Category Definitions (PROMPT-02 + PROMPT-03)

**Current SYSTEM_PROMPT (base.js lines 18-35):**
```
You are an email classifier for IntelliMail. Classify the email below.

Respond with a single JSON object matching this schema — and nothing else:
{
  "category": one of [...],
  "urgency": ...,
  "urgency_reason": ...,
  "summary": one-line summary (max 120 chars),   <-- PROMPT-05: change to structural constraint
  "extracted_data": ...,
  "suggested_tone": ...,
  "draft_reply": a complete suggested reply       <-- PROMPT-01: REMOVE this field from Call A
}

Rules:
- Legal emails are always urgent.
- Calendar invites / Zoom / Teams / Meet links are meeting_request.
- Newsletters, digests, noreply senders are fyi.
- If unsure, use "other".
```

**After Phase 1 (SYSTEM_PROMPT):**
- Remove `"draft_reply"` from the schema block (Call A no longer produces it)
- Change `"summary"` description from `"one-line summary (max 120 chars)"` to `"one sentence: what happened and what action (if any) the recipient needs to take — do not repeat the subject line"`
- Add category definitions block immediately after the enum
- Add disambiguation rules for the 3 confused pairs
- Add few-shot examples at the end

**DEFAULTS in base.js also needs update:**
- Remove `draft_reply` from DEFAULTS (or keep it null — `parseProviderResponse()` currently merges it; after Call A no longer requests it, the field will always be the default)
- Actually: keep DEFAULTS.draft_reply as null or empty string; the parseProviderResponse for Call A won't find it in the LLM output but the fallback is harmless

### Anti-Patterns to Avoid

- **Modifying `router.js` classify() for temperature:** Do not add temperature logic to the existing classify() method. Temperature for Call B belongs in generateDraft() + provider call, not classify().
- **Centralized JSON mode abstraction in base.js:** D-14 explicitly forbids this. Each provider file is the authority on its own request shape.
- **Calling generateDraft() during email sync:** The imap.js → classifier.classifyEmail() path must never reach generateDraft(). The placeholder draft row (body='') created by storeClassification() is the mechanism.
- **Throwing in parseProviderResponse() for JSON parse failures:** INFRA-01 changes this to WARN + return DEFAULTS. The "not a string" case can still throw.
- **Storing full email body in corpus.json:** D-03 specifies body_snippet only (first N chars). The eval corpus is not a full email dump.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON parse from LLM response | Custom regex parser | `extractJsonBlock()` (already exists in base.js) | Handles 3 fallback paths; battle-tested in production |
| DB schema evolution | Raw ALTER TABLE | Inline try/catch pattern in db.js (already established) | Idempotent, production-safe; same pattern used 15+ times |
| Test DB isolation | Shared intellimail.db | Set `process.env.DB_PATH` to unique file per suite (established pattern) | Every existing test does this |
| Provider error classification | New error types | `classifyError()` in router.js (already handles 7 outcomes) | Add `'parse_failure'` to the existing set |
| Rate limit / circuit breaker | Custom retry logic | Existing `buckets`/`breakers` Maps in router.js | Already handles quota, 429, 401, 503, network errors |

---

## Current State: File-by-File Analysis

This is the highest-value section for the planner. Every file to be modified is analyzed to line-level precision. [VERIFIED: all files read directly]

### `src/llm/providers/base.js` — PRIMARY CHANGE FILE

**Lines 1-16:** CATEGORIES, URGENCIES, TONES, DEFAULTS constants — no change needed to the constants themselves. DEFAULTS.draft_reply will become unused by Call A but is harmless to leave.

**Lines 18-35: SYSTEM_PROMPT** — requires 4 changes:
1. Remove `"draft_reply": a complete suggested reply` from the schema block (PROMPT-01)
2. Change `"summary": one-line summary (max 120 chars)` to structural constraint (PROMPT-05)
3. Add category definitions after the enum listing (PROMPT-02)
4. Add few-shot disambiguation examples at end, after Rules section (PROMPT-03)

**Lines 37-49: `buildPrompt(email, opts = {})`** — 2 changes:
1. Remove `opts.mode === 'regen'` branch (lines 45-47) — this branch added draft tone instruction to Call A. Call B now has its own prompt function.
2. Optionally: strip leading `>` quoted-reply lines from body before slicing (improves quality but is deferred to Phase 2 per CONTEXT.md — not needed here)

**Lines 51-63: `extractJsonBlock(text)`** — NO CHANGE. This function is the fallback for providers that ignore JSON mode flags. Must be preserved.

**Lines 65-85: `parseProviderResponse(raw)`** — 3 changes:
1. Add `opts = {}` parameter to accept `{ provider: name }` for logging
2. Change line 70 (`throw new Error('could not parse...')`) to WARN + return DEFAULTS with `error: 'parse_failure'` (INFRA-01)
3. Add `low_confidence: true` to returned object when `obj.category` was not in CATEGORIES (PROMPT-07)

**Lines 87-91: `module.exports`** — Add `buildDraftPrompt` to exports.

**New function: `buildDraftPrompt(email, opts = {})`** — Insert between buildPrompt and extractJsonBlock. ~15 lines.

### `src/llm/providers/nvidia.js` — NO CHANGES NEEDED

**VERIFIED actual state:**
- Line 24: `response_format: { type: 'json_object' }` — already present
- Line 23: `temperature: 0.1` — already present
- PROMPT-04 and PROMPT-06 are already satisfied for NVIDIA

**The only change that COULD apply:** If router.generateDraft() passes temperature via opts, nvidia.js would need to read `opts.temperature || 0.1`. This depends on implementation choice in router.js. If temperature is hardcoded per-provider, no change needed. If it's passed via opts, a one-line change on line 23.

### `src/llm/providers/groq.js` — NO CHANGES NEEDED (or minor temperature read)

**VERIFIED actual state:**
- Line 22: `response_format: { type: 'json_object' }` — already present
- Line 21: `temperature: 0.1` — already present
- PROMPT-04 and PROMPT-06 are already satisfied for Groq

**CONTEXT.md D-16 was incorrect:** It said "Groq — add response_format." The code already has it. No JSON mode work needed.

Same temperature note as NVIDIA: if Call B temperature is passed via opts, one-line change to read `opts.temperature || 0.1`.

### `src/llm/providers/gemini.js` — MINOR CHANGE

**VERIFIED actual state:**
- Line 29: `generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }` — ALREADY HAS BOTH

**CONTEXT.md D-17 was partially incorrect:** It said "add responseMimeType." The code already has both temperature and responseMimeType. PROMPT-04 and PROMPT-06 are already satisfied for Gemini too.

**The only real change:** If Call B needs temperature 0.3-0.5 for Gemini, it must be passed via opts (same pattern as other providers).

**Important Gemini-specific:** Gemini does NOT use the `messages` array format. It uses `contents` (line 27). And it concatenates SYSTEM_PROMPT + buildPrompt() in the user content (line 28), unlike the other 3 which use a separate `system` role message. This means:
- `buildDraftPrompt()` in Gemini must be concatenated the same way: `SYSTEM_PROMPT_DRAFT + '\n\n' + buildDraftPrompt()`
- OR the router passes the prompt as a string and Gemini's call() function uses it directly
- The cleanest approach: Gemini's `call()` receives `opts.isDraft` or `opts.mode === 'draft'` and switches to `buildDraftPrompt()` internally

### `src/llm/providers/deepseek.js` — NO CHANGES NEEDED (or minor temperature read)

**VERIFIED actual state:**
- Line 22: `response_format: { type: 'json_object' }` — already present
- Line 21: `temperature: 0.1` — already present
- PROMPT-04 and PROMPT-06 are already satisfied for DeepSeek

**CONTEXT.md D-18 was incorrect:** It said "DeepSeek — add response_format." Already present.

### `src/llm/router.js` — ADD generateDraft()

**Current exports (line 175):**
```javascript
return { classify, _byName: byName, getProviderHealth, getObservedLimits, setObservedLimits };
```

**Add `generateDraft` to this return object.**

**generateDraft() implementation strategy:** The method reuses the entire cascade logic from `classify()`. Two implementation options:

Option A: Duplicate the loop body (fragile, but explicit about the differences)
Option B: Extract the cascade loop into a shared `_cascade(email, opts, buildPromptFn, parseFn)` function and call it from both `classify()` and `generateDraft()` — cleaner but touches existing code more

**Recommendation:** Option A for Phase 1 (minimal risk). The loop is ~80 lines. The key differences in generateDraft():
- Calls `buildDraftPrompt()` via opts (providers receive `mode: 'draft'`)
- Temperature 0.4 passed via opts (providers read `opts.temperature || 0.1`)
- Only extracts `draft_reply` from parsed result (other fields discarded)
- Returns `{ draft_reply: string, _provider: name }` or null

**Test impact:** `tests/llm/router.test.js` tests will need one new test block for generateDraft(). Existing tests are not affected by adding a new method.

### `src/classifier.js` — THREE CHANGES

**Change 1 — generateDraft() (lines 274-283):**
```javascript
// BEFORE:
const routed = await llm.router.classify(email, { mode: 'regen', userId });

// AFTER:
const routed = await llm.router.generateDraft(email, { mode: 'draft', userId });
```

**Change 2 — INFRA-02 attempt counter:**
Add `const attempts = new Map()` module-level constant alongside `queues`.
Add attempt tracking in `classifyEmail()` before the router call. Max attempts = 3. On exhaustion: `storeClassification(..., { source: 'failed' })`.

**Change 3 — storeClassification() placeholder draft (lines 229-237):**
Verify `body = ''` is explicit (it already is: line 236 passes `''`). No code change needed here.

**The `source: 'failed'` value is new** — not in the existing set of `'rules' | 'llm' | 'fallback' | 'template' | 'user'`. Must be handled in:
- `/api/llm/status` endpoint (api.js line 1241) — the `fallback_count` query filters `source = 'fallback'`; a separate or extended query for `source = 'failed'` may be needed for the UI
- `storeClassification()` boundary check — currently accepts any `data.source` via `data.source || null`, so `'failed'` passes through without code change

### `src/routes/api.js` — CHECK DRAFT REGEN ENDPOINT

**Current `/api/emails/:id/draft/regen` (lines 999-1041):**
This endpoint calls `llm.router.classify(email, { mode: 'regen', ... })` directly on line 1012 — it does NOT go through `classifier.generateDraft()`. After Phase 1, it should be updated to call `llm.router.generateDraft()` directly OR through `classifier.generateDraft()`.

The endpoint currently handles:
- tone parameter (line 1001)
- template fallback when LLM returns null (lines 1017-1021)
- DB update (lines 1030-1038)
- Returns `{ draft_reply, source, warning? }`

**This endpoint is the actual trigger path when user clicks "Regen" button.** The `classifier.generateDraft()` function is a separate simpler path used for initial draft generation. Both need to call `router.generateDraft()` after Phase 1.

### `src/db.js` — OPTIONAL: low_confidence column

If the planner decides to store `low_confidence` as a DB column (Claude's discretion per CONTEXT.md), use the inline try/catch pattern:

```javascript
// At bottom of src/db.js, after existing migrations
try { db.exec('ALTER TABLE classifications ADD COLUMN low_confidence INTEGER DEFAULT 0'); } catch(e) {}
```

The `storeClassification()` function in classifier.js would then include `low_confidence` in the INSERT statement.

**Alternative:** Store `low_confidence` only in the router response (not persisted). The planner should decide and document the choice.

### `scripts/eval-corpus.js` — NEW FILE

**Purpose:** Export emails from DB and run them through the classifier to produce a scoreable accuracy report.

**Key design constraints from CONTEXT.md:**
- D-01: Read from live `intellimail.db` (not a test DB)
- D-03: Corpus schema: `{ id, subject, from, body_snippet, ground_truth_category }`
- D-04: Output category accuracy % + breakdown per category
- D-05: Write to `.planning/eval/corpus.json` and `.planning/eval/baseline.md`

**Implementation pattern (matching existing codebase style):**
```javascript
#!/usr/bin/env node
// scripts/eval-corpus.js
// Usage: node scripts/eval-corpus.js [--export|--score]
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// --export mode: dump emails from DB to corpus.json for manual labeling
// --score mode: run classifier against corpus.json, output accuracy

// The script uses the LIVE DB (not a test DB) for --export
// but does NOT modify the DB (read-only for export)
```

**Two-mode design:**
1. `--export`: Reads 50+ recent emails from `intellimail.db`, writes `corpus.json` with fields `{ id, subject, from, body_snippet }` (no `ground_truth_category` yet — user fills that in manually)
2. `--score`: Reads `corpus.json`, calls `buildPrompt()` + a direct provider API call (or loads the router) against each email, compares `output.category` vs `ground_truth_category`, prints category-breakdown accuracy report

**Alternative scoring approach:** Instead of making real API calls, the eval script can call `rulesClassify()` + the LLM router in the same process. This requires setting `DB_PATH` to a temp location so the eval doesn't accidentally write classifications back to the production DB.

**Output format (stdout for --score):**
```
=== IntelliMail Eval Corpus Accuracy ===
Total: 45 emails | Correct: 38 | Accuracy: 84.4%

By category:
  financial       : 8/9  (88.9%)
  fyi             : 5/7  (71.4%)   <-- most confused
  meeting_request : 6/6  (100%)
  other           : 4/5  (80.0%)
  ...
```

**Write to baseline.md:**
```markdown
# Eval Baseline

**Run:** 2026-05-14
**Corpus:** 45 emails
**Overall accuracy:** 84.4%
**Per-category:** [table]
```

---

## Common Pitfalls

### Pitfall 1: Assuming CONTEXT.md Provider Analysis is Correct

**What goes wrong:** Planning tasks for "add response_format to Groq/DeepSeek" when these already exist.
**Why it happens:** CONTEXT.md was written before the full code read; it said NVIDIA was the only correct provider.
**How to avoid:** The planner must use this research document's verified current state, not CONTEXT.md's provider descriptions.
**Warning signs:** Any task titled "add response_format to groq.js" is wrong — no such change is needed.

### Pitfall 2: parseProviderResponse() Callers Expect Exceptions

**What goes wrong:** After INFRA-01 changes the JSON-miss path from throw to return, existing test `parseProviderResponse throws on totally garbage input` (base.test.js line 71) will fail.
**Why it happens:** The test asserts `assert.throws()` for the case `extractJsonBlock()` returns null.
**How to avoid:** Update the test. The new behavior: `parseProviderResponse('not json at all')` returns DEFAULTS with `error: 'parse_failure'`, not throws. The "not a string" case still throws — update the test to cover that case instead.
**Warning signs:** The base.test.js test suite will fail after INFRA-01 if tests are not updated.

### Pitfall 3: router.js classify() Currently Catches 'invalid_json' for Parse Failures

**What goes wrong:** After INFRA-01, parseProviderResponse no longer throws on JSON-miss. The `classifyError(err)` branch `/could not parse/i` (router.js line 132) will never trigger for parse failures. Parse failures now return normally — they appear as successful calls to the router. The circuit breaker never opens for a provider that consistently returns unparseable JSON.
**Why it happens:** The router's error handling assumes parse failures are thrown errors.
**How to avoid:** After INFRA-01, add a check in `classify()`: if `parsed.error === 'parse_failure'`, treat it as a soft failure for breaker purposes, or just accept that parse_failure is a "successful" call that produced a default result. INFRA-01 says "no silent failures" — the WARN log satisfies that. The breaker question is deferred to Phase 4 (OBSERVE-06).
**Warning signs:** Provider consistently returning malformed JSON but breaker never opening.

### Pitfall 4: Gemini's prompt construction differs from the other 3

**What goes wrong:** Adding `generateDraft()` to router.js using a generic "pass buildDraftPrompt result as system message" — breaks Gemini which uses `contents` not `messages`.
**Why it happens:** Gemini (gemini.js) does NOT use the OpenAI message format. It concatenates SYSTEM_PROMPT + user content into a single `contents` block with `role: 'user'`.
**How to avoid:** Either (a) have each provider's `call()` function handle the `mode: 'draft'` opts flag internally and call buildDraftPrompt() themselves, OR (b) pass the built prompt string through opts and let each provider use it in their format. Option (a) is cleaner but requires touching all 4 provider files; option (b) centralizes in router.
**Warning signs:** Gemini returning classification JSON when draft was requested, or API error "invalid role".

### Pitfall 5: Eval Script Writing Classifications to Production DB

**What goes wrong:** eval-corpus.js runs the classifier logic which calls `storeClassification()` — writing test/scoring results into the real `intellimail.db`.
**Why it happens:** The scoring mode loads the classifier module which uses the default DB_PATH.
**How to avoid:** The `--score` mode must either: (a) not use `storeClassification()` at all (just call `buildPrompt()` + provider API + `parseProviderResponse()`), OR (b) set `process.env.DB_PATH` to a temp file before requiring `../src/db`.
**Warning signs:** `intellimail.db` classifications table has new rows after running `--score` mode.

### Pitfall 6: `source: 'failed'` Not Handled in UI Queries

**What goes wrong:** After INFRA-02 stores `source: 'failed'`, the `/api/llm/status` endpoint (api.js line 1241) only counts `source = 'fallback'`. The "Classification failed" UI state is never surfaced in the dashboard stats.
**Why it happens:** The existing source value set is `'rules' | 'llm' | 'fallback' | 'template' | 'user'`. The new `'failed'` value was not anticipated.
**How to avoid:** Add a `failed_count` query to `/api/llm/status` response alongside `fallback_count`. Update sidebar stats query to include `source = 'failed'` emails in the count for the relevant category badge (or treat them as uncategorized).
**Warning signs:** Users see emails "stuck" with no badge, no "Classification failed" indicator.

---

## Code Examples

### Verified Pattern: Test DB Isolation (used by all test suites)

```javascript
// [VERIFIED: tests/classifier_scope.test.js lines 6-11]
const dbPath = path.join(__dirname, '..', 'intellimail-scope-test.db');
process.env.DB_PATH = dbPath;

test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
```

### Verified Pattern: Mock global.fetch in Provider Tests

```javascript
// [VERIFIED: tests/llm/providers/groq.test.js]
const orig = global.fetch;
global.fetch = async (url, opts) => {
  seenUrl = url; seenOpts = opts;
  return {
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => ({ choices: [{ message: { content: JSON.stringify({...}) } }] })
  };
};
try {
  const out = await groq.call(email, { mode: 'full' }, { apiKey: 'sk-test', model: '...' });
  // assertions
} finally {
  global.fetch = orig;
}
```

### Verified Pattern: Mock router.classify in Classifier Tests

```javascript
// [VERIFIED: tests/classifier_validation.test.js lines 43-53]
const llm = require('../src/llm');
const origClassify = llm.router.classify;
llm.router.classify = async () => ({ category: 'request', urgency: 'whatever', ... });
try {
  await classifyEmail(userId, emailId);
} finally {
  llm.router.classify = origClassify;
}
```

### Verified Pattern: Inline DB Migration Guard

```javascript
// [VERIFIED: src/db.js lines 86, 184-190]
try { db.exec('ALTER TABLE emails ADD COLUMN is_deleted INTEGER DEFAULT 0'); } catch(e) {}
// Pattern used 15+ times in db.js. Safe on live WAL-mode SQLite.
```

### Verified Pattern: Router createRouter() Return Shape

```javascript
// [VERIFIED: src/llm/router.js line 175]
return { classify, _byName: byName, getProviderHealth, getObservedLimits, setObservedLimits };
// Add generateDraft to this object
```

---

## State of the Art

| Old Approach | Current Approach | Phase 1 Change |
|--------------|------------------|----------------|
| 7-field monolithic prompt (classification + draft in one call) | Split: Call A (6 fields) + Call B (draft, on-demand) | PROMPT-01 |
| No category boundary definitions | One-liner per category + 3 disambiguation rules | PROMPT-02 |
| Zero-shot for all categories | Few-shot for the 3 boundary-confused pairs only | PROMPT-03 |
| Temperature hardcoded at 0.1 (already present in all providers) | Call A stays 0.1; Call B uses 0.3–0.5 | PROMPT-04 |
| Character-count summary constraint ("max 120 chars") | Structural constraint ("one sentence, state action needed") | PROMPT-05 |
| JSON mode: Groq/DeepSeek/NVIDIA already enabled; Gemini already has responseMimeType | No change needed for JSON modes | PROMPT-06 (done) |
| No low_confidence signal | `low_confidence: true` when category fell back to enum default | PROMPT-07 |
| parseProviderResponse() throws on JSON-miss (silent to caller) | Returns DEFAULTS + WARN log | INFRA-01 |
| No retry cap — infinite retries per email | 3-attempt cap; source='failed' after exhaustion | INFRA-02 |

**Deprecated/outdated in CONTEXT.md:**
- "Groq needs response_format added" — already has it. No work needed.
- "DeepSeek needs response_format added" — already has it. No work needed.
- "Gemini needs responseMimeType added" — already has it. No work needed.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `low_confidence` should only be set when the LLM returned a category not in the CATEGORIES enum (the CONTEXT.md "Specifics" section describes it as derived from `other` fallback specifically) | parseProviderResponse() pattern | Minor — if `other` is returned by the LLM as a valid classification (not as a fallback), it would be incorrectly flagged as low_confidence. Acceptable in Phase 1. |
| A2 | Eval script `--score` mode should call the LLM cascade directly rather than using storeClassification, to avoid writing to production DB | eval-corpus.js design | If eval script accidentally writes to production DB, classifications would be corrupted for the eval emails |
| A3 | Temperature for Call B passed via opts to provider (providers read `opts.temperature \|\| 0.1`) rather than hardcoding 0.4 in each provider file | router.generateDraft() design | If providers don't read opts.temperature, Call B will use 0.1 (classification temperature) — drafts will be less creative but not broken |
| A4 | `source: 'failed'` emails should appear in the dashboard UI as a visible failure state, which requires a UI query change in api.js | INFRA-02 | If api.js is not updated, failed emails are invisible — they disappear from the inbox without explanation |

---

## Open Questions

1. **`low_confidence` storage — column or response-only?**
   - What we know: REQUIREMENTS.md says "attached to any parsed result"; CONTEXT.md says "storage decision is Claude's call"
   - What's unclear: Whether the UI (Phase 5) needs to query this field from DB, or whether it's only used for logging/API response
   - Recommendation: Store as a column (`low_confidence INTEGER DEFAULT 0`) using the inline migration guard — it's one try/catch line in db.js and costs nothing. Avoids a Phase 5 schema migration when the UI needs it.

2. **`source: 'failed'` in dashboard stats and API status**
   - What we know: The current `/api/llm/status` endpoint has `fallback_count` query for `source = 'fallback'`
   - What's unclear: Should `source: 'failed'` be counted separately (new `failed_count` field in API response) or combined with `fallback_count`?
   - Recommendation: Add `failed_count` as a separate field. The UI treatment differs: `fallback` means "reclassify when you have LLM keys"; `failed` means "classification exhausted, check your keys".

3. **Eval script scoring — real API calls or rules-only?**
   - What we know: The eval corpus is 30–50 emails. Scoring all of them through the LLM cascade costs real API tokens.
   - What's unclear: Whether the eval script should use live LLM calls (accurate to production) or just the rules tier (cheaper but misses the LLM behavior being evaluated)
   - Recommendation: Use live LLM calls for scoring (that is what's being measured). Limit to one provider at a time with a flag (`--provider nvidia`). Cache results to avoid re-scoring unchanged emails.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All scripts and tests | Yes | v24.11.1 | — |
| better-sqlite3 | eval script DB read | Yes | ^12.6.2 (in package.json) | — |
| node:test (built-in) | All existing tests | Yes | Built into Node.js v24 | — |
| intellimail.db | Eval corpus export | Must verify at runtime | N/A | If DB empty, eval export produces no corpus |
| LLM provider API keys | Eval --score mode | Not verified (env vars) | N/A | Skip scoring if no key configured |

**Missing dependencies with no fallback:** None. All required tools are present.

**Missing dependencies with fallback:** LLM API keys — eval script should gracefully handle missing keys with an error message rather than silently producing zero accuracy.

---

## Validation Architecture

`nyquist_validation` is enabled in `.planning/config.json` (`"nyquist_validation": true`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test` + `node:assert/strict`) — no install needed |
| Config file | None — run directly via `node --test` |
| Quick run command | `node --test "tests/llm/**/*.test.js"` |
| Full suite command | `node --test "tests/**/*.test.js"` |
| Eval command | `node scripts/eval-corpus.js --score` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVAL-01 | corpus.json exists with 30-50 entries, each having `ground_truth_category` | Manual check + file assertion | `node -e "const c=require('./.planning/eval/corpus.json'); console.assert(c.length>=30)"` | No — created in Wave 0 by user labeling |
| EVAL-02 | Baseline accuracy recorded in baseline.md | Script output | `node scripts/eval-corpus.js --score` | No — script created in Wave 0 |
| PROMPT-01 | buildPrompt() no longer requests draft_reply; buildDraftPrompt() exists | Unit | `node --test "tests/llm/base.test.js"` | Partial — existing tests cover buildPrompt; new tests needed |
| PROMPT-02 | SYSTEM_PROMPT includes one-liner per category | Unit (string assertion) | `node --test "tests/llm/base.test.js"` | No — new test assertions needed |
| PROMPT-03 | SYSTEM_PROMPT includes examples for 3 confused pairs | Unit (string assertion) | `node --test "tests/llm/base.test.js"` | No — new test assertions needed |
| PROMPT-04 | Call A uses temp 0.1; Call B uses 0.3-0.5 | Unit (provider call inspection) | `node --test "tests/llm/providers/*.test.js"` | Partial — existing provider tests check temperature |
| PROMPT-05 | Summary constraint is structural ("one sentence...") in SYSTEM_PROMPT | Unit (string assertion) | `node --test "tests/llm/base.test.js"` | No — new test assertion needed |
| PROMPT-06 | All providers have JSON mode enabled | Unit (request body inspection) | `node --test "tests/llm/providers/*.test.js"` | Yes — existing tests already assert `response_format.type === 'json_object'` |
| PROMPT-07 | `low_confidence: true` returned when category fell back to default | Unit | `node --test "tests/llm/base.test.js"` | No — new test case needed |
| INFRA-01 | parseProviderResponse returns DEFAULTS+error on JSON-miss (no throw) | Unit | `node --test "tests/llm/base.test.js"` | Partial — existing test asserts throw; must be UPDATED to assert return |
| INFRA-02 | After 3 failed attempts, email stored as source='failed' | Unit (classifier test) | `node --test "tests/classifier_validation.test.js"` | No — new test needed in classifier_validation.test.js |

### Sampling Rate

- **Per task commit:** `node --test "tests/llm/**/*.test.js"` — covers base, router, providers, ratelimiter
- **Per wave merge:** `node --test "tests/**/*.test.js"` — full suite
- **Phase gate:** Full suite green + `node scripts/eval-corpus.js --score` showing improvement over baseline before marking phase complete

### Wave 0 Gaps (files to create before implementation)

- [ ] `.planning/eval/corpus.json` — created by `node scripts/eval-corpus.js --export`, then user adds `ground_truth_category` manually
- [ ] `.planning/eval/baseline.md` — created by `node scripts/eval-corpus.js --score` after corpus is labeled
- [ ] `scripts/eval-corpus.js` — new file; no test file needed (it is itself a test harness)
- [ ] New test assertions in `tests/llm/base.test.js` — update existing "throws on garbage input" test + add PROMPT-02, PROMPT-03, PROMPT-05, PROMPT-07 assertions
- [ ] New test case in `tests/classifier_validation.test.js` — INFRA-02 attempt cap behavior
- [ ] New test case in `tests/llm/router.test.js` — generateDraft() method

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase 1 doesn't touch auth |
| V3 Session Management | No | Phase 1 doesn't touch sessions |
| V4 Access Control | Partial | eval script reads live DB directly — must not be exposed as an HTTP endpoint |
| V5 Input Validation | Yes | SYSTEM_PROMPT changes are prompt-injection adjacent: category enum whitelisting in parseProviderResponse() is the control |
| V6 Cryptography | No | No key changes in Phase 1 |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via email content | Tampering | `buildPrompt()` treats email fields as data, not instructions; structural separation via labeled sections |
| LLM output poisoning (malicious category value) | Tampering | `parseProviderResponse()` whitelist check: `CATEGORIES.includes(obj.category)` — out-of-enum values fall back to 'other' |
| Eval script DB write contamination | Elevation | Eval script must use read-only DB access or temp DB_PATH for scoring mode |
| Raw LLM response logged at WARN (PII risk) | Information Disclosure | INFRA-01 logs only first 200 chars of raw response — likely sufficient but could expose email snippets if provider echoes them back. Acceptable for WARN-level logs. |

---

## Sources

### Primary (HIGH confidence — VERIFIED this session)

- `src/llm/providers/base.js` — SYSTEM_PROMPT, buildPrompt, extractJsonBlock, parseProviderResponse, CATEGORIES, DEFAULTS: read directly
- `src/llm/providers/nvidia.js` — reference implementation: confirmed has `response_format` + `temperature: 0.1`
- `src/llm/providers/groq.js` — VERIFIED already has `response_format: { type: 'json_object' }` + `temperature: 0.1`
- `src/llm/providers/gemini.js` — VERIFIED already has `responseMimeType: 'application/json'` + `temperature: 0.1`
- `src/llm/providers/deepseek.js` — VERIFIED already has `response_format: { type: 'json_object' }` + `temperature: 0.1`
- `src/llm/router.js` — classify() full implementation, createRouter() structure, classifyError(), return shape
- `src/classifier.js` — classifyEmail(), generateDraft(), storeClassification(), queueClassification(), queue Map
- `src/routes/api.js` — draft/regen endpoint (line 999-1041), draft/save, llm/status
- `src/db.js` — classifications table schema, migrations pattern, inline try/catch ALTER TABLE
- `src/db-migration.js` — grandfatherIfNeeded() (does NOT contain an addColumn() helper — CONTEXT.md was incorrect; the migration pattern is inline try/catch in db.js)
- `tests/llm/base.test.js` — test patterns, assert.throws case for JSON-miss
- `tests/llm/router.test.js` — test patterns, fake provider pattern
- `tests/llm/providers/groq.test.js` — global.fetch mock pattern
- `tests/classifier_scope.test.js` — DB isolation pattern (DB_PATH env var)
- `tests/classifier_validation.test.js` — llm.router.classify monkey-patch pattern
- `.planning/config.json` — nyquist_validation: true confirmed
- `package.json` — test command: `node --test "tests/**/*.test.js"`, Node.js v24.11.1

### Secondary (HIGH confidence — from prior project research, verified against codebase)

- `.planning/research/SUMMARY.md` — Phase 1 implementation guidance
- `.planning/research/STACK.md` — prompt engineering patterns, JSON mode docs

---

## Metadata

**Confidence breakdown:**
- Current file state (what exists vs what CONTEXT.md describes): HIGH — directly verified
- Provider JSON mode status: HIGH — all 4 providers read directly; CONTEXT.md was partially wrong
- Test patterns: HIGH — multiple test files read; established patterns are consistent
- Eval script design: MEDIUM — pattern is clear but exact implementation is ASSUMED (no existing eval script to copy)
- low_confidence storage decision: ASSUMED (documented in Assumptions Log as A1)

**Research date:** 2026-05-14
**Valid until:** Stable — until any of the 5 provider/base/router/classifier files are modified

---

## CONTEXT.md Corrections

These items in CONTEXT.md are incorrect based on direct code verification:

| CONTEXT.md Claim | Actual State | Impact |
|------------------|-------------|--------|
| "NVIDIA — already correct. No changes needed." | Correct | No change |
| "Groq — add response_format: { type: 'json_object' }" | Groq ALREADY HAS IT (line 22) | No JSON mode work for Groq |
| "Gemini — add responseMimeType: 'application/json'" | Gemini ALREADY HAS IT (line 30) | No JSON mode work for Gemini |
| "DeepSeek — add response_format: { type: 'json_object' }" | DeepSeek ALREADY HAS IT (line 22) | No JSON mode work for DeepSeek |
| "addColumn() helper for safe schema changes" (from code_context) | No addColumn() in db-migration.js — db-migration.js only contains grandfatherIfNeeded(). The addColumn pattern is inline try/catch in db.js | Use inline try/catch in db.js |

**Net impact:** PROMPT-06 (JSON modes) and much of PROMPT-04 (temperature) are already done. The Phase 1 work is smaller than CONTEXT.md implied. Temperature 0.1 is already set on all 4 providers for Call A; the only new temperature work is Call B (0.3–0.5) which requires adding temperature-override reading to provider `call()` functions.
