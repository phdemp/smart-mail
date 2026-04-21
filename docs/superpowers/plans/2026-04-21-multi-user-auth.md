# Multi-User Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-user registration + login to IntelliMail with JWT auth in localStorage, where each user's password is their IMAP password (reused), every row in the DB scopes by `user_id`, IMAP sync and classifier queues become per-user, and the existing single-user data is grandfathered onto the first user to log in.

**Architecture:** A single new `users` table plus `user_id` FK on every scoped table. Stateless JWT signed with a persisted secret file. All `/api/*` routes gated by a `requireAuth` middleware that populates `req.user`. Page routes serve static HTML; a tiny client-side redirect snippet reads localStorage and hops to `/login`, `/setup`, or `/dashboard` as appropriate. Per-user runtime state in `imap.js` and `classifier.js` becomes a `Map<userId, State>`; the LLM router's buckets/breakers become keyed by `userId+provider`.

**Tech Stack:** Node 24, Express 4, better-sqlite3, Alpine.js, HTMX, `jsonwebtoken` (new dep), Node `crypto`, built-in `node:test`.

**Conventions:**
- Test runner: `npm test` (already configured). Run a single file with `npm test -- tests/<path>`.
- All git commits: `git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "..."`. The repo has no global git identity.
- Working directory: `C:\mywork\xgen-intel` (use bash / forward-slash paths: `/c/mywork/xgen-intel`).
- Server runs on http://localhost:3000. Start with `node src/server.js`, kill with `taskkill //F //IM node.exe` on Windows.
- Branch: `feature/llm-provider-fallback` (current) — this plan's commits stack on top.
- Baseline commit before this plan: `dba9459` (the multi-user auth spec).

---

## File Structure

**New files:**
- `src/auth.js` — JWT sign/verify + secret management
- `src/middleware/auth.js` — `requireAuth` Express middleware
- `src/routes/auth.js` — `POST /api/auth/signup`, `/login`, `/logout`, `GET /api/auth/check`, `GET /api/users/any`
- `views/login.html` — login page
- `tests/auth/jwt.test.js`
- `tests/auth/middleware.test.js`
- `tests/auth/signup.test.js`
- `tests/auth/login.test.js`
- `tests/migration.test.js`
- `tests/api/scoping.test.js`
- `docs/superpowers/plans/2026-04-21-multi-user-auth-smoke.md` (final task)

**Modified files:**
- `package.json` — add `jsonwebtoken` dep
- `.gitignore` — add `data/jwt.secret`
- `src/db.js` — `users` table + `user_id` columns + `meta` table + grandfather migration
- `src/llm/config.js` — `resolveConfig` takes `userId`, `saveProviderConfig` takes `userId`
- `src/llm/router.js` — per-user buckets/breakers keyed by `userId+provider`
- `src/llm/index.js` — `router.classify(email, {mode, tone, userId})` passes userId through
- `src/imap.js` — `startSyncForUser`, `stopSyncForUser`, per-user state Map
- `src/classifier.js` — `queueClassification(userId, emailId)`, per-user queue
- `src/server.js` — wire auth routes + middleware; on boot start sync per user
- `src/routes/pages.js` — add `GET /login`; remove server-side redirect in `GET /`
- `src/routes/api.js` — add `requireAuth` to all `/api/*` except public ones; add `user_id` filter to every query
- `views/setup.html` — post to `/api/auth/signup`; store JWT on success
- `views/login.html` — (new, listed above)
- `views/dashboard.html`, `views/settings.html`, `views/setup.html`, `views/login.html` — inject redirect snippet; add HTMX auth hook
- `public/js/app.js` — add `authFetch`, HTMX hook, 401 global handler; replace all `fetch` with `authFetch`

---

## Task 1: Install `jsonwebtoken` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dep**

```bash
cd /c/mywork/xgen-intel
npm install --save jsonwebtoken@^9.0.2
```

- [ ] **Step 2: Verify**

```bash
node -e "console.log(require('jsonwebtoken').sign({a:1}, 'k'))"
```
Expected: a JWT string starting with `eyJ`.

- [ ] **Step 3: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add package.json package-lock.json
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: add jsonwebtoken dep"
```

---

## Task 2: JWT primitives (`src/auth.js`)

**Files:**
- Create: `src/auth.js`
- Create: `tests/auth/jwt.test.js`
- Modify: `.gitignore`

- [ ] **Step 1: Add secret path to gitignore**

Edit `.gitignore`, add a new line:
```
data/jwt.secret
```

- [ ] **Step 2: Write failing tests**

Create `tests/auth/jwt.test.js`:
```js
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
```

- [ ] **Step 3: Run to verify they fail**

```bash
npm test -- tests/auth/jwt.test.js
```
Expected: module not found / multiple failures.

- [ ] **Step 4: Implement `src/auth.js`**

```js
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
```

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- tests/auth/jwt.test.js
```
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/auth.js tests/auth/jwt.test.js .gitignore
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: JWT sign/verify + persisted secret"
```

---

## Task 3: `requireAuth` middleware

**Files:**
- Create: `src/middleware/auth.js`
- Create: `tests/auth/middleware.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/auth/middleware.test.js`:
```js
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
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- tests/auth/middleware.test.js
```

- [ ] **Step 3: Implement `src/middleware/auth.js`**

```js
const { verifyToken } = require('../auth');

function requireAuth(req, res, next) {
  const h = (req.headers && req.headers.authorization) || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = { id: payload.userId, email: payload.email };
  next();
}

module.exports = { requireAuth };
```

- [ ] **Step 4: Verify pass**

```bash
npm test -- tests/auth/middleware.test.js
```
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/middleware/auth.js tests/auth/middleware.test.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: requireAuth middleware"
```

---

## Task 4: Schema migrations (users table + user_id columns + meta table)

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1: Add schema changes after the existing `provider_usage` section in `src/db.js`**

Locate the block that ends with `try { db.prepare("DELETE FROM provider_usage WHERE day < date('now', '-7 days')").run(); } catch(e) {}` — insert immediately after it:
```js
// ─── Multi-user auth ─────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

const USER_ID_TABLES = ['account_config', 'emails', 'classifications', 'drafts', 'sync_log'];
for (const t of USER_ID_TABLES) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN user_id INTEGER REFERENCES users(id)`); } catch(e) {}
}

db.exec(`
CREATE INDEX IF NOT EXISTS idx_emails_user          ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_classifications_user ON classifications(user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_user          ON drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_user        ON sync_log(user_id);
`);

// provider_usage needs its PK rebuilt to include user_id. SQLite can't ALTER PK,
// so rebuild the table in place. On fresh installs where user_id is already NULL
// and the composite PK doesn't exist, copy rows into the new shape.
const puHasUserId = db.prepare('PRAGMA table_info(provider_usage)').all().some(c => c.name === 'user_id');
if (!puHasUserId) {
  db.exec(`
    CREATE TABLE provider_usage_new (
      user_id INTEGER,
      provider TEXT NOT NULL,
      day DATE NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, provider, day)
    );
    INSERT INTO provider_usage_new (user_id, provider, day, request_count)
      SELECT NULL, provider, day, request_count FROM provider_usage;
    DROP TABLE provider_usage;
    ALTER TABLE provider_usage_new RENAME TO provider_usage;
    CREATE INDEX IF NOT EXISTS idx_provider_usage_day ON provider_usage(day);
    CREATE INDEX IF NOT EXISTS idx_provider_usage_user ON provider_usage(user_id, day);
  `);
}
```

- [ ] **Step 2: Verify schema by booting once**

```bash
cd /c/mywork/xgen-intel
node -e "const {db}=require('./src/db'); console.log('users cols:', db.prepare('PRAGMA table_info(users)').all().map(c=>c.name).join(',')); console.log('meta cols:', db.prepare('PRAGMA table_info(meta)').all().map(c=>c.name).join(',')); console.log('account_config has user_id:', db.prepare('PRAGMA table_info(account_config)').all().some(c=>c.name==='user_id')); console.log('provider_usage has user_id:', db.prepare('PRAGMA table_info(provider_usage)').all().some(c=>c.name==='user_id'));"
```
Expected:
```
users cols: id,email,created_at
meta cols: key,value
account_config has user_id: true
provider_usage has user_id: true
```

- [ ] **Step 3: Confirm tests still pass**

```bash
npm test 2>&1 | tail -5
```
Expected: 45 pass (36 pre-existing + 5 jwt + 4 middleware).

- [ ] **Step 4: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/db.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: users table + user_id columns + provider_usage PK rebuild"
```

---

## Task 5: Grandfather migration (attach existing single-user data to first registered user)

**Files:**
- Modify: `src/db.js` — add a `grandfatherIfNeeded()` export
- Create: `tests/migration.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/migration.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

// Use an isolated DB for this test.
const dbPath = path.join(__dirname, '..', 'intellimail-migration-test.db');

test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });

function freshLegacyDb() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE account_config (id INTEGER PRIMARY KEY, email TEXT, password TEXT);
    CREATE TABLE emails (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE classifications (id INTEGER PRIMARY KEY AUTOINCREMENT, email_id INTEGER);
    CREATE TABLE drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, email_id INTEGER);
    CREATE TABLE sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  // Add user_id columns
  for (const t of ['account_config','emails','classifications','drafts','sync_log']) {
    db.exec(`ALTER TABLE ${t} ADD COLUMN user_id INTEGER`);
  }
  // Seed legacy data
  db.prepare('INSERT INTO account_config (id, email, password) VALUES (1, ?, ?)').run('legacy@ex.com', 'pw');
  for (let i = 0; i < 3; i++) db.prepare('INSERT INTO emails DEFAULT VALUES').run();
  db.prepare('INSERT INTO classifications (email_id) VALUES (1)').run();
  db.prepare('INSERT INTO drafts (email_id) VALUES (1)').run();
  db.prepare('INSERT INTO sync_log DEFAULT VALUES').run();
  return db;
}

test('grandfatherIfNeeded creates user and attaches legacy rows', () => {
  const db = freshLegacyDb();
  const { grandfatherIfNeeded } = require('../src/db-migration');
  grandfatherIfNeeded(db);

  const users = db.prepare('SELECT * FROM users').all();
  assert.equal(users.length, 1);
  assert.equal(users[0].email, 'legacy@ex.com');
  const uid = users[0].id;

  assert.equal(db.prepare('SELECT user_id FROM account_config WHERE id=1').get().user_id, uid);
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM emails WHERE user_id = ?').get(uid).n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM classifications WHERE user_id = ?').get(uid).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM drafts WHERE user_id = ?').get(uid).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM sync_log WHERE user_id = ?').get(uid).n, 1);
  assert.equal(db.prepare('SELECT value FROM meta WHERE key = ?').get('multi_user_migrated').value, '1');
  db.close();
});

test('grandfatherIfNeeded is a no-op on a fresh DB (no legacy account_config.id=1)', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE account_config (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, user_id INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  const { grandfatherIfNeeded } = require('../src/db-migration');
  grandfatherIfNeeded(db);
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM users').get().n, 0);
  assert.equal(db.prepare('SELECT value FROM meta WHERE key = ?').get('multi_user_migrated'), undefined);
});

test('grandfatherIfNeeded is idempotent — second call is a no-op', () => {
  const db = freshLegacyDb();
  const { grandfatherIfNeeded } = require('../src/db-migration');
  grandfatherIfNeeded(db);
  grandfatherIfNeeded(db);
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM users').get().n, 1);
  db.close();
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- tests/migration.test.js
```
Expected: module not found.

- [ ] **Step 3: Implement `src/db-migration.js` (new file, separate from `db.js` so it's testable with an injected db)**

```js
function grandfatherIfNeeded(db) {
  const already = db.prepare("SELECT value FROM meta WHERE key = 'multi_user_migrated'").get();
  if (already && already.value === '1') return;

  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (userCount > 0) {
    // Users already exist; skip grandfather but mark migrated
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('multi_user_migrated', '1')").run();
    return;
  }

  const legacy = db.prepare('SELECT email FROM account_config WHERE id = 1').get();
  if (!legacy || !legacy.email) {
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('multi_user_migrated', '1')").run();
    return;
  }

  const info = db.prepare('INSERT INTO users (email) VALUES (?)').run(legacy.email);
  const uid = info.lastInsertRowid;

  db.prepare('UPDATE account_config SET user_id = ? WHERE id = 1').run(uid);
  for (const t of ['emails', 'classifications', 'drafts', 'sync_log']) {
    db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`).run(uid);
  }
  // provider_usage already has user_id column after Task 4 rebuild
  try { db.prepare('UPDATE provider_usage SET user_id = ? WHERE user_id IS NULL').run(uid); } catch {}

  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('multi_user_migrated', '1')").run();
}

module.exports = { grandfatherIfNeeded };
```

- [ ] **Step 4: Wire into `src/db.js`**

At the bottom of `src/db.js`, before `module.exports = ...`, add:
```js
const { grandfatherIfNeeded } = require('./db-migration');
grandfatherIfNeeded(db);
```

- [ ] **Step 5: Verify tests pass**

```bash
npm test -- tests/migration.test.js
npm test 2>&1 | tail -5
```
Expected: 3 migration tests pass; total test count 48.

- [ ] **Step 6: Verify live DB**

```bash
node -e "const {db}=require('./src/db'); console.log(db.prepare('SELECT * FROM users').all()); console.log('migrated flag:', db.prepare(\"SELECT value FROM meta WHERE key='multi_user_migrated'\").get());"
```
Expected: one user matching the current `account_config` email (e.g. `manvendra.s@xgenplus.com`), and `{ value: '1' }`.

- [ ] **Step 7: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/db-migration.js src/db.js tests/migration.test.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: grandfather migration for legacy single-user data"
```

---

## Task 6: `GET /api/users/any` public endpoint

**Files:**
- Modify: `src/routes/api.js`

- [ ] **Step 1: Add route**

Add near the top of `src/routes/api.js` (right after the `const { db, ... } = require('../db')` imports, and before any other route is defined) — actually place it just above the first `router.get(...)` or `router.post(...)`:
```js
router.get('/api/users/any', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  res.json({ any: n > 0 });
});
```

- [ ] **Step 2: Smoke-test the endpoint**

```bash
taskkill //F //IM node.exe 2>&1 | head -1 || true
sleep 1
node src/server.js >/tmp/srv.log 2>&1 &
sleep 2
curl -s http://localhost:3000/api/users/any
taskkill //F //IM node.exe 2>&1 | head -1
```
Expected: `{"any":true}` (from grandfather migration).

- [ ] **Step 3: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/routes/api.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: public GET /api/users/any"
```

---

## Task 7: Signup route (`POST /api/auth/signup`)

**Files:**
- Create: `src/routes/auth.js`
- Create: `tests/auth/signup.test.js`
- Modify: `src/server.js` — mount the auth router

- [ ] **Step 1: Write failing test**

Create `tests/auth/signup.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET_PATH = path.join(__dirname, '..', '..', 'data-test-jwt', 'jwt.secret');
// Run signup tests against a dedicated DB so we don't clobber dev data.
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

const app = buildApp();
const request = (method, url, body) => new Promise((resolve) => {
  const req = require('http').request({
    method, hostname: 'localhost', port: 0, path: url,
    headers: { 'Content-Type': 'application/json' }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
  });
  const server = app.listen(0, () => {
    const port = server.address().port;
    const client = require('http').request({
      method, hostname: 'localhost', port, path: url,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); });
    });
    if (body) client.write(JSON.stringify(body));
    client.end();
  });
  req.destroy();
});

test.after(() => {
  imapModule.testImap = originalTestImap;
  try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}
});

test('signup creates user + account_config + returns token', async () => {
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
```

**Note:** The main `src/db.js` currently reads `DB_PATH` env override — add this to `src/db.js` if not present:
```js
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'intellimail.db');
const db = new Database(DB_PATH);
```
(Check if already; the current code hardcodes the path. If so, modify this line.)

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- tests/auth/signup.test.js
```

- [ ] **Step 3: Implement `src/routes/auth.js`**

```js
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { signToken } = require('../auth');
const { testImap } = require('../imap');

router.post('/api/auth/signup', async (req, res) => {
  const b = req.body || {};
  if (!b.email || !b.password || !b.imap_host || !b.smtp_host) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(b.email);
  if (existing) return res.status(409).json({ error: 'email_exists' });

  const cfg = {
    display_name: b.display_name || b.email,
    email: b.email,
    imap_host: b.imap_host,
    imap_port: parseInt(b.imap_port, 10) || 993,
    imap_tls: (b.imap_tls === true || b.imap_tls === 1 || b.imap_tls === '1' || b.imap_tls === 'on') ? 1 : 0,
    smtp_host: b.smtp_host,
    smtp_port: parseInt(b.smtp_port, 10) || 465,
    smtp_tls: (b.smtp_tls === true || b.smtp_tls === 1 || b.smtp_tls === '1' || b.smtp_tls === 'on') ? 1 : 0,
    username: b.username || b.email,
    password: b.password,
    sync_interval: parseInt(b.sync_interval, 10) || 60
  };

  let imapResult;
  try { imapResult = await testImap(cfg); }
  catch (e) { imapResult = { ok: false, error: e.message }; }
  if (!imapResult || !imapResult.ok) {
    return res.status(400).json({ error: 'imap_failed', detail: imapResult && imapResult.error || 'IMAP test failed' });
  }

  const info = db.prepare('INSERT INTO users (email) VALUES (?)').run(cfg.email);
  const userId = info.lastInsertRowid;

  db.prepare(`
    INSERT INTO account_config (
      user_id, display_name, email, imap_host, imap_port, imap_tls,
      smtp_host, smtp_port, smtp_tls, username, password, sync_interval
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(userId, cfg.display_name, cfg.email, cfg.imap_host, cfg.imap_port, cfg.imap_tls,
         cfg.smtp_host, cfg.smtp_port, cfg.smtp_tls, cfg.username, cfg.password, cfg.sync_interval);

  const token = signToken(userId, cfg.email);
  res.json({ token, user: { id: userId, email: cfg.email } });
});

module.exports = router;
```

- [ ] **Step 4: Mount router in `src/server.js`**

Add `const authRouter = require('./routes/auth');` near the other route requires, and `app.use('/', authRouter);` before the existing routers.

- [ ] **Step 5: Verify tests pass**

```bash
npm test -- tests/auth/signup.test.js
npm test 2>&1 | tail -5
```
Expected: 3 new signup tests pass; total 51.

- [ ] **Step 6: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/routes/auth.js src/server.js tests/auth/signup.test.js src/db.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: POST /api/auth/signup"
```

---

## Task 8: Login, logout, and check routes

**Files:**
- Modify: `src/routes/auth.js`
- Create: `tests/auth/login.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/auth/login.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET_PATH = path.join(__dirname, '..', '..', 'data-test-jwt', 'jwt.secret');
process.env.DB_PATH = path.join(__dirname, '..', '..', 'intellimail-login-test.db');
try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}

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
      const req = require('http').request({ method, hostname: 'localhost', port, path: url,
        headers: { 'Content-Type': 'application/json', ...(body?._auth ? { Authorization: 'Bearer ' + body._auth } : {}) } },
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

test.after(() => { try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {} });

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
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- tests/auth/login.test.js
```

- [ ] **Step 3: Extend `src/routes/auth.js`**

Add these three routes above the existing `module.exports = router;`:
```js
const { requireAuth } = require('../middleware/auth');

router.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  const row = db.prepare(`
    SELECT u.id, u.email, ac.password
    FROM users u JOIN account_config ac ON ac.user_id = u.id
    WHERE u.email = ?
  `).get(email);
  if (!row || row.password !== password) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = signToken(row.id, row.email);
  res.json({ token, user: { id: row.id, email: row.email } });
});

router.post('/api/auth/logout', (req, res) => {
  res.json({ ok: true });
});

router.get('/api/auth/check', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});
```

- [ ] **Step 4: Verify tests pass**

```bash
npm test -- tests/auth/login.test.js
npm test 2>&1 | tail -5
```
Expected: 5 new login tests pass; total 56.

- [ ] **Step 5: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/routes/auth.js tests/auth/login.test.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: login, logout, check routes"
```

---

## Task 9: Add `requireAuth` to all existing `/api/*` routes except public endpoints

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add a targeted auth-gate middleware before the `apiRouter` mount**

In `src/server.js`, after `setClassifierBroadcast(broadcast);` and before `const pagesRouter = require('./routes/pages');`, add:
```js
const { requireAuth } = require('./middleware/auth');
const PUBLIC_API_PATHS = new Set([
  '/api/auth/signup', '/api/auth/login', '/api/auth/logout', '/api/auth/check',
  '/api/users/any',
  '/api/account/test-imap', '/api/account/test-smtp', '/api/account/test'
]);

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  // Provider test endpoint is allowed pre-signup with cfg in body (used by setup wizard) — keep open
  if (req.path.startsWith('/api/providers/') && req.path.endsWith('/test')) return next();
  return requireAuth(req, res, next);
});
```

- [ ] **Step 2: Smoke-test**

```bash
taskkill //F //IM node.exe 2>&1 | head -1 || true
sleep 1
node src/server.js >/tmp/srv.log 2>&1 &
sleep 2
echo "--- public endpoint without auth ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/users/any
echo "--- protected endpoint without auth ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/stats
echo "--- protected endpoint with invalid token ---"
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer bad" http://localhost:3000/api/stats
taskkill //F //IM node.exe 2>&1 | head -1
```
Expected: 200 for users/any, 401 for /api/stats (both cases).

- [ ] **Step 3: Verify unit tests still pass**

```bash
npm test 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/server.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: gate all /api/* behind requireAuth except public endpoints"
```

---

## Task 10: Scope existing API queries by `user_id`

**Files:**
- Modify: `src/routes/api.js` — every DB query inside a protected route
- Modify: `src/db.js` — `getConfig()` becomes `getConfig(userId)`
- Create: `tests/api/scoping.test.js`

- [ ] **Step 1: Update `src/db.js` `getConfig` and `getStats` to accept `userId`**

Replace `getConfig`:
```js
function getConfig(userId) {
  if (userId != null) {
    return db.prepare('SELECT * FROM account_config WHERE user_id = ?').get(userId);
  }
  // Legacy callers (e.g. imap startup before user context) — return first row
  return db.prepare('SELECT * FROM account_config ORDER BY id LIMIT 1').get();
}
```

Replace `getStats`:
```js
function getStats(userId) {
  const where = userId != null ? 'AND e.user_id = ?' : '';
  const params = userId != null ? [userId] : [];

  const rows = db.prepare(`
    SELECT c.category, COUNT(*) as count
    FROM emails e
    JOIN classifications c ON c.email_id = e.id
    WHERE e.is_archived = 0 AND e.is_deleted = 0 AND e.folder = 'INBOX' ${where}
    GROUP BY c.category
  `).all(...params);

  const urgentCount = db.prepare(`
    SELECT COUNT(*) as count FROM emails e
    JOIN classifications c ON c.email_id = e.id
    WHERE c.urgency = 'urgent' AND e.is_archived = 0 AND e.is_deleted = 0 AND e.is_read = 0 ${where}
  `).get(...params);

  const totalUnread = db.prepare(`
    SELECT COUNT(*) as count FROM emails e
    WHERE is_read = 0 AND is_archived = 0 AND is_deleted = 0 AND folder = 'INBOX' ${where}
  `).get(...params);

  const trashCount = db.prepare(`
    SELECT COUNT(*) as count FROM emails e WHERE is_deleted = 1 ${where}
  `).get(...params);

  const stats = {
    urgent: urgentCount.count, total_unread: totalUnread.count, trash: trashCount.count,
    meeting_request: 0, financial: 0, legal: 0, travel: 0,
    pitch_deck: 0, fyi: 0, rewards_awards: 0, other: 0
  };
  for (const row of rows) if (stats.hasOwnProperty(row.category)) stats[row.category] = row.count;
  return stats;
}
```

- [ ] **Step 2: Update all callers in `src/routes/api.js`**

Run a manual pass over `src/routes/api.js`. For each route that is behind `requireAuth`:

- Replace `getConfig()` with `getConfig(req.user.id)`.
- Replace `getStats()` with `getStats(req.user.id)`.
- On every query that touches `emails`, `classifications`, `drafts`, `sync_log`, or `provider_usage`, add `AND <table>.user_id = ?` to the WHERE clause and pass `req.user.id` as a parameter.
- For ownership-critical routes (`/api/emails/:id` and all its siblings like `/read`, `/star`, `/delete`, `/draft/*`, `/ical`), change `WHERE id = ?` to `WHERE id = ? AND user_id = ?`. If the query returns empty / `changes === 0`, respond `res.status(404).json({ error: 'not_found' })`.

Specific must-change routes: `/api/stats`, `/api/sync/status`, `/api/sync/now`, `/api/emails` (list), `/api/emails/:id` (detail), `/api/emails/:id/read`, `/star`, `/delete`, `/permanently-delete`, `/archive`, `/reclassify`, `/api/emails/:id/draft`, `/draft/save`, `/draft/send`, `/draft/regen`, `/api/emails/:id/ical`, `/api/settings`, `/api/settings/save`, `/api/providers/usage`, `/api/sidebar`, `/api/account/logout`, `/api/account/reset`.

**Pattern for emails/drafts/classifications:**
```js
const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
if (!email) return res.status(404).json({ error: 'not_found' });
```

**Pattern for writes:**
```js
const info = db.prepare('UPDATE emails SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
```

**Pattern for settings save:**
```js
db.prepare(`UPDATE account_config SET ... WHERE user_id = ?`).run(..., req.user.id);
```

**Pattern for list / sidebar queries (already filtered):**
Just add the `AND e.user_id = ?` clause and append the param.

- [ ] **Step 3: Write cross-user scoping test**

Create `tests/api/scoping.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET_PATH = path.join(__dirname, '..', '..', 'data-test-jwt', 'jwt.secret');
process.env.DB_PATH = path.join(__dirname, '..', '..', 'intellimail-scoping-test.db');
try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}

const express = require('express');
const { db } = require('../../src/db');
const { requireAuth } = require('../../src/middleware/auth');
const { signToken } = require('../../src/auth');

function seed() {
  const u1 = db.prepare('INSERT INTO users (email) VALUES (?)').run('u1@test.com').lastInsertRowid;
  const u2 = db.prepare('INSERT INTO users (email) VALUES (?)').run('u2@test.com').lastInsertRowid;
  // Email owned by u1 only
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
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- tests/api/scoping.test.js
npm test 2>&1 | tail -5
```

- [ ] **Step 5: Live smoke**

```bash
taskkill //F //IM node.exe 2>&1 | head -1 || true
node src/server.js >/tmp/srv.log 2>&1 &
sleep 2
# Log in with the grandfather user
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"manvendra.s@xgenplus.com","password":"YOUR_PASSWORD_HERE"}' | python -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
echo "Token prefix: ${TOKEN:0:20}..."
echo "--- /api/stats without token ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/stats
echo "--- /api/stats with token ---"
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/stats
taskkill //F //IM node.exe 2>&1 | head -1
```
(Replace `YOUR_PASSWORD_HERE` with the IMAP password. Expected: 401 without token, 200 with token.)

- [ ] **Step 6: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/db.js src/routes/api.js tests/api/scoping.test.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: scope all /api/* queries by user_id"
```

---

## Task 11: Per-user IMAP sync

**Files:**
- Modify: `src/imap.js`
- Modify: `src/server.js`
- Modify: `src/routes/api.js`

- [ ] **Step 1: Refactor `src/imap.js` — replace module-level state with `Map<userId, SyncState>`**

Rewrite the file:
```js
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const cron = require('node-cron');
const crypto = require('crypto');
const { db, getConfig } = require('./db');
const { queueClassification } = require('./classifier');

let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }

// Per-user sync state
const states = new Map();

function stateFor(userId) {
  let s = states.get(userId);
  if (!s) {
    s = {
      syncMode: 'disconnected', lastSeenUID: 0, idleDropTimes: [],
      cronJob: null, recoveryInterval: null, renewalTimer: null, currentClient: null
    };
    states.set(userId, s);
  }
  return s;
}

function getSyncMode(userId) {
  return stateFor(userId).syncMode;
}

function setSyncMode(userId, mode) {
  stateFor(userId).syncMode = mode;
  broadcast('sync_status', { userId, mode, lastSync: new Date().toISOString() });
}

async function createClient(cfg) { /* unchanged */ }

// All previously module-level state accesses now use stateFor(userId)
// startIDLE(cfg, userId), startPolling(cfg, userId), etc.
// On email arrival: queueClassification(userId, emailId)
// Keep the same logic; just thread userId through.

async function startSyncForUser(userId) {
  const cfg = getConfig(userId);
  if (!cfg) { setSyncMode(userId, 'disconnected'); return; }
  // ... existing body of startSync, but scope all state via stateFor(userId)
}

async function stopSyncForUser(userId) {
  const s = stateFor(userId);
  if (s.renewalTimer) clearTimeout(s.renewalTimer);
  if (s.cronJob) { s.cronJob.stop(); s.cronJob = null; }
  if (s.recoveryInterval) { clearInterval(s.recoveryInterval); s.recoveryInterval = null; }
  if (s.currentClient) { try { await s.currentClient.logout(); } catch {} s.currentClient = null; }
  s.syncMode = 'disconnected';
  broadcast('sync_status', { userId, mode: 'disconnected', lastSync: new Date().toISOString() });
}

async function testImap(cfg) { /* unchanged — takes cfg directly */ }

async function flagAsDeleted(userId, uid, folder) { /* thread userId into state lookup */ }
async function expungeDeleted(userId) { /* thread userId */ }

module.exports = {
  startSyncForUser, stopSyncForUser, testImap, getSyncMode, setBroadcast,
  flagAsDeleted, expungeDeleted
};
```

**Implementation note:** the actual body of `startSync` is long (covers cold-start UID fetch, IDLE state machine, circuit breaker, polling fallback, renewal). Preserve every line; the only substitutions needed are:
- `lastSeenUID` → `stateFor(userId).lastSeenUID`
- `idleDropTimes` → `stateFor(userId).idleDropTimes`
- `renewalTimer` / `cronJob` / `recoveryInterval` / `currentClient` → `stateFor(userId).<field>`
- `setSyncMode(mode)` → `setSyncMode(userId, mode)`
- `setTimeout(startSync, ...)` → `setTimeout(() => startSyncForUser(userId), ...)`
- `queueClassification(emailId)` → `queueClassification(userId, emailId)`

If a function currently closes over `cfg`, keep passing it explicitly alongside `userId`.

- [ ] **Step 2: Update `src/server.js` startup**

Replace `startSync();` in `init()` with:
```js
async function init() {
  const users = db.prepare('SELECT id FROM users').all();
  for (const u of users) {
    classifyAllUnclassifiedForUser(u.id);
    startSyncForUser(u.id);
  }
}
```
Update imports at the top: `const { startSyncForUser, setBroadcast } = require('./imap');` and `const { classifyAllUnclassifiedForUser, setBroadcast: setClassifierBroadcast } = require('./classifier');` (after Task 12 renames these; for now, stub `classifyAllUnclassifiedForUser = (id) => classifier.classifyAllUnclassified()` so the file still runs).

- [ ] **Step 3: Update `src/routes/api.js`**

Replace any reference to `startSync()` / `stopSync()` / `getSyncMode()` with `startSyncForUser(req.user.id)` / `stopSyncForUser(req.user.id)` / `getSyncMode(req.user.id)`.

For `flagAsDeleted(uid, folder)` calls, change to `flagAsDeleted(req.user.id, uid, folder)`.

- [ ] **Step 4: Smoke — start server, confirm logged-in user has IMAP sync attempting**

```bash
taskkill //F //IM node.exe 2>&1 | head -1 || true
node src/server.js >/tmp/srv.log 2>&1 &
sleep 3
grep "IMAP startup error\|connecting\|idle" /tmp/srv.log | head -3
taskkill //F //IM node.exe 2>&1 | head -1
```
Expected: sync activity for the grandfathered user is visible in the log.

- [ ] **Step 5: Verify all tests pass**

```bash
npm test 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/imap.js src/server.js src/routes/api.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: per-user IMAP sync state"
```

---

## Task 12: Per-user classifier queue

**Files:**
- Modify: `src/classifier.js`
- Modify: `src/imap.js` — update `queueClassification` call sites (done in Task 11)
- Modify: `src/server.js` — use `classifyAllUnclassifiedForUser`

- [ ] **Step 1: Refactor `src/classifier.js`**

Replace the module-level `classificationQueue` and `processing` with per-user:
```js
const { db, getConfig } = require('./db');
const llm = require('./llm');

let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }

// Per-user queue state
const queues = new Map(); // userId -> { queue: [], processing: false }
function q(userId) {
  let s = queues.get(userId);
  if (!s) { s = { queue: [], processing: false }; queues.set(userId, s); }
  return s;
}

// ─── Tier 1 rules: unchanged ──────────────────────────────────────────────
// (keep existing rulesClassify / rulesExtractedData / rulesUrgency / fallbackClassification)

async function classifyEmail(userId, emailId) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(emailId, userId);
  if (!email) return;

  const existing = db.prepare('SELECT id FROM classifications WHERE email_id = ? AND user_id = ?').get(emailId, userId);
  if (existing) return;

  const rulesCategory = rulesClassify(email);
  if (rulesCategory) {
    const { urgency, urgency_reason } = rulesUrgency(rulesCategory, email);
    const extracted = rulesExtractedData(rulesCategory, email);
    const sub = email.subject || '';
    const summary = `${email.from_name || email.from_address} sent: ${sub.substring(0, 80)}${sub.length > 80 ? '...' : ''}.`;
    storeClassification(userId, emailId, {
      category: rulesCategory, urgency, urgency_reason, summary,
      extracted_data: extracted, suggested_tone: 'professional', draft_reply: null
    });
    return;
  }

  const routed = await llm.router.classify(email, { mode: 'full', userId });
  if (routed) {
    storeClassification(userId, emailId, {
      category: routed.category, urgency: routed.urgency,
      urgency_reason: routed.urgency_reason, summary: routed.summary,
      extracted_data: routed.extracted_data || {},
      suggested_tone: routed.suggested_tone || 'professional',
      draft_reply: routed.draft_reply || null
    });
    return;
  }
  storeClassification(userId, emailId, fallbackClassification());
}

function storeClassification(userId, emailId, data) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO classifications
      (user_id, email_id, category, urgency, urgency_reason, summary, extracted_data, draft_reply, suggested_tone)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      userId, emailId, data.category, data.urgency, data.urgency_reason, data.summary,
      typeof data.extracted_data === 'string' ? data.extracted_data : JSON.stringify(data.extracted_data || {}),
      data.draft_reply || null, data.suggested_tone
    );
    broadcast('classification_done', { user_id: userId, email_id: emailId, category: data.category, urgency: data.urgency });
    const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(emailId, userId);
    const existing = db.prepare('SELECT id FROM drafts WHERE email_id = ? AND user_id = ?').get(emailId, userId);
    if (!existing && email && !['fyi', 'other'].includes(data.category)) {
      db.prepare('INSERT INTO drafts (user_id, email_id, body, tone, subject, to_address) VALUES (?,?,?,?,?,?)')
        .run(userId, emailId, '', data.suggested_tone || 'professional', 'Re: ' + email.subject, email.from_address);
    }
  } catch {}
}

async function processQueueFor(userId) {
  const s = q(userId);
  if (s.processing || s.queue.length === 0) return;
  s.processing = true;
  try {
    while (s.queue.length > 0) {
      const batch = s.queue.splice(0, 5);
      await Promise.all(batch.map(id => classifyEmail(userId, id)));
    }
  } finally { s.processing = false; }
}

function queueClassification(userId, emailId) {
  const s = q(userId);
  if (!s.queue.includes(emailId)) s.queue.push(emailId);
  setImmediate(() => processQueueFor(userId));
}

async function classifyAllUnclassifiedForUser(userId) {
  const rows = db.prepare(`
    SELECT e.id FROM emails e
    LEFT JOIN classifications c ON c.email_id = e.id AND c.user_id = e.user_id
    WHERE c.id IS NULL AND e.user_id = ?
  `).all(userId);
  for (const row of rows) queueClassification(userId, row.id);
}

async function generateDraft(userId, emailId) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(emailId, userId);
  if (!email) return null;
  const routed = await llm.router.classify(email, { mode: 'regen', userId });
  return routed?.draft_reply || 'Thank you for your email. I will review and respond shortly.';
}

module.exports = {
  queueClassification, classifyAllUnclassifiedForUser, classifyEmail,
  generateDraft, setBroadcast
};
```

- [ ] **Step 2: Update the regen route in `src/routes/api.js`**

Anywhere `llm.router.classify(email, { mode: 'regen', tone })` appears, add `userId: req.user.id`. Same for `mode: 'full'`.

- [ ] **Step 3: Run tests**

```bash
npm test 2>&1 | tail -5
```
(Router tests will still use fake providers that ignore `userId`.)

- [ ] **Step 4: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/classifier.js src/routes/api.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: per-user classifier queue + scoped classifyEmail"
```

---

## Task 13: Per-user LLM router config

**Files:**
- Modify: `src/llm/config.js`
- Modify: `src/llm/router.js`
- Modify: `src/llm/index.js`

- [ ] **Step 1: Update `resolveConfig(userId)` signature**

In `src/llm/config.js`, change `resolveConfig()` to `resolveConfig(userId)`:
```js
function resolveConfig(userId) {
  const row = userId != null
    ? db.prepare('SELECT * FROM account_config WHERE user_id = ?').get(userId)
    : db.prepare('SELECT * FROM account_config ORDER BY id LIMIT 1').get();
  const r = row || {};
  // ... rest unchanged (orderRaw, enabledRaw, keys, models, limits, enabledFiltered)
}
```

And `saveProviderConfig(upd)` takes `userId` as first arg:
```js
function saveProviderConfig(userId, upd) {
  const existing = db.prepare('SELECT id FROM account_config WHERE user_id = ?').get(userId);
  if (!existing) {
    db.prepare('INSERT INTO account_config (user_id) VALUES (?)').run(userId);
  }
  // ... rest unchanged, replace `WHERE id = 1` with `WHERE user_id = ?` and append userId param
}
```

- [ ] **Step 2: Update `src/llm/router.js` — per-user buckets/breakers**

Replace module-level `buckets` / `breakers` Map with per-user maps keyed by `userId+name`:
```js
function createRouter({ providers, getConfig, logger, usage }) {
  const byName = new Map(providers.map(p => [p.name, p]));
  const log = logger || (() => {});
  const usageApi = usage || require('./usage');

  // Keyed by `${userId}::${providerName}`
  const buckets = new Map();
  const breakers = new Map();

  const BREAKER_OPEN_MS = 5 * 60 * 1000;
  const BREAKER_FAILS = 3;

  function bucketKey(userId, name) { return `${userId ?? 'global'}::${name}`; }
  function getBucket(userId, provider) {
    const k = bucketKey(userId, provider.name);
    if (!buckets.has(k)) {
      const cfg = getConfig(userId) || {};
      const userLim = (cfg.limits || {})[provider.name] || {};
      const rpm = (typeof userLim.rpm === 'number' && userLim.rpm > 0) ? userLim.rpm : provider.limits.rpm;
      buckets.set(k, new TokenBucket({ rpm }));
    }
    return buckets.get(k);
  }
  function getBreaker(userId, name) {
    const k = bucketKey(userId, name);
    if (!breakers.has(k)) breakers.set(k, { fails: 0, openedAt: 0 });
    return breakers.get(k);
  }
  function breakerOpen(userId, name) {
    const b = getBreaker(userId, name);
    if (b._sessionDisabled) return true;
    if (!b.openedAt) return false;
    if (Date.now() - b.openedAt >= BREAKER_OPEN_MS) { b.openedAt = 0; return false; }
    return true;
  }

  async function classify(email, opts = {}) {
    const userId = opts.userId;
    const cfg = getConfig(userId) || { order: [], enabled: [], keys: {}, models: {}, limits: {} };
    const enabledSet = new Set(cfg.enabled || []);
    const order = (cfg.order || []).filter(n => enabledSet.has(n) && byName.has(n));

    for (const name of order) {
      const provider = byName.get(name);
      const providerCfg = {
        apiKey: (cfg.keys || {})[name],
        model:  (cfg.models || {})[name] || provider.defaultModel
      };

      if (breakerOpen(userId, name)) { log({ provider: name, mode: opts.mode, outcome: 'skipped_breaker', email_id: email.id, user_id: userId }); continue; }

      const cfgLim = cfg.limits && cfg.limits[name];
      const effectiveRpd = (cfgLim && typeof cfgLim.rpd === 'number' && cfgLim.rpd > 0) ? cfgLim.rpd : provider.limits.rpd;
      if (Number.isFinite(effectiveRpd) && usageApi.getCount(userId, name) >= effectiveRpd) {
        log({ provider: name, mode: opts.mode, outcome: 'skipped_quota', email_id: email.id, user_id: userId });
        continue;
      }

      const maxWaitMs = opts.mode === 'regen' ? 2000 : 30000;
      const got = await getBucket(userId, provider).acquire(maxWaitMs);
      if (!got) { log({ provider: name, mode: opts.mode, outcome: 'skipped_bucket', email_id: email.id, user_id: userId }); continue; }

      const start = Date.now();
      try {
        const raw = await provider.call(email, opts, providerCfg);
        const parsed = typeof raw === 'string'
          ? parseProviderResponse(raw)
          : { ...DEFAULTS, ...raw };
        try { usageApi.increment(userId, name); } catch {}
        getBreaker(userId, name).fails = 0;
        log({ provider: name, mode: opts.mode, outcome: 'success', latency_ms: Date.now() - start, email_id: email.id, user_id: userId });
        return { ...parsed, _provider: name };
      } catch (err) {
        const outcome = classifyError(err);
        log({ provider: name, mode: opts.mode, outcome, latency_ms: Date.now() - start, email_id: email.id, user_id: userId, err: err.message });
        const br = getBreaker(userId, name);
        if (outcome === 'http_401') { br.openedAt = Date.now(); br._sessionDisabled = true; }
        else if (outcome === 'http_429') { /* don't count */ }
        else { br.fails += 1; if (br.fails >= BREAKER_FAILS) { br.openedAt = Date.now(); br.fails = 0; } }
        continue;
      }
    }
    return null;
  }

  // classifyError unchanged
  return { classify, _byName: byName };
}
```

Also update `usageApi` signature — `getCount(userId, provider)` and `increment(userId, provider)` in `src/llm/usage.js`:
```js
function getCount(userId, provider, day = today()) {
  const row = db.prepare('SELECT request_count FROM provider_usage WHERE user_id = ? AND provider=? AND day=?').get(userId, provider, day);
  return row ? row.request_count : 0;
}
function increment(userId, provider) {
  const day = today();
  db.prepare(`INSERT INTO provider_usage (user_id, provider, day, request_count)
              VALUES (?, ?, ?, 1)
              ON CONFLICT(user_id, provider, day) DO UPDATE SET request_count = request_count + 1`).run(userId, provider, day);
}
function todaySummary(userId) {
  const rows = db.prepare('SELECT provider, request_count FROM provider_usage WHERE user_id = ? AND day=?').all(userId, today());
  const out = {};
  for (const r of rows) out[r.provider] = r.request_count;
  return out;
}
```

And `/api/providers/usage` in `src/routes/api.js` becomes `todaySummary(req.user.id)`.

- [ ] **Step 3: Update existing router tests**

`tests/llm/router.test.js` — all calls to `createRouter` that pass `getConfig: () => ({...})` now need to ignore the userId arg (the function signature accepts it but plenty of tests don't care). Existing tests pass `getConfig: () => ({...})` which already matches — the signature `(userId) => cfg` just ignores its arg. Similarly, existing usage-mock tests:
```js
const usage = { getCount: () => 0, increment: () => {} };
```
still work because the new signature accepts any number of args.

One test to update — the one that asserts quota skip: change mock to `getCount: (uid, n) => n === 'a' ? 5 : 0`.

- [ ] **Step 4: Run, verify pass**

```bash
npm test 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add src/llm/config.js src/llm/router.js src/llm/usage.js src/llm/index.js src/routes/api.js tests/llm/router.test.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: per-user LLM config, buckets, breakers, quota"
```

---

## Task 14: `/login` page

**Files:**
- Create: `views/login.html`
- Modify: `src/routes/pages.js`

- [ ] **Step 1: Create `views/login.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IntelliMail — Log in</title>
  <script>
  (function () {
    const token = localStorage.getItem('intellimail_token');
    if (token) { location.href = '/dashboard'; }
  })();
  </script>
  <script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="/css/app.css">
  <style>
    body { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:0; margin:0; overflow:auto; }
    .login-card { max-width:420px; width:92%; padding:32px 28px; background:var(--bg-raised); border:1px solid var(--border); border-radius:12px; }
  </style>
</head>
<body>
<div class="login-card" x-data="loginApp()">
  <h1 style="font-family:'Syne',sans-serif;font-size:24px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">IntelliMail</h1>
  <p style="font-size:13px;color:var(--text-muted);margin-bottom:24px;">Log in with your email and password</p>

  <form @submit.prevent="doLogin()">
    <div class="form-field">
      <label>Email</label>
      <input type="email" x-model="email" required autofocus>
    </div>
    <div class="form-field" style="position:relative;">
      <label>Password</label>
      <input :type="showPassword?'text':'password'" x-model="password" required>
      <button @click.prevent="showPassword=!showPassword" type="button"
              style="position:absolute;right:10px;bottom:8px;background:none;border:none;color:var(--text-muted);cursor:pointer;">
        <span x-text="showPassword?'🙈':'👁'"></span>
      </button>
    </div>
    <div x-show="error" style="color:var(--accent-red);font-size:12px;margin-bottom:12px;" x-text="error"></div>
    <button class="action-btn btn-primary" style="width:100%;" :disabled="loading">
      <span x-show="!loading">Log in</span>
      <span x-show="loading">Logging in...</span>
    </button>
  </form>

  <div style="text-align:center;margin-top:20px;font-size:13px;color:var(--text-muted);">
    No account? <a href="/setup" style="color:var(--accent-cyan);">Sign up</a>
  </div>
</div>
<script>
function loginApp() {
  return {
    email: '', password: '', error: '', loading: false, showPassword: false,
    async doLogin() {
      this.loading = true; this.error = '';
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: this.email, password: this.password })
        });
        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('intellimail_token', data.token);
          location.href = '/dashboard';
        } else {
          this.error = data.error === 'invalid_credentials' ? 'Email or password incorrect.' : (data.error || 'Login failed');
        }
      } catch(e) {
        this.error = 'Network error';
      } finally {
        this.loading = false;
      }
    }
  };
}
</script>
</body>
</html>
```

- [ ] **Step 2: Add `/login` route to `src/routes/pages.js`**

Replace the contents:
```js
const express = require('express');
const path = require('path');
const router = express.Router();
const views = path.join(__dirname, '..', '..', 'views');

// Root: serve a tiny HTML shell that redirects client-side based on token + user count
router.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html><script>
  (function(){
    const t = localStorage.getItem('intellimail_token');
    if (t) { location.href = '/dashboard'; return; }
    fetch('/api/users/any').then(r => r.json()).then(d => {
      location.href = d.any ? '/login' : '/setup';
    }).catch(() => { location.href = '/setup'; });
  })();
  </script>`);
});

router.get('/login',     (req, res) => res.sendFile(path.join(views, 'login.html')));
router.get('/setup',     (req, res) => res.sendFile(path.join(views, 'setup.html')));
router.get('/dashboard', (req, res) => res.sendFile(path.join(views, 'dashboard.html')));
router.get('/settings',  (req, res) => res.sendFile(path.join(views, 'settings.html')));

module.exports = router;
```

- [ ] **Step 3: Smoke test**

```bash
taskkill //F //IM node.exe 2>&1 | head -1 || true
node src/server.js >/tmp/srv.log 2>&1 &
sleep 2
curl -s -o /dev/null -w "GET /login -> %{http_code}\n" http://localhost:3000/login
curl -s -o /dev/null -w "GET / -> %{http_code}\n" http://localhost:3000/
taskkill //F //IM node.exe 2>&1 | head -1
```
Expected: both 200.

- [ ] **Step 4: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add views/login.html src/routes/pages.js
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: /login page + client-side root redirect"
```

---

## Task 15: Client auth plumbing (`authFetch`, HTMX hook, 401 handler, redirect snippets)

**Files:**
- Modify: `public/js/app.js`
- Modify: `views/dashboard.html`, `views/settings.html`, `views/setup.html`

- [ ] **Step 1: Add `authFetch` + HTMX hook + redirect-on-401 to `public/js/app.js`**

At the very top of `public/js/app.js`:
```js
function authFetch(url, opts = {}) {
  const token = localStorage.getItem('intellimail_token');
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const promise = fetch(url, { ...opts, headers });
  promise.then(r => {
    if (r.status === 401 && !url.startsWith('/api/auth/')) {
      localStorage.removeItem('intellimail_token');
      location.href = '/login';
    }
  }).catch(() => {});
  return promise;
}

// HTMX: attach Authorization header on every request
document.addEventListener('DOMContentLoaded', () => {
  if (document.body) {
    document.body.addEventListener('htmx:configRequest', (evt) => {
      const token = localStorage.getItem('intellimail_token');
      if (token) evt.detail.headers['Authorization'] = 'Bearer ' + token;
    });
    document.body.addEventListener('htmx:responseError', (evt) => {
      if (evt.detail.xhr.status === 401) {
        localStorage.removeItem('intellimail_token');
        location.href = '/login';
      }
    });
  }
});
```

- [ ] **Step 2: Replace every `fetch(` with `authFetch(` in `public/js/app.js`**

Search-and-replace `fetch(` → `authFetch(` in `public/js/app.js`. Leave any `fetch(` inside the `authFetch` definition itself. Do a `grep -n "fetch(" public/js/app.js` afterwards to confirm only one remains (the one inside `authFetch`).

- [ ] **Step 3: Replace every `fetch(` with `authFetch(` in the view files that use it**

```bash
grep -rn "fetch(" /c/mywork/xgen-intel/views/ | head -20
```
Update `dashboard.html`, `settings.html`, `setup.html`. Leave the `fetch('/api/users/any')` in `pages.js` root redirect alone (pre-login, no token yet) and the `fetch('/api/auth/login')` in `views/login.html` (no token yet).

For `views/setup.html`, the call that submits the wizard should target `/api/auth/signup` (change from whatever it targets today — likely `/api/account/save`) and on success store the token:
```js
const data = await res.json();
if (res.ok) {
  localStorage.setItem('intellimail_token', data.token);
  location.href = '/dashboard';
} else if (res.status === 409) {
  this.error = 'An account with this email already exists. Log in instead.';
} else if (res.status === 400 && data.error === 'imap_failed') {
  this.error = 'IMAP test failed: ' + (data.detail || 'check host/port/password');
}
```

- [ ] **Step 4: Inject the redirect snippet into each protected page's `<head>`**

In `views/dashboard.html` and `views/settings.html`, add this AS THE FIRST `<script>` inside `<head>`:
```html
<script>
(function () {
  const token = localStorage.getItem('intellimail_token');
  if (!token) {
    fetch('/api/users/any').then(r => r.json()).then(d => {
      location.href = d.any ? '/login' : '/setup';
    }).catch(() => { location.href = '/login'; });
  }
})();
</script>
```

- [ ] **Step 5: Smoke**

```bash
taskkill //F //IM node.exe 2>&1 | head -1 || true
node src/server.js >/tmp/srv.log 2>&1 &
sleep 2
# With no token: dashboard should render shell then JS bounces to login
curl -s http://localhost:3000/dashboard | grep -o "intellimail_token" | head -1
# /api/stats without token → 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/stats
taskkill //F //IM node.exe 2>&1 | head -1
```
Expected: first line prints `intellimail_token`; second prints `401`.

- [ ] **Step 6: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add public/js/app.js views/dashboard.html views/settings.html views/setup.html
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: authFetch, HTMX auth hook, page redirect snippets"
```

---

## Task 16: Logout button in Settings

**Files:**
- Modify: `views/settings.html`

- [ ] **Step 1: Add logout button near the "Save Settings" row**

In `views/settings.html`, above the existing `<a href="/dashboard" ...>← Dashboard</a>` button, add:
```html
<button class="action-btn btn-ghost" @click="logout()" style="font-size:12px;">🚪 Log out</button>
```

Add the method inside `settingsApp()`:
```js
logout() {
  localStorage.removeItem('intellimail_token');
  location.href = '/login';
},
```

- [ ] **Step 2: Smoke**

Open `/settings` with a valid token → click "Log out" → should redirect to `/login`; DevTools → Application → Local Storage should show the token cleared.

- [ ] **Step 3: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add views/settings.html
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: Log out button in Settings"
```

---

## Task 17: Manual end-to-end smoke

**Files:**
- Create: `docs/superpowers/plans/2026-04-21-multi-user-auth-smoke.md`

- [ ] **Step 1: Run through the scenarios below and record results**

1. **Existing user login.** Open fresh browser → `/` → should redirect to `/login` (grandfather user exists). Log in with `manvendra.s@xgenplus.com` + IMAP password → `/dashboard`, your 300 emails visible.
2. **New user registration.** Open incognito → `/` → `/login`. Click "Sign up" → `/setup` wizard. Enter a different email + IMAP creds. On step 4, signup should succeed only if IMAP test passes, a new `users` row is created, and you land on `/dashboard` with an empty mailbox.
3. **Cross-user isolation.** In user 2's session, try to URL-tamper to `/api/emails/<id>` using one of user 1's email IDs → should get HTTP 404.
4. **Settings are per-user.** In user 2's Settings, the Groq/Gemini keys fields are empty (not shared with user 1). Enter distinct keys; user 2's usage counter increments independently.
5. **Logout.** Click Log out in Settings → land on `/login`. localStorage token cleared.
6. **Invalid token recovery.** While on `/dashboard`, open DevTools and set `intellimail_token` to `bad`. Trigger any API call (e.g. reload sidebar). Page bounces back to `/login`.
7. **Signup with IMAP failure.** Try to sign up a third user with a wrong IMAP password → form shows "IMAP test failed: …" and no user row is created (verify via `sqlite3` + `SELECT COUNT(*) FROM users`).
8. **Duplicate email.** Try to sign up with an existing user's email → form shows "An account with this email already exists. Log in instead."

- [ ] **Step 2: Record observed vs. expected in a new file**

```markdown
# Multi-User Auth — Smoke Test Results (YYYY-MM-DD)

| # | Scenario | Expected | Observed | Pass |
|---|---|---|---|---|
| 1 | Existing user login | dashboard loads, 300 emails | <fill in> | ☐ |
| 2 | New user registration | empty dashboard, users table has 2 rows | <fill in> | ☐ |
| 3 | Cross-user email access | 404 | <fill in> | ☐ |
| 4 | Per-user Settings | u2 settings empty | <fill in> | ☐ |
| 5 | Logout | redirects to /login, token cleared | <fill in> | ☐ |
| 6 | Invalid token | auto-redirect to /login | <fill in> | ☐ |
| 7 | Signup IMAP fail | 400 imap_failed, no user row | <fill in> | ☐ |
| 8 | Duplicate email | 409 email_exists inline message | <fill in> | ☐ |
```

- [ ] **Step 3: Run the full test suite one last time**

```bash
cd /c/mywork/xgen-intel
npm test 2>&1 | tail -5
```
Expected: all existing + all new tests pass. Total ≥ 56.

- [ ] **Step 4: Commit**

```bash
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" add docs/superpowers/plans/2026-04-21-multi-user-auth-smoke.md
git -c user.email="office@myxgen.com" -c user.name="xgen-intel-local" commit -m "checkpoint: multi-user auth smoke-test results"
```

---

## Self-review notes

- **Spec coverage:**
  - F1 (open signup via `/setup`) → Task 7, Task 15 step 3.
  - F2 (IMAP test gates signup) → Task 7.
  - F3 (login with email + IMAP password) → Task 8.
  - F4 (JWT in localStorage, HTMX hook) → Task 15.
  - F5 (all API queries scoped by user_id) → Task 10.
  - F6 (client-side root redirect) → Task 14 step 2.
  - F7 (logout drops token client-side) → Task 16.
  - F8 (per-user IMAP + classifier) → Tasks 11, 12.
  - F9 (grandfather migration) → Task 5.
  - N1 (one new dep `jsonwebtoken`) → Task 1.
  - N2 (persisted secret) → Task 2.
  - N3 (7-day exp) → Task 2.
  - N4 (existing tests keep passing) → checked at every `npm test` step.
  - N5 (existing user inherits state transparently) → Tasks 5 + 10 + 11 verifying manvendra.s@ still sees the 300 emails.

- **Placeholder scan:** No `TBD` / `implement later`; every step has either a file path + code or a shell command.

- **Type consistency:** `resolveConfig(userId)`, `saveProviderConfig(userId, upd)`, `router.classify(email, {mode, tone, userId})`, `queueClassification(userId, emailId)`, `classifyEmail(userId, emailId)`, `generateDraft(userId, emailId)`, `startSyncForUser(userId)`, `stopSyncForUser(userId)`, `getSyncMode(userId)`, `setSyncMode(userId, mode)`, `usage.getCount(userId, provider)`, `usage.increment(userId, provider)`, `usage.todaySummary(userId)` — consistent across tasks.

- **Test DB isolation:** tests/auth/signup.test.js, login.test.js, scoping.test.js, migration.test.js all use `process.env.DB_PATH` to point at a temp file and clean up in `test.after`. `src/db.js` honors this via `const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'intellimail.db');` (added in Task 7 Step 1 pre-check).
