const { buildPrompt, parseProviderResponse, SYSTEM_PROMPT } = require('./base');

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
      const err = new Error(`DeepSeek error ${res.status}: ${body.slice(0, 200)}`);
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
  name: 'deepseek',
  defaultModel: 'deepseek-chat',
  limits: { rpm: 30, rpd: 10000 },
  call
};
