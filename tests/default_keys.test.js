const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, '..', 'intellimail-defaultkeys-test.db');
process.env.DB_PATH = dbPath;

test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });

let db, defaultKeysStatusFor, resolveConfig;
test.before(() => {
  ({ db } = require('../src/db'));
  ({ defaultKeysStatusFor, resolveConfig } = require('../src/llm/config'));

  // Two users — one created today (UTC), one created 2 days ago.
  db.prepare("INSERT INTO users (email, created_at) VALUES (?, datetime('now'))").run('today@x.com');
  db.prepare("INSERT INTO users (email, created_at) VALUES (?, datetime('now', '-2 days'))").run('old@x.com');
  const todayId = db.prepare('SELECT id FROM users WHERE email = ?').get('today@x.com').id;
  const oldId   = db.prepare('SELECT id FROM users WHERE email = ?').get('old@x.com').id;

  // Both users get an account_config row with NO own keys, so the only
  // way they have a key is via the env-var fallback.
  db.prepare('INSERT INTO account_config (user_id) VALUES (?)').run(todayId);
  db.prepare('INSERT INTO account_config (user_id) VALUES (?)').run(oldId);

  global.__todayId = todayId;
  global.__oldId   = oldId;
});

test('user created today → defaults active', () => {
  const s = defaultKeysStatusFor(global.__todayId);
  assert.equal(s.active, true);
  assert.ok(s.expires_at, 'expires_at present');
});

test('user created 2 days ago → defaults expired', () => {
  const s = defaultKeysStatusFor(global.__oldId);
  assert.equal(s.active, false);
});

test('null userId → defaults inactive (no row)', () => {
  const s = defaultKeysStatusFor(null);
  assert.equal(s.active, false);
});

test('resolveConfig: env key passes through for today user, blocked for expired user', () => {
  const ENV = 'NVIDIA_API_KEY';
  const prev = process.env[ENV];
  process.env[ENV] = 'env-test-key';
  try {
    const todayCfg = resolveConfig(global.__todayId);
    assert.equal(todayCfg.keys.nvidia, 'env-test-key', 'today user gets env fallback');

    const oldCfg = resolveConfig(global.__oldId);
    assert.equal(oldCfg.keys.nvidia, null, 'expired user does NOT get env fallback');
  } finally {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  }
});

test("resolveConfig: user's stored key always wins, even after expiry", () => {
  // Give the expired user their own NVIDIA key.
  db.prepare('UPDATE account_config SET nvidia_api_key = ? WHERE user_id = ?')
    .run('user-own-key', global.__oldId);
  const cfg = resolveConfig(global.__oldId);
  assert.equal(cfg.keys.nvidia, 'user-own-key');
});
