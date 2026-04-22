const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET_PATH = path.join(__dirname, '..', '..', 'data-test-signup', 'jwt.secret');
process.env.DB_PATH = path.join(__dirname, '..', '..', 'intellimail-signup-test.db');

try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}

// Mock testImap to avoid real network during tests
const imapModule = require('../../src/imap');
const originalTestImap = imapModule.testImap;
let imapShouldSucceed = true;
imapModule.testImap = async () => ({ ok: imapShouldSucceed, error: imapShouldSucceed ? null : 'mocked IMAP fail' });

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
