# Multi-User Authentication — Design

**Date:** 2026-04-21
**Status:** Approved for implementation planning
**Scope:** Add multi-user registration and login to IntelliMail. Each user gets their own mailbox, classifications, drafts, provider keys, and IMAP sync. Login uses JWT in localStorage. The "app password" is the user's IMAP password (no separate credential to manage).

---

## 1. Motivation

Today IntelliMail is a single-user self-hosted app. `account_config.id = 1` is hardcoded; every email, draft, classification, and provider usage row implicitly belongs to that single owner. The app has no login — anyone with network access to port 3000 sees the mailbox.

The user wants to support multiple independent registered users on the same IntelliMail instance, each with their own email account, mailbox, classifications, and settings. Data must be strictly scoped per user. Login uses email + the IMAP password — no separate app password.

---

## 2. Requirements

### 2.1 Functional
- **F1.** Users register by going through the existing `/setup` wizard. Signup is open (anyone who can reach the server can register).
- **F2.** Signup requires a successful IMAP connection test — if IMAP doesn't authenticate, no user row is created. This doubles as email-ownership verification; no separate email-verify flow.
- **F3.** Login at `/login` takes email + password, returns a JWT in the response body. The password is compared against the stored IMAP password (plaintext, since the app also needs it for IMAP auth).
- **F4.** JWT stored in localStorage on the client. All `/api/*` requests carry `Authorization: Bearer <token>`; HTMX requests inject the header via a `htmx:configRequest` hook.
- **F5.** All existing routes (`/api/emails`, `/api/stats`, `/api/settings`, `/api/emails/:id/draft/regen`, etc.) scope every DB read and write by the authenticated user's id. Cross-user reads return 404.
- **F6.** `/` redirect is client-side based on localStorage: no token + any users exist → `/login`; no token + no users → `/setup`; token → `/dashboard`.
- **F7.** Logout is client-side: drop the token from localStorage and redirect to `/login`. No server-side session table to update.
- **F8.** IMAP sync and classifier queue become per-user: each user has their own IDLE connection, circuit breaker, and classification queue.
- **F9.** Grandfather migration: when a DB with the existing single `account_config.id = 1` row is first upgraded, the first user to register inherits all existing emails, classifications, drafts, sync_log rows, provider_usage, and the existing IMAP / provider config.

### 2.2 Non-functional
- **N1.** One new runtime dep: `jsonwebtoken`. Nothing else.
- **N2.** JWT secret auto-generated on first boot, persisted in `data/jwt.secret` (gitignored). Same secret across restarts so active tokens stay valid. Random 32-byte hex.
- **N3.** Token expiry: 7 days (fixed, no sliding extension). After expiry, client prompts re-login.
- **N4.** All existing 36 unit tests continue passing. Every new capability lands with TDD tests.
- **N5.** No behavior change for the existing user on their first login after migration: they see the same inbox, same classifications, same settings as before.

### 2.3 Out of scope
- Password reset (forgot-password flow). For a self-hosted personal/small-team tool, direct DB fix is fine.
- Email verification beyond "IMAP login succeeded".
- Rate limiting on login (brute-force protection). Deployable later via an Express middleware.
- Password complexity rules. The password is the IMAP password; whatever the mail provider requires is the effective policy.
- Admin / role system. Every user is equal.
- Account deletion from the UI. Also a direct-DB operation for now.
- Changing email (requires coordinated change with IMAP provider; out of scope).

---

## 3. Architecture

### 3.1 File layout changes

```
src/
  auth.js                # jwtSecret(), signToken(), verifyToken() — pure functions
  middleware/
    auth.js              # requireAuth Express middleware
  routes/
    auth.js              # POST /api/auth/signup, /api/auth/login, /api/auth/logout, GET /api/auth/check
    pages.js             # existing, adds GET /login
  llm/                   # unchanged (providers don't care about user)
  classifier.js          # queue + classifyEmail now take userId
  imap.js                # startSyncForUser, per-user Map of sync state
  db.js                  # schema additions + grandfather migration

views/
  login.html             # new — simple email+password form

public/
  js/app.js              # add authFetch() wrapper, HTMX auth hook, auth redirect snippet

tests/
  auth/
    jwt.test.js
    middleware.test.js
    signup.test.js
    login.test.js
  api/
    scoping.test.js
  migration.test.js

data/
  jwt.secret             # runtime-generated, gitignored
```

### 3.2 Data model

**New table:**
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Additive migrations to existing tables** (using the existing `try { db.exec('ALTER TABLE …'); } catch {}` pattern):
```sql
ALTER TABLE account_config  ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE emails          ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE classifications ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE drafts          ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE sync_log        ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE provider_usage  ADD COLUMN user_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_emails_user           ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_classifications_user  ON classifications(user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_user           ON drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_user         ON sync_log(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_usage_user   ON provider_usage(user_id, day);
```

**`account_config` identity change:** drops the implicit `WHERE id = 1`. Queries become `WHERE user_id = ?`. The `id` column stays as an autoincrement PK (one row per user).

**`provider_usage` primary key change:** the old PK `(provider, day)` becomes `(user_id, provider, day)`. SQLite can't `ALTER TABLE … MODIFY PK`, so the migration creates `provider_usage_new`, copies rows (with `user_id` filled from the grandfather user when migrating), drops the old, renames. Fresh installs just get the new shape.

**`meta` table (new):**
```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
```
Used to flag `multi_user_migrated=1` so the grandfather routine runs exactly once.

### 3.3 Grandfather migration

Runs in `src/db.js` on boot, after schema migrations, conditional on `meta.multi_user_migrated` not being set:

1. If `SELECT COUNT(*) FROM users` is 0 AND `SELECT * FROM account_config WHERE id = 1` exists:
   - Insert `users (email) VALUES (cfg.email)`, capture `user_id`.
   - `UPDATE account_config SET user_id = ? WHERE id = 1`.
   - `UPDATE emails SET user_id = ? WHERE user_id IS NULL`.
   - Same for `classifications`, `drafts`, `sync_log`.
   - For `provider_usage`: recreate with composite PK, copy all rows with `user_id = ?`.
2. Insert `meta (key, value) VALUES ('multi_user_migrated', '1')`.

If `users` is already populated or `account_config` doesn't have id=1, the migration is a no-op.

---

## 4. Auth flow

### 4.1 JWT (`src/auth.js`)

```js
function jwtSecret() {
  const path = 'data/jwt.secret';
  try { return fs.readFileSync(path, 'utf8').trim(); }
  catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync(path, s, { mode: 0o600 });
    return s;
  }
}

function signToken(userId, email) {
  return jwt.sign({ userId, email }, jwtSecret(), { expiresIn: '7d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, jwtSecret()); }
  catch { return null; }
}
```

### 4.2 Middleware (`src/middleware/auth.js`)

```js
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = { id: payload.userId, email: payload.email };
  next();
}
```

Mounted on `/api/*` except the public endpoints: `/api/auth/signup`, `/api/auth/login`, `/api/auth/check`, `/api/auth/logout`, `/api/users/any`, and `/api/account/test-imap`/`test-smtp` (used during signup before any user exists). Page routes stay unauthenticated — they serve static HTML; the client-side redirect snippet in §5.3 is what guards protected pages.

### 4.3 Signup (`POST /api/auth/signup`)

Body: same fields the existing `/setup` wizard posts to `/api/account/save`:
`{ email, password, imap_host, imap_port, imap_tls, smtp_host, smtp_port, smtp_tls, display_name, sync_interval }`.

Flow:
1. Validate required fields; 400 on missing.
2. `SELECT id FROM users WHERE email = ?` — if exists → `409 {error: 'email_exists'}`.
3. Run `testImap(cfg)` from `src/imap.js`. If it rejects → `400 {error: 'imap_failed', detail: <msg>}`, no DB write.
4. `INSERT INTO users (email) VALUES (?)` → `user_id`.
5. `INSERT INTO account_config (user_id, email, password, imap_host, ...) VALUES (...)`.
6. Call `startSyncForUser(user_id)` (async, doesn't block the response).
7. Return `{ token: signToken(user_id, email), user: { id: user_id, email } }`.

### 4.4 Login (`POST /api/auth/login`)

Body: `{ email, password }`.

Flow:
1. `SELECT users.id, account_config.password FROM users JOIN account_config ON account_config.user_id = users.id WHERE users.email = ?`.
2. If no row OR `row.password !== req.body.password` → `401 {error: 'invalid_credentials'}`.
3. Return `{ token: signToken(row.id, email), user: { id: row.id, email } }`.

**Plaintext comparison.** The IMAP password is already stored plaintext in `account_config.password` (required for IMAP auth). Hashing it for login verification would create a second credential and defeat the "one password" design goal. The threat model assumes any DB read is equivalent to full account compromise anyway.

### 4.5 Logout (`POST /api/auth/logout`)

No server side effect (JWT is stateless). Returns `{ok: true}`. The client is expected to delete `intellimail_token` from localStorage regardless.

### 4.6 Token check (`GET /api/auth/check`)

Returns `{ok: true, user}` if the Authorization header carries a valid token, else `401`. Used by the client on page load to confirm the token is still valid before redirecting to `/dashboard`.

### 4.7 `GET /api/users/any` (public)

Returns `{any: true|false}`. Used by the client-side redirect snippet to decide login-vs-setup. Public, no auth needed.

---

## 5. Client-side changes

### 5.1 `authFetch` wrapper (`public/js/app.js`)

```js
function authFetch(url, opts = {}) {
  const token = localStorage.getItem('intellimail_token');
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const p = fetch(url, { ...opts, headers });
  // Global 401 handler: drop token, redirect
  p.then(r => {
    if (r.status === 401 && !url.includes('/api/auth/')) {
      localStorage.removeItem('intellimail_token');
      location.href = '/login';
    }
  });
  return p;
}
```

Every existing `fetch('/api/...')` in the codebase (`public/js/app.js`, `views/*.html`) gets replaced with `authFetch(...)`. Search+replace.

### 5.2 HTMX auth hook (`public/js/app.js`)

```js
document.body.addEventListener('htmx:configRequest', evt => {
  const token = localStorage.getItem('intellimail_token');
  if (token) evt.detail.headers['Authorization'] = 'Bearer ' + token;
});
```

And an `htmx:responseError` handler that redirects to `/login` on 401.

### 5.3 Redirect snippet (injected at the top of every page's `<head>`)

```html
<script>
(function () {
  const token = localStorage.getItem('intellimail_token');
  const path  = location.pathname;
  const publicPaths = ['/login', '/setup'];
  if (!token && !publicPaths.includes(path)) {
    fetch('/api/users/any').then(r => r.json()).then(d => {
      location.href = d.any ? '/login' : '/setup';
    });
    return;
  }
  if (token && publicPaths.includes(path)) {
    location.href = '/dashboard';
  }
})();
</script>
```

Same snippet on `dashboard.html`, `settings.html`, `setup.html`, `login.html`. Runs before any other JS so the user never sees flash-of-protected-content.

### 5.4 `/login` page (`views/login.html`)

Minimal Alpine component:

```
┌ Welcome back ────────────────┐
│ Email    [________________]  │
│ Password [________________] 👁│
│ [ Log in ]                    │
│                               │
│ Don't have an account?        │
│ → Sign up / run setup         │
└───────────────────────────────┘
```

On submit: POST `/api/auth/login` → on success, `localStorage.setItem('intellimail_token', token)` and `location.href = '/dashboard'`. On 401, show inline red error under the form.

### 5.5 `/setup` wizard updates

The existing 4-step wizard stays almost identical. Changes:
- Final step posts to `/api/auth/signup` instead of `/api/account/save`.
- On success, stores JWT and redirects to `/dashboard`.
- A new "Already have an account? Log in →" link at the top of step 1.
- Step 4 error handling: if signup returns `409 email_exists`, show "That email is already registered — click Log in instead".

### 5.6 Logout button

Added to Settings (top-right of the Settings page header):
```html
<button @click="logout()">Log out</button>
```
Where `logout()` = `localStorage.removeItem('intellimail_token'); location.href = '/login';`.

---

## 6. Per-user runtime state

### 6.1 IMAP sync

Today `src/imap.js` maintains process-wide state: `currentClient`, `syncMode`, `cronJob`, `recoveryInterval`, etc. That becomes a `Map<userId, SyncState>` indexed by user.

Public API changes:
- `startSync()` → `startSyncForUser(userId)`.
- `stopSync()` → `stopSyncForUser(userId)`.
- `getSyncMode()` → `getSyncMode(userId)`.
- `setSyncMode(userId, mode)`.
- `testImap(cfg)` — unchanged, it's a pure function that takes a cfg object.

On server boot:
```js
const rows = db.prepare('SELECT id FROM users').all();
for (const { id } of rows) startSyncForUser(id);
```

On signup, after creating the user: `startSyncForUser(newUserId)`.

Login does NOT restart sync — sync is persistent across logins.

### 6.2 Classifier queue

`classifier.js` queue becomes `Map<userId, Queue>`. `queueClassification(emailId)` becomes `queueClassification(userId, emailId)`. `classifyAllUnclassified()` becomes `classifyAllUnclassifiedForUser(userId)` called for each user on boot.

Each call to `classifyEmail(userId, emailId)` loads the email with `WHERE id = ? AND user_id = ?` to enforce scope.

### 6.3 LLM router

The router singleton is unchanged — providers don't care about users. But `resolveConfig()` in `src/llm/config.js` needs to take a `userId` now, and look up config from the user's `account_config` row rather than `id = 1`. Router is re-created per user? No — simpler: router stays global, but each call to `router.classify(email, opts)` passes `opts.userId`, and the router uses that to resolve per-user config (keys, limits, provider order).

Practical change:
- `router.classify(email, opts)` → `router.classify(email, { mode, tone, userId })`.
- `getConfig()` hook becomes `getConfig(userId)`.
- Buckets and breakers in the router become `Map<userId+provider, state>` instead of `Map<provider, state>`.
- `reload()` still works but now clears all user states.

---

## 7. Route-by-route changes

Every `/api/*` route gets `requireAuth` middleware and filters by `req.user.id`. Complete list:

| Route | Change |
|---|---|
| `GET /api/stats` | All 4 queries get `AND user_id = ?` |
| `GET /api/sync/status` | Uses `getSyncMode(req.user.id)` |
| `POST /api/sync/now` | Calls `startSyncForUser(req.user.id)` |
| `GET /api/emails` | `WHERE user_id = ?` on the main query |
| `GET /api/emails/:id` | `WHERE id = ? AND user_id = ?` — 404 if not owner |
| `POST /api/emails/:id/read` etc. | Same ownership check before UPDATE |
| `POST /api/emails/:id/draft/save` | Ownership check |
| `POST /api/emails/:id/draft/send` | Ownership check; uses user's SMTP |
| `POST /api/emails/:id/draft/regen` | Router called with `userId`; ownership check |
| `GET /api/emails/:id/ical` | Ownership check |
| `GET /api/settings` | Reads user's `account_config` |
| `POST /api/settings/save` | Writes user's `account_config`; calls `llm.reload()` to rebuild router for that user |
| `POST /api/providers/:name/test` | Uses the logged-in user's keys |
| `GET /api/providers/usage` | Filters `provider_usage` by user_id |
| `POST /api/account/save` | **Removed** — superseded by `/api/auth/signup` |
| `POST /api/account/test-imap` etc. | Stay; used during signup to test before user exists (public). These take config from query params so no user context needed. |
| `POST /api/account/logout` | **Removed** — JWT logout is client-side |
| `POST /api/account/reset` | Becomes "delete my account": removes user's rows; keeps other users |
| `GET /api/sidebar` | Scoped by user_id |

---

## 8. Error handling & UX

| Scenario | Server | Client |
|---|---|---|
| Signup email exists | `409 {error: 'email_exists'}` | Inline: "Already registered. [Log in →]" |
| Signup IMAP fails | `400 {error: 'imap_failed', detail}` | Wizard stays open, red banner at step 4 showing the detail |
| Login unknown email OR wrong password | `401 {error: 'invalid_credentials'}` | Inline: "Email or password incorrect." |
| Any `/api/*` without token | `401 {error: 'unauthorized'}` | `authFetch` redirects to `/login` |
| Expired / tampered JWT | `401 {error: 'unauthorized'}` | Same — drop token, redirect |
| Accessing another user's resource | `404 {error: 'not_found'}` | Normal "not found" UX |
| 500s from DB / unexpected | `500 {error: <msg>}` | Red toast |

Password never logged. Tokens never logged. `detail` on `imap_failed` may contain server messages; safe because the user is the one who just typed the password.

---

## 9. Testing

### 9.1 Unit tests

`tests/auth/jwt.test.js`:
- `signToken` + `verifyToken` roundtrip returns `{userId, email}`.
- Tampered token → `verifyToken` returns null.
- Expired token (`expiresIn: '-1s'`) → null.
- `jwtSecret()` creates `data/jwt.secret` if missing; reads existing if present.

`tests/auth/middleware.test.js`:
- `requireAuth` with valid Bearer → `req.user` populated, `next()` called.
- No header → 401.
- Malformed header → 401.
- Expired token → 401.
- Tampered token → 401.

`tests/auth/signup.test.js` (uses in-memory or temp DB + mocked `testImap`):
- Fresh DB, valid payload with mocked IMAP success → 200 + token; users table has 1 row; account_config.user_id set.
- Duplicate email → 409.
- Mocked IMAP failure → 400, no rows written.

`tests/auth/login.test.js`:
- Seeded user, correct password → 200 + token.
- Wrong password → 401.
- Unknown email → 401.

`tests/api/scoping.test.js`:
- Seed two users with different emails. Insert an email row under user 1.
- Request `/api/emails/<id>` with user 2's token → 404.
- Request with user 1's token → 200 + email data.

`tests/migration.test.js`:
- Start from a DB that has the legacy shape: `account_config` with id=1, 5 emails with no user_id, no users table.
- Run migration.
- Assert users has 1 row matching `account_config.email`, `account_config.user_id` set, all 5 emails have user_id set.
- Run migration a second time — assert no-op (no duplicate user).

### 9.2 Manual smoke checklist

1. Start with an existing `intellimail.db` (single-user data present) → first boot after migration → users table has 1 row, all data attached to it. Visit `/` → `/login`.
2. Log in with existing email + IMAP password → `/dashboard`, emails visible, classifications intact.
3. Open incognito window → `/` → `/login`. Register a second user with a different email. Wizard completes → `/dashboard`, empty mailbox.
4. Second user's Settings shows their own (empty) usage, their own keys.
5. Try to access first user's emails by ID in second user's session (manual URL tamper) → 404.
6. Log out of user 2 → `/` → `/login`. Token cleared from localStorage.
7. Log back in → `/dashboard`.
8. Manually set an invalid token in localStorage → next API call → automatic redirect to `/login`.

---

## 10. Implementation phases (rough ordering)

1. **Auth module** — `src/auth.js` + tests.
2. **Auth middleware** — `src/middleware/auth.js` + tests; mount on a no-op test route.
3. **Schema + migration** — `users` + ALTER TABLE + grandfather routine + tests.
4. **Signup + login routes** — `src/routes/auth.js`; updates to `/setup` wizard; new `/login` page.
5. **Client auth plumbing** — `authFetch`, HTMX hook, 401 redirect, redirect snippet on every page.
6. **Scope existing routes** — add `requireAuth` and `user_id` filters to `/api/emails`, `/api/stats`, `/api/settings`, `/api/emails/:id/*`, `/api/providers/*`, `/api/sync/*`, `/api/sidebar`.
7. **Per-user IMAP sync** — `startSyncForUser`, `stopSyncForUser`, per-user state map.
8. **Per-user classifier** — queue map, `queueClassification(userId, emailId)`, etc.
9. **Per-user router config** — `resolveConfig(userId)`, router `bucket`/`breaker` maps keyed by `userId+provider`.
10. **Cross-user access test** — integration test verifying 404 on cross-user access.
11. **Logout UX** — button in Settings.
12. **Manual smoke** — run the checklist above, record results.

---

## 11. Rollback & risk

- All schema changes are `ALTER TABLE ADD COLUMN` with defaults OR `CREATE TABLE IF NOT EXISTS`. No destructive migrations except the `provider_usage` PK rebuild, which copies rows first.
- If we roll back by reverting code, the new columns become unused dead weight but nothing breaks.
- Biggest risk: per-user IMAP sync refactor. The existing single-state module is used by multiple call sites; cleanly mapping to per-user requires changing `startSync` / `stopSync` / `setSyncMode` / `getSyncMode` signatures in one shot. Mitigation: TDD the change against a two-user fixture.
- Second-biggest risk: token invalidation after secret regeneration. Mitigation: `jwt.secret` is gitignored and persisted, so accidental deletion invalidates all sessions but they can just log in again.

---

## 12. Open points (none blocking)
- Rate limiting on `/api/auth/login` (brute-force protection) — deferrable; self-hosted install rarely faces this.
- Sliding session extension — current spec is fixed 7-day. If users complain about being logged out mid-week, switch to a `renewIfWithin24h` rule in `requireAuth`.
- Account deletion from UI — not included; delete from DB for now.
- UI to invite / list users — not included; single account management per user for now.
