const { buildPrompt, buildDraftPrompt, parseProviderResponse, SYSTEM_PROMPT } = require('./base');

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

async function call(email, opts, cfg) {
  if (!cfg.apiKey) {
    const err = new Error('Groq API key not configured');
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
        model: cfg.model || 'llama-3.3-70b-versatile',
        temperature: opts.temperature || 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: opts.mode === 'draft' ? buildDraftPrompt(email, opts) : buildPrompt(email, opts) }
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
    // Groq returns rate-limit + quota usage in response headers on every call.
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
  } finally {
    clearTimeout(t);
  }
}

function parseIntOr(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

module.exports = {
  name: 'groq',
  defaultModel: 'llama-3.3-70b-versatile',
  limits: { rpm: 25, rpd: 14000 },
  call
};
