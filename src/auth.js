const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

function secretPath() {
  return process.env.JWT_SECRET_PATH || path.join(__dirname, '..', 'data', 'jwt.secret');
}

function jwtSecret() {
  const p = secretPath();
  try {
    const s = fs.readFileSync(p, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, { mode: 0o600 });
  return s;
}

function signToken(userId, email, expiresIn = '7d') {
  return jwt.sign({ userId, email }, jwtSecret(), { expiresIn });
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try { return jwt.verify(token, jwtSecret()); }
  catch { return null; }
}

module.exports = { jwtSecret, signToken, verifyToken };
