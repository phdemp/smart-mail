const { buildPrompt, buildDraftPrompt, parseProviderResponse, SYSTEM_PROMPT } = require('./base');

function urlFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

async function call(email, opts, cfg) {
  if (!cfg.apiKey) {
    const err = new Error('Gemini API key not configured');
    err.status = 401;
    throw err;
  }
  // IN-03: 'gemini-flash-latest' is not a valid Google Generative Language API
  // model ID. The correct versioned name is 'gemini-1.5-flash-latest'.
  const model = cfg.model || 'gemini-1.5-flash-latest';
  const timeoutMs = cfg.timeoutMs || 30_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(urlFor(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Google's recommended auth for the Generative Language API.
        'X-goog-api-key': cfg.apiKey
      },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: opts.mode === 'draft' ? buildDraftPrompt(email, opts) : SYSTEM_PROMPT + '\n\n' + buildPrompt(email, opts) }] }
        ],
        generationConfig: {
          temperature: opts.temperature || 0.1,
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
  } catch (e) {
    if (e.name === 'AbortError' || /aborted/i.test(e.message || '')) {
      const err = new Error(`Gemini timed out after ${timeoutMs / 1000}s`);
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  name: 'gemini',
  // IN-03: updated from 'gemini-flash-latest' (invalid) to a known-valid model ID.
  defaultModel: 'gemini-1.5-flash-latest',
  limits: { rpm: 8, rpd: 450 },
  call
};
