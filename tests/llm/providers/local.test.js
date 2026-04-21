const test = require('node:test');
const assert = require('node:assert/strict');
const local = require('../../../src/llm/providers/local');

test('local provider calls localhost:8765/classify with email fields', async () => {
  const origFetch = global.fetch;
  let seenUrl, seenBody;
  global.fetch = async (url, opts) => {
    seenUrl = url;
    seenBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        category: 'meeting_request', urgency: 'normal',
        summary: 's', extracted_data: {},
        suggested_tone: 'professional', draft_reply: 'reply'
      })
    };
  };
  try {
    const email = { id: 1, from_name: 'x', from_address: 'a@b.com', subject: 'Hi', body_text: 'hello' };
    const result = await local.call(email, { mode: 'full' }, {});
    assert.equal(seenUrl, 'http://localhost:8765/classify');
    assert.equal(seenBody.subject, 'Hi');
    assert.equal(seenBody.from_address, 'a@b.com');
    assert.equal(result.category, 'meeting_request');
  } finally {
    global.fetch = origFetch;
  }
});

test('local provider throws with status tag on HTTP 500', async () => {
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  try {
    const email = { from_address: 'a@b.com', subject: 's', body_text: 'b' };
    await assert.rejects(
      () => local.call(email, { mode: 'full' }, {}),
      /500/
    );
  } finally {
    global.fetch = origFetch;
  }
});

test('local provider metadata', () => {
  assert.equal(local.name, 'local');
  assert.ok(local.limits.rpm > 0);
});
