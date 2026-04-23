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
      headers: { get: () => null },
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
