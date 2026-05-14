---
phase: 01-prompt-quality-baseline
reviewed: 2026-05-14T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - scripts/eval-corpus.js
  - src/classifier.js
  - src/db.js
  - src/llm/providers/base.js
  - src/llm/providers/deepseek.js
  - src/llm/providers/gemini.js
  - src/llm/providers/groq.js
  - src/llm/providers/nvidia.js
  - src/llm/router.js
  - src/routes/api.js
  - tests/classifier_validation.test.js
  - tests/llm/base.test.js
  - tests/llm/router.test.js
findings:
  critical: 6
  warning: 9
  info: 4
  total: 19
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

This review covers the prompt-quality baseline implementation: the LLM classifier pipeline (providers, router, base prompt utilities), the database layer, the main API routes, and the eval corpus script. The implementation is functionally coherent and shows careful attention to multi-user scoping, rate-limit handling, and circuit-breaker logic. However, six blocker-level issues were found spanning security (XSS in HTMX-rendered HTML, open redirect, path traversal in eval script, SSRF-adjacent redeem-URL bypass, credential exposure through `console.log`), and data correctness (stale `archive` endpoint silently re-maps to `delete`). Nine warnings cover logic errors, missing error handling, and quality gaps that could manifest as bugs under edge conditions.

---

## Critical Issues

### CR-01: XSS via Unsanitized `redeem_url` Injected into `href` Attribute

**File:** `src/routes/api.js:800`
**Issue:** The `redeem_url` value extracted from LLM-generated `extracted_data` is placed inside an `href` attribute after only a shallow `escHtml()` call. `escHtml()` entity-encodes angle brackets and quotes but does NOT strip `javascript:` URIs. An LLM that returns `"redeem_url": "javascript:alert(document.cookie)"` will produce a clickable link that executes arbitrary JavaScript in the user's browser. The LLM can be tricked into emitting this via a crafted email body.

**Fix:**
```javascript
// Before (line 800):
${extracted.redeem_url ? `<a ... href="${escHtml(extracted.redeem_url.startsWith('http') ? extracted.redeem_url : 'https://'+extracted.redeem_url)}" ...>` : ''}

// After — validate scheme before inserting into HTML:
function safeHref(raw) {
  try {
    const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return escHtml(u.href);
  } catch { return null; }
}
// Then:
${extracted.redeem_url ? (() => { const h = safeHref(extracted.redeem_url); return h ? `<a ... href="${h}" ...>...</a>` : ''; })() : ''}
```

---

### CR-02: Open Redirect in `/api/account/save` Error Path

**File:** `src/routes/api.js:112`
**Issue:** On save failure the handler redirects to `/setup?error=<encodeURIComponent(e.message)>`. The error message comes from a database exception (`e.message`). SQLite error messages can include user-supplied values (e.g., column values that violate a constraint). A carefully crafted input could embed a partial URL string into the message, and because the path is a server-side redirect (`res.redirect`), if any upstream proxy or browser interprets the `Location` header loosely, this becomes an open redirect vector. More concretely: the error message is reflected unescaped into the query string and could contain `&` that injects extra query params into the setup page, affecting client-side logic.

**Fix:**
```javascript
} catch (e) {
  // Never reflect raw DB error messages — log server-side, show generic message to client.
  console.error('[account/save] error:', e.message);
  res.redirect('/setup?error=' + encodeURIComponent('Save failed. Check your settings.'));
}
```

---

### CR-03: Path Traversal in `eval-corpus.js` Provider Loader

**File:** `scripts/eval-corpus.js:127`
**Issue:** The provider name is taken from `process.env.EVAL_PROVIDER` (defaulting to `'nvidia'`) and fed directly into `require('../src/llm/providers/' + providerName)` with no path sanitization. A user who sets `EVAL_PROVIDER=../../../etc/passwd` or `EVAL_PROVIDER=../../../../some/system/module` will cause Node.js to attempt to require an arbitrary filesystem path. While the default value is safe, any CI/CD system that passes `EVAL_PROVIDER` from external input (e.g. a PR variable, environment injection) is vulnerable to module load from an unintended path.

**Fix:**
```javascript
const ALLOWED_PROVIDERS = new Set(['nvidia', 'groq', 'gemini', 'deepseek']);
const providerName = process.env.EVAL_PROVIDER || 'nvidia';
if (!ALLOWED_PROVIDERS.has(providerName)) {
  console.error(`Unknown provider '${providerName}'. Allowed: ${[...ALLOWED_PROVIDERS].join(', ')}`);
  process.exit(1);
}
// Now safe to require:
provider = require('../src/llm/providers/' + providerName);
```
(The `allowed` Set already exists in the test endpoint at `api.js:171` — use the same pattern here.)

---

### CR-04: IMAP/SMTP Credentials Logged Verbatim in `console.log`

**File:** `src/routes/api.js:135-136, 149-150`
**Issue:** The test-IMAP and test-SMTP endpoints log the full config object via `console.log('[IMAP TEST] result:', JSON.stringify(result))`. The `result` object returned by `testImap`/`testSmtp` may echo connection details. More critically, `buildCfg` constructs a config that includes the `password` field (line 122–130), and if an exception leaks that object into an error log, passwords appear in plaintext in `server.log` (which is committed to the repository based on git status). Even without the exception path, the pattern is dangerous.

**Fix:**
```javascript
// Log only safe fields — never the password or full config object:
console.log(`[IMAP TEST] host=${cfg.imap_host} port=${cfg.imap_port} tls=${cfg.imap_tls} user=${cfg.username}`);
// (password field intentionally omitted from all log lines)

// For result logging, strip sensitive fields before serialization:
const safeResult = { ok: result.ok, error: result.error };
console.log(`[IMAP TEST] result:`, JSON.stringify(safeResult));
```

---

### CR-05: `archive` Endpoint Silently Deletes Instead of Archiving

**File:** `src/routes/api.js:900-906`
**Issue:** The `POST /api/emails/:id/archive` endpoint is labeled "Keep archive as alias for backward compat" but its implementation sets `is_deleted = 1`, which moves the email to Trash — not to an archive folder. A caller using the archive endpoint expecting "hide from inbox but keep accessible" will instead permanently soft-delete the email. This is a data-correctness bug: archived emails are irrecoverable without manually clearing `is_deleted`. The `delete` endpoint (line 877) does the exact same update. The two are indistinguishable at the database level.

**Fix:**
```javascript
// Either use a dedicated is_archived column (already exists) or document
// that this endpoint is intentionally equivalent to delete and rename it.
router.post('/api/emails/:id/archive', (req, res) => {
  const info = db.prepare(
    'UPDATE emails SET is_archived = 1, is_read = 1 WHERE id = ? AND user_id = ?'
  ).run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});
```

---

### CR-06: `storeClassification` Broadcasts Un-sanitized Category/Urgency

**File:** `src/classifier.js:238-244`
**Issue:** `storeClassification` correctly sanitizes `category` and `urgency` before writing to the DB (lines 224–225), but the `broadcast` call on line 238 uses `data.category` and `data.urgency` — the **original, unsanitized** values. Any client listening to the `classification_done` SSE/WebSocket event receives the raw out-of-enum value (e.g., the historical `'request'` category) rather than the sanitized `'other'`. This means the UI can display an unrecognized category label, and any downstream handler that switches on the broadcasted category misses the safety net.

**Fix:**
```javascript
broadcast('classification_done', {
  user_id: userId,
  email_id: emailId,
  category: safeCategory,   // use the sanitized local variables
  urgency:  safeUrgency
});
```

---

## Warnings

### WR-01: `db.js` Stores IMAP Password in Plaintext

**File:** `src/db.js:22`
**Issue:** The `account_config` table schema defines `password TEXT` with no encryption. IMAP/SMTP credentials are stored and retrieved as plaintext SQLite values. The `saveConfig` function writes the raw password directly. If the SQLite file is accessed by another process, leaked via a path traversal, or included in a backup, all stored credentials are immediately exposed.

**Fix:** Encrypt the password with a server-side key (e.g., AES-256-GCM keyed from `process.env.CREDENTIAL_KEY`) before INSERT and decrypt after SELECT. At minimum, add a comment clearly acknowledging the plaintext storage and document the known risk.

---

### WR-02: `getStats` SQL Queries Are Not User-Scoped for the `JOIN` Tables

**File:** `src/db.js:283-316`
**Issue:** In `getStats(userId)`, the `classifications` table is joined without a `c.user_id = ?` predicate. The JOIN condition is only `c.email_id = e.id`. Because `email_id` values are globally unique (AUTOINCREMENT), this does not expose cross-user data in practice today. However, if `email_id` ever resets (e.g., after a full data wipe and re-import), rows from a previous user could match the new user's emails, silently inflating counts. The defensive fix is free.

**Fix:**
```sql
JOIN classifications c ON c.email_id = e.id AND c.user_id = e.user_id
```
Apply to all three JOINs in `getStats` (lines 287, 294, 300 — the COUNT queries).

---

### WR-03: `generateDraft` in `classifier.js` Has a Silent Empty Catch

**File:** `src/classifier.js:296-298`
**Issue:** The `catch` block in `generateDraft` discards the error entirely with no logging. If the router throws an unexpected error (e.g., a bug in the provider call), the function silently returns a generic template string. There is no signal in logs that the LLM call failed, making these failures invisible during debugging.

**Fix:**
```javascript
} catch (err) {
  console.warn('[classifier] generateDraft failed:', err.message);
  return 'Thank you for your email. I will review and respond shortly.';
}
```

---

### WR-04: `storeClassification` Has a Broad Silent `catch` That Hides DB Errors

**File:** `src/classifier.js:254-256`
**Issue:** The entire `storeClassification` function body is wrapped in a try/catch that swallows all exceptions with a comment `// silent: classifier failures shouldn't block sync`. This includes schema errors, constraint violations, and the draft INSERT on lines 249–253. A mis-formed `extracted_data` that causes a DB error, or a broken migration that adds a NOT NULL column, will silently produce no classification row while giving no log evidence. The `broadcast` call is also inside the try, meaning broadcast failures are silenced too.

**Fix:** Narrow the catch to only cover the draft INSERT (which is truly optional), and add at minimum a `console.error` for the classification INSERT failure:
```javascript
try {
  db.prepare('INSERT OR IGNORE INTO classifications ...').run(...);
  broadcast('classification_done', { ... });
} catch (e) {
  console.error('[classifier] storeClassification failed:', e.message);
  return; // Do not attempt the draft insert if classification failed
}
// Draft insert in a separate optional try:
try { /* draft insert */ } catch {}
```

---

### WR-05: `groq.js` and `deepseek.js` Have No Timeout-Error Re-Throw

**File:** `src/llm/providers/groq.js:13-54`, `src/llm/providers/deepseek.js:11-55`
**Issue:** The `nvidia.js` and `gemini.js` providers explicitly catch `AbortError` and rethrow a descriptive error with `status = 504`. The `groq.js` and `deepseek.js` providers have the `AbortController` + `clearTimeout` pattern but do **not** have the corresponding `catch` block that converts `AbortError` to a `504` error. When a Groq or DeepSeek call times out, the `AbortError` propagates raw to the router's `catch (err)` handler. `classifyError` checks `err.name === 'AbortError'` (line 211 of router.js) so the routing outcome is `'timeout'` — correct. However, the missing `err.status` means the `http_401` / `http_429` / `http_503` branch checks all fail, and the error falls through to the generic `'network'` path in `classifyError`, incrementing the breaker counter when it should arguably be treated differently.

**Fix:** Add the same AbortError catch that `nvidia.js` uses to both `groq.js` and `deepseek.js`:
```javascript
} catch (e) {
  if (e.name === 'AbortError' || /aborted/i.test(e.message || '')) {
    const err = new Error(`Groq timed out after 10s`);
    err.status = 504;
    throw err;
  }
  throw e;
} finally {
  clearTimeout(t);
}
```

---

### WR-06: `router.js` `generateDraft` Is Code-Duplicated from `classify`

**File:** `src/llm/router.js:126-204`
**Issue:** `generateDraft` is a near-verbatim copy of `classify` (80+ lines of identical bucket, breaker, quota, and error-handling logic) with only minor differences (fixed `temperature: 0.4`, fixed `maxWaitMs: 2000`, returns only `draft_reply`). Any bug fix or enhancement to one function must be manually mirrored to the other. This has already drifted: `classify` uses `opts.mode` for `maxWaitMs` selection (line 72), while `generateDraft` hardcodes 2000ms regardless of `opts.mode`. This means a `regen`-mode draft request gets the same wait budget as a background classification, rather than the shorter budget applied in `classify`.

**Fix:** Extract the shared provider-iteration logic into a private `_callProvider(email, opts, config)` helper and call it from both `classify` and `generateDraft`. This is a refactor rather than a one-line patch, but the duplication guarantees future drift bugs.

---

### WR-07: `reclassify` Endpoint Ignores the User-Supplied `category` Value It Validates

**File:** `src/routes/api.js:918-940`
**Issue:** The `POST /api/emails/:id/reclassify` endpoint validates the incoming `category` against `validCategories`, then deletes the existing classification and queues the email for *automatic* reclassification by the LLM router (line 930: `queueClassification`). The user's explicit category choice is never written to the DB. The endpoint response misleads the user with "Reclassifying as `${category}`..." but the actual resulting category depends entirely on what the LLM decides next, which could produce a completely different category.

**Fix:** Either write the user-supplied category directly to the DB as the new classification (with `source = 'user'`), or rename the endpoint to `re-queue` and update the UI copy to say "Re-queuing for classification..." so user expectations match actual behavior.

---

### WR-08: `eval-corpus.js` in `--score` Mode Uses `from` Field Instead of `from_address`

**File:** `scripts/eval-corpus.js:165-169`
**Issue:** In `--score` mode, the `emailObj` constructed for provider calls (lines 164–169) sets `from_address: entry.from || ''`. The corpus JSON stores the `from` field as a combined string (e.g., `"Alice <alice@example.com>"`). `buildPrompt` (in `base.js`) renders `From: ${email.from_name || ''} <${email.from_address || ''}>`, so the combined `from` string ends up in the `<address>` part, producing garbled output like `From:  <Alice <alice@example.com>>`. The `from_name` field is always empty string. Provider context for sender identity is degraded, which skews eval scores.

**Fix:**
```javascript
// Parse the combined 'from' string into name + address parts:
function splitFrom(from) {
  const m = (from || '').match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { from_name: m[1].trim(), from_address: m[2].trim() };
  return { from_name: '', from_address: from || '' };
}
const { from_name, from_address } = splitFrom(entry.from);
const emailObj = { from_name, from_address, subject: entry.subject || '', body_text: entry.body_snippet || '' };
```

---

### WR-09: `buildDraftPrompt` Uses the Wrong System Prompt in Gemini

**File:** `src/llm/providers/gemini.js:27`
**Issue:** When `opts.mode === 'draft'`, the Gemini provider builds the message as:
```
SYSTEM_PROMPT + '\n\n' + buildDraftPrompt(email, opts)
```
`SYSTEM_PROMPT` is the *classification* prompt that instructs the model to return a specific JSON schema with `category`, `urgency`, etc. Prepending this to a draft-generation request tells the model two contradictory things simultaneously. The model will likely return a JSON classification object rather than a prose email reply, causing `parseProviderResponse` to extract an empty `draft_reply`. The other three providers (nvidia, groq, deepseek) send `SYSTEM_PROMPT` as a *system* role message and `buildDraftPrompt` as the *user* message — which is also wrong for draft mode (same issue), but at least the system/user separation means the system prompt can potentially be overridden. Gemini compounds the problem by concatenating them.

**Fix:** For `mode === 'draft'`, use `buildDraftPrompt` as the sole content — do not prepend `SYSTEM_PROMPT`:
```javascript
const promptText = opts.mode === 'draft'
  ? buildDraftPrompt(email, opts)
  : SYSTEM_PROMPT + '\n\n' + buildPrompt(email, opts);

body: JSON.stringify({
  contents: [{ role: 'user', parts: [{ text: promptText }] }],
  ...
})
```
The same fix applies to nvidia, groq, and deepseek: the `SYSTEM_PROMPT` should not be sent as the system message when `mode === 'draft'`.

---

## Info

### IN-01: Magic Number `800` Repeated Across Multiple Files

**File:** `src/llm/providers/base.js:60,72`; `tests/llm/base.test.js:17,23,130`
**Issue:** The body truncation limit `800` is a magic number appearing in `buildPrompt`, `buildDraftPrompt`, and both test files. If the limit changes, it must be updated in at least 4 places. The test assertion `out.includes('x'.repeat(800)) && !out.includes('x'.repeat(801))` will silently pass incorrectly if the constant drifts.

**Fix:** Export a named constant: `const BODY_SNIPPET_LEN = 800;` from `base.js` and reference it in all four sites.

---

### IN-02: `storeClassification` Re-Queries the Email it Already Has in `classifyEmail`

**File:** `src/classifier.js:248`
**Issue:** `classifyEmail` already fetches the email row at line 157 (`const email = db.prepare(...).get(emailId, userId)`). When it later calls `storeClassification`, that function re-queries the same email (line 248: `const email = db.prepare('SELECT * FROM emails ...').get(emailId, userId)`). This is a redundant DB round-trip on every classification.

**Fix:** Pass the already-fetched `email` object into `storeClassification` as an argument, or restructure the draft-creation logic to live in `classifyEmail` where the email is already in scope.

---

### IN-03: `gemini.js` Default Model Name Is Likely Invalid

**File:** `src/llm/providers/gemini.js:13`, `src/db.js:97`
**Issue:** The default model is `'gemini-flash-latest'`. The Google Generative Language API model names use the pattern `gemini-1.5-flash-latest` or `gemini-2.0-flash-latest`. `gemini-flash-latest` (without a version number) is unlikely to resolve to a valid model and will produce a 404 or 400 error on every call until the user overrides it in settings. The `db.js` migration default (line 97) propagates the same value.

**Fix:** Set the default to a known-valid model ID: `'gemini-1.5-flash-latest'` (or whatever the current production model name is), and update the migration default accordingly.

---

### IN-04: `classifier_validation.test.js` Test Has a Potential Race Between `finally` and `then`

**File:** `tests/classifier_validation.test.js:89-97`
**Issue:** In the "gitlab access-token" test, the `try { return classifyEmail(...).then(...) } finally { llm.router.classify = origClassify; }` pattern restores the mock in `finally` before the returned Promise resolves. Because `finally` runs synchronously before the returned promise is awaited by the test runner, `origClassify` is restored before the `.then` assertion callback executes. This means other concurrently-running tests could trigger the real router between the restore and the assertion completing. The same structure is used in the "newsletter" test (lines 116–126).

**Fix:** Use `async/await` to ensure the restore happens after the assertion:
```javascript
test('...', async () => {
  const origClassify = llm.router.classify;
  llm.router.classify = async () => null;
  try {
    await classifyEmail(userId, emailId);
    const row = db.prepare('SELECT category, source FROM classifications WHERE email_id = ?').get(emailId);
    assert.notEqual(row.category, 'fyi', '...');
  } finally {
    llm.router.classify = origClassify;
  }
});
```

---

_Reviewed: 2026-05-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
