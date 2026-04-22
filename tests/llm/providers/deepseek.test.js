const test = require('node:test');
const assert = require('node:assert/strict');
const deepseek = require('../../../src/llm/providers/deepseek');

test('deepseek posts chat completion with bearer key and json_object format', async () => {
  const orig = global.fetch;
  let seenUrl, seenOpts;
  global.fetch = async (url, opts) => {
    seenUrl = url; seenOpts = opts;
    return {
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          category: 'financial', urgency: 'moderate', summary: 's',
          extracted_data: {}, suggested_tone: 'professional', draft_reply: 'r'
        }) } }]
      })
    };
  };
  try {
    const out = await deepseek.call(
      { from_address: 'a@b.com', subject: 'Invoice', body_text: 'x' },
      { mode: 'full' },
      { apiKey: 'sk-ds-test', model: 'deepseek-chat' }
    );
    assert.equal(seenUrl, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(seenOpts.headers['Authorization'], 'Bearer sk-ds-test');
    const body = JSON.parse(seenOpts.body);
    assert.equal(body.model, 'deepseek-chat');
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(out.category, 'financial');
  } finally {
    global.fetch = orig;
  }
});

test('deepseek missing API key throws 401', async () => {
  await assert.rejects(
    () => deepseek.call({ from_address: 'a@b.com', subject: 'x' }, {}, { apiKey: null }),
    (err) => err.status === 401
  );
});

test('deepseek propagates 429 with status', async () => {
  const orig = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate' });
  try {
    await assert.rejects(
      () => deepseek.call({ from_address: 'a@b.com', subject: 'x' }, {}, { apiKey: 'k', model: 'm' }),
      (err) => err.status === 429
    );
  } finally {
    global.fetch = orig;
  }
});

test('deepseek metadata', () => {
  assert.equal(deepseek.name, 'deepseek');
  assert.ok(deepseek.limits.rpm > 0);
  assert.equal(deepseek.defaultModel, 'deepseek-chat');
});
