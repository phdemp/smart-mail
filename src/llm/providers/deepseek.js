const { buildPrompt, buildDraftPrompt, parseProviderResponse, SYSTEM_PROMPT } = require('./base');

const ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

async function call(email, opts, cfg) {
  if (!cfg.apiKey) {
    const err = new Error('DeepSeek API key not configured');
    err.status = 401;
    throw err;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model || 'deepseek-chat',
        temperature: opts.temperature || 0.1,
        response_format: { type: 'json_object' },
        // WR-09: Do not send the classification SYSTEM_PROMPT when mode is 'draft'.
        // Sending it as the system message tells the model to return the classification
        // JSON schema, which conflicts with the draft-generation instruction and causes
        // the model to return a JSON object instead of a prose reply.
        messages: opts.mode === 'draft'
          ? [{ role: 'user', content: buildDraftPrompt(email, opts) }]
          : [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: buildPrompt(email, opts) }
            ]
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`DeepSeek error ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    // DeepSeek is OpenAI-compatible — return any rate-limit headers it exposes.
    const h = res.headers;
    const observedLimits = {
      rpd_limit:      parseIntOr(h.get('x-ratelimit-limit-requests')),
      rpd_remaining:  parseIntOr(h.get('x-ratelimit-remaining-requests')),
      tpd_limit:      parseIntOr(h.get('x-ratelimit-limit-tokens')),
      tpd_remaining:  parseIntOr(h.get('x-ratelimit-remaining-tokens')),
      reset_requests: h.get('x-ratelimit-reset-requests') || null,
      reset_tokens:   h.get('x-ratelimit-reset-tokens')   || null,
      observed_at:    Date.now()
    };
    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content || '';
    const parsed = parseProviderResponse(raw);
    return { ...parsed, _observedLimits: observedLimits };
  } catch (e) {
    // WR-05: Convert AbortError to a 504 with err.status so the router's
    // classifyError() correctly identifies it as a timeout (not 'network').
    // Without err.status the router falls through to the generic 'network'
    // path and increments the circuit-breaker counter on every timeout.
    if (e.name === 'AbortError' || /aborted/i.test(e.message || '')) {
      const err = new Error('DeepSeek timed out after 10s');
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function parseIntOr(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

module.exports = {
  name: 'deepseek',
  defaultModel: 'deepseek-chat',
  limits: { rpm: 30, rpd: 10000 },
  call
};
