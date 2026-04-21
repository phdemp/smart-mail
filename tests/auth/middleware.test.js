const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.JWT_SECRET_PATH = path.join(__dirname, '..', '..', 'data-test-jwt', 'jwt.secret');

const { requireAuth } = require('../../src/middleware/auth');
const { signToken } = require('../../src/auth');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (x) => { res.body = x; return res; };
  return res;
}

test('requireAuth with valid Bearer populates req.user', () => {
  const tok = signToken(7, 'a@b.c');
  const req = { headers: { authorization: 'Bearer ' + tok } };
  const res = mockRes();
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, 7);
  assert.equal(req.user.email, 'a@b.c');
  assert.equal(res.statusCode, 200);
});

test('requireAuth without header returns 401', () => {
  const req = { headers: {} };
  const res = mockRes();
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('requireAuth with malformed header returns 401', () => {
  const req = { headers: { authorization: 'NotBearer xyz' } };
  const res = mockRes();
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth with tampered token returns 401', () => {
  const tok = signToken(1, 'a@b.c');
  const req = { headers: { authorization: 'Bearer ' + tok.slice(0, -3) + 'XXX' } };
  const res = mockRes();
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});
