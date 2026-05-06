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

test('router session-disables provider on 401', async () => {
  let calls = 0;
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => { calls++; const e = new Error('unauth'); e.status = 401; throw e; } };
  const b = { name: 'b', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }) };
  const usage = { getCount: () => 0, increment: () => {} };
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} }),
    usage
  });
  await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  assert.equal(calls, 1, 'second call should skip provider a after 401');
});

test('router does not trip breaker on 429', async () => {
  let calls = 0;
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => { calls++; const e = new Error('rate'); e.status = 429; throw e; } };
  const b = { name: 'b', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }) };
  const usage = { getCount: () => 0, increment: () => {} };
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} }),
    usage
  });
  for (let i = 0; i < 5; i++) {
    await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  }
  assert.equal(calls, 5, 'every call should still reach a (breaker not tripped on 429)');
});

test('router opens breaker after 3 consecutive failures', async () => {
  let calls = 0;
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => { calls++; throw new Error('boom'); } };
  const b = { name: 'b', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }) };
  const usage = { getCount: () => 0, increment: () => {} };
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} }),
    usage
  });
  for (let i = 0; i < 3; i++) {
    await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  }
  assert.equal(calls, 3);
  const out = await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  assert.equal(calls, 3, 'breaker should have skipped a');
  assert.equal(out._provider, 'b');
});

test('router skips provider at daily quota', async () => {
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1000, rpd: 5 },
    call: async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }) };
  const b = { name: 'b', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => ({ category: 'legal', urgency: 'urgent', summary: 's', draft_reply: 'r' }) };
  const usage = { getCount: (n) => n === 'a' ? 5 : 0, increment: () => {} };
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} }),
    usage
  });
  const out = await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'full' });
  assert.equal(out._provider, 'b');
});

test('router skips provider when bucket is empty (regen mode)', async () => {
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1, rpd: 1000 },
    call: async () => ({ category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'ra' }) };
  const b = { name: 'b', defaultModel: 'x', limits: { rpm: 1000, rpd: 1000 },
    call: async () => ({ category: 'legal', urgency: 'urgent', summary: 's', draft_reply: 'rb' }) };
  const r = createRouter({
    providers: [a, b],
    getConfig: () => ({ order: ['a', 'b'], enabled: ['a', 'b'], keys: {}, models: {} })
  });
  // First call consumes a's only token — returns a
  const first = await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'regen' });
  assert.equal(first._provider, 'a');
  // Second call: a's bucket is empty; rpm=1 means 60s refill > 2s regen wait, so skip to b
  const second = await r.classify({ from_address: 'x@y', subject: 's', body_text: '' }, { mode: 'regen' });
  assert.equal(second._provider, 'b');
});

test('router keeps per-user buckets separate', async () => {
  // User A exhausts bucket; User B should still get the token.
  let calls = 0;
  const a = { name: 'a', defaultModel: 'x', limits: { rpm: 1, rpd: 1000 },
    call: async () => { calls++; return { category: 'fyi', urgency: 'normal', summary: 's', draft_reply: 'r' }; } };
  const r = require('../../src/llm/router').createRouter({
    providers: [a],
    getConfig: () => ({ order: ['a'], enabled: ['a'], keys: {}, models: {}, limits: {} }),
    usage: { getCount: () => 0, increment: () => {} }
  });
  const email = { from_address: 'x@y', subject: 's', body_text: '' };

  const r1u1 = await r.classify(email, { mode: 'regen', userId: 1 });
  assert.equal(r1u1._provider, 'a');
  const r2u1 = await r.classify(email, { mode: 'regen', userId: 1 });
  assert.equal(r2u1, null);  // User 1's bucket is empty
  const r1u2 = await r.classify(email, { mode: 'regen', userId: 2 });
  assert.equal(r1u2._provider, 'a');  // User 2's bucket is fresh
});
