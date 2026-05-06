const test = require('node:test');
const assert = require('node:assert/strict');
const gemini = require('../../../src/llm/providers/gemini');

test('gemini posts to generateContent with key in X-goog-api-key header', async () => {
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
    const out = await gemini.call(email, { mode: 'full' }, { apiKey: 'g-test', model: 'gemini-flash-latest' });
    assert.ok(seenUrl.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent'));
    assert.doesNotMatch(seenUrl, /key=/);
    assert.equal(seenOpts.headers['X-goog-api-key'], 'g-test');
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
      () => gemini.call({ from_address: 'a@b.com', subject: 'x' }, {}, { apiKey: 'k', model: 'gemini-flash-latest' }),
      (err) => err.status === 429
    );
  } finally {
    global.fetch = orig;
  }
});
