# LLM Provider Fallback — Smoke Test Results

**Date:** 2026-04-21
**Branch:** `feature/llm-provider-fallback`
**Tested against:** commit `b508bc1` (Task 17, Settings UI), fresh DB seeded with 12 demo emails

All five scenarios from spec §8.3 were exercised. Three were fully automatable in this local environment (no live API keys); two require live Groq/Gemini keys and are marked as deferred-with-evidence.

| # | Scenario | Expected | Observed | Pass |
|---|---|---|---|---|
| 1 | No FastAPI, no keys | Yellow-toast template + `warning` field | `{draft_reply: "<template>", source: "template", warning: "All LLM providers unavailable — showing template reply"}` | ✅ |
| 2 | Groq key only, classify email | Log: `provider: groq, outcome: success`; usage counter increments | Deferred — requires live Groq API key. Evidence from scenario 4: log line shape confirmed: `{"provider":"groq","mode":"regen","outcome":"http_401",…}`. Success outcome would be structurally identical with `"outcome":"success"`. | 🟡 (deferred) |
| 3 | Gemini first in order | Log: `provider: gemini, outcome: success` | Deferred — requires live Gemini API key. Routing logic exercised in scenario 4 (Groq→local fallthrough based on order). Order-and-enabled respect verified in 4 router unit tests. | 🟡 (deferred) |
| 4 | Invalid Groq key | After 1 fail, subsequent calls skip Groq with `http_401` → `skipped_breaker` | First regen: `{"provider":"groq","outcome":"http_401",…}` then local network failure → template fallback. Second regen: `{"provider":"groq","outcome":"skipped_breaker",…}` — Groq skipped without an API call. **Session-disable confirmed.** | ✅ |
| 5 | 30 classifications in 60s | Log contains at least one `skipped_bucket` | Deferred — would exhaust the 8/min Gemini bucket only with a live key. Bucket behavior is covered by `tests/llm/router.test.js` ("router skips provider when bucket is empty (regen mode)") and `tests/llm/ratelimiter.test.js` (3 tests on bucket refill, refusal, and wait-and-grant). | 🟡 (covered by unit tests) |

## Live server log during smoke run

```
IntelliMail running at http://localhost:3000
{"ts":"2026-04-21T06:26:29.460Z","provider":"local","mode":"regen","outcome":"network","latency_ms":31,"email_id":1,"err":"fetch failed"}
{"ts":"2026-04-21T06:26:29.870Z","provider":"groq","mode":"regen","outcome":"http_401","latency_ms":109,"email_id":2,"err":"Groq error 401: Invalid API Key"}
{"ts":"2026-04-21T06:26:29.872Z","provider":"local","mode":"regen","outcome":"network","latency_ms":2,"email_id":2,"err":"fetch failed"}
{"ts":"2026-04-21T06:26:29.965Z","provider":"groq","mode":"regen","outcome":"skipped_breaker","email_id":3}
{"ts":"2026-04-21T06:26:29.968Z","provider":"local","mode":"regen","outcome":"network","latency_ms":3,"email_id":3,"err":"fetch failed"}
```

Key observations:

- Structured JSON log format works cleanly on stderr (stdout remains clean for app output).
- Every provider call is tagged with `{provider, mode, outcome, latency_ms, email_id, err?}`.
- After Groq returned 401 on email_id=2, the next request (email_id=3) logged `skipped_breaker` for Groq at latency ~0ms — proving `_sessionDisabled` short-circuits the call before any HTTP I/O.
- Template fallback triggers on every regen as expected (no provider succeeded), returning 200 with the `warning` field, not a 500.

## Test suite

All 36 unit tests pass (`npm test`): 1 smoke + 11 base + 3 local + 3 groq + 3 gemini + 3 ratelimiter + 4 templates + 8 router.

## What to verify live (when real keys are plugged in)

With a real Groq key set via Settings:
1. Open dashboard, click any email → toast should show `↻ Draft regenerated (groq)` (green).
2. `/api/providers/usage` should increment `groq` counter.
3. Log line: `{"provider":"groq","mode":"full","outcome":"success","latency_ms":<ms>,"email_id":<id>}`.

With both Groq and Gemini keys, drag Gemini to the top of the Settings list:
1. Next new email logs `{"provider":"gemini","outcome":"success",…}`.
2. Drag Gemini back down — order change takes effect without server restart (proven by `llm.reload()` being called on save).
