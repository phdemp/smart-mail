const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET_PATH = path.join(__dirname, '..', '..', 'data-test-login', 'jwt.secret');
process.env.DB_PATH = path.join(__dirname, '..', '..', 'intellimail-login-test.db');
try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}

// Stub IMAP sync so the login route's sync-nudge doesn't spawn retry timers
// that hold the DB lock past test teardown.
const imapModule = require('../../src/imap');
imapModule.startSyncForUser = () => {};
imapModule.getSyncMode = () => 'disconnected';

const express = require('express');
const authRouter = require('../../src/routes/auth');
const { db } = require('../../src/db');

function seed(email, password) {
  const info = db.prepare('INSERT INTO users (email) VALUES (?)').run(email);
  db.prepare(`INSERT INTO account_config (user_id, email, password, imap_host, imap_port, smtp_host, smtp_port)
              VALUES (?, ?, ?, 'x', 993, 'y', 465)`).run(info.lastInsertRowid, email, password);
  return info.lastInsertRowid;
}

function app() {
  const a = express();
  a.use(express.json());
  a.use(authRouter);
  return a;
}

function request(application, method, url, body) {
  return new Promise((resolve) => {
    const server = application.listen(0, () => {
      const port = server.address().port;
      const headers = { 'Content-Type': 'application/json' };
      if (body && body._auth) { headers.Authorization = 'Bearer ' + body._auth; }
      const req = require('http').request({ method, hostname: 'localhost', port, path: url, headers },
        (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); });
        });
      if (body && !body._auth) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

test.after(() => {
  try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}
  try { fs.rmSync(path.dirname(process.env.JWT_SECRET_PATH), { recursive: true, force: true }); } catch {}
});

seed('dan@test.com', 'correct-password');

test('login with correct password returns token', async () => {
  const res = await request(app(), 'POST', '/api/auth/login', { email: 'dan@test.com', password: 'correct-password' });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, 'dan@test.com');
});

test('login with wrong password returns 401', async () => {
  const res = await request(app(), 'POST', '/api/auth/login', { email: 'dan@test.com', password: 'wrong' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');
});

test('login with unknown email returns 401 (same message)', async () => {
  const res = await request(app(), 'POST', '/api/auth/login', { email: 'nobody@test.com', password: 'x' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');
});

test('check with valid token returns user; without returns 401', async () => {
  const loginRes = await request(app(), 'POST', '/api/auth/login', { email: 'dan@test.com', password: 'correct-password' });
  const tok = loginRes.body.token;
  const ok = await request(app(), 'GET', '/api/auth/check', { _auth: tok });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.email, 'dan@test.com');
  const bad = await request(app(), 'GET', '/api/auth/check');
  assert.equal(bad.status, 401);
});

test('logout returns ok regardless of token', async () => {
  const res = await request(app(), 'POST', '/api/auth/logout', {});
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});
