# LLM Provider Fallback — Design

**Date:** 2026-04-21
**Status:** Approved for implementation planning
**Scope:** Add Groq and Gemini 2.5 Flash as cloud LLM fallbacks for Tier‑2 classification and draft regeneration in IntelliMail

---

## 1. Motivation

The Tier‑2 classifier is a FastAPI service at `http://localhost:8765` backed by Ollama. When it's unreachable:

- **Initial classification** silently falls through to rules → `"other"`, which is acceptable as a degraded mode.
- **Draft regeneration** (`POST /api/emails/:id/draft/regen`) has no fallback — the user sees `❌ Regen failed: fetch failed` and the feature is effectively broken whenever Ollama isn't running.

The fix: introduce a provider-agnostic LLM router with pluggable backends. Local Ollama remains the primary, Groq and Gemini 2.5 Flash serve as free-tier cloud fallbacks. Goal: classify and regen **~1000 emails/day entirely on free tiers**, never hand the user a "fetch failed" error again.

---

## 2. Requirements

### 2.1 Functional
- **F1.** Cloud LLM fallback applies to **all Tier‑2 calls** — both `classifyEmail()` and `/api/emails/:id/draft/regen`.
- **F2.** User decides **provider priority order** from the Settings page (drag-to-reorder, toggle enable/disable).
- **F3.** All provider configuration (keys, models, order, enabled state) is edited in Settings; env vars (`GROQ_API_KEY`, `GEMINI_API_KEY`) are an optional startup override.
- **F4.** Per-provider rate limits are enforced client-side (token bucket) to stay under free-tier per-minute caps.
- **F5.** Per-provider daily request quotas are tracked and enforced; exhausted providers are skipped until midnight UTC reset.
- **F6.** When all providers fail, regen returns a **template reply** with HTTP 200 and a `warning` field — never surfaces `"fetch failed"` to the user.

### 2.2 Non-functional
- **N1.** No new runtime dependencies beyond the existing Node stack — use the built-in `fetch`, `node:test`, Alpine.js (already loaded). Groq is OpenAI-compatible so no SDK needed; Gemini uses the REST `generateContent` endpoint.
- **N2.** Provider list must be extensible — adding a fourth provider (e.g. Flash-Lite) in the future is a single file + one config entry.
- **N3.** No behavioural change for users who have Ollama running: when local succeeds, no cloud call is ever made.

### 2.3 Out of scope
- Attribute-based routing rules ("legal → Gemini, fyi → Groq"). May be added later as a v2.
- Encryption at rest for API keys (the app already stores IMAP password in plaintext; this spec doesn't tighten that — tracked separately).
- Prompt caching / semantic dedup across emails.

---

## 3. Free-tier budget & rate-limit targets

| Provider | Model default | Free RPM | Free RPD | Token bucket (safety) |
|---|---|---:|---:|---:|
| Groq | `llama-3.3-70b-versatile` | ~30 | ~14,400 | **25/min** |
| Gemini | `gemini-2.5-flash` | 10 | ~500 | **8/min** |

Numbers are approximate and provider-published limits change over time; they are read from a `PROVIDER_LIMITS` constant in `src/llm/providers/<name>.js` that is easy to update.

At 1000 emails/day average:
- Groq carries the full load on daily quota (~7% of cap) with per-minute queuing during bursts.
- Gemini's 500 RPD is a soft ceiling; if Groq is saturated for more than ~500 emails, the remainder classifies via rules-based `"other"`. Acceptable degraded mode.

---

## 4. Architecture

```
src/
  llm/
    providers/
      base.js        # prompt builder, output contract, JSON parser
      local.js       # existing FastAPI at :8765
      groq.js        # OpenAI-compatible chat completions
      gemini.js      # generativelanguage.googleapis.com generateContent
    router.js        # cascade + rate limiter + circuit breaker + quota
  classifier.js      # calls router.classify(..., {mode: 'full'})  — modified
  routes/api.js      # /draft/regen calls router.classify(..., {mode: 'regen'}) — modified
```

### 4.1 Provider output contract

Every provider returns the same JSON shape that the existing FastAPI returns, so `storeClassification()` and the draft editor are unchanged:

```json
{
  "category": "meeting_request|financial|legal|travel|pitch_deck|fyi|rewards_awards|other",
  "urgency": "urgent|moderate|normal",
  "urgency_reason": "string | null",
  "summary": "short one-line summary",
  "extracted_data": { "...category-specific fields..." },
  "suggested_tone": "formal|professional|friendly|brief",
  "draft_reply": "string"
}
```

### 4.2 `base.js` responsibilities
- **Prompt builder** — mirrors the structure of `main_staging.py`'s `EIn.prompt()`:
  ```
  From: {from_name} <{from_address}>
  Subject: {subject}
  [optional Hint: {category_hint} ({confidence}%)]

  {body_text_or_preview truncated to 800 chars}
  ```
  For `mode: 'regen'`, appends `Generate a reply in {tone} tone.`
- **Output schema + system prompt** — instructs the model to return strictly-formatted JSON with the fields above.
- **Parser** — `JSON.parse`; on failure, extract the first `{...}` block with a non-greedy regex; normalize `category` to the 8-value enum (unknown → `"other"`); fill missing fields with defaults.

### 4.3 Provider modules
Each provider exports:
```js
{
  name: 'groq',             // stable identifier
  defaultModel: 'llama-3.3-70b-versatile',
  limits: { rpm: 25, rpd: 14400 },
  async call(email, opts, { apiKey, model }) { ... returns contract object or throws ... }
}
```

- **`local.js`** — POSTs to `http://localhost:8765/classify`. No API key needed.
- **`groq.js`** — POSTs to `https://api.groq.com/openai/v1/chat/completions` with `response_format: { type: 'json_object' }`. Maps the `choices[0].message.content` through the parser.
- **`gemini.js`** — POSTs to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}` with `generationConfig.responseMimeType: 'application/json'`. Maps `candidates[0].content.parts[0].text` through the parser.

---

## 5. Router behavior

`router.classify(email, opts)` where `opts = { mode: 'full' | 'regen', tone?: string }`.

Algorithm:
1. Read the **enabled provider list in configured order** from the in-memory config cache (reloaded on Settings save via a pubsub hook on the config module).
2. For each provider:
   1. **Circuit breaker check** — if open (3 consecutive failures → 5-min cool-down), skip. After cool-down, one probe call is allowed; success closes the breaker and resets the counter.
   2. **Daily quota check** — if `provider_usage.request_count >= limits.rpd` for today, skip.
   3. **Rate limiter** (token bucket, per-process in-memory):
      - `mode: 'full'` — wait up to 30 s for a slot, then skip.
      - `mode: 'regen'` — wait up to 2 s for a slot, then skip (user is watching).
   4. Call provider with **10 s timeout**.
   5. **On success:** increment `provider_usage.request_count`, record success in breaker state, return result.
   6. **On failure:** classify the error (see §5.1), log, continue.
3. **All providers failed** → return `null`. Caller handles:
   - `mode: 'full'` — `classifyEmail()` stores a rules-based classification (existing behavior).
   - `mode: 'regen'` — route returns `{ draft_reply: <template>, source: 'rules', warning: '...' }` with HTTP 200.

### 5.1 Error classification
| Error | Circuit breaker | Quota | Action |
|---|---|---|---|
| Network error / timeout | +1 failure | no change | skip to next |
| HTTP 5xx | +1 failure | no change | skip to next |
| HTTP 429 (rate limit) | **no** failure count | no change | honor `retry-after` or sleep 5 s, skip to next |
| HTTP 401/403 | mark provider **session-disabled** with `reason: 'invalid_key'` | no change | skip; red badge in Settings |
| Malformed JSON | +1 failure | no change | skip to next |

### 5.2 In-memory state
```js
providerHealth: Map<name, {
  consecutiveFailures: number,
  circuitOpenedAt: number | null,
  lastSuccessAt: number,
  sessionDisabled: { reason: string } | null
}>
providerBuckets: Map<name, TokenBucket>  // capacity=rpm, refill=1/sec*rpm/60
```

### 5.3 Persisted state (new SQLite tables)
```sql
CREATE TABLE provider_usage (
  provider TEXT NOT NULL,
  day DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, day)
);
CREATE INDEX idx_provider_usage_day ON provider_usage(day);
```
Daily quotas live here so they survive process restarts. Old rows (>7 days) are pruned on boot.

No persisted circuit-breaker state — restart = clean slate, which is fine (forgiveness is cheap).

---

## 6. Config storage & Settings UI

### 6.1 Schema additions to `account_config`
```sql
ALTER TABLE account_config ADD COLUMN groq_api_key TEXT;
ALTER TABLE account_config ADD COLUMN gemini_api_key TEXT;
ALTER TABLE account_config ADD COLUMN groq_model TEXT DEFAULT 'llama-3.3-70b-versatile';
ALTER TABLE account_config ADD COLUMN gemini_model TEXT DEFAULT 'gemini-2.5-flash';
ALTER TABLE account_config ADD COLUMN llm_provider_order TEXT DEFAULT 'local,groq,gemini';
ALTER TABLE account_config ADD COLUMN llm_providers_enabled TEXT DEFAULT 'local,groq,gemini';
```

Order/enabled are comma-separated strings (no JSON migrations). Each `ALTER TABLE` uses the existing try/catch pattern in `src/db.js`.

### 6.2 Env override
On startup:
```js
if (process.env.GROQ_API_KEY) runtimeConfig.groqKey = process.env.GROQ_API_KEY;
if (process.env.GEMINI_API_KEY) runtimeConfig.geminiKey = process.env.GEMINI_API_KEY;
```
Env keys take precedence over DB; DB values are still displayed in Settings (masked) as a "fallback" hint.

### 6.3 Settings UI — new "AI Providers" card in `views/settings.html`
```
┌ AI Providers ──────────────────────────────────────────┐
│ Drag to reorder. Toggle to enable/disable.              │
│                                                         │
│ ☰ ☑ Local (Ollama)      http://localhost:8765  [Test] │
│ ☰ ☑ Groq                 Key: ••••••••12ab    [Test] │
│   Model: llama-3.3-70b-versatile ▾                     │
│ ☰ ☑ Gemini               Key: ••••••••xy12    [Test] │
│   Model: gemini-2.5-flash ▾                            │
│                                                         │
│ Today's usage:                                          │
│   local:  342 calls                                     │
│   groq:   89/14400 (0.6%)                              │
│   gemini: 12/500  (2.4%)                               │
│                                                         │
│                                      [Save Providers] │
└─────────────────────────────────────────────────────────┘
```

- Drag reorder via HTML5 drag API + Alpine — no new dependencies.
- `[Test]` button → `POST /api/providers/:name/test` runs one tiny classify call against a canned email and reports OK/error.
- Usage counters query `provider_usage` for today.
- Save button persists to `account_config` and calls `router.reloadConfig()`.

---

## 7. Error handling & UX

### 7.1 Regen route change (`src/routes/api.js:898`)
Before:
```js
const r = await fetch(`${LOCAL_API}/classify`, {...});
if (!r.ok) throw new Error(`Local API error: ${r.status}`);
```
After:
```js
const result = await router.classify(email, { mode: 'regen', tone });
if (!result) {
  const template = buildTemplateReply(cls, tone);  // see below
  return res.json({
    draft_reply: template,
    source: 'rules',
    warning: 'All LLM providers unavailable — showing template reply'
  });
}
res.json({ draft_reply: result.draft_reply, source: result._provider });
```

**`buildTemplateReply(classification, tone)`** — pure function; produces a generic reply using `classification.category`, the sender's first name (from `email.from_name`), and the tone. Examples:

| Category | Professional | Friendly |
|---|---|---|
| `meeting_request` | "Thank you for the meeting invitation. I will review and confirm my availability shortly." | "Thanks for reaching out — I'll take a look and get back to you on timing." |
| `financial` | "Thank you for the notice. I will review the details and respond shortly." | "Thanks for the heads-up — I'll look into it." |
| `legal` | "I acknowledge receipt of your notice. I will review and respond accordingly." | *(falls back to professional for legal regardless of requested tone)* |
| *other* | "Thank you for your email. I will review and respond shortly." | "Thanks — I'll get back to you soon." |

The full mapping is a small table in `src/llm/templates.js`; 8 categories × 4 tones = 32 one-line strings. No LLM needed.

### 7.2 Client change (`public/js/app.js:207`)
```js
if (data.warning) {
  showToast('warning', '⚠ ' + data.warning);
  this.saveStatus = 'Regenerated (template)';
} else {
  showToast('success', '↻ Draft regenerated');
}
```

### 7.3 Logging
Each provider call logs a structured record:
```json
{"ts":"2026-04-21T14:23:01Z","provider":"groq","email_id":128,"mode":"regen","outcome":"success","latency_ms":842}
```
Outcomes: `success | timeout | http_5xx | http_429 | http_401 | invalid_json | skipped_quota | skipped_breaker | skipped_bucket`.

---

## 8. Testing

### 8.1 Unit tests — `node:test`, no new deps
- `tests/llm/base.test.js`
  - prompt builder output matches snapshot for each of 8 categories
  - JSON parser: clean JSON, markdown-fenced JSON, trailing chatter, missing fields, unknown category
- `tests/llm/router.test.js` (fake providers, no network)
  - first-success short-circuit
  - 3 consecutive failures open the breaker; 4th call skipped
  - after 5-min cool-down, one probe allowed
  - rate limiter: 30 rapid calls to an rpm=10 bucket → first 10 through, rest queue (mode: full) or skip (mode: regen)
  - daily quota: at cap → provider skipped; midnight rollover → reset
  - all-fail in mode: regen → returns `{draft_reply: template, warning: ...}`
  - HTTP 401 → session-disable + `invalid_key` reason; provider skipped on subsequent calls
- `tests/llm/providers/groq.test.js`, `tests/llm/providers/gemini.test.js`
  - monkey-patch `global.fetch`; assert URL, headers, body shape; assert response mapping

### 8.2 No integration tests against live Groq/Gemini
Would consume free quota in CI. Manual smoke-test checklist (below) covers the contract.

### 8.3 Manual smoke test
1. Start app with no FastAPI, no keys → Regen returns template, yellow toast appears, draft editor still works.
2. Set Groq key in Settings → classify a fresh email → `server.log` shows `provider: groq, outcome: success`; Settings usage counter increments.
3. Set both keys, drag Gemini to top → next new email logs `provider: gemini`.
4. Paste an invalid Groq key → Test button shows failure; after one real call, Settings shows red `invalid_key` badge on reload; subsequent emails fall through to Gemini.
5. Fire 30 classifier requests within 60 s → log shows some `skipped_bucket` for Groq (rpm=25 bucket saturates).

---

## 9. Implementation phases (rough ordering for the plan)

1. **Scaffold provider abstraction** — `base.js`, `providers/local.js` wrapping existing fetch. `router.js` with trivial cascade (no breaker / bucket / quota yet). Migrate `classifier.js` and the regen route to use the router. No behavior change.
2. **Add Groq provider + test endpoint** — config schema, Settings UI card (simple toggle + key input only), env override, `/api/providers/groq/test`.
3. **Add Gemini provider** — same pattern as Groq.
4. **Drag-to-reorder UI** — alpine component, persists `llm_provider_order`.
5. **Rate limiter (token bucket)** — per-process in-memory; wire into router.
6. **Daily quota** — `provider_usage` table, migration, router check, Settings counter display.
7. **Circuit breaker** — per-process state, wire into router.
8. **Template fallback for regen** — when router returns null, build a tone-aware template from the classification; wire into route + client.
9. **Structured logging** — replace `console.log` in router with JSON lines into `server.log`.
10. **Unit tests + manual smoke run** — per §8.

---

## 10. Migration & rollback

- All schema changes are `ALTER TABLE ADD COLUMN` with defaults — existing DBs migrate silently on boot.
- To roll back: revert the code; the new columns are unused by the old code and stay in the DB harmlessly.
- No data migration, no backfill.

---

## 11. Open points (none blocking)
- Token-bucket safety margins (25/min Groq, 8/min Gemini) are conservative guesses; we may tune after observing real traffic.
- Whether `local.js` should also have a daily quota (currently: no — local is free and unlimited).
- Future: add Flash-Lite as a fourth provider to hit a stricter "always-free 1000/day" SLA — explicitly deferred.
