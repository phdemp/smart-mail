const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET_PATH = path.join(__dirname, '..', '..', 'data-test-signup', 'jwt.secret');
process.env.DB_PATH = path.join(__dirname, '..', '..', 'intellimail-signup-test.db');

try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}

// Mock testImap + startSyncForUser to avoid real network + dangling IDLE timers during tests
const imapModule = require('../../src/imap');
const originalTestImap = imapModule.testImap;
const originalStartSync = imapModule.startSyncForUser;
let imapShouldSucceed = true;
imapModule.testImap = async () => ({ ok: imapShouldSucceed, error: imapShouldSucceed ? null : 'mocked IMAP fail' });
imapModule.startSyncForUser = () => { /* no-op in tests */ };

const express = require('express');
const authRouter = require('../../src/routes/auth');
const { db } = require('../../src/db');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  return app;
}

function request(method, url, body) {
  return new Promise((resolve) => {
    const server = buildApp().listen(0, () => {
      const port = server.address().port;
      const req = require('http').request({
        method, hostname: 'localhost', port, path: url,
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); });
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

test.after(() => {
  imapModule.testImap = originalTestImap;
  imapModule.startSyncForUser = originalStartSync;
  try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}
  try { fs.rmSync(path.dirname(process.env.JWT_SECRET_PATH), { recursive: true, force: true }); } catch {}
});

test('signup creates user + account_config + returns token', async () => {
  // Clean any state leaked from parallel test files that share the db module.
  try { db.prepare('DELETE FROM account_config WHERE email LIKE ?').run('%@test.com'); } catch {}
  try { db.prepare('DELETE FROM users WHERE email LIKE ?').run('%@test.com'); } catch {}
  imapShouldSucceed = true;
  const res = await request('POST', '/api/auth/signup', {
    email: 'alice@test.com', password: 'pw',
    imap_host: 'imap.example.com', imap_port: 993, imap_tls: 1,
    smtp_host: 'smtp.example.com', smtp_port: 465, smtp_tls: 1,
    display_name: 'Alice', sync_interval: 60
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, 'alice@test.com');
  const users = db.prepare('SELECT * FROM users WHERE email = ?').all('alice@test.com');
  assert.equal(users.length, 1);
  const cfg = db.prepare('SELECT * FROM account_config WHERE user_id = ?').get(users[0].id);
  assert.equal(cfg.imap_host, 'imap.example.com');
});

test('signup with duplicate email returns 409', async () => {
  imapShouldSucceed = true;
  await request('POST', '/api/auth/signup', {
    email: 'bob@test.com', password: 'pw',
    imap_host: 'x', imap_port: 993, imap_tls: 1, smtp_host: 'y', smtp_port: 465, smtp_tls: 1
  });
  const res = await request('POST', '/api/auth/signup', {
    email: 'bob@test.com', password: 'pw',
    imap_host: 'x', imap_port: 993, imap_tls: 1, smtp_host: 'y', smtp_port: 465, smtp_tls: 1
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'email_exists');
});

test('signup with failing IMAP returns 400 and writes nothing', async () => {
  imapShouldSucceed = false;
  const before = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  const res = await request('POST', '/api/auth/signup', {
    email: 'carol@test.com', password: 'pw',
    imap_host: 'x', imap_port: 993, imap_tls: 1, smtp_host: 'y', smtp_port: 465, smtp_tls: 1
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'imap_failed');
  const after = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  assert.equal(after, before);
});

test('signup row contains nvidia in llm_provider_order/enabled (regression: column DEFAULT was locked at the legacy local,...)', async () => {
  imapShouldSucceed = true;
  await request('POST', '/api/auth/signup', {
    email: 'dave@test.com', password: 'pw',
    imap_host: 'imap.example.com', imap_port: 993, imap_tls: 1,
    smtp_host: 'smtp.example.com', smtp_port: 465, smtp_tls: 1,
    display_name: 'Dave', sync_interval: 60
  });
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get('dave@test.com');
  const cfg = db.prepare('SELECT llm_provider_order, llm_providers_enabled FROM account_config WHERE user_id = ?').get(u.id);
  assert.equal(cfg.llm_provider_order,    'nvidia,groq,gemini,deepseek');
  assert.equal(cfg.llm_providers_enabled, 'nvidia,groq,gemini,deepseek');
});

test('login normalizes Gmail app password whitespace before comparing', async () => {
  imapShouldSucceed = true;
  // Sign up with Google's spaced display format. Server stores the cleaned value.
  await request('POST', '/api/auth/signup', {
    email: 'eve@gmail.com', password: 'abcd efgh ijkl mnop',
    imap_host: 'imap.gmail.com', imap_port: 993, imap_tls: 1,
    smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_tls: 1,
    display_name: 'Eve', sync_interval: 60
  });
  // Login with the SAME spaced format the user copy-pasted from Google's UI.
  const res = await request('POST', '/api/auth/login', {
    email: 'eve@gmail.com',
    password: 'abcd efgh ijkl mnop'
  });
  assert.equal(res.status, 200, 'login should succeed even with spaces');
  assert.ok(res.body.token);
  // And the stored value is the clean one (no spaces).
  const stored = db.prepare(`SELECT password FROM account_config WHERE email = ?`).get('eve@gmail.com');
  assert.equal(stored.password, 'abcdefghijklmnop');
});
