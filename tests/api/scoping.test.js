const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET_PATH = path.join(__dirname, '..', '..', 'data-test-scoping', 'jwt.secret');
process.env.DB_PATH = path.join(__dirname, '..', '..', 'intellimail-scoping-test.db');
try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}

const express = require('express');
const { db } = require('../../src/db');
const { requireAuth } = require('../../src/middleware/auth');
const { signToken } = require('../../src/auth');

function seed() {
  const u1 = db.prepare('INSERT INTO users (email) VALUES (?)').run('u1@test.com').lastInsertRowid;
  const u2 = db.prepare('INSERT INTO users (email) VALUES (?)').run('u2@test.com').lastInsertRowid;
  const e1 = db.prepare(`INSERT INTO emails (user_id, subject, from_address, folder)
                         VALUES (?, 'u1 email', 'a@b.c', 'INBOX')`).run(u1).lastInsertRowid;
  return { u1, u2, e1 };
}

function app() {
  const a = express();
  a.use(express.json());
  a.get('/api/emails/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  });
  return a;
}

function request(application, method, url, token) {
  return new Promise((resolve) => {
    const server = application.listen(0, () => {
      const port = server.address().port;
      const req = require('http').request({ method, hostname: 'localhost', port, path: url,
        headers: token ? { Authorization: 'Bearer ' + token } : {} },
        (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); });
        });
      req.end();
    });
  });
}

test.after(() => { try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {} });

const { u1, u2, e1 } = seed();

test('owner can read own email', async () => {
  const tok = signToken(u1, 'u1@test.com');
  const res = await request(app(), 'GET', `/api/emails/${e1}`, tok);
  assert.equal(res.status, 200);
  assert.equal(res.body.subject, 'u1 email');
});

test('non-owner gets 404 for other user email', async () => {
  const tok = signToken(u2, 'u2@test.com');
  const res = await request(app(), 'GET', `/api/emails/${e1}`, tok);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
});
