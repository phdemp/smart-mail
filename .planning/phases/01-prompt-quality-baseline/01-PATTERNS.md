# Phase 1: Prompt Quality Baseline - Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 9 (6 modify, 1 new script, 2 new test additions)
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/llm/providers/base.js` | utility (prompt-builder + parser) | transform | Self — read directly | exact |
| `src/llm/router.js` | service (provider cascade) | request-response | Self — read directly | exact |
| `src/classifier.js` | service (queue + orchestration) | event-driven | Self — read directly | exact |
| `src/routes/api.js` (draft/regen endpoint) | route | request-response | Self — read directly | exact |
| `src/db.js` (low_confidence column migration) | config/migration | batch | `src/db.js` lines 86–199 (existing migrations) | exact |
| `src/llm/providers/gemini.js` (temperature opts) | service (provider adapter) | request-response | `src/llm/providers/nvidia.js` | exact |
| `scripts/eval-corpus.js` | utility (offline script) | batch / file-I/O | `tests/classifier_scope.test.js` (DB isolation pattern) | partial |
| `tests/llm/base.test.js` (update + additions) | test | transform | Self — read directly | exact |
| `tests/classifier_validation.test.js` (new case) | test | event-driven | Self — read directly | exact |

---

## Pattern Assignments

### `src/llm/providers/base.js` — PRIMARY CHANGE FILE

**Role:** utility — prompt construction and response parsing

#### 1. SYSTEM_PROMPT (lines 18–35) — 4 changes required

Current state (lines 18–35):
```javascript
const SYSTEM_PROMPT = `You are an email classifier for IntelliMail. Classify the email below.

Respond with a single JSON object matching this schema — and nothing else:
{
  "category": one of [${CATEGORIES.map(c => `"${c}"`).join(', ')}],
  "urgency": one of ["urgent", "moderate", "normal"],
  "urgency_reason": short string or null,
  "summary": one-line summary (max 120 chars),
  "extracted_data": object with category-specific fields (may be empty),
  "suggested_tone": one of ["formal", "professional", "friendly", "brief"],
  "draft_reply": a complete suggested reply as a string
}

Rules:
- Legal emails are always urgent.
- Calendar invites / Zoom / Teams / Meet links are meeting_request.
- Newsletters, digests, noreply senders are fyi.
- If unsure, use "other".`;
```

Changes:
1. Remove `"draft_reply": a complete suggested reply as a string` (PROMPT-01)
2. Change `"summary": one-line summary (max 120 chars)` to structural constraint (PROMPT-05)
3. Add one-liner category definitions block after the category enum line (PROMPT-02)
4. Add disambiguation rules for `fyi vs other`, `rewards_awards vs fyi`, `meeting_request vs other`, plus few-shot examples at the end after the Rules section (PROMPT-03)

Few-shot example format per D-13:
```
Subject: [subject], From: [sender] → [category] (not [confused_category]: [one-line reason])
```

#### 2. `buildPrompt()` (lines 37–49) — remove regen branch

Current state (lines 37–49):
```javascript
function buildPrompt(email, opts = {}) {
  const lines = [];
  lines.push(SYSTEM_PROMPT);
  lines.push('');
  lines.push(`From: ${email.from_name || ''} <${email.from_address || ''}>`);
  lines.push(`Subject: ${email.subject || ''}`);
  const body = (email.body_text || email.preview || '').slice(0, 800);
  if (body) lines.push('', body);
  if (opts.mode === 'regen' && opts.tone) {
    lines.push('', `Generate the draft_reply in a ${opts.tone} tone.`);  // REMOVE THIS BRANCH
  }
  return lines.join('\n');
}
```

Remove lines 45–47 (the `opts.mode === 'regen'` branch). `buildPrompt()` becomes Call A only.

#### 3. New function `buildDraftPrompt()` — insert after buildPrompt, before extractJsonBlock

**Pattern to match:** Mirror buildPrompt's structure — push lines into array, join at end. Body truncation at 800 chars matches Call A. Add tone instruction when opts.tone is provided.

```javascript
// Structure to copy from buildPrompt() — mirror this pattern exactly:
function buildDraftPrompt(email, opts = {}) {
  const lines = [];
  // Call B system instruction (no SYSTEM_PROMPT — this is a standalone prompt)
  lines.push('You are drafting a reply email on behalf of the recipient.');
  lines.push('Write a direct, complete reply. 2-4 sentences. No subject line. No placeholder text.');
  lines.push('');
  lines.push(`From: ${email.from_name || ''} <${email.from_address || ''}>`);
  lines.push(`Subject: ${email.subject || ''}`);
  const body = (email.body_text || email.preview || '').slice(0, 800); // match buildPrompt limit
  if (body) lines.push('', body);
  if (opts.tone) lines.push('', `Write in a ${opts.tone} tone.`);
  return lines.join('\n');
}
```

#### 4. `parseProviderResponse()` (lines 65–85) — 3 changes

Current state (lines 65–85):
```javascript
function parseProviderResponse(raw) {
  if (typeof raw !== 'string') {
    throw new Error('could not parse provider response: not a string');  // KEEP this throw
  }
  const obj = extractJsonBlock(raw);
  if (!obj || typeof obj !== 'object') {
    throw new Error('could not parse provider response: no JSON object found');  // CHANGE THIS
  }
  const out = { ...DEFAULTS };
  if (CATEGORIES.includes(obj.category)) out.category = obj.category;
  if (URGENCIES.includes(obj.urgency)) out.urgency = obj.urgency;
  if (typeof obj.urgency_reason === 'string') out.urgency_reason = obj.urgency_reason;
  if (typeof obj.summary === 'string') out.summary = obj.summary.slice(0, 200);
  if (obj.extracted_data && typeof obj.extracted_data === 'object') {
    out.extracted_data = obj.extracted_data;
  }
  if (TONES.includes(obj.suggested_tone)) out.suggested_tone = obj.suggested_tone;
  if (typeof obj.draft_reply === 'string') out.draft_reply = obj.draft_reply;
  if (out.category === 'legal') out.urgency = 'urgent';
  return out;
}
```

Changes:
1. Add `opts = {}` parameter: `function parseProviderResponse(raw, opts = {})`
2. Change the `throw new Error('could not parse provider response: no JSON object found')` at line 71 to:
   ```javascript
   const provider = opts.provider || 'unknown';
   const excerpt = raw.slice(0, 200);
   console.warn(`[llm/base] parse_failure provider=${provider} raw="${excerpt}"`);
   return { ...DEFAULTS, error: 'parse_failure', low_confidence: true };
   ```
3. After the existing enum-miss check at line 74, set `low_confidence: true` on `out` when `obj.category` was not in CATEGORIES (fell back to DEFAULTS.category):
   ```javascript
   const categoryMissed = !CATEGORIES.includes(obj.category);
   // ... existing validation lines 74-83 ...
   if (categoryMissed) out.low_confidence = true;
   ```

#### 5. `module.exports` (lines 87–91) — add buildDraftPrompt

Current state:
```javascript
module.exports = {
  CATEGORIES, URGENCIES, TONES, DEFAULTS,
  buildPrompt, parseProviderResponse, extractJsonBlock,
  SYSTEM_PROMPT
};
```

Add `buildDraftPrompt` to exports.

---

### `src/llm/router.js` — ADD `generateDraft()`

**Role:** service — provider cascade routing

#### Current return shape (line 175):
```javascript
return { classify, _byName: byName, getProviderHealth, getObservedLimits, setObservedLimits };
```

#### `classify()` — the exact pattern to copy for `generateDraft()` (lines 44–124):

The full cascade loop is the analog. Key structural points:

```javascript
async function classify(email, opts = {}) {
  const userId = opts.userId;
  const cfg = (getConfig && getConfig(userId)) || { order: [], enabled: [], keys: {}, models: {}, limits: {} };
  const enabledSet = new Set(cfg.enabled || []);
  const order = (cfg.order || []).filter(n => enabledSet.has(n) && byName.has(n));

  for (const name of order) {
    const provider = byName.get(name);
    const providerCfg = {
      apiKey: (cfg.keys || {})[name],
      model:  (cfg.models || {})[name] || provider.defaultModel
    };

    // 1. Breaker check
    if (breakerOpen(userId, name)) { log(...); continue; }

    // 2. Quota check
    const cfgLim = cfg.limits && cfg.limits[name];
    const effectiveRpd = ...;
    if (Number.isFinite(effectiveRpd)) { const count = ...; if (count >= effectiveRpd) { continue; } }

    // 3. Rate bucket (maxWaitMs differs: regen = 2000, full = 30000)
    const maxWaitMs = opts.mode === 'regen' ? 2000 : 30000;
    const got = await getBucket(userId, provider).acquire(maxWaitMs);
    if (!got) { continue; }

    // 4. Provider call + parse
    const start = Date.now();
    try {
      const rawResult = await provider.call(email, opts, providerCfg);
      const parsed = typeof rawResult === 'string'
        ? parseProviderResponse(rawResult)
        : { ...DEFAULTS, ...rawResult };
      // ... usage increment, breaker reset, log ...
      return { ...parsed, _provider: name };
    } catch (err) {
      const outcome = classifyError(err);
      // ... breaker management ...
      continue;
    }
  }
  return null;
}
```

#### `generateDraft()` — differences from `classify()`:

1. `maxWaitMs` for bucket acquire: use `2000` (same as regen mode, since it's on-demand)
2. Pass `temperature: 0.4` in providerCfg: `const providerCfg = { apiKey: ..., model: ..., temperature: 0.4 }`
3. After `provider.call()`, extract only `draft_reply` from the parsed result: `return { draft_reply: parsed.draft_reply || null, _provider: name }`
4. The log call: use `mode: 'draft'` in the log object

Add `generateDraft` to the return object:
```javascript
return { classify, generateDraft, _byName: byName, getProviderHealth, getObservedLimits, setObservedLimits };
```

---

### `src/classifier.js` — THREE CHANGES

**Role:** service — classification queue and draft orchestration

#### Change 1 — `generateDraft()` (lines 274–283)

Current state:
```javascript
async function generateDraft(userId, emailId) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(emailId, userId);
  if (!email) return null;
  try {
    const routed = await llm.router.classify(email, { mode: 'regen', userId });  // CHANGE THIS LINE
    return routed?.draft_reply || 'Thank you for your email. I will review and respond shortly.';
  } catch {
    return 'Thank you for your email. I will review and respond shortly.';
  }
}
```

Change line 278 from `llm.router.classify(email, { mode: 'regen', userId })` to:
```javascript
const routed = await llm.router.generateDraft(email, { mode: 'draft', userId });
```

#### Change 2 — INFRA-02 attempt counter (module level + `classifyEmail()`)

Add after line 9 (`const queues = new Map();`):
```javascript
const attempts = new Map(); // `${userId}::${emailId}` -> attemptCount
const MAX_ATTEMPTS = 3;
```

Add inside `classifyEmail()` at line 154, immediately after the `isInClassificationScope` check and before the Tier 1 rules call (after line 163):
```javascript
// Attempt tracking (INFRA-02)
const attemptKey = `${userId}::${emailId}`;
const currentAttempts = (attempts.get(attemptKey) || 0) + 1;
attempts.set(attemptKey, currentAttempts);
if (currentAttempts > MAX_ATTEMPTS) {
  storeClassification(userId, emailId, { ...fallbackClassification(), source: 'failed' });
  attempts.delete(attemptKey);
  return;
}
```

On successful classification (both rules and LLM paths at lines 172–177 and 184–194), delete the attempt key:
```javascript
attempts.delete(attemptKey);
```

Note: `source: 'failed'` is a new value — `storeClassification()` accepts any string via `data.source || null` (line 219), so no change needed there. But `src/routes/api.js` `/api/llm/status` endpoint (line ~1241) needs a `failed_count` query added.

#### Change 3 — `storeClassification()` placeholder draft (lines 229–237)

Current state (lines 234–236):
```javascript
if (!existing && email) {
  db.prepare('INSERT INTO drafts (user_id, email_id, body, tone, subject, to_address) VALUES (?,?,?,?,?,?)')
    .run(userId, emailId, '', data.suggested_tone || 'professional', 'Re: ' + email.subject, email.from_address);
}
```

Body is already `''` (explicit empty string). No code change required — verify only.

---

### `src/routes/api.js` — UPDATE DRAFT/REGEN ENDPOINT

**Role:** route — HTTP handler for on-demand draft generation

#### Current state of `POST /api/emails/:id/draft/regen` (lines 999–1041):

```javascript
router.post('/api/emails/:id/draft/regen', async (req, res) => {
  const { tone = 'professional' } = req.body;
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  const cls = db.prepare('SELECT * FROM classifications WHERE email_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });

  const llm = require('../llm');
  const { buildTemplateReply } = require('../llm/templates');

  let draftReply, source, dbSource, warning = null;
  try {
    const routed = await llm.router.classify(email, { mode: 'regen', tone, userId: req.user.id });  // CHANGE THIS LINE
    if (routed && routed.draft_reply) {
      draftReply = routed.draft_reply;
      source = routed._provider;
      dbSource = 'llm';
    } else {
      draftReply = buildTemplateReply(cls || { category: 'other' }, tone);
      source = 'template';
      dbSource = 'template';
      warning = 'All LLM providers unavailable — showing template reply';
    }
  } catch (e) {
    draftReply = buildTemplateReply(cls || { category: 'other' }, tone);
    source = 'template';
    dbSource = 'template';
    warning = 'LLM provider error — showing template reply';
  }
  // ... DB update and res.json unchanged (lines 1030-1041) ...
});
```

Change line 1012 from `llm.router.classify(email, { mode: 'regen', tone, userId: req.user.id })` to:
```javascript
const routed = await llm.router.generateDraft(email, { mode: 'draft', tone, userId: req.user.id });
```

Everything else in the endpoint (null-check, template fallback, DB update, response) stays identical.

---

### `src/db.js` — OPTIONAL low_confidence COLUMN MIGRATION

**Role:** config/migration — inline ALTER TABLE guard

#### Pattern to copy (line 86, and lines 184–199 for the established style):

```javascript
// Every migration in db.js follows this identical pattern:
try { db.exec('ALTER TABLE emails ADD COLUMN is_deleted INTEGER DEFAULT 0'); } catch(e) {}
// ...
try { db.exec(`ALTER TABLE drafts ADD COLUMN source TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE classifications ADD COLUMN source TEXT`); } catch(e) {}
```

Add after the last migration at line 199:
```javascript
// low_confidence: 1 when the LLM returned a category not in the enum (Phase 1 PROMPT-07).
try { db.exec(`ALTER TABLE classifications ADD COLUMN low_confidence INTEGER DEFAULT 0`); } catch(e) {}
```

No backfill needed — new rows will have it set at classification time. Existing rows default to 0.

If storing `low_confidence`, also update `storeClassification()` INSERT in `classifier.js` (line 211–219):
- Add `low_confidence` to the column list
- Add `data.low_confidence ? 1 : 0` to the VALUES list

---

### `src/llm/providers/gemini.js` — TEMPERATURE OVERRIDE FOR CALL B

**Role:** service — provider adapter (Gemini-specific format)

#### Current state (lines 25–34):

```javascript
body: JSON.stringify({
  contents: [
    { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + buildPrompt(email, opts) }] }
  ],
  generationConfig: {
    temperature: 0.1,                       // hardcoded — needs to read opts.temperature
    responseMimeType: 'application/json'
  }
}),
```

**Critical difference from other providers:** Gemini uses `contents[].parts[].text` (concatenated SYSTEM_PROMPT + buildPrompt), NOT a `messages` array with `system` role. This means for Call B, the prompt concatenation must be:
- If `opts.mode === 'draft'`: use `buildDraftPrompt(email, opts)` as the entire `text` (no SYSTEM_PROMPT prepended — buildDraftPrompt is self-contained)
- If Call A: keep `SYSTEM_PROMPT + '\n\n' + buildPrompt(email, opts)`

Temperature change:
```javascript
generationConfig: {
  temperature: opts.temperature || 0.1,   // reads override from router.generateDraft()
  responseMimeType: 'application/json'
}
```

Add `buildDraftPrompt` to the require at line 1:
```javascript
const { buildPrompt, buildDraftPrompt, parseProviderResponse, SYSTEM_PROMPT } = require('./base');
```

The other three providers (nvidia, groq, deepseek) use the same `messages` array format and need the same temperature override pattern:
```javascript
// Current (all three, e.g. nvidia.js line 23):
temperature: 0.1,
// Change to:
temperature: opts.temperature || 0.1,
```

And all three need `buildDraftPrompt` added to their require from base.js, then use it when `opts.mode === 'draft'`:
```javascript
messages: [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: opts.mode === 'draft' ? buildDraftPrompt(email, opts) : buildPrompt(email, opts) }
]
```

---

### `scripts/eval-corpus.js` — NEW FILE

**Role:** utility — offline eval runner (no analog exists; patterns drawn from test files)

#### DB isolation pattern (from `tests/classifier_scope.test.js` lines 6–11):

```javascript
// Set DB_PATH BEFORE requiring any src/ module that touches DB
const dbPath = path.join(__dirname, '..', 'intellimail-scope-test.db');
process.env.DB_PATH = dbPath;
// ...
test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
```

For the eval script `--score` mode, set a throw-away DB path before requiring `../src/db` to avoid writing to production DB:
```javascript
process.env.DB_PATH = '/tmp/eval-score-throwaway.db';  // or os.tmpdir()
```

#### CommonJS module pattern (matches all project files):

```javascript
#!/usr/bin/env node
'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// --export mode: read from live DB
// --score mode: call provider APIs against corpus.json
const [,, mode] = process.argv;
```

#### DB read pattern (copy from `storeClassification()` in classifier.js for the SELECT query pattern):

```javascript
// Use better-sqlite3 synchronous API — same as entire codebase
const db = new Database(dbPath, { readonly: true });
const emails = db.prepare('SELECT id, subject, from_name, from_address, body_text FROM emails ORDER BY received_at DESC LIMIT 100').all();
```

#### Corpus schema (D-03):
```javascript
// corpus.json entry shape
{ id, subject, from, body_snippet, ground_truth_category }
// ground_truth_category is '' on --export (user fills in manually)
```

#### Score output format (per CONTEXT.md specifics):
```
=== IntelliMail Eval Corpus Accuracy ===
Total: 45 emails | Correct: 38 | Accuracy: 84.4%

By category:
  financial       : 8/9  (88.9%)
  fyi             : 5/7  (71.4%)
  ...
```

---

### `tests/llm/base.test.js` — UPDATE + NEW ASSERTIONS

**Role:** test — unit tests for base.js functions

#### Test file structure to match (lines 1–9):

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPrompt,
  parseProviderResponse,
  CATEGORIES,
  DEFAULTS
} = require('../../src/llm/providers/base');
```

Add `buildDraftPrompt` to the destructure.

#### Test to UPDATE (lines 70–73) — INFRA-01 changes behavior from throw to return:

Current (will break after INFRA-01):
```javascript
test('parseProviderResponse throws on totally garbage input', () => {
  assert.throws(() => parseProviderResponse('not json at all, nothing here'),
    /could not parse/i);
});
```

Change to assert return of DEFAULTS + error field instead of throw:
```javascript
test('parseProviderResponse returns DEFAULTS with error on garbage input (no throw)', () => {
  const r = parseProviderResponse('not json at all, nothing here');
  assert.equal(r.category, DEFAULTS.category);
  assert.equal(r.error, 'parse_failure');
  assert.equal(r.low_confidence, true);
});

test('parseProviderResponse still throws when raw is not a string', () => {
  assert.throws(() => parseProviderResponse(null), /could not parse/i);
  assert.throws(() => parseProviderResponse(42),   /could not parse/i);
});
```

#### New tests to ADD:

```javascript
// PROMPT-01: buildPrompt no longer includes draft_reply instruction in any mode
test('buildPrompt does not include draft_reply instruction (Call A only)', () => {
  const out = buildPrompt({ from_address: 'a@b.com', subject: 'Hi', body_text: 'hello' }, { mode: 'full' });
  assert.ok(!out.includes('draft_reply'), 'buildPrompt must not include draft_reply after PROMPT-01 split');
});

// PROMPT-02: SYSTEM_PROMPT has one-liner per category
test('SYSTEM_PROMPT includes one-liner definitions for all 8 categories', () => {
  const { SYSTEM_PROMPT } = require('../../src/llm/providers/base');
  for (const cat of CATEGORIES) {
    assert.ok(SYSTEM_PROMPT.includes(cat), `SYSTEM_PROMPT must reference category: ${cat}`);
  }
});

// PROMPT-05: summary constraint is structural
test('SYSTEM_PROMPT uses structural summary constraint not character-count limit', () => {
  const { SYSTEM_PROMPT } = require('../../src/llm/providers/base');
  assert.ok(!SYSTEM_PROMPT.includes('max 120 chars'), 'old character-count constraint must be removed');
  assert.ok(SYSTEM_PROMPT.includes('action'), 'structural constraint must reference action');
});

// PROMPT-07: low_confidence set when category not in enum
test('parseProviderResponse sets low_confidence when category falls back to default', () => {
  const r = parseProviderResponse('{"category":"spam_folder","urgency":"normal","summary":"s"}');
  assert.equal(r.category, 'other');
  assert.equal(r.low_confidence, true);
});

// buildDraftPrompt basic structure
test('buildDraftPrompt includes from, subject, and body truncated to ~800', () => {
  const r = buildDraftPrompt({
    from_name: 'Bob', from_address: 'b@c.com',
    subject: 'Test', body_text: 'x'.repeat(2000)
  });
  assert.match(r, /From: Bob/);
  assert.match(r, /Subject: Test/);
  assert.ok(r.includes('x'.repeat(800)) && !r.includes('x'.repeat(801)));
});
```

---

### `tests/classifier_validation.test.js` — NEW TEST CASE (INFRA-02)

**Role:** test — integration test for classifier queue behavior

#### Test DB isolation pattern to match (lines 6–11):

```javascript
const dbPath = path.join(__dirname, '..', 'intellimail-classvalid-test.db');
process.env.DB_PATH = dbPath;
test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
```

#### Router mock pattern to match (lines 43–58):

```javascript
const llm = require('../src/llm');
const origClassify = llm.router.classify;
llm.router.classify = async () => ({ category: 'request', urgency: 'whatever', ... });
try {
  await classifyEmail(userId, emailId);
} finally {
  llm.router.classify = origClassify;
}
```

#### New test case for INFRA-02:

```javascript
test('classifyEmail stores source="failed" after 3 failed attempts', async () => {
  const userId = global.__cvUserId;

  db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, from_address, body_text, received_at)
    VALUES (?, 'mid-attempts', 'INBOX', 'test attempts', 'x@x.com', 'body', datetime('now'))
  `).run(userId);
  const emailId = db.prepare("SELECT id FROM emails WHERE message_id = 'mid-attempts'").get().id;

  const llm = require('../src/llm');

  // Mock router.generateDraft too if needed, but the attempt cap is in classifyEmail
  // which calls router.classify — mock that to throw repeatedly
  const origClassify = llm.router.classify;
  llm.router.classify = async () => { throw new Error('provider error'); };
  try {
    // Call 3 times — each call should increment the attempt counter
    await classifyEmail(userId, emailId);
    // Delete the row to allow re-classification (INSERT OR IGNORE prevents double insert)
    db.prepare('DELETE FROM classifications WHERE email_id = ?').run(emailId);
    await classifyEmail(userId, emailId);
    db.prepare('DELETE FROM classifications WHERE email_id = ?').run(emailId);
    await classifyEmail(userId, emailId);
  } finally {
    llm.router.classify = origClassify;
  }

  // After 3 failures, source should be 'failed'
  // Note: actual behavior depends on how the fallback + attempt counter interact —
  // confirm the exact row written matches the implementation
  const row = db.prepare('SELECT source FROM classifications WHERE email_id = ?').get(emailId);
  assert.equal(row.source, 'failed');
});
```

---

## Shared Patterns

### CommonJS module pattern
**Source:** All `src/` files
**Apply to:** `scripts/eval-corpus.js` and all modified files
```javascript
'use strict';
const x = require('./path');
module.exports = { fn1, fn2 };
```

### Test DB isolation
**Source:** `tests/classifier_scope.test.js` lines 6–11, `tests/classifier_validation.test.js` lines 7–11
**Apply to:** `tests/classifier_validation.test.js` new test case, `scripts/eval-corpus.js` --score mode
```javascript
const dbPath = path.join(__dirname, '..', 'intellimail-{suite}-test.db');
process.env.DB_PATH = dbPath;  // MUST be set before any require('../src/db')
test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
```

### Router mock pattern (monkey-patch)
**Source:** `tests/classifier_validation.test.js` lines 43–58
**Apply to:** New INFRA-02 test and any new test that exercises classifier without real LLM
```javascript
const llm = require('../src/llm');
const origClassify = llm.router.classify;
llm.router.classify = async () => ({ /* fake result */ });
try {
  await classifyEmail(userId, emailId);
} finally {
  llm.router.classify = origClassify;  // always restore in finally
}
```

### Inline migration guard
**Source:** `src/db.js` lines 86, 184–199
**Apply to:** `src/db.js` new `low_confidence` column
```javascript
try { db.exec('ALTER TABLE classifications ADD COLUMN low_confidence INTEGER DEFAULT 0'); } catch(e) {}
```

### Provider call structure (OpenAI-compatible: nvidia, groq, deepseek)
**Source:** `src/llm/providers/nvidia.js` full file
**Apply to:** Temperature override changes in nvidia.js, groq.js, deepseek.js
```javascript
body: JSON.stringify({
  model: cfg.model || 'default-model',
  temperature: opts.temperature || 0.1,   // read from opts; fallback to 0.1 for Call A
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: opts.mode === 'draft' ? buildDraftPrompt(email, opts) : buildPrompt(email, opts) }
  ]
})
```

### Provider call structure (Gemini — different format)
**Source:** `src/llm/providers/gemini.js` lines 25–34
**Apply to:** `src/llm/providers/gemini.js` temperature + buildDraftPrompt changes
```javascript
body: JSON.stringify({
  contents: [
    {
      role: 'user',
      parts: [{
        text: opts.mode === 'draft'
          ? buildDraftPrompt(email, opts)
          : SYSTEM_PROMPT + '\n\n' + buildPrompt(email, opts)
      }]
    }
  ],
  generationConfig: {
    temperature: opts.temperature || 0.1,
    responseMimeType: 'application/json'
  }
})
```

### Error outcome string set
**Source:** `src/llm/router.js` lines 126–133 (`classifyError()`)
**Apply to:** Any new error tracking; `'parse_failure'` is a new outcome string that joins this set:
```javascript
// existing: 'http_429' | 'http_401' | 'http_503' | 'http_5xx' | 'timeout' | 'invalid_json' | 'network'
// new in Phase 1: 'parse_failure' (returned in parsed.error field, not thrown)
```

---

## No Analog Found

No files are without analog. All patterns are drawn from the existing codebase.

| File | Closest Pattern | Note |
|------|-----------------|------|
| `scripts/eval-corpus.js` | `tests/classifier_scope.test.js` (DB isolation) | New file type (offline script) but patterns directly transferable; DB read uses better-sqlite3 synchronous API already used throughout |

---

## Metadata

**Analog search scope:** `src/llm/providers/`, `src/llm/`, `src/`, `src/routes/`, `tests/`
**Files read directly:** 11
**Pattern extraction date:** 2026-05-14

**Critical facts confirmed by direct read (override CONTEXT.md):**
- Groq already has `response_format: { type: 'json_object' }` + `temperature: 0.1` (line 22–23) — no JSON mode work needed
- DeepSeek already has `response_format: { type: 'json_object' }` + `temperature: 0.1` (line 22–23) — no JSON mode work needed
- Gemini already has `responseMimeType: 'application/json'` + `temperature: 0.1` (line 30–31) — no JSON mode work needed
- NVIDIA already correct — confirmed
- `db-migration.js` does NOT contain an `addColumn()` helper — use inline `try { db.exec(...) } catch(e) {}` in `db.js`
- `parseProviderResponse()` currently throws on JSON-miss at line 71 — INFRA-01 must change this to WARN + return
- `classifier.generateDraft()` currently calls `llm.router.classify(email, { mode: 'regen' })` at line 278 — must change to `llm.router.generateDraft()`
- `api.js` draft/regen endpoint (line 1012) calls `llm.router.classify()` directly — must also be updated to `llm.router.generateDraft()`
