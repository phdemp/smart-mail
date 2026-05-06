const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBucket } = require('../../src/llm/ratelimiter');

test('bucket grants rpm tokens immediately', async () => {
  const b = new TokenBucket({ rpm: 5 });
  for (let i = 0; i < 5; i++) {
    assert.equal(await b.acquire(0), true);
  }
});

test('bucket refuses when empty and maxWaitMs=0', async () => {
  const b = new TokenBucket({ rpm: 2 });
  await b.acquire(0); await b.acquire(0);
  assert.equal(await b.acquire(0), false);
});

test('bucket waits and grants when refill occurs', async () => {
  const b = new TokenBucket({ rpm: 60 });  // 1 token/sec
  for (let i = 0; i < 60; i++) await b.acquire(0);
  const t0 = Date.now();
  const granted = await b.acquire(1500);
  const dt = Date.now() - t0;
  assert.equal(granted, true);
  assert.ok(dt >= 900 && dt <= 1400, `expected ~1s wait, got ${dt}ms`);
});
