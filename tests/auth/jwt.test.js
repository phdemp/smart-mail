const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Keep tests isolated from other test files' secret.
const tmpDir = path.join(__dirname, '..', '..', 'data-test-jwt');
const secretPath = path.join(tmpDir, 'jwt.secret');
process.env.JWT_SECRET_PATH = secretPath;

const auth = require('../../src/auth');

test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

test('jwtSecret creates file if missing and reuses it', () => {
  try { fs.rmSync(secretPath, { force: true }); } catch {}
  const a = auth.jwtSecret();
  const b = auth.jwtSecret();
  assert.equal(a, b);
  assert.ok(a.length >= 32);
  assert.ok(fs.existsSync(secretPath));
});

test('signToken + verifyToken roundtrip', () => {
  const tok = auth.signToken(42, 'u@example.com');
  const payload = auth.verifyToken(tok);
  assert.equal(payload.userId, 42);
  assert.equal(payload.email, 'u@example.com');
});

test('verifyToken returns null for tampered token', () => {
  const tok = auth.signToken(1, 'a@b.c');
  const tampered = tok.slice(0, -5) + 'XXXXX';
  assert.equal(auth.verifyToken(tampered), null);
});

test('verifyToken returns null for expired token', () => {
  const expired = auth.signToken(1, 'a@b.c', '-1s');
  assert.equal(auth.verifyToken(expired), null);
});

test('verifyToken returns null for garbage input', () => {
  assert.equal(auth.verifyToken('not-a-token'), null);
  assert.equal(auth.verifyToken(''), null);
  assert.equal(auth.verifyToken(null), null);
});
