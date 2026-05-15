# Phase 3: User Correction Loop - Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 5 new/modified files
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/db.js` | migration | batch | `src/db.js` lines 93, 181–194, 212–226 (self — extend existing guard block) | exact |
| `src/classifier.js` | service | request-response | `src/classifier.js` lines 179–194 (Tier 1 rules short-circuit) | exact |
| `src/routes/api.js` | controller | request-response | `src/routes/api.js` lines 943–979 (existing /reclassify) + 899–941 (action endpoints) | exact |
| `public/js/app.js` | client utility | event-driven | `public/js/app.js` lines 200–208 (classification_done SSE listener) | exact |
| `tests/correction.test.js` | test | batch | `tests/classifier_validation.test.js` + `tests/api/scoping.test.js` | exact |

---

## Pattern Assignments

### `src/db.js` (migration, batch) — schema additions only

**Analog:** `src/db.js` — the file extends itself using its own guard pattern.

**Imports / module header** (lines 1–5):
```javascript
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'intellimail.db');
const db = new Database(DB_PATH);
```

**ALTER TABLE guard pattern** (lines 93, 224–226) — copy this for every column addition:
```javascript
// Migration: add is_deleted for trash support
try { db.exec('ALTER TABLE emails ADD COLUMN is_deleted INTEGER DEFAULT 0'); } catch(e) {}

// Classification provenance
try { db.exec(`ALTER TABLE classifications ADD COLUMN source TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE classifications ADD COLUMN low_confidence INTEGER DEFAULT 0`); } catch(e) {}
```

**CREATE TABLE guard pattern** (lines 181–194) — copy this for sender_rules and ai_feedback:
```javascript
// Phase 2: llm_logs table (D-10) — created via inline guard so re-runs are safe
try {
  db.exec(`
    CREATE TABLE llm_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      provider TEXT,
      user_id INTEGER,
      email_id INTEGER,
      token_count INTEGER,
      outcome TEXT,
      latency_ms INTEGER
    )
  `);
} catch(e) {}
```

**Phase 3 application — place these blocks after line 226 (after existing `classifications` ALTER TABLE guards):**
```javascript
// Phase 3: correction audit columns (CORRECT-01)
try { db.exec(`ALTER TABLE classifications ADD COLUMN user_corrected_category TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE classifications ADD COLUMN corrected_at DATETIME`); } catch(e) {}

// Phase 3: sender_rules table (D-04)
try {
  db.exec(`
    CREATE TABLE sender_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      domain TEXT,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sender_rules_uq ON sender_rules(user_id, domain, category)');
} catch(e) {}

// Phase 3: ai_feedback table (D-11)
try {
  db.exec(`
    CREATE TABLE ai_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      summary_id INTEGER REFERENCES classifications(id),
      user_id INTEGER,
      vote TEXT CHECK(vote IN ('up','down')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_feedback_uq ON ai_feedback(user_id, summary_id)');
} catch(e) {}
```

**UPSERT pattern for sender_rules and ai_feedback** (analogous to provider_usage upsert, db.js):
```javascript
// INSERT OR REPLACE with a unique index — idempotent, updates on conflict
db.prepare(`
  INSERT OR REPLACE INTO sender_rules (user_id, domain, category)
  VALUES (?, ?, ?)
`).run(userId, domain, category);

db.prepare(`
  INSERT OR REPLACE INTO ai_feedback (user_id, summary_id, vote)
  VALUES (?, ?, ?)
`).run(userId, classificationId, vote);
```

**Pruning pattern** (line 197) — optional boot-time cleanup, follow same try/catch:
```javascript
// Phase 2: 30-day retention pruning on boot (D-11)
try { db.prepare("DELETE FROM llm_logs WHERE ts < datetime('now', '-30 days')").run(); } catch(e) {}
```

---

### `src/classifier.js` (service, request-response) — Tier 0 sender-rule lookup

**Analog:** `src/classifier.js` lines 179–194 — Tier 1 rules short-circuit pattern.

**Module header / setBroadcast pattern** (lines 1–7):
```javascript
const { db, getConfig } = require('./db');
const llm = require('./llm');
const { CATEGORIES, URGENCIES } = require('./llm/providers/base');
const { fetchThreadContext, buildThreadContext } = require('./llm/thread');

let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }
```

**Tier 1 short-circuit pattern** (lines 179–194) — copy this shape for Tier 0:
```javascript
// Tier 1: instant rules
const rulesCategory = rulesClassify(email);
if (rulesCategory) {
  const { urgency, urgency_reason } = rulesUrgency(rulesCategory, email);
  const extracted = rulesExtractedData(rulesCategory, email);
  const sub = email.subject || '';
  const summary = `${email.from_name || email.from_address} sent: ${sub.substring(0, 80)}${sub.length > 80 ? '...' : ''}.`;
  attempts.delete(attemptKey);
  storeClassification(userId, emailId, {
    category: rulesCategory, urgency, urgency_reason, summary,
    extracted_data: extracted, suggested_tone: 'professional', draft_reply: null,
    source: 'rules'
  }, email);
  return;
}
```

**Phase 3 Tier 0 block — insert BEFORE "Tier 1: instant rules" (before line 179):**
```javascript
// Tier 0: sender-rule override (D-06) — fires before regex, short-circuits immediately
const domain = (email.from_address || '').split('@')[1];
if (domain) {
  const senderRule = db.prepare(
    'SELECT category FROM sender_rules WHERE user_id = ? AND domain = ?'
  ).get(userId, domain);
  if (senderRule) {
    const { urgency, urgency_reason } = rulesUrgency(senderRule.category, email);
    const sub = email.subject || '';
    const summary = `${email.from_name || email.from_address} sent: ${sub.substring(0, 80)}${sub.length > 80 ? '...' : ''}.`;
    attempts.delete(attemptKey);
    storeClassification(userId, emailId, {
      category: senderRule.category, urgency, urgency_reason, summary,
      extracted_data: {}, suggested_tone: 'professional', draft_reply: null,
      source: 'rule'
    }, email);
    return;
  }
}
```

**module.exports** (bottom of classifier.js — add setBroadcast export if not already exported):
```javascript
module.exports = { classifyEmail, classifyAllUnclassifiedForUser, queueClassification, setBroadcast };
```

---

### `src/routes/api.js` (controller, request-response) — extend /reclassify + new /feedback endpoint

**Analog:** `src/routes/api.js` lines 943–979 (existing /reclassify), lines 899–941 (archive/star patterns).

**setBroadcast injection pattern** (must be added to api.js to mirror classifier.js:6-7):
```javascript
// At top of api.js — same injection pattern as classifier.js
let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }
module.exports.setBroadcast = setBroadcast;
// Then in server.js, after mounting: require('./routes/api').setBroadcast(broadcast);
```

**Auth-scoped email fetch pattern** (lines 949–951) — copy for both endpoints:
```javascript
const email = db.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?')
  .get(req.params.id, req.user.id);
if (!email) return res.status(404).json({ error: 'not_found' });
```

**Category validation pattern** (lines 944–946):
```javascript
const { category } = req.body;
const validCategories = ['meeting_request','financial','legal','travel','pitch_deck','fyi','rewards_awards','other'];
if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category' });
```

**Existing /reclassify core** (lines 943–979) — Phase 3 extends this, not replaces:
```javascript
router.post('/api/emails/:id/reclassify', (req, res) => {
  const { category } = req.body;
  const validCategories = ['meeting_request','financial','legal','travel','pitch_deck','fyi','rewards_awards','other'];
  if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category' });

  const email = db.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });

  db.prepare('DELETE FROM classifications WHERE email_id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  const userUrgency = category === 'legal' ? 'urgent' : 'normal';
  const userUrgencyReason = category === 'legal' ? 'Legal matter requires immediate attention' : null;
  db.prepare(`
    INSERT OR IGNORE INTO classifications
    (user_id, email_id, category, urgency, urgency_reason, summary, extracted_data, suggested_tone, source, low_confidence)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.user.id, req.params.id, category, userUrgency, userUrgencyReason,
    null, '{}', 'professional', 'user', 0
  );

  res.send(`<div style="...">Reload to see updated details</div>`);
});
```

**Phase 3 extension — replace the SELECT + INSERT + res.send block with:**
```javascript
router.post('/api/emails/:id/reclassify', (req, res) => {
  const { category } = req.body;
  const validCategories = ['meeting_request','financial','legal','travel','pitch_deck','fyi','rewards_awards','other'];
  if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category' });

  // Fetch full email row to get from_address for domain extraction (D-08)
  const email = db.prepare('SELECT id, from_address FROM emails WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });

  const domain = (email.from_address || '').split('@')[1] || '';
  const userUrgency = category === 'legal' ? 'urgent' : 'normal';
  const userUrgencyReason = category === 'legal' ? 'Legal matter requires immediate attention' : null;

  // DELETE + INSERT with audit columns (CORRECT-01, Pitfall 2)
  db.prepare('DELETE FROM classifications WHERE email_id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  db.prepare(`
    INSERT OR IGNORE INTO classifications
    (user_id, email_id, category, urgency, urgency_reason, summary, extracted_data,
     suggested_tone, source, low_confidence, user_corrected_category, corrected_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
  `).run(req.user.id, req.params.id, category, userUrgency, userUrgencyReason,
    null, '{}', 'professional', 'user', 0, category);

  // Sender rule promotion (D-05): count corrections for this (user, domain, category)
  if (domain) {
    const { cnt } = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM classifications c
      JOIN emails e ON e.id = c.email_id AND e.user_id = c.user_id
      WHERE c.user_id = ? AND c.source = 'user'
        AND substr(e.from_address, instr(e.from_address, '@') + 1) = ?
        AND c.category = ?
    `).get(req.user.id, domain, category);
    if (cnt >= 2) {
      db.prepare(`
        INSERT OR REPLACE INTO sender_rules (user_id, domain, category)
        VALUES (?, ?, ?)
      `).run(req.user.id, domain, category);
    }
  }

  // SSE broadcast (D-09)
  broadcast('classification_updated', {
    email_id: req.params.id,
    category,
    source: 'user',
    domain
  });

  // HTMX response — triggers client-side re-render via SSE listener
  res.send(`<div style="padding:48px;text-align:center;color:var(--text-muted);">
    <div style="font-size:24px;margin-bottom:12px;">&#x2713;</div>
    <div>Recategorized as ${escHtml(categoryLabel(category))}</div>
  </div>`);
});
```

**New POST /api/emails/:id/feedback endpoint** (copy pattern from archive endpoint at lines 925–931):
```javascript
router.post('/api/emails/:id/feedback', (req, res) => {
  const { vote, classification_id } = req.body;
  if (!['up', 'down'].includes(vote)) return res.status(400).json({ error: 'Invalid vote' });

  // Auth-scope: confirm email ownership before writing feedback
  const email = db.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });

  // Confirm classification belongs to this email + user
  const cls = db.prepare(
    'SELECT id FROM classifications WHERE id = ? AND email_id = ? AND user_id = ?'
  ).get(classification_id, req.params.id, req.user.id);
  if (!cls) return res.status(404).json({ error: 'not_found' });

  // UPSERT — allows vote change (up -> down), no duplicate rows (D-13)
  db.prepare(`
    INSERT OR REPLACE INTO ai_feedback (user_id, summary_id, vote)
    VALUES (?, ?, ?)
  `).run(req.user.id, cls.id, vote);

  // HTMX outerHTML swap — replace thumbs widget with "Thanks!" (D-13)
  res.send(`<div id="thumbs-${cls.id}" class="ai-thumbs">
    <span style="font-size:12px;color:var(--text-muted);">Thanks!</span>
  </div>`);
});
```

**Email detail fragment additions** (follow existing HTMX pattern at lines 866–885):

3-second read timer script block (append to detail fragment before closing tag):
```html
<script>
(function() {
  var el = document.getElementById('correction-affordance-${email.id}');
  if (el && !el.dataset.timerSet) {
    el.dataset.timerSet = '1';
    setTimeout(function() { el.classList.add('correction-visible'); }, 3000);
  }
})();
</script>
```

Correction affordance wrapper (wraps existing recategorize picker at line 866):
```html
<div id="correction-affordance-${email.id}" class="correction-affordance">
  <!-- existing category picker panel goes here -->
</div>
```

Correction history row (conditional — render only when user_corrected_category exists, CORRECT-06):
```javascript
${cls?.user_corrected_category ? `
  <div style="font-size:12px;color:var(--text-muted);margin-top:6px;">
    Corrected to: <strong>${escHtml(categoryLabel(cls.user_corrected_category))}</strong>
    at ${new Date(cls.corrected_at).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
  </div>
` : ''}
```

Thumbs widget (inline below AI summary section, analogous to HTMX form at line 874):
```html
<div id="thumbs-${cls.id}" class="ai-thumbs" style="margin-top:8px;display:flex;gap:8px;">
  <button hx-post="/api/emails/${email.id}/feedback"
          hx-vals='{"vote":"up","classification_id":"${cls.id}"}'
          hx-target="#thumbs-${cls.id}"
          hx-swap="outerHTML"
          style="background:none;border:none;cursor:pointer;font-size:18px;">&#x1F44D;</button>
  <button hx-post="/api/emails/${email.id}/feedback"
          hx-vals='{"vote":"down","classification_id":"${cls.id}"}'
          hx-target="#thumbs-${cls.id}"
          hx-swap="outerHTML"
          style="background:none;border:none;cursor:pointer;font-size:18px;">&#x1F44E;</button>
</div>
```

---

### `public/js/app.js` (client utility, event-driven) — add classification_updated SSE listener

**Analog:** `public/js/app.js` lines 200–208 — classification_done SSE listener.

**Existing SSE listener pattern** (lines 200–208):
```javascript
es.addEventListener('classification_done', (e) => {
  const data = JSON.parse(e.data);
  if (this.pendingClassifying > 0) this.pendingClassifying -= 1;
  if (this.pendingClassifying === 0) this.classifyTotal = 0;
  const listPanel = document.querySelector('[hx-get*="/api/emails"]');
  if (listPanel) htmx.trigger(listPanel, 'refresh');
});
```

**Existing new_email SSE listener pattern** (lines 169–182) — shows toast + triggers list refresh:
```javascript
es.addEventListener('new_email', (e) => {
  try {
    const d = JSON.parse(e.data);
    showToast('info', `📬 ${d.from_name}: ${(d.subject || '').substring(0, 50)}`);
    const listPanel = document.querySelector('.email-list-panel');
    if (listPanel && window.htmx) {
      htmx.trigger(listPanel, 'categoryChange');
    }
    authFetch('/api/stats').then(r => r.json()).then(data => { this.stats = data; }).catch(() => {});
  } catch(err) {}
});
```

**showToast signature** (lines 374–406) — use type 'info':
```javascript
function showToast(type, message, duration = 4000) {
  // type: 'success' | 'error' | 'warning' | 'info'
  // ...
}
```

**categoryLabel function** (lines 437–444) — available globally, use in toast message:
```javascript
function categoryLabel(cat) {
  const map = {
    meeting_request: 'Meeting', financial: 'Financial', legal: 'Legal',
    travel: 'Travel', pitch_deck: 'Pitch', fyi: 'FYI',
    rewards_awards: 'Rewards', request: 'Request', other: 'Other'
  };
  return map[cat] || cat;
}
```

**Phase 3 addition — add inside connectSSE() after classification_done listener (after line 208):**
```javascript
es.addEventListener('classification_updated', (e) => {
  try {
    const d = JSON.parse(e.data);
    // Toast with domain memory message (D-10)
    showToast('info', `Moved to ${categoryLabel(d.category)}. We'll remember this for future emails from ${d.domain}.`);
    // Re-fetch email detail to update category badge (D-03)
    const detail = document.getElementById('email-detail');
    if (detail && d.email_id) {
      htmx.ajax('GET', `/api/emails/${d.email_id}`, '#email-detail');
    }
    // Refresh email list badge (matches existing categoryChange pattern)
    const listPanel = document.querySelector('.email-list-panel');
    if (listPanel && window.htmx) htmx.trigger(listPanel, 'categoryChange');
  } catch(err) {}
});
```

---

### `tests/correction.test.js` (test, batch) — new file

**Analog:** `tests/classifier_validation.test.js` (DB isolation + classifyEmail testing) and `tests/api/scoping.test.js` (Express + auth + HTTP request helper).

**File header / DB isolation pattern** (classifier_validation.test.js lines 1–25):
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Isolated DB — set before requiring src/db
const dbPath = path.join(__dirname, '..', 'intellimail-correction-test.db');
process.env.DB_PATH = dbPath;

test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });

let db;
test.before(async () => {
  ({ db } = require('../src/db'));
  // seed user + email for use across tests
  db.prepare('INSERT INTO users (email) VALUES (?)').run('correction@test.com');
  const userId = db.prepare('SELECT id FROM users WHERE email = ?').get('correction@test.com').id;
  db.prepare('INSERT INTO account_config (user_id) VALUES (?)').run(userId);
  global.__corrUserId = userId;
});
```

**Schema assertion pattern** (migration.test.js lines 37–53):
```javascript
test('classifications table has user_corrected_category and corrected_at columns (CORRECT-01)', () => {
  const cols = db.prepare('PRAGMA table_info(classifications)').all().map(c => c.name);
  assert.ok(cols.includes('user_corrected_category'), 'user_corrected_category column must exist');
  assert.ok(cols.includes('corrected_at'), 'corrected_at column must exist');
});
```

**Better-sqlite3 sync DB assertions** (classifier_validation.test.js lines 60–62):
```javascript
const row = db.prepare('SELECT category, source FROM classifications WHERE email_id = ?').get(emailId);
assert.equal(row.category, 'other',  'invalid category coerced to "other"');
assert.equal(row.source,   'rules',  'source must be "rules"');
```

**Express HTTP test helper** (scoping.test.js lines 34–48):
```javascript
function request(application, method, url, token, body) {
  return new Promise((resolve) => {
    const server = application.listen(0, () => {
      const port = server.address().port;
      const bodyStr = body ? JSON.stringify(body) : undefined;
      const req = require('http').request({
        method, hostname: 'localhost', port, path: url,
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {})
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: data });
        });
      });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}
```

**Test structure for CORRECT-05 sender rule promotion:**
```javascript
test('sender rule promoted after 2 corrections from same domain+category (CORRECT-05)', () => {
  const userId = global.__corrUserId;
  // Insert 2 emails from same domain
  // Insert 2 classifications with source='user', same category, joined emails from same domain
  // Assert sender_rules row exists for (userId, domain, category)
});

test('Tier 0 lookup short-circuits classifyEmail when sender rule exists (CORRECT-05)', async () => {
  // Insert email from same domain
  // Assert classifyEmail stores source='rule' without calling LLM
});
```

**Test structure for CORRECT-07 ai_feedback UPSERT:**
```javascript
test('ai_feedback upsert replaces vote rather than duplicating (CORRECT-07)', () => {
  const userId = global.__corrUserId;
  // Insert classification row
  // INSERT OR REPLACE vote='up', then INSERT OR REPLACE vote='down'
  // Assert COUNT(*) = 1 and vote = 'down'
});
```

---

## Shared Patterns

### setBroadcast Injection (anti-circular-require)
**Source:** `src/classifier.js` lines 6–7; `src/server.js` lines 64–65
**Apply to:** `src/routes/api.js` (new — not currently injected), `src/classifier.js` (already has it)
```javascript
// In classifier.js and api.js — module-level stub:
let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }
module.exports.setBroadcast = setBroadcast;

// In server.js — wire after mounting:
setClassifierBroadcast(broadcast);
// Add for api.js:
const { setBroadcast: setApiBroadcast } = require('./routes/api');
setApiBroadcast(broadcast);
```

### Auth-Scoped Email Ownership Check
**Source:** `src/routes/api.js` lines 949–951
**Apply to:** `/reclassify` extension, new `/feedback` endpoint
```javascript
const email = db.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?')
  .get(req.params.id, req.user.id);
if (!email) return res.status(404).json({ error: 'not_found' });
```

### Synchronous better-sqlite3 DB Ops
**Source:** `src/db.js` throughout, `src/routes/api.js` throughout
**Apply to:** all DB reads and writes in this phase
```javascript
// All DB ops are synchronous — no async/await, no .then()
const row = db.prepare('SELECT ...').get(param1, param2);  // single row
const rows = db.prepare('SELECT ...').all(param1);          // multiple rows
db.prepare('INSERT ...').run(param1, param2);               // write
```

### CommonJS Module Pattern
**Source:** All source files
**Apply to:** `tests/correction.test.js` and any helpers
```javascript
const { db } = require('../src/db');
const { classifyEmail } = require('../src/classifier');
// No ESM import/export — require() only
```

### HTMX Form POST + HTML Fragment Response
**Source:** `src/routes/api.js` lines 874–882 (category picker buttons), 971–978 (reclassify response)
**Apply to:** thumbs widget buttons + `/feedback` endpoint response
```javascript
// Server returns raw HTML — HTMX swaps it into the target element
res.send(`<div id="thumbs-${cls.id}" ...>Thanks!</div>`);
```

### Input Validation Before Any DB Write
**Source:** `src/routes/api.js` lines 944–946
**Apply to:** `/feedback` endpoint (validate vote), `/reclassify` extension (category already validated)
```javascript
const validValues = ['up', 'down'];
if (!validValues.includes(vote)) return res.status(400).json({ error: 'Invalid vote' });
```

---

## No Analog Found

All files have strong analogs in the existing codebase. No new patterns need to be sourced from RESEARCH.md exclusively.

---

## Metadata

**Analog search scope:** `src/`, `tests/`, `public/js/`
**Files scanned:** `src/db.js`, `src/classifier.js`, `src/routes/api.js`, `src/server.js`, `public/js/app.js`, `tests/migration.test.js`, `tests/classifier_validation.test.js`, `tests/api/scoping.test.js`, `tests/smoke.test.js`
**Pattern extraction date:** 2026-05-15
