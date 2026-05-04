const test = require('node:test');
const assert = require('node:assert/strict');
const nvidia = require('../../../src/llm/providers/nvidia');

const validJsonReply = JSON.stringify({
  category: 'meeting_request', urgency: 'normal',
  summary: 's', extracted_data: {},
  suggested_tone: 'professional', draft_reply: 'reply'
});

function fakeFetchOk(captured) {
  return async (url, opts) => {
    captured.url = url;
    captured.opts = opts;
    captured.body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: validJsonReply } }] })
    };
  };
}

test('nvidia provider posts OpenAI-compatible payload to integrate.api.nvidia.com', async () => {
  const origFetch = global.fetch;
  const cap = {};
  global.fetch = fakeFetchOk(cap);
  try {
    const email = { id: 1, from_name: 'x', from_address: 'a@b.com', subject: 'Hi', body_text: 'hello' };
    const result = await nvidia.call(email, { mode: 'full' }, { apiKey: 'k', model: 'meta/llama-3.3-70b-instruct' });
    assert.equal(cap.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
    assert.equal(cap.opts.headers['Authorization'], 'Bearer k');
    assert.equal(cap.body.model, 'meta/llama-3.3-70b-instruct');
    assert.equal(cap.body.response_format.type, 'json_object');
    assert.equal(cap.body.messages.length, 2);
    assert.equal(result.category, 'meeting_request');
  } finally {
    global.fetch = origFetch;
  }
});

test('nvidia provider throws 401 when apiKey missing', async () => {
  await assert.rejects(
    () => nvidia.call({ from_address: 'a@b.com' }, { mode: 'full' }, {}),
    e => e.status === 401
  );
});

test('nvidia provider tags status on HTTP 500', async () => {
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  try {
    await assert.rejects(
      () => nvidia.call({ from_address: 'a@b.com' }, { mode: 'full' }, { apiKey: 'k' }),
      e => /500/.test(e.message) && e.status === 500
    );
  } finally {
    global.fetch = origFetch;
  }
});

test('nvidia provider metadata', () => {
  assert.equal(nvidia.name, 'nvidia');
  assert.ok(nvidia.limits.rpm > 0);
  assert.ok(nvidia.limits.rpd > 0);
  assert.equal(nvidia.defaultModel, 'meta/llama-3.3-70b-instruct');
});
