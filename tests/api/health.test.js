const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET_PATH = path.join(__dirname, '..', '..', 'data-test-health', 'jwt.secret');
process.env.DB_PATH = path.join(__dirname, '..', '..', 'intellimail-health-test.db');
try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}

const express = require('express');
const { db } = require('../../src/db');
const { requireAuth } = require('../../src/middleware/auth');
const { signToken } = require('../../src/auth');

function seed() {
  const u1 = db.prepare('INSERT INTO users (email) VALUES (?)').run('health@test.com').lastInsertRowid;
  const e1 = db.prepare(`INSERT INTO emails (user_id, subject, from_address, folder)
                         VALUES (?, 'test email', 'a@b.c', 'INBOX')`).run(u1).lastInsertRowid;
  return { u1, e1 };
}

// Module-level variable for mock injection — test controls what getProviderHealth returns
let mockGetProviderHealth = () => ({
  nvidia: { status: 'ok', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null },
  groq:   { status: 'ok', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null },
  gemini: { status: 'ok', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null },
  deepseek: { status: 'ok', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null }
});

function app() {
  const a = express();
  a.use(express.json());

  // GET /api/llm/health — provider health endpoint (OBSERVE-01)
  a.get('/api/llm/health', requireAuth, (req, res) => {
    const health = mockGetProviderHealth(req.user.id) || {};
    const failed = db.prepare(
      "SELECT COUNT(*) as n FROM classifications WHERE user_id = ? AND source = 'failed'"
    ).get(req.user.id).n;
    res.json({ providers: health, failed_count: failed });
  });

  // GET /api/llm/health/pill — end-user AI degraded pill fragment (OBSERVE-04)
  a.get('/api/llm/health/pill', requireAuth, (req, res) => {
    const health = mockGetProviderHealth(req.user.id) || {};
    const anyDegraded = Object.values(health).some(
      h => h.status && h.status !== 'ok' && h.status !== 'unknown'
    );
    if (!anyDegraded) return res.send('');
    res.send(
      '<div style="padding:8px 16px;background:rgba(245,158,11,0.1);border-bottom:1px solid rgba(245,158,11,0.3);font-size:12px;display:flex;align-items:center;gap:8px;">' +
      '<span style="color:var(--accent-amber);">&#9888;</span>' +
      '<span style="color:var(--text-primary);">AI features degraded</span>' +
      '<a href="/settings#providers" style="color:var(--accent-amber);font-size:11px;margin-left:auto;text-decoration:none;">View status &rarr;</a>' +
      '</div>'
    );
  });

  return a;
}

// HTTP request helper — project standard (copied verbatim from scoping.test.js)
function request(application, method, url, token) {
  return new Promise((resolve) => {
    const server = application.listen(0, () => {
      const port = server.address().port;
      const req = require('http').request({ method, hostname: 'localhost', port, path: url,
        headers: token ? { Authorization: 'Bearer ' + token } : {} },
        (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: data ? (() => { try { return JSON.parse(data); } catch { return data; } })() : '' }); });
        });
      req.end();
    });
  });
}

test.after(() => { try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {} });

const { u1 } = seed();

test('GET /api/llm/health returns 401 without token', async () => {
  const r = await request(app(), 'GET', '/api/llm/health', null);
  assert.equal(r.status, 401, 'should return 401 when no token provided');
});

test('GET /api/llm/health returns { providers, failed_count } shape with valid token', async () => {
  const tok = signToken(u1, 'health@test.com');
  mockGetProviderHealth = () => ({
    nvidia: { status: 'ok', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null }
  });
  const r = await request(app(), 'GET', '/api/llm/health', tok);
  assert.equal(r.status, 200, 'should return 200 with valid token');
  assert.ok(r.body && typeof r.body === 'object', 'response should be JSON object');
  assert.ok('providers' in r.body, 'response must have providers key');
  assert.ok('failed_count' in r.body, 'response must have failed_count key');
  assert.equal(typeof r.body.failed_count, 'number', 'failed_count should be a number');
});

test('GET /api/llm/health/pill returns empty string when all providers ok or unknown', async () => {
  const tok = signToken(u1, 'health@test.com');
  mockGetProviderHealth = () => ({
    nvidia:   { status: 'ok', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null },
    groq:     { status: 'unknown', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null },
    gemini:   { status: 'ok', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null },
    deepseek: { status: 'unknown', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null }
  });
  const r = await request(app(), 'GET', '/api/llm/health/pill', tok);
  assert.equal(r.status, 200, 'should return 200');
  assert.equal(r.body, '', 'pill body should be empty string when all providers ok or unknown');
});

test('GET /api/llm/health/pill returns amber pill HTML when any provider non-ok — contains "AI features degraded", does not contain provider names or circuit breaker language', async () => {
  const tok = signToken(u1, 'health@test.com');
  mockGetProviderHealth = () => ({
    nvidia:   { status: 'ok', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null },
    groq:     { status: 'rate_limited', last_error: 'http_429', last_error_at: null, last_error_msg: null, last_success_at: null },
    gemini:   { status: 'ok', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null },
    deepseek: { status: 'ok', last_error: null, last_error_at: null, last_error_msg: null, last_success_at: null }
  });
  const r = await request(app(), 'GET', '/api/llm/health/pill', tok);
  assert.equal(r.status, 200, 'should return 200');
  assert.ok(typeof r.body === 'string' && r.body.length > 0, 'pill body should be non-empty HTML when a provider is degraded');
  assert.ok(r.body.includes('AI features degraded'), 'pill must contain "AI features degraded" text');
  assert.ok(!r.body.includes('circuit breaker'), 'pill must not contain "circuit breaker"');
  assert.ok(!r.body.includes('rate limited'), 'pill must not contain "rate limited"');
  assert.ok(!r.body.toLowerCase().includes('groq'), 'pill must not contain provider names');
  assert.ok(!r.body.toLowerCase().includes('nvidia'), 'pill must not contain provider names');
});
