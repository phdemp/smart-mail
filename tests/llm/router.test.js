const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../../src/llm/router');

function fake(name, impl) {
  return {
    name, defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: impl
  };
}

test('router returns first provider success and skips others', async () => {
  let calledB = false;
  const a = fake('a', async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }));
  const b = fake('b', async () => { calledB = true; return {}; });
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.equal(out._provider, 'a');
  assert.equal(out.category, 'fyi');
  assert.equal(calledB, false);
});

test('router falls through to next provider on throw', async () => {
  const a = fake('a', async () => { throw new Error('nope'); });
  const b = fake('b', async () => ({ category: 'legal', urgency: 'urgent', summary: 's', draft_reply: 'r' }));
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.equal(out._provider, 'b');
  assert.equal(out.category, 'legal');
});

test('router returns null when all providers fail', async () => {
  const a = fake('a', async () => { throw new Error('x'); });
  const b = fake('b', async () => { throw new Error('y'); });
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.equal(out, null);
});

test('router honors order and enabled flags', async () => {
  const seen = [];
  const a = fake('a', async () => { seen.push('a'); throw new Error('x'); });
  const b = fake('b', async () => { seen.push('b'); throw new Error('y'); });
  const c = fake('c', async () => { seen.push('c'); return { category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }; });
  const r = createRouter({
    providers: [a, b, c],
    getConfig: () => ({ order: ['c', 'a'], enabled: ['c', 'a'], keys: {}, models: {} })
  });
  const out = await r.classify({ from_address: 'x@y.com', subject: 'z', body_text: '' }, { mode: 'full' });
  assert.deepEqual(seen, ['c']);
  assert.equal(out._provider, 'c');
});
