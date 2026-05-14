const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Isolated DB
const dbPath = path.join(__dirname, '..', 'intellimail-classvalid-test.db');
process.env.DB_PATH = dbPath;

test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });

let db, classifyEmail;

test.before(async () => {
  ({ db } = require('../src/db'));
  ({ classifyEmail } = require('../src/classifier'));

  // Seed a user with one email that's IN scope (today's date) so the scope
  // gate doesn't block classification.
  db.prepare('INSERT INTO users (email) VALUES (?)').run('cls@test.com');
  const userId = db.prepare('SELECT id FROM users WHERE email = ?').get('cls@test.com').id;
  db.prepare('INSERT INTO account_config (user_id) VALUES (?)').run(userId);
  global.__cvUserId = userId;
});

test('storeClassification rejects an out-of-enum category (regression: legacy "request")', async () => {
  const userId = global.__cvUserId;

  // Insert an email whose subject the rules tier WILL match (forces a known
  // category from rules so we don't depend on the LLM in tests). We then
  // call storeClassification directly to verify out-of-enum sanitization.
  db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-bad-cat', 'INBOX', 'test', 'body', datetime('now'))
  `).run(userId);
  const emailId = db.prepare("SELECT id FROM emails WHERE message_id = 'mid-bad-cat'").get().id;

  // Reach into classifier for the private storeClassification by re-requiring
  // the module — it's not exported, so exercise it via classifyEmail's path
  // by mocking the LLM router to return an invalid category.
  const llm = require('../src/llm');
  const origClassify = llm.router.classify;
  llm.router.classify = async () => ({
    category: 'request',          // not in enum
    urgency: 'whatever',          // not in enum
    urgency_reason: null,
    summary: 'test bad category',
    extracted_data: {},
    suggested_tone: 'professional',
    draft_reply: null,
    _provider: 'fake'
  });
  try {
    await classifyEmail(userId, emailId);
  } finally {
    llm.router.classify = origClassify;
  }

  const row = db.prepare('SELECT category, urgency FROM classifications WHERE email_id = ?').get(emailId);
  assert.equal(row.category, 'other',  'invalid category coerced to "other"');
  assert.equal(row.urgency,  'normal', 'invalid urgency coerced to "normal"');
});

test('rulesClassify does NOT mark gitlab access-token email as fyi (regression: body unsubscribe over-match)', () => {
  // Re-import without going through the storeClassification path — we want to
  // exercise the pure rules function. It's not exported, so we test the
  // observable behavior: an email with a CAN-SPAM-style unsubscribe footer
  // but no newsletter signals must NOT come back as fyi.
  const userId = global.__cvUserId;

  db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, from_address, body_text, received_at)
    VALUES (?, 'mid-gitlab', 'INBOX', ?, ?, ?, datetime('now'))
  `).run(
    userId,
    'Your resource access tokens will expire in 30 days or less',
    'gitlab@dil.in',
    'Your access token expires soon. Manage your notification settings here. Unsubscribe from these emails.'
  );
  const emailId = db.prepare("SELECT id FROM emails WHERE message_id = 'mid-gitlab'").get().id;

  // Force a no-LLM path: ensure the router returns null so we observe the
  // rules tier's choice (or the fallback if rules don't match).
  const llm = require('../src/llm');
  const origClassify = llm.router.classify;
  llm.router.classify = async () => null;
  try {
    return classifyEmail(userId, emailId).then(() => {
      const row = db.prepare('SELECT category, source FROM classifications WHERE email_id = ?').get(emailId);
      // Rules tier shouldn't match this — should fall through. Source will be
      // 'fallback' (router returned null), category stays 'other'.
      assert.notEqual(row.category, 'fyi', 'gitlab access-token email must not be classified as fyi');
    });
  } finally {
    llm.router.classify = origClassify;
  }
});

test('rulesClassify still marks an explicit newsletter as fyi', () => {
  const userId = global.__cvUserId;

  db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, from_address, body_text, received_at)
    VALUES (?, 'mid-newsletter', 'INBOX', ?, ?, ?, datetime('now'))
  `).run(
    userId,
    'Weekly Newsletter — top stories',
    'noreply@somesite.com',
    'Your weekly digest.'
  );
  const emailId = db.prepare("SELECT id FROM emails WHERE message_id = 'mid-newsletter'").get().id;

  const llm = require('../src/llm');
  const origClassify = llm.router.classify;
  llm.router.classify = async () => null;  // force rules-only path
  try {
    return classifyEmail(userId, emailId).then(() => {
      const row = db.prepare('SELECT category, source FROM classifications WHERE email_id = ?').get(emailId);
      assert.equal(row.category, 'fyi');
      assert.equal(row.source,   'rules');
    });
  } finally {
    llm.router.classify = origClassify;
  }
});

// --- Turned GREEN in Plan 03 (INFRA-02) ---

test('classifyEmail stores source="failed" after 3 failed attempts (INFRA-02)', async () => {
  const userId = global.__cvUserId;

  db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, from_address, body_text, received_at)
    VALUES (?, 'mid-attempts', 'INBOX', 'test attempts', 'x@x.com', 'body', datetime('now'))
  `).run(userId);
  const emailId = db.prepare("SELECT id FROM emails WHERE message_id = 'mid-attempts'").get().id;

  const llm = require('../src/llm');
  const origClassify = llm.router.classify;
  llm.router.classify = async () => { throw new Error('provider error'); };
  try {
    // Call 1 — increments attempt counter to 1, router throws, fallback stored
    await classifyEmail(userId, emailId);
    // Delete the classification row so INSERT OR IGNORE allows re-insertion on next call
    db.prepare('DELETE FROM classifications WHERE email_id = ?').run(emailId);

    // Call 2 — increments attempt counter to 2, router throws, fallback stored
    await classifyEmail(userId, emailId);
    db.prepare('DELETE FROM classifications WHERE email_id = ?').run(emailId);

    // Call 3 — increments attempt counter to 3, router throws, fallback stored
    await classifyEmail(userId, emailId);
    db.prepare('DELETE FROM classifications WHERE email_id = ?').run(emailId);

    // Call 4 — attempt counter is now 4 > MAX_ATTEMPTS(3), stores source='failed'
    await classifyEmail(userId, emailId);
  } finally {
    llm.router.classify = origClassify;
  }

  const row = db.prepare('SELECT source FROM classifications WHERE email_id = ?').get(emailId);
  assert.ok(row, 'classification row must exist after exhausting attempts');
  assert.equal(row.source, 'failed', 'source must be "failed" after 3 failed attempts');
});
