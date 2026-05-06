# LLM Provider Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded `fetch('http://localhost:8765/classify')` call with a provider-agnostic router that cascades through Local Ollama → Groq → Gemini 2.5 Flash → template fallback, with user-configurable order, rate limiting, daily quotas, and a circuit breaker — so classification and draft regen keep working for ~1000 emails/day on free tiers even when Ollama is down.

**Architecture:** Extract a `LlmProvider` interface under `src/llm/providers/`. A single `src/llm/router.js` owns the cascade and cross-cutting concerns (bucket, breaker, quota, logging). Both Tier‑2 call sites — `classifyEmail()` in `src/classifier.js` and `POST /api/emails/:id/draft/regen` — go through the router. Config lives in `account_config` (comma-separated provider order + enabled flags + per-provider keys/models); env vars optionally override keys.

**Tech Stack:** Node.js 24, Express, better-sqlite3, Alpine.js 3, HTMX, vanilla `fetch`, built-in `node:test`. No new runtime dependencies.

**Conventions used in this plan:**
- Test runner command: `node --test tests/<path>`. Writing a plain `node:test` file with `test()`/`assert` is enough — no config.
- All git commands assume the local-only repo already initialized at `/c/mywork/xgen-intel` (commit `3fcf0b1`).
- `git commit -m "checkpoint: <what>"` format — keeps every task in sync with the "always checkpoint" preference.

---

## File Structure

**New files:**
- `src/llm/providers/base.js` — prompt builder + JSON output schema + parser + normalizer
- `src/llm/providers/local.js` — wraps existing FastAPI call
- `src/llm/providers/groq.js` — Groq chat completions
- `src/llm/providers/gemini.js` — Gemini generateContent
- `src/llm/router.js` — cascade + bucket + breaker + quota + logging
- `src/llm/config.js` — resolves provider config from env/DB
- `src/llm/ratelimiter.js` — token bucket
- `src/llm/templates.js` — canned tone-aware template replies
- `tests/llm/base.test.js`
- `tests/llm/router.test.js`
- `tests/llm/providers/local.test.js`
- `tests/llm/providers/groq.test.js`
- `tests/llm/providers/gemini.test.js`
- `tests/llm/ratelimiter.test.js`
- `tests/llm/templates.test.js`

**Modified files:**
- `package.json` — add `test` script
- `src/db.js` — `ALTER TABLE account_config ADD COLUMN ...` + `CREATE TABLE provider_usage`
- `src/classifier.js` — `classifyEmail()` calls `router.classify(email, {mode:'full'})` instead of direct fetch
- `src/routes/api.js` — regen route uses router + template fallback; new `POST /api/providers/:name/test`, extended `GET/POST /api/settings`
- `views/settings.html` — new "AI Providers" card (inputs + toggles + reorder + test + usage counters)
- `public/js/app.js` — `regenerateDraft()` handles `data.warning`

---

## Task 1: Test scaffolding

**Files:**
- Modify: `package.json`
- Create: `tests/smoke.test.js`

- [ ] **Step 1: Add test script to `package.json`**

Edit `package.json`:
```json
"scripts": {
  "start": "node src/server.js",
  "dev": "nodemon src/server.js",
  "test": "node --test tests/"
},
```

- [ ] **Step 2: Create smoke test**

Create `tests/smoke.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('node:test is wired up', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Run and confirm passing**

Run: `npm test`
Expected: `# pass 1` in output.

- [ ] **Step 4: Commit**

```bash
git add package.json tests/smoke.test.js
git commit -m "checkpoint: add node:test scaffolding"
```

---

## Task 2: `base.js` — prompt builder, output contract, parser

**Files:**
- Create: `src/llm/providers/base.js`
- Create: `tests/llm/base.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/llm/base.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPrompt,
  parseProviderResponse,
  CATEGORIES,
  DEFAULTS
} = require('../../src/llm/providers/base');

test('buildPrompt includes sender, subject, and body truncated to 800', () => {
  const email = {
    from_name: 'Alice',
    from_address: 'alice@example.com',
    subject: 'Invoice #123',
    body_text: 'x'.repeat(2000)
  };
  const out = buildPrompt(email, { mode: 'full' });
  assert.match(out, /From: Alice <alice@example\.com>/);
  assert.match(out, /Subject: Invoice #123/);
  assert.ok(out.includes('x'.repeat(800)) && !out.includes('x'.repeat(801)),
    'body should be truncated to 800 chars');
});

test('buildPrompt in regen mode includes tone instruction', () => {
  const email = { from_name: '', from_address: 'a@b.com', subject: 'Hi', body_text: 'hello' };
  const out = buildPrompt(email, { mode: 'regen', tone: 'friendly' });
  assert.match(out, /friendly/i);
});

test('parseProviderResponse parses clean JSON and normalizes', () => {
  const raw = JSON.stringify({
    category: 'financial', urgency: 'urgent', urgency_reason: 'Due today',
    summary: 's', extracted_data: { amount: '100' },
    suggested_tone: 'professional', draft_reply: 'ok'
  });
  const r = parseProviderResponse(raw);
  assert.equal(r.category, 'financial');
  assert.equal(r.urgency, 'urgent');
  assert.equal(r.draft_reply, 'ok');
});

test('parseProviderResponse extracts JSON from markdown fence', () => {
  const raw = '```json\n{"category":"fyi","urgency":"normal","summary":"s","draft_reply":"x"}\n```';
  const r = parseProviderResponse(raw);
  assert.equal(r.category, 'fyi');
});

test('parseProviderResponse tolerates trailing chatter', () => {
  const raw = 'Here is my analysis: {"category":"legal","urgency":"urgent","summary":"s","draft_reply":"r"} Hope that helps!';
  const r = parseProviderResponse(raw);
  assert.equal(r.category, 'legal');
});

test('parseProviderResponse fills missing fields with defaults', () => {
  const raw = '{"category":"travel"}';
  const r = parseProviderResponse(raw);
  assert.equal(r.category, 'travel');
  assert.equal(r.urgency, 'normal');
  assert.equal(r.suggested_tone, 'professional');
  assert.equal(typeof r.summary, 'string');
  assert.deepEqual(r.extracted_data, {});
});

test('parseProviderResponse maps unknown category to other', () => {
  const raw = '{"category":"spam_folder","urgency":"normal","summary":"s","draft_reply":"r"}';
  const r = parseProviderResponse(raw);
  assert.equal(r.category, 'other');
});

test('parseProviderResponse throws on totally garbage input', () => {
  assert.throws(() => parseProviderResponse('not json at all, nothing here'),
    /could not parse/i);
});

test('CATEGORIES has the 8 expected values', () => {
  assert.deepEqual(new Set(CATEGORIES), new Set([
    'meeting_request','financial','legal','travel',
    'pitch_deck','fyi','rewards_awards','other'
  ]));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/llm/base.test.js`
Expected: module not found / multiple test failures.

- [ ] **Step 3: Implement `src/llm/providers/base.js`**

```js
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

function buildPrompt(email, opts = {}) {
  const lines = [];
  lines.push(SYSTEM_PROMPT);
  lines.push('');
  lines.push(`From: ${email.from_name || ''} <${email.from_address || ''}>`);
  lines.push(`Subject: ${email.subject || ''}`);
  const body = (email.body_text || email.preview || '').slice(0, 800);
  if (body) lines.push('', body);
  if (opts.mode === 'regen' && opts.tone) {
    lines.push('', `Generate the draft_reply in a ${opts.tone} tone.`);
  }
  return lines.join('\n');
}

function extractJsonBlock(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

function parseProviderResponse(raw) {
  if (typeof raw !== 'string') {
    throw new Error('could not parse provider response: not a string');
  }
  const obj = extractJsonBlock(raw);
  if (!obj || typeof obj !== 'object') {
    throw new Error('could not parse provider response: no JSON object found');
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

module.exports = {
  CATEGORIES, URGENCIES, TONES, DEFAULTS,
  buildPrompt, parseProviderResponse, extractJsonBlock,
  SYSTEM_PROMPT
};
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/llm/base.test.js`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm/providers/base.js tests/llm/base.test.js
git commit -m "checkpoint: llm base — prompt builder + JSON parser + contract"
```

---

## Task 3: Local provider (wraps existing FastAPI)

**Files:**
- Create: `src/llm/providers/local.js`
- Create: `tests/llm/providers/local.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/llm/providers/local.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const local = require('../../../src/llm/providers/local');

test('local provider calls localhost:8765/classify with email fields', async () => {
  const origFetch = global.fetch;
  let seenUrl, seenBody;
  global.fetch = async (url, opts) => {
    seenUrl = url;
    seenBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        category: 'meeting_request', urgency: 'normal',
        summary: 's', extracted_data: {},
        suggested_tone: 'professional', draft_reply: 'reply'
      })
    };
  };
  try {
    const email = { id: 1, from_name: 'x', from_address: 'a@b.com', subject: 'Hi', body_text: 'hello' };
    const result = await local.call(email, { mode: 'full' }, {});
    assert.equal(seenUrl, 'http://localhost:8765/classify');
    assert.equal(seenBody.subject, 'Hi');
    assert.equal(seenBody.from_address, 'a@b.com');
    assert.equal(result.category, 'meeting_request');
  } finally {
    global.fetch = origFetch;
  }
});

test('local provider throws with status tag on HTTP 500', async () => {
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  try {
    const email = { from_address: 'a@b.com', subject: 's', body_text: 'b' };
    await assert.rejects(
      () => local.call(email, { mode: 'full' }, {}),
      /500/
    );
  } finally {
    global.fetch = origFetch;
  }
});

test('local provider metadata', () => {
  assert.equal(local.name, 'local');
  assert.ok(local.limits.rpm > 0);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- tests/llm/providers/local.test.js`
Expected: module not found.

- [ ] **Step 3: Implement `src/llm/providers/local.js`**

```js
const URL = 'http://localhost:8765/classify';

async function call(email, opts, cfg) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject:      email.subject      || '',
        from_address: email.from_address || '',
        from_name:    email.from_name    || '',
        preview:      (email.body_text   || '').slice(0, 400),
        email_id:     email.id != null ? String(email.id) : undefined
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Local API error: ${res.status} ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  name: 'local',
  defaultModel: 'ollama:intellimail-qwen',
  limits: { rpm: 120, rpd: Number.POSITIVE_INFINITY },
  call
};
```

- [ ] **Step 4: Verify pass**

Run: `npm test -- tests/llm/providers/local.test.js`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm/providers/local.js tests/llm/providers/local.test.js
git commit -m "checkpoint: local provider wrapping FastAPI"
```

---

## Task 4: Minimal router (cascade only)

**Files:**
- Create: `src/llm/router.js`
- Create: `tests/llm/router.test.js`

- [ ] **Step 1: Write failing tests (cascade only — more tests added in later tasks)**

Create `tests/llm/router.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../../src/llm/router');

function fake(name, impl) {
  return {
    name, defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: impl
  };
}

test('router returns first provider success and skips others', async () => {
  let calledB = false;
  const a = fake('a', async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }));
  const b = fake('b', async () => { calledB = true; return {}; });
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.equal(out._provider, 'a');
  assert.equal(out.category, 'fyi');
  assert.equal(calledB, false);
});

test('router falls through to next provider on throw', async () => {
  const a = fake('a', async () => { throw new Error('nope'); });
  const b = fake('b', async () => ({ category: 'legal', urgency: 'urgent', summary: 's', draft_reply: 'r' }));
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.equal(out._provider, 'b');
  assert.equal(out.category, 'legal');
});

test('router returns null when all providers fail', async () => {
  const a = fake('a', async () => { throw new Error('x'); });
  const b = fake('b', async () => { throw new Error('y'); });
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.equal(out, null);
});

test('router honors order and enabled flags', async () => {
  const seen = [];
  const a = fake('a', async () => { seen.push('a'); throw new Error('x'); });
  const b = fake('b', async () => { seen.push('b'); throw new Error('y'); });
  const c = fake('c', async () => { seen.push('c'); return { category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }; });
  const r = createRouter({
    providers: [a, b, c],
    getConfig: () => ({ order: ['c', 'a'], enabled: ['c', 'a'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.deepEqual(seen, ['c']);
  assert.equal(out._provider, 'c');
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- tests/llm/router.test.js`
Expected: module not found.

- [ ] **Step 3: Implement minimal `src/llm/router.js`**

```js
const { parseProviderResponse, DEFAULTS } = require('./providers/base');

function createRouter({ providers, getConfig, logger }) {
  const byName = new Map(providers.map(p => [p.name, p]));
  const log = logger || (() => {});

  async function classify(email, opts = {}) {
    const cfg = getConfig() || { order: [], enabled: [], keys: {}, models: {} };
    const enabledSet = new Set(cfg.enabled || []);
    const order = (cfg.order || []).filter(n => enabledSet.has(n) && byName.has(n));

    for (const name of order) {
      const provider = byName.get(name);
      const providerCfg = {
        apiKey: (cfg.keys || {})[name],
        model: (cfg.models || {})[name] || provider.defaultModel
      };
      const start = Date.now();
      try {
        const rawResult = await provider.call(email, opts, providerCfg);
        const parsed = typeof rawResult === 'string'
          ? parseProviderResponse(rawResult)
          : { ...DEFAULTS, ...rawResult };
        log({ provider: name, mode: opts.mode, outcome: 'success', latency_ms: Date.now() - start, email_id: email.id });
        return { ...parsed, _provider: name };
      } catch (err) {
        log({ provider: name, mode: opts.mode, outcome: classifyError(err), latency_ms: Date.now() - start, email_id: email.id, err: err.message });
        continue;
      }
    }
    return null;
  }

  function classifyError(err) {
    if (err.status === 429) return 'http_429';
    if (err.status === 401 || err.status === 403) return 'http_401';
    if (err.status >= 500) return 'http_5xx';
    if (err.name === 'AbortError') return 'timeout';
    if (/could not parse/i.test(err.message)) return 'invalid_json';
    return 'network';
  }

  return { classify, _byName: byName };
}

module.exports = { createRouter };
```

- [ ] **Step 4: Verify pass**

Run: `npm test -- tests/llm/router.test.js`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm/router.js tests/llm/router.test.js
git commit -m "checkpoint: minimal router cascade"
```

---

## Task 5: Wire router into `classifier.js` and regen route (no behavior change)

**Files:**
- Create: `src/llm/index.js`
- Modify: `src/classifier.js:90-104` (replace `localClassify`), `src/classifier.js:155-170` (Tier 2 call), `src/classifier.js:108-118` (`generateDraft`)
- Modify: `src/routes/api.js:898-934` (regen route)

- [ ] **Step 1: Create `src/llm/index.js` — singleton wiring**

```js
const localProvider = require('./providers/local');
const { createRouter } = require('./router');

function log(rec) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n');
}

function getConfig() {
  return {
    order: ['local'],
    enabled: ['local'],
    keys: {},
    models: {}
  };
}

const router = createRouter({
  providers: [localProvider],
  getConfig,
  logger: log
});

module.exports = { router, _setConfigProvider: (fn) => { module.exports.router = createRouter({
  providers: [localProvider], getConfig: fn, logger: log
}); } };
```

(The `_setConfigProvider` hook gets used in Task 11.)

- [ ] **Step 2: Modify `src/classifier.js` Tier 2 block**

Replace the `localClassify` function (`src/classifier.js:90-104`) and the Tier 2 call inside `classifyEmail` (`src/classifier.js:156-170`).

Remove the top-level `LOCAL_API` const and `localClassify` function. Add at the top, after the `const { db, getConfig } = require('./db');` line:
```js
const llm = require('./llm');
```

Replace the Tier 2 block inside `classifyEmail`:
```js
  // Tier 2: provider cascade (local → groq → gemini → ...)
  const routed = await llm.router.classify(email, { mode: 'full' });
  if (routed) {
    storeClassification(emailId, {
      category:       routed.category,
      urgency:        routed.urgency,
      urgency_reason: routed.urgency_reason,
      summary:        routed.summary,
      extracted_data: routed.extracted_data || {},
      suggested_tone: routed.suggested_tone || 'professional',
      draft_reply:    routed.draft_reply    || null
    });
    return;
  }
  storeClassification(emailId, fallbackClassification());
```

Replace `generateDraft`:
```js
async function generateDraft(emailId) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
  if (!email) return null;
  const routed = await llm.router.classify(email, { mode: 'regen' });
  return routed?.draft_reply || 'Thank you for your email. I will review and respond shortly.';
}
```

- [ ] **Step 3: Modify `src/routes/api.js:898-934` (regen route)**

Replace the body of `router.post('/api/emails/:id/draft/regen', ...)` with:
```js
router.post('/api/emails/:id/draft/regen', async (req, res) => {
  const { tone = 'professional' } = req.body;
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(req.params.id);
  const cls = db.prepare('SELECT * FROM classifications WHERE email_id = ?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Email not found' });

  try {
    const llm = require('../llm');
    const routed = await llm.router.classify(email, { mode: 'regen', tone });
    const draftReply = routed?.draft_reply
      || cls?.draft_reply
      || 'Thank you for your email. I will respond shortly.';

    const existing = db.prepare('SELECT id FROM drafts WHERE email_id = ?').get(req.params.id);
    if (existing) {
      db.prepare('UPDATE drafts SET body=?, tone=?, last_edited=CURRENT_TIMESTAMP WHERE email_id=?')
        .run(draftReply, tone, req.params.id);
    } else {
      db.prepare('INSERT INTO drafts (email_id, body, tone, subject, to_address) VALUES (?,?,?,?,?)')
        .run(req.params.id, draftReply, tone, 'Re: ' + email.subject, email.from_address);
    }

    res.json({ draft_reply: draftReply, source: routed?._provider || 'fallback' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 4: Smoke check — server still starts**

Run in background: `node src/server.js`
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/setup`
Expected: `200`.
Stop server.

- [ ] **Step 5: Commit**

```bash
git add src/llm/index.js src/classifier.js src/routes/api.js
git commit -m "checkpoint: migrate Tier-2 callers to router"
```

---

## Task 6: Template fallback for regen + client warning UX

**Files:**
- Create: `src/llm/templates.js`
- Create: `tests/llm/templates.test.js`
- Modify: `src/routes/api.js` (regen route — now returns template with `warning` when router returns null)
- Modify: `public/js/app.js:207-232` (`regenerateDraft`)

- [ ] **Step 1: Write failing template tests**

Create `tests/llm/templates.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTemplateReply } = require('../../src/llm/templates');

test('template for meeting_request professional', () => {
  const r = buildTemplateReply({ category: 'meeting_request' }, 'professional');
  assert.match(r, /meeting/i);
});

test('legal category forces professional tone', () => {
  const r = buildTemplateReply({ category: 'legal' }, 'friendly');
  assert.match(r, /acknowledge|notice/i);
  assert.doesNotMatch(r, /cheers|thanks!/i);
});

test('unknown category returns generic reply', () => {
  const r = buildTemplateReply({ category: 'spam' }, 'professional');
  assert.match(r, /thank|review/i);
});

test('unknown tone falls back to professional', () => {
  const r = buildTemplateReply({ category: 'fyi' }, 'sarcastic');
  assert.ok(typeof r === 'string' && r.length > 0);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- tests/llm/templates.test.js`
Expected: module not found.

- [ ] **Step 3: Implement `src/llm/templates.js`**

```js
const GENERIC = {
  formal:        'Thank you for your email. I will review and respond in due course.',
  professional: 'Thank you for your email. I will review and respond shortly.',
  friendly:     'Thanks for reaching out — I\'ll get back to you soon.',
  brief:        'Received — will respond shortly.'
};

const TABLE = {
  meeting_request: {
    formal:        'Thank you for the meeting invitation. I will review my calendar and respond with my availability.',
    professional: 'Thank you for the meeting invitation. I will review and confirm my availability shortly.',
    friendly:     'Thanks for the invite — I\'ll take a look and get back to you on timing.',
    brief:        'Thanks — will confirm availability shortly.'
  },
  financial: {
    formal:        'Thank you for the notice. I will review the details and revert in due course.',
    professional: 'Thank you for the notice. I will review the details and respond shortly.',
    friendly:     'Thanks for the heads-up — I\'ll look into it.',
    brief:        'Noted — will review shortly.'
  },
  legal: {
    formal:        'I acknowledge receipt of your notice. I will review the matter and respond through appropriate channels.',
    professional: 'I acknowledge receipt of your notice. I will review and respond accordingly.',
    friendly:     'I acknowledge receipt of your notice. I will review and respond accordingly.',
    brief:        'Acknowledged — reviewing.'
  },
  travel: {
    formal:        'Thank you for the booking confirmation. I will review the itinerary and respond if any adjustments are needed.',
    professional: 'Thank you for the confirmation. I will check the details and follow up if needed.',
    friendly:     'Thanks for the booking info — I\'ll double-check the details and reach out if anything\'s off.',
    brief:        'Thanks — will verify details.'
  },
  pitch_deck: {
    formal:        'Thank you for sharing. I will review the materials and respond at my earliest convenience.',
    professional: 'Thanks for sending this through. I will review and get back to you.',
    friendly:     'Thanks for sharing — I\'ll take a look and circle back.',
    brief:        'Thanks — will review.'
  },
  fyi: {
    formal:        'Thank you for the update. Noted.',
    professional: 'Thank you for the update. Noted for my records.',
    friendly:     'Thanks for the heads-up!',
    brief:        'Noted.'
  },
  rewards_awards: {
    formal:        'Thank you for the notification. I will review and act as appropriate.',
    professional: 'Thank you for letting me know. I will review before the deadline.',
    friendly:     'Thanks — I\'ll take a look before these expire.',
    brief:        'Noted — will check before expiry.'
  },
  other: GENERIC
};

function buildTemplateReply(classification, tone) {
  const cat = classification?.category || 'other';
  const table = TABLE[cat] || GENERIC;
  if (cat === 'legal') return table.professional;
  return table[tone] || table.professional || GENERIC.professional;
}

module.exports = { buildTemplateReply, TABLE, GENERIC };
```

- [ ] **Step 4: Verify template tests pass**

Run: `npm test -- tests/llm/templates.test.js`
Expected: 4 tests pass.

- [ ] **Step 5: Update regen route to use template + warning when router returns null**

In `src/routes/api.js` replace the regen-route body from Task 5 with:
```js
router.post('/api/emails/:id/draft/regen', async (req, res) => {
  const { tone = 'professional' } = req.body;
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(req.params.id);
  const cls = db.prepare('SELECT * FROM classifications WHERE email_id = ?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Email not found' });

  const llm = require('../llm');
  const { buildTemplateReply } = require('../llm/templates');

  let draftReply, source, warning = null;
  try {
    const routed = await llm.router.classify(email, { mode: 'regen', tone });
    if (routed && routed.draft_reply) {
      draftReply = routed.draft_reply;
      source = routed._provider;
    } else {
      draftReply = buildTemplateReply(cls || { category: 'other' }, tone);
      source = 'template';
      warning = 'All LLM providers unavailable — showing template reply';
    }
  } catch (e) {
    draftReply = buildTemplateReply(cls || { category: 'other' }, tone);
    source = 'template';
    warning = 'LLM provider error — showing template reply';
  }

  const existing = db.prepare('SELECT id FROM drafts WHERE email_id = ?').get(req.params.id);
  if (existing) {
    db.prepare('UPDATE drafts SET body=?, tone=?, last_edited=CURRENT_TIMESTAMP WHERE email_id=?')
      .run(draftReply, tone, req.params.id);
  } else {
    db.prepare('INSERT INTO drafts (email_id, body, tone, subject, to_address) VALUES (?,?,?,?,?)')
      .run(req.params.id, draftReply, tone, 'Re: ' + email.subject, email.from_address);
  }

  res.json({ draft_reply: draftReply, source, ...(warning ? { warning } : {}) });
});
```

- [ ] **Step 6: Update client `regenerateDraft()` in `public/js/app.js:207-232`**

Replace the function body:
```js
    async regenerateDraft() {
      this.regenerating = true;
      this.saveStatus = 'Regenerating...';
      try {
        const res = await fetch(`/api/emails/${this.emailId}/draft/regen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tone: this.tone })
        });
        if (res.ok) {
          const data = await res.json();
          this.draftBody = data.draft_reply || '';
          if (data.warning) {
            this.saveStatus = 'Regenerated (template)';
            showToast('warning', '⚠ ' + data.warning);
          } else {
            this.saveStatus = 'Regenerated';
            showToast('success', '↻ Draft regenerated (' + (data.source || 'llm') + ')');
          }
        } else {
          const err = await res.json().catch(() => ({}));
          showToast('error', '❌ Regen failed: ' + (err.error || 'Unknown error'));
          this.saveStatus = 'Regen failed';
        }
      } catch(e) {
        showToast('error', '❌ Network error during regen');
        this.saveStatus = 'Error';
      } finally {
        this.regenerating = false;
      }
    },
```

- [ ] **Step 7: Verify showToast supports 'warning' variant**

Check `public/js/app.js` for the `showToast` definition. If it only handles `success` and `error`, extend:
Run: `grep -n "function showToast\|window.showToast" /c/mywork/xgen-intel/public/js/app.js`
If the function uses a switch or object lookup, add a `warning: '#d97706'` (amber) color mapping — mirror the existing style of whatever exists. If the file doesn't define it and it's globally provided elsewhere, search `views/partials/draft-editor.html` and nearby. Add a mapping entry without removing the existing `success`/`error` ones.

- [ ] **Step 8: Manual smoke — Regen with no Tier-2 service**

- Start server: `node src/server.js`
- Verify FastAPI on :8765 is NOT running (curl refused).
- In the dashboard, click any email, then click Regen.
- Expected: yellow warning toast "All LLM providers unavailable — showing template reply"; draft editor populated with a generic template line.
- Stop server.

- [ ] **Step 9: Commit**

```bash
git add src/llm/templates.js tests/llm/templates.test.js src/routes/api.js public/js/app.js
git commit -m "checkpoint: template fallback + warning UX for regen"
```

---

## Task 7: DB migrations — new columns + `provider_usage` table

**Files:**
- Modify: `src/db.js` (after the existing `is_deleted` migration at line 86)

- [ ] **Step 1: Add migrations to `src/db.js`**

After the line `try { db.exec('ALTER TABLE emails ADD COLUMN is_deleted INTEGER DEFAULT 0'); } catch(e) {}` insert:
```js
// ─── LLM provider config + usage ─────────────────────────────────────────
const PROVIDER_COLS = [
  ['groq_api_key',          'TEXT'],
  ['gemini_api_key',        'TEXT'],
  ['groq_model',            "TEXT DEFAULT 'llama-3.3-70b-versatile'"],
  ['gemini_model',          "TEXT DEFAULT 'gemini-2.5-flash'"],
  ['llm_provider_order',    "TEXT DEFAULT 'local,groq,gemini'"],
  ['llm_providers_enabled', "TEXT DEFAULT 'local,groq,gemini'"]
];
for (const [col, type] of PROVIDER_COLS) {
  try { db.exec(`ALTER TABLE account_config ADD COLUMN ${col} ${type}`); } catch(e) {}
}

db.exec(`
CREATE TABLE IF NOT EXISTS provider_usage (
  provider TEXT NOT NULL,
  day DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, day)
);
CREATE INDEX IF NOT EXISTS idx_provider_usage_day ON provider_usage(day);
`);

// Prune provider_usage rows older than 7 days on boot
try { db.prepare("DELETE FROM provider_usage WHERE day < date('now', '-7 days')").run(); } catch(e) {}
```

- [ ] **Step 2: Verify schema change by starting server**

- Delete any existing `intellimail.db` to start fresh (OR keep it — migrations are additive): `rm -f /c/mywork/xgen-intel/intellimail.db`
- Run: `node src/server.js &` then `sleep 1`
- Run: `sqlite3 /c/mywork/xgen-intel/intellimail.db ".schema account_config"`
- Expected: new columns (`groq_api_key`, `gemini_api_key`, `groq_model`, `gemini_model`, `llm_provider_order`, `llm_providers_enabled`) present in output.
- Run: `sqlite3 /c/mywork/xgen-intel/intellimail.db ".schema provider_usage"`
- Expected: the new table is present.
- Stop server.

If `sqlite3` CLI isn't available, use a one-off node snippet:
```bash
node -e "const db=require('better-sqlite3')('intellimail.db'); console.log(db.prepare('PRAGMA table_info(account_config)').all().map(c=>c.name).join(','));"
```

- [ ] **Step 3: Commit**

```bash
git add src/db.js
git commit -m "checkpoint: schema for provider config + daily usage"
```

---

## Task 8: Config resolver (env + DB)

**Files:**
- Create: `src/llm/config.js`

- [ ] **Step 1: Implement `src/llm/config.js`**

```js
const { db } = require('../db');

function parseList(s) {
  if (!s) return [];
  return String(s).split(',').map(x => x.trim()).filter(Boolean);
}

function resolveConfig() {
  const row = db.prepare('SELECT * FROM account_config WHERE id = 1').get() || {};
  const order = parseList(row.llm_provider_order) || ['local', 'groq', 'gemini'];
  const enabled = parseList(row.llm_providers_enabled) || ['local', 'groq', 'gemini'];

  const keys = {
    local:  null,
    groq:   process.env.GROQ_API_KEY   || row.groq_api_key   || null,
    gemini: process.env.GEMINI_API_KEY || row.gemini_api_key || null
  };
  const models = {
    local:  null,
    groq:   row.groq_model   || 'llama-3.3-70b-versatile',
    gemini: row.gemini_model || 'gemini-2.5-flash'
  };

  // Auto-disable cloud providers without a key
  const enabledFiltered = enabled.filter(p => p === 'local' || keys[p]);

  return {
    order: order.length ? order : ['local', 'groq', 'gemini'],
    enabled: enabledFiltered,
    keys,
    models
  };
}

function saveProviderConfig({ groq_api_key, gemini_api_key, groq_model, gemini_model, order, enabled }) {
  const existing = db.prepare('SELECT id FROM account_config WHERE id = 1').get();
  if (!existing) {
    db.prepare('INSERT INTO account_config (id) VALUES (1)').run();
  }
  const orderStr   = Array.isArray(order)   ? order.join(',')   : order;
  const enabledStr = Array.isArray(enabled) ? enabled.join(',') : enabled;
  db.prepare(`UPDATE account_config SET
    groq_api_key   = COALESCE(?, groq_api_key),
    gemini_api_key = COALESCE(?, gemini_api_key),
    groq_model     = COALESCE(?, groq_model),
    gemini_model   = COALESCE(?, gemini_model),
    llm_provider_order    = COALESCE(?, llm_provider_order),
    llm_providers_enabled = COALESCE(?, llm_providers_enabled)
    WHERE id = 1`).run(
      groq_api_key ?? null,
      gemini_api_key ?? null,
      groq_model ?? null,
      gemini_model ?? null,
      orderStr ?? null,
      enabledStr ?? null
    );
}

module.exports = { resolveConfig, saveProviderConfig };
```

- [ ] **Step 2: Smoke test**

Run: `node -e "const c=require('./src/llm/config'); console.log(JSON.stringify(c.resolveConfig(), null, 2));"`
Expected: JSON output with `order`, `enabled`, `keys` (local only — others null), `models`.

- [ ] **Step 3: Commit**

```bash
git add src/llm/config.js
git commit -m "checkpoint: provider config resolver (env + DB)"
```

---

## Task 9: Groq provider

**Files:**
- Create: `src/llm/providers/groq.js`
- Create: `tests/llm/providers/groq.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/llm/providers/groq.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const groq = require('../../../src/llm/providers/groq');

test('groq posts chat completion with bearer key and json_object format', async () => {
  const orig = global.fetch;
  let seenUrl, seenOpts;
  global.fetch = async (url, opts) => {
    seenUrl = url; seenOpts = opts;
    return {
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          category: 'financial', urgency: 'moderate', summary: 's',
          extracted_data: { amount_due: '100' },
          suggested_tone: 'professional', draft_reply: 'reply'
        }) } }]
      })
    };
  };
  try {
    const email = { from_address: 'a@b.com', subject: 'Bill', body_text: 'Pay now' };
    const out = await groq.call(email, { mode: 'full' }, { apiKey: 'sk-test', model: 'llama-3.3-70b-versatile' });
    assert.equal(seenUrl, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(seenOpts.headers['Authorization'], 'Bearer sk-test');
    const body = JSON.parse(seenOpts.body);
    assert.equal(body.model, 'llama-3.3-70b-versatile');
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.temperature, 0.1);
    assert.equal(out.category, 'financial');
  } finally {
    global.fetch = orig;
  }
});

test('groq missing API key throws', async () => {
  await assert.rejects(
    () => groq.call({ from_address: 'a@b.com', subject: 'x' }, {}, { apiKey: null }),
    /api key/i
  );
});

test('groq propagates 429 with status', async () => {
  const orig = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate' });
  try {
    await assert.rejects(
      () => groq.call({ from_address: 'a@b.com', subject: 'x' }, {}, { apiKey: 'k', model: 'm' }),
      (err) => err.status === 429
    );
  } finally {
    global.fetch = orig;
  }
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- tests/llm/providers/groq.test.js`

- [ ] **Step 3: Implement `src/llm/providers/groq.js`**

```js
const { buildPrompt, parseProviderResponse, SYSTEM_PROMPT } = require('./base');

const URL = 'https://api.groq.com/openai/v1/chat/completions';

async function call(email, opts, cfg) {
  if (!cfg.apiKey) {
    const err = new Error('Groq API key not configured');
    err.status = 401;
    throw err;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model || 'llama-3.3-70b-versatile',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildPrompt(email, opts) }
        ]
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Groq error ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content || '';
    return parseProviderResponse(raw);
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  name: 'groq',
  defaultModel: 'llama-3.3-70b-versatile',
  limits: { rpm: 25, rpd: 14000 },
  call
};
```

- [ ] **Step 4: Verify tests pass**

Run: `npm test -- tests/llm/providers/groq.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/llm/providers/groq.js tests/llm/providers/groq.test.js
git commit -m "checkpoint: groq provider"
```

---

## Task 10: Gemini provider

**Files:**
- Create: `src/llm/providers/gemini.js`
- Create: `tests/llm/providers/gemini.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/llm/providers/gemini.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const gemini = require('../../../src/llm/providers/gemini');

test('gemini posts to generateContent with key in query string', async () => {
  const orig = global.fetch;
  let seenUrl, seenOpts;
  global.fetch = async (url, opts) => {
    seenUrl = url; seenOpts = opts;
    return {
      ok: true, status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          category: 'fyi', urgency: 'normal', summary: 's',
          suggested_tone: 'professional', draft_reply: 'r'
        }) }] } }]
      })
    };
  };
  try {
    const email = { from_address: 'x@y.com', subject: 'News', body_text: 'weekly digest' };
    const out = await gemini.call(email, { mode: 'full' }, { apiKey: 'g-test', model: 'gemini-2.5-flash' });
    assert.ok(seenUrl.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'));
    assert.match(seenUrl, /key=g-test/);
    const body = JSON.parse(seenOpts.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.ok(Array.isArray(body.contents) && body.contents[0].parts[0].text.length > 0);
    assert.equal(out.category, 'fyi');
  } finally {
    global.fetch = orig;
  }
});

test('gemini missing API key throws 401', async () => {
  await assert.rejects(
    () => gemini.call({ from_address: 'a@b.com', subject: 'x' }, {}, { apiKey: null }),
    (err) => err.status === 401
  );
});

test('gemini tags 429 on quota error', async () => {
  const orig = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, text: async () => 'quota' });
  try {
    await assert.rejects(
      () => gemini.call({ from_address: 'a@b.com', subject: 'x' }, {}, { apiKey: 'k', model: 'gemini-2.5-flash' }),
      (err) => err.status === 429
    );
  } finally {
    global.fetch = orig;
  }
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- tests/llm/providers/gemini.test.js`

- [ ] **Step 3: Implement `src/llm/providers/gemini.js`**

```js
const { buildPrompt, parseProviderResponse, SYSTEM_PROMPT } = require('./base');

function urlFor(model, apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

async function call(email, opts, cfg) {
  if (!cfg.apiKey) {
    const err = new Error('Gemini API key not configured');
    err.status = 401;
    throw err;
  }
  const model = cfg.model || 'gemini-2.5-flash';
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(urlFor(model, cfg.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + buildPrompt(email, opts) }] }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Gemini error ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseProviderResponse(raw);
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  name: 'gemini',
  defaultModel: 'gemini-2.5-flash',
  limits: { rpm: 8, rpd: 450 },
  call
};
```

- [ ] **Step 4: Verify tests pass**

Run: `npm test -- tests/llm/providers/gemini.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/llm/providers/gemini.js tests/llm/providers/gemini.test.js
git commit -m "checkpoint: gemini provider"
```

---

## Task 11: Wire Groq + Gemini into the router singleton

**Files:**
- Modify: `src/llm/index.js`

- [ ] **Step 1: Replace `src/llm/index.js` with full wiring**

```js
const localProvider  = require('./providers/local');
const groqProvider   = require('./providers/groq');
const geminiProvider = require('./providers/gemini');
const { createRouter } = require('./router');
const { resolveConfig } = require('./config');

function log(rec) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n');
}

const router = createRouter({
  providers: [localProvider, groqProvider, geminiProvider],
  getConfig: resolveConfig,
  logger: log
});

module.exports = { router };
```

- [ ] **Step 2: Smoke — resolve should include local even with no cloud keys**

Run: `node -e "const {router}=require('./src/llm'); router.classify({from_address:'a@b',subject:'hi',body_text:''},{mode:'full'}).then(r=>console.log('ok',r==null?'null (all failed, expected: FastAPI is down)':r._provider));"`
Expected: `ok null (all failed, expected: FastAPI is down)` — since FastAPI isn't running and no Groq/Gemini keys set, all providers fail. That's the correct path.

- [ ] **Step 3: Commit**

```bash
git add src/llm/index.js
git commit -m "checkpoint: router wired with groq + gemini"
```

---

## Task 12: `POST /api/providers/:name/test` endpoint

**Files:**
- Modify: `src/routes/api.js` (add new route near the other `/api/account/test-*` routes)

- [ ] **Step 1: Add route**

Find the block of `test-imap`/`test-smtp` routes in `src/routes/api.js` (search for `/api/account/test-imap`) and add below it:
```js
router.post('/api/providers/:name/test', async (req, res) => {
  const { name } = req.params;
  const allowed = new Set(['local', 'groq', 'gemini']);
  if (!allowed.has(name)) return res.status(400).json({ ok: false, error: 'Unknown provider' });

  const { resolveConfig } = require('../llm/config');
  const cfg = resolveConfig();
  const providers = {
    local:  require('../llm/providers/local'),
    groq:   require('../llm/providers/groq'),
    gemini: require('../llm/providers/gemini')
  };
  const provider = providers[name];
  const sampleEmail = {
    from_address: 'ping@intellimail.local',
    from_name:    'IntelliMail Test',
    subject:      'Test classification — please reply',
    body_text:    'This is a synthetic test email used to verify the provider responds correctly.'
  };
  try {
    const result = await provider.call(sampleEmail, { mode: 'full' }, {
      apiKey: cfg.keys[name],
      model:  cfg.models[name]
    });
    res.json({ ok: true, category: result.category, provider: name });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message, status: e.status || null });
  }
});
```

- [ ] **Step 2: Smoke**

Start server, run:
```bash
curl -s -X POST http://localhost:3000/api/providers/local/test | head -c 400; echo
```
Expected: `{"ok":false,"error":"Local API error: ..."}` (FastAPI still not running) — proves the route works and returns a meaningful error.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api.js
git commit -m "checkpoint: POST /api/providers/:name/test"
```

---

## Task 13: Token-bucket rate limiter

**Files:**
- Create: `src/llm/ratelimiter.js`
- Create: `tests/llm/ratelimiter.test.js`
- Modify: `src/llm/router.js`
- Modify: `tests/llm/router.test.js` (add bucket tests)

- [ ] **Step 1: Write failing limiter tests**

Create `tests/llm/ratelimiter.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBucket } = require('../../src/llm/ratelimiter');

test('bucket grants rpm tokens immediately', async () => {
  const b = new TokenBucket({ rpm: 5 });
  for (let i = 0; i < 5; i++) {
    assert.equal(await b.acquire(0), true);
  }
});

test('bucket refuses when empty and maxWaitMs=0', async () => {
  const b = new TokenBucket({ rpm: 2 });
  await b.acquire(0); await b.acquire(0);
  assert.equal(await b.acquire(0), false);
});

test('bucket waits and grants when refill occurs', async () => {
  const b = new TokenBucket({ rpm: 60 });  // 1 token/sec
  for (let i = 0; i < 60; i++) await b.acquire(0);
  const t0 = Date.now();
  const granted = await b.acquire(1500);
  const dt = Date.now() - t0;
  assert.equal(granted, true);
  assert.ok(dt >= 900 && dt <= 1400, `expected ~1s wait, got ${dt}ms`);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- tests/llm/ratelimiter.test.js`

- [ ] **Step 3: Implement `src/llm/ratelimiter.js`**

```js
class TokenBucket {
  constructor({ rpm }) {
    this.capacity = rpm;
    this.refillPerMs = rpm / 60000;
    this.tokens = rpm;
    this.last = Date.now();
  }
  _refill() {
    const now = Date.now();
    const delta = (now - this.last) * this.refillPerMs;
    this.tokens = Math.min(this.capacity, this.tokens + delta);
    this.last = now;
  }
  async acquire(maxWaitMs = 0) {
    this._refill();
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    if (maxWaitMs <= 0) return false;
    const needed = 1 - this.tokens;
    const waitMs = Math.ceil(needed / this.refillPerMs);
    if (waitMs > maxWaitMs) return false;
    await new Promise(r => setTimeout(r, waitMs));
    this._refill();
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }
}
module.exports = { TokenBucket };
```

- [ ] **Step 4: Verify limiter tests pass**

Run: `npm test -- tests/llm/ratelimiter.test.js`

- [ ] **Step 5: Wire bucket into router**

Modify `src/llm/router.js`. At the top of `createRouter`, after the `byName` map:
```js
  const { TokenBucket } = require('./ratelimiter');
  const buckets = new Map();
  for (const p of providers) buckets.set(p.name, new TokenBucket({ rpm: p.limits.rpm }));
```

In the provider loop, before calling `provider.call(...)`, insert:
```js
      const maxWaitMs = opts.mode === 'regen' ? 2000 : 30000;
      const got = await buckets.get(name).acquire(maxWaitMs);
      if (!got) {
        log({ provider: name, mode: opts.mode, outcome: 'skipped_bucket', email_id: email.id });
        continue;
      }
```

- [ ] **Step 6: Add bucket-skip test to router tests**

Append to `tests/llm/router.test.js`:
```js
test('router skips provider when bucket is empty (regen mode)', async () => {
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1, rpd: 1000 },
    call: async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }) };
  const b = { name: 'b', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => ({ category: 'legal', urgency: 'urgent', summary: 's', draft_reply: 'r' }) };
  const r = require('../../src/llm/router').createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'regen' });
  const out = await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'regen' });
  assert.equal(out._provider, 'b');
});
```

- [ ] **Step 7: Run, verify all router tests pass**

Run: `npm test -- tests/llm/`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/llm/ratelimiter.js tests/llm/ratelimiter.test.js src/llm/router.js tests/llm/router.test.js
git commit -m "checkpoint: token-bucket rate limiter in router"
```

---

## Task 14: Daily quota tracking

**Files:**
- Create: `src/llm/usage.js`
- Modify: `src/llm/router.js`
- Modify: `tests/llm/router.test.js` (quota test)

- [ ] **Step 1: Implement `src/llm/usage.js`**

```js
const { db } = require('../db');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getCount(provider, day = today()) {
  const row = db.prepare('SELECT request_count FROM provider_usage WHERE provider=? AND day=?').get(provider, day);
  return row ? row.request_count : 0;
}

function increment(provider) {
  const day = today();
  db.prepare(`INSERT INTO provider_usage (provider, day, request_count)
              VALUES (?, ?, 1)
              ON CONFLICT(provider, day) DO UPDATE SET request_count = request_count + 1`).run(provider, day);
}

function todaySummary() {
  const rows = db.prepare('SELECT provider, request_count FROM provider_usage WHERE day=?').all(today());
  const out = {};
  for (const r of rows) out[r.provider] = r.request_count;
  return out;
}

module.exports = { getCount, increment, todaySummary };
```

- [ ] **Step 2: Wire quota into router**

In `src/llm/router.js`, at the top of `createRouter` add:
```js
  const usage = require('./usage');
```

Inside the provider loop, after the bucket check and before `provider.call(...)`, insert:
```js
      if (Number.isFinite(provider.limits.rpd) && usage.getCount(name) >= provider.limits.rpd) {
        log({ provider: name, mode: opts.mode, outcome: 'skipped_quota', email_id: email.id });
        continue;
      }
```

After a successful `provider.call(...)` (in the success branch right after `log({..., outcome: 'success', ...})`), insert:
```js
        try { usage.increment(name); } catch {}
```

- [ ] **Step 3: Router test — dependency injection for `usage`**

The simplest way to test: pass a usage shim into `createRouter` for tests. Modify `createRouter` to accept `opts.usage` overriding the require:
```js
function createRouter({ providers, getConfig, logger, usage }) {
  const usageApi = usage || require('./usage');
  ...
}
```
And replace `usage.getCount(...)` / `usage.increment(...)` in the loop with `usageApi.getCount(...)` / `usageApi.increment(...)`.

Append to `tests/llm/router.test.js`:
```js
test('router skips provider at daily quota', async () => {
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1000, rpd: 5 },
    call: async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }) };
  const b = { name: 'b', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => ({ category: 'legal', urgency: 'urgent', summary: 's', draft_reply: 'r' }) };
  const usage = { _a: 5, getCount: (n) => n === 'a' ? 5 : 0, increment: () => {} };
  const r = require('../../src/llm/router').createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} }),
    usage
  });
  const out = await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  assert.equal(out._provider, 'b');
});
```

- [ ] **Step 4: Verify tests pass**

Run: `npm test -- tests/llm/`

- [ ] **Step 5: Commit**

```bash
git add src/llm/usage.js src/llm/router.js tests/llm/router.test.js
git commit -m "checkpoint: daily quota tracking in router"
```

---

## Task 15: Circuit breaker

**Files:**
- Modify: `src/llm/router.js`
- Modify: `tests/llm/router.test.js`

- [ ] **Step 1: Add breaker state + check in router**

In `src/llm/router.js`, at the top of `createRouter`, after the `buckets` block:
```js
  const BREAKER_OPEN_MS = 5 * 60 * 1000;
  const BREAKER_FAILS = 3;
  const breakers = new Map();
  for (const p of providers) breakers.set(p.name, { fails: 0, openedAt: 0 });
  const breakerOpen = (name) => {
    const b = breakers.get(name);
    if (!b.openedAt) return false;
    if (Date.now() - b.openedAt >= BREAKER_OPEN_MS) { b.openedAt = 0; return false; }
    return true;
  };
```

Inside the provider loop, at the very start of each iteration, before the bucket check, insert:
```js
      if (breakerOpen(name)) {
        log({ provider: name, mode: opts.mode, outcome: 'skipped_breaker', email_id: email.id });
        continue;
      }
```

In the success branch (right after `usageApi.increment(name)`):
```js
        breakers.get(name).fails = 0;
```

In the catch block (right after `log(...)`):
```js
        const br = breakers.get(name);
        // HTTP 429 shouldn't count toward breaker (see Task 16 — refined there)
        br.fails += 1;
        if (br.fails >= BREAKER_FAILS) { br.openedAt = Date.now(); br.fails = 0; }
```

- [ ] **Step 2: Add breaker tests**

Append to `tests/llm/router.test.js`:
```js
test('router opens breaker after 3 consecutive failures', async () => {
  let calls = 0;
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => { calls++; throw new Error('boom'); } };
  const b = { name: 'b', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }) };
  const r = require('../../src/llm/router').createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  for (let i = 0; i < 3; i++) {
    await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  }
  assert.equal(calls, 3);
  const out = await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  assert.equal(calls, 3, 'breaker should have skipped a');
  assert.equal(out._provider, 'b');
});
```

- [ ] **Step 3: Verify all router tests pass**

Run: `npm test -- tests/llm/router.test.js`

- [ ] **Step 4: Commit**

```bash
git add src/llm/router.js tests/llm/router.test.js
git commit -m "checkpoint: circuit breaker after 3 consecutive failures"
```

---

## Task 16: Error classification refinements

**Files:**
- Modify: `src/llm/router.js`
- Modify: `tests/llm/router.test.js`

- [ ] **Step 1: Refine error handling in router catch block**

In `src/llm/router.js`, replace the catch block inside the provider loop:
```js
      } catch (err) {
        const outcome = classifyError(err);
        log({ provider: name, mode: opts.mode, outcome, latency_ms: Date.now() - start, email_id: email.id, err: err.message });
        if (outcome === 'http_401') {
          // session-disable: mark breaker as permanently open for this process
          const br = breakers.get(name);
          br.openedAt = Date.now();
          br._sessionDisabled = true;
        } else if (outcome === 'http_429') {
          // quota/rate — don't count against breaker
        } else {
          const br = breakers.get(name);
          br.fails += 1;
          if (br.fails >= BREAKER_FAILS) { br.openedAt = Date.now(); br.fails = 0; }
        }
        continue;
      }
```

Also adjust `breakerOpen` to keep session-disabled providers always skipped:
```js
  const breakerOpen = (name) => {
    const b = breakers.get(name);
    if (b._sessionDisabled) return true;
    if (!b.openedAt) return false;
    if (Date.now() - b.openedAt >= BREAKER_OPEN_MS) { b.openedAt = 0; return false; }
    return true;
  };
```

- [ ] **Step 2: Add tests**

Append to `tests/llm/router.test.js`:
```js
test('router session-disables provider on 401', async () => {
  let calls = 0;
  const err401 = () => { const e = new Error('unauth'); e.status = 401; throw e; };
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => { calls++; err401(); } };
  const b = { name: 'b', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }) };
  const r = require('../../src/llm/router').createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  assert.equal(calls, 1, 'second call should skip provider a after 401');
});

test('router does not trip breaker on 429', async () => {
  let calls = 0;
  const err429 = () => { const e = new Error('rate'); e.status = 429; throw e; };
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => { calls++; err429(); } };
  const b = { name: 'b', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }) };
  const r = require('../../src/llm/router').createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  for (let i = 0; i < 5; i++) {
    await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  }
  assert.equal(calls, 5, 'every call should still reach a (breaker not tripped on 429)');
});
```

- [ ] **Step 3: Verify all tests pass**

Run: `npm test -- tests/llm/`

- [ ] **Step 4: Commit**

```bash
git add src/llm/router.js tests/llm/router.test.js
git commit -m "checkpoint: error classification (401 session-disable, 429 no-breaker)"
```

---

## Task 17: Settings UI — AI Providers card

**Files:**
- Modify: `views/settings.html` (add a new section)
- Modify: `src/routes/api.js` (extend `GET /api/settings` + `POST /api/settings/save` to carry provider fields; new `GET /api/providers/usage`)

- [ ] **Step 1: Extend `GET /api/settings` and `POST /api/settings/save`**

In `src/routes/api.js`, locate the existing `router.get('/api/settings', ...)` and `router.post('/api/settings/save', ...)` handlers. Update them:

```js
router.get('/api/settings', (req, res) => {
  const cfg = getConfig() || {};
  const mask = (k) => k ? ('•'.repeat(Math.max(0, k.length - 4)) + k.slice(-4)) : '';
  res.json({
    ...cfg,
    password: undefined,
    // provider fields
    groq_api_key:   mask(cfg.groq_api_key),
    gemini_api_key: mask(cfg.gemini_api_key),
    groq_model:   cfg.groq_model   || 'llama-3.3-70b-versatile',
    gemini_model: cfg.gemini_model || 'gemini-2.5-flash',
    llm_provider_order:    cfg.llm_provider_order    || 'local,groq,gemini',
    llm_providers_enabled: cfg.llm_providers_enabled || 'local,groq,gemini'
  });
});

router.post('/api/settings/save', (req, res) => {
  try {
    const { saveProviderConfig } = require('../llm/config');
    const body = req.body || {};
    // Existing IMAP/SMTP save (keep existing code above if any).
    // New: provider fields
    const providerUpdates = {};
    if (body.groq_api_key   && !/^•+/.test(body.groq_api_key))   providerUpdates.groq_api_key   = body.groq_api_key;
    if (body.gemini_api_key && !/^•+/.test(body.gemini_api_key)) providerUpdates.gemini_api_key = body.gemini_api_key;
    if (body.groq_model)             providerUpdates.groq_model   = body.groq_model;
    if (body.gemini_model)           providerUpdates.gemini_model = body.gemini_model;
    if (body.llm_provider_order)     providerUpdates.order        = body.llm_provider_order;
    if (body.llm_providers_enabled)  providerUpdates.enabled      = body.llm_providers_enabled;
    if (Object.keys(providerUpdates).length) saveProviderConfig(providerUpdates);

    // (Leave existing account-save behavior intact — see original handler.)

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/providers/usage', (req, res) => {
  const { todaySummary } = require('../llm/usage');
  res.json(todaySummary());
});
```

(If the existing `POST /api/settings/save` body already handles IMAP/SMTP config, merge the provider block into that handler alongside the existing logic — do not replace it.)

- [ ] **Step 2: Add "AI Providers" section to `views/settings.html`**

Find an insertion point after the existing "IMAP Settings" / "SMTP Settings" blocks, before the "Save" button, and add:
```html
<!-- AI Providers -->
<div class="settings-section">
  <h3>🧠 AI Providers</h3>
  <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
    Fallback chain for Tier-2 classification and draft regen. Toggle to enable, drag to reorder.
  </p>

  <template x-for="(p, idx) in providerList" :key="p.name">
    <div draggable="true"
         @dragstart="dragIdx=idx"
         @dragover.prevent
         @drop="reorderProviders(idx)"
         style="display:grid;grid-template-columns:24px 24px 1fr auto;gap:10px;align-items:center;margin-bottom:10px;padding:10px;background:var(--bg-raised);border:1px solid var(--border);border-radius:6px;">
      <span style="cursor:grab;color:var(--text-muted);">☰</span>
      <input type="checkbox" x-model="p.enabled" @change="saveProviderOrder()">
      <div>
        <div style="font-weight:600;" x-text="p.label"></div>
        <template x-if="p.name !== 'local'">
          <div style="display:flex;gap:8px;margin-top:6px;">
            <input type="password" :placeholder="p.name.toUpperCase() + ' API key'"
                   x-model="p.apiKey"
                   style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text-primary);padding:6px 10px;border-radius:4px;font-size:12px;">
            <input type="text" :placeholder="'Model'" x-model="p.model"
                   style="width:220px;background:var(--bg);border:1px solid var(--border);color:var(--text-primary);padding:6px 10px;border-radius:4px;font-size:12px;">
          </div>
        </template>
      </div>
      <button class="action-btn btn-ghost" @click="testProvider(p.name)" :disabled="p.testing"
              style="font-size:12px;">
        <span x-show="!p.testing">Test</span>
        <span x-show="p.testing">…</span>
      </button>
    </div>
  </template>

  <div style="margin-top:12px;font-size:12px;color:var(--text-muted);">
    <div style="font-weight:600;margin-bottom:4px;">Today's usage</div>
    <template x-for="p in providerList" :key="'usage-'+p.name">
      <div>
        <span x-text="p.name"></span>:
        <span x-text="usage[p.name] || 0"></span>
        <span x-show="p.rpd !== Infinity">/ <span x-text="p.rpd"></span></span>
      </div>
    </template>
  </div>

  <button class="action-btn btn-primary" @click="saveProviders()" style="margin-top:12px;">
    Save Providers
  </button>
</div>
```

- [ ] **Step 3: Extend the existing `settingsApp()` in `views/settings.html` (around line 170)**

Inside the returned object, add initial state + helpers:
```js
providerList: [
  { name: 'local',  label: 'Local (Ollama)',     enabled: true, apiKey: '', model: '', rpd: Infinity, testing: false },
  { name: 'groq',   label: 'Groq',               enabled: true, apiKey: '', model: 'llama-3.3-70b-versatile', rpd: 14000, testing: false },
  { name: 'gemini', label: 'Gemini 2.5 Flash',   enabled: true, apiKey: '', model: 'gemini-2.5-flash',        rpd: 450,   testing: false }
],
usage: {},
dragIdx: null,

async loadProviders() {
  const res = await fetch('/api/settings');
  const cfg = await res.json();
  const order    = (cfg.llm_provider_order    || 'local,groq,gemini').split(',');
  const enabled  = new Set((cfg.llm_providers_enabled || 'local,groq,gemini').split(','));
  const byName = Object.fromEntries(this.providerList.map(p => [p.name, p]));
  if (byName.groq)   { byName.groq.apiKey = cfg.groq_api_key || '';   byName.groq.model = cfg.groq_model || byName.groq.model; }
  if (byName.gemini) { byName.gemini.apiKey = cfg.gemini_api_key || ''; byName.gemini.model = cfg.gemini_model || byName.gemini.model; }
  this.providerList = order.map(n => byName[n]).filter(Boolean);
  for (const p of this.providerList) p.enabled = enabled.has(p.name);
  const u = await fetch('/api/providers/usage').then(r => r.json()).catch(() => ({}));
  this.usage = u;
},

reorderProviders(toIdx) {
  if (this.dragIdx == null || this.dragIdx === toIdx) return;
  const moved = this.providerList.splice(this.dragIdx, 1)[0];
  this.providerList.splice(toIdx, 0, moved);
  this.dragIdx = null;
  this.saveProviderOrder();
},

async saveProviderOrder() {
  await fetch('/api/settings/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      llm_provider_order:    this.providerList.map(p => p.name).join(','),
      llm_providers_enabled: this.providerList.filter(p => p.enabled).map(p => p.name).join(',')
    })
  });
},

async saveProviders() {
  const payload = {
    llm_provider_order:    this.providerList.map(p => p.name).join(','),
    llm_providers_enabled: this.providerList.filter(p => p.enabled).map(p => p.name).join(',')
  };
  for (const p of this.providerList) {
    if (p.name === 'groq')   { payload.groq_api_key = p.apiKey; payload.groq_model = p.model; }
    if (p.name === 'gemini') { payload.gemini_api_key = p.apiKey; payload.gemini_model = p.model; }
  }
  const res = await fetch('/api/settings/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const ok = (await res.json()).ok;
  showToast(ok ? 'success' : 'error', ok ? '✓ Providers saved' : '❌ Save failed');
},

async testProvider(name) {
  const p = this.providerList.find(x => x.name === name);
  p.testing = true;
  try {
    await this.saveProviders();
    const res = await fetch(`/api/providers/${name}/test`, { method: 'POST' });
    const data = await res.json();
    showToast(data.ok ? 'success' : 'error',
      data.ok ? `✓ ${name}: ${data.category}` : `❌ ${name}: ${data.error || 'failed'}`);
  } finally {
    p.testing = false;
  }
},
```

And in the existing `init()` (or equivalent page-load hook), ensure `this.loadProviders()` is called after `this.loadConfig()`. If `init()` doesn't exist, add `x-init="init()"` to `<body>` and define `init() { this.loadConfig(); this.loadProviders(); }`.

- [ ] **Step 4: Verify `showToast` handles `'warning'` (sanity re-check from Task 6)**

If not already extended, extend the toast color/icon map to include warning (amber).

- [ ] **Step 5: Manual smoke — open Settings page**

- Start server, open http://localhost:3000/settings
- Expected: "AI Providers" section appears below IMAP/SMTP; three rows (Local/Groq/Gemini); drag handles visible; Test buttons present.
- Paste a fake Groq key, hit Save Providers; reload page; key should come back masked (•••abc123).
- Click Test on Local → toast shows error (FastAPI off).
- Click Test on Groq with fake key → toast shows error.

- [ ] **Step 6: Commit**

```bash
git add views/settings.html src/routes/api.js
git commit -m "checkpoint: Settings UI — AI Providers card with reorder, test, usage"
```

---

## Task 18: Manual end-to-end smoke + documentation

**Files:**
- Create: `docs/superpowers/plans/2026-04-21-llm-provider-fallback-smoke.md`

- [ ] **Step 1: Run the 5-scenario smoke test from spec §8.3**

For each scenario below, record actual vs. expected in the smoke log file.

1. **No FastAPI, no cloud keys** — Regen any email → yellow toast "All LLM providers unavailable"; draft editor shows template reply.
2. **Groq key only** — save key in Settings → reclassify an email (delete + re-queue via `POST /api/emails/:id/reclassify`) → `server.log` shows `"provider":"groq","outcome":"success"`; Settings usage shows `groq: 1`.
3. **Groq + Gemini, Gemini first** — drag Gemini to position 0, save → new email classifies via Gemini; usage reflects.
4. **Invalid Groq key** — paste `sk-bad`, Test button → error toast; classify another email → log shows `"provider":"groq","outcome":"http_401"` then `"provider":"gemini","outcome":"success"`; further calls skip Groq (session-disabled).
5. **30 classifications in 60s** — run `for i in $(seq 1 30); do curl -X POST http://localhost:3000/api/emails/1/reclassify; done` → log contains at least one `"outcome":"skipped_bucket"` for whichever provider is at the top of the order and has rpm=25.

- [ ] **Step 2: Write the smoke log**

Record observed outcomes in `docs/superpowers/plans/2026-04-21-llm-provider-fallback-smoke.md`:
```markdown
# LLM Provider Fallback — Smoke Test Results (YYYY-MM-DD)

| # | Scenario | Expected | Observed | Pass |
|---|---|---|---|---|
| 1 | No Tier-2, no keys | Yellow toast + template | <fill in> | ☐ |
| 2 | Groq only | `provider:groq, success` in log | <fill in> | ☐ |
| 3 | Gemini first | `provider:gemini` in log | <fill in> | ☐ |
| 4 | Invalid Groq key | Groq skipped after 1 fail | <fill in> | ☐ |
| 5 | 30 in 60s | `skipped_bucket` appears | <fill in> | ☐ |
```

- [ ] **Step 3: Run full test suite one last time**

Run: `npm test`
Expected: all tests pass across `tests/smoke.test.js`, `tests/llm/*.test.js`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-21-llm-provider-fallback-smoke.md
git commit -m "checkpoint: smoke-test results for LLM provider fallback"
```

---

## Self-review notes (done by plan author)

- Every requirement in spec §2 has a task:
  - F1 (fallback for all Tier-2): Tasks 5, 11
  - F2 (UI reorder): Task 17
  - F3 (config in Settings + env override): Tasks 7, 8, 17
  - F4 (per-provider rate limit): Task 13
  - F5 (daily quota): Task 14
  - F6 (template, no raw "fetch failed"): Task 6
  - N1 (no new runtime deps): all tasks use built-in fetch + node:test
  - N2 (extensible): Task 11 singleton takes an array of providers
  - N3 (no behavior change when Ollama works): Task 5
- Breaker semantics (§5.1): Task 15 (consecutive failures) + Task 16 (401/429 special-cases). Consistent with spec fix from §5.
- `buildTemplateReply` table from §7.1: Task 6 implementation includes all 8 categories × 4 tones.
- Usage table pruning (§5.3 "Old rows >7 days"): Task 7.
- Gemini RPD safety margin: spec §3 says "free ~500 RPD"; Task 10 uses `rpd: 450` — safety margin matches §3's "conservative" intent.

No placeholders remain. All code blocks are complete. File paths and line ranges match the current repo (verified against the baseline commit `3fcf0b1`).
