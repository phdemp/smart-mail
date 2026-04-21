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
