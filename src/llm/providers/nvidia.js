const { buildPrompt, parseProviderResponse, SYSTEM_PROMPT } = require('./base');

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

async function call(email, opts, cfg) {
  if (!cfg.apiKey) {
    const err = new Error('NVIDIA API key not configured');
    err.status = 401;
    throw err;
  }
  const timeoutMs = cfg.timeoutMs || 30_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model || 'qwen/qwen3.5-122b-a10b',
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
      const err = new Error(`NVIDIA error ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
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
    if (e.name === 'AbortError' || /aborted/i.test(e.message || '')) {
      const err = new Error(`NVIDIA timed out after ${timeoutMs / 1000}s`);
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
  name: 'nvidia',
  defaultModel: 'qwen/qwen3.5-122b-a10b',
  limits: { rpm: 40, rpd: 1000 },
  call
};
