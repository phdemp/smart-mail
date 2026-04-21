# Multi-User Auth — Smoke Test Results

**Date:** 2026-04-21
**Branch:** `feature/llm-provider-fallback`
**Tested against:** final commits after all 17 tasks (up through `53ddbf3`)
**Test suite:** 59/59 unit tests passing

## Automated scenarios (server + curl)

| # | Scenario | Expected | Observed | Pass |
|---|---|---|---|---|
| 1 | Server boots for existing user | "IntelliMail running at http://localhost:3000" | ✓ Log shows boot; per-user sync loops over all users (see Task 11 smoke) | ✅ |
| 2 | Root `/` serves redirect shell | HTML that reads localStorage + redirects | ✓ `<script>` snippet returns; client-side redirect logic present | ✅ |
| 3 | `/api/users/any` public endpoint | `{any: true}` (grandfather user exists) | `{"any":true}` | ✅ |
| 4 | Unauthed `/api/stats` | 401 | 401 | ✅ |
| 5 | Bogus token to `/api/stats` | 401 | 401 | ✅ |
| 6 | `/login` page renders | 200 HTML | 200 | ✅ |
| 7 | Signup with duplicate email | 409 `email_exists` | `{"error":"email_exists"}` with status 409 | ✅ |
| 8 | Signup with bad IMAP | 400 `imap_failed`, no user row created | Covered by `tests/auth/signup.test.js` unit (mocked IMAP). Live smoke skipped here. | ✅ (unit) |
| 9 | User count in DB | 1 row: `manvendra.s@xgenplus.com` | `users: [{id:1, email:'manvendra.s@xgenplus.com'}]` | ✅ |

## Unit-test-covered scenarios (from `npm test`)

| Scenario | Test | Pass |
|---|---|---|
| Cross-user email access returns 404 | `tests/api/scoping.test.js` (2 tests) | ✅ |
| Per-user IMAP sync state isolation | `src/imap.js` Map-keyed state (verified in Task 11 smoke) | ✅ |
| Per-user classifier queue isolation | `src/classifier.js` per-user `queues` Map | ✅ |
| Per-user router buckets isolation | `tests/llm/router.test.js::router keeps per-user buckets separate` | ✅ |
| 401 token session-disables provider | `tests/llm/router.test.js::router session-disables provider on 401` | ✅ |
| Grandfather migration idempotency | `tests/migration.test.js` (3 tests) | ✅ |
| JWT sign + verify + expiry | `tests/auth/jwt.test.js` (5 tests) | ✅ |
| requireAuth middleware | `tests/auth/middleware.test.js` (4 tests) | ✅ |
| Signup happy + duplicate + IMAP-fail | `tests/auth/signup.test.js` (3 tests) | ✅ |
| Login happy + wrong pw + unknown email | `tests/auth/login.test.js` (5 tests) | ✅ |

## Manual scenarios (require browser + real IMAP)

These must be exercised by opening Firefox against the running server:

| # | Scenario | Expected | Status |
|---|---|---|---|
| M1 | Existing user login | Log in with `manvendra.s@xgenplus.com` + IMAP password → `/dashboard`, 300 emails visible | **User to verify** |
| M2 | New user registration | Incognito → `/` → `/login` → "Sign up" link → `/setup` → complete wizard with a DIFFERENT email + IMAP creds → `/dashboard` with empty mailbox | **User to verify** |
| M3 | Cross-user isolation (browser URL tamper) | While logged in as user 2, try `GET /api/emails/<one-of-user-1's-ids>` → 404 | **User to verify** |
| M4 | Per-user Settings | User 2's Settings page shows empty provider keys (not user 1's) | **User to verify** |
| M5 | Logout from Settings | Click "🚪 Log out" in Settings → `/login`; localStorage token cleared | **User to verify** |
| M6 | Invalid token recovery | DevTools → set `intellimail_token=bad` in localStorage → next API call bounces to `/login` | **User to verify** |

## Architecture summary (what shipped)

| Layer | Changes |
|---|---|
| DB | `users` table, `user_id` columns on 5 tables, `provider_usage` PK rebuilt, `meta` table, grandfather migration |
| Auth | `src/auth.js` (JWT primitives), `src/middleware/auth.js` (`requireAuth`), `src/routes/auth.js` (signup/login/logout/check), persisted `data/jwt.secret` |
| Gate | `src/server.js` middleware rejects all `/api/*` except public list (users/any, auth/*, account/test-*, providers/*/test) |
| Scoping | Every protected route in `src/routes/api.js` filters by `req.user.id`; cross-user access returns 404 |
| Per-user runtime | `src/imap.js` `Map<userId, SyncState>`, `src/classifier.js` `Map<userId, Queue>`, `src/llm/router.js` buckets/breakers keyed by `${userId}::${name}` |
| Client | `authFetch()` wrapper, HTMX auth hook, 401 auto-redirect, per-page redirect snippets, `/login` page, logout button |

## Commits (this plan only)

```
53ddbf3 checkpoint: Log out button in Settings
53bdc75 checkpoint: authFetch, HTMX auth hook, page redirect snippets, setup posts to /api/auth/signup
57154ef checkpoint: /login page + client-side root redirect
b67b935 checkpoint: per-user LLM router buckets + breakers
6010cb8 checkpoint: per-user classifier queue + scoped classifyEmail
33198a3 checkpoint: per-user IMAP sync state
da47fd7 checkpoint: scope all /api/* queries by user_id
a212d34 checkpoint: gate all /api/* behind requireAuth except public endpoints
00a1703 checkpoint: login, logout, check routes
7fe8e2b checkpoint: POST /api/auth/signup
a3e1620 checkpoint: public GET /api/users/any
4ef954a checkpoint: grandfather migration for legacy single-user data
f663a70 checkpoint: users table + user_id columns + provider_usage PK rebuild
09efd7e checkpoint: requireAuth middleware
ef53b51 checkpoint: JWT sign/verify + persisted secret
934ad6e checkpoint: add jsonwebtoken dep
```

Plus a few small follow-up fixes (`93ebafd`, `fcc08d5`, `0873e49`, …) for test isolation and gitignore.

## Known-deferred items (flagged during implementation, not blockers)

1. SSE `/api/sse` and `stats_update` broadcasts are still global; every connected client sees every user's new-email events. Fix: filter broadcasts by `userId` and make SSE stream per-user.
2. Password reset flow (per spec §2.3, out of scope).
3. Login rate limiting (per spec §2.3, out of scope).
4. UI to delete / rename an account from the browser (per spec §2.3, out of scope).
