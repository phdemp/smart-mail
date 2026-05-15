'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Isolated DB — must be set BEFORE any require of src/db or src/classifier
const dbPath = path.join(__dirname, '..', 'intellimail-correction-test.db');
process.env.DB_PATH = dbPath;

// Teardown: remove test DB before and after suite
test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });

let db;

// Setup: open isolated DB (triggers all migrations in src/db.js), seed a user
test.before(() => {
  ({ db } = require('../src/db'));
  // Seed test user — schema has only (email) for users
  db.prepare('INSERT INTO users (email) VALUES (?)').run('correction@test.com');
  const userId = db.prepare('SELECT id FROM users WHERE email = ?').get('correction@test.com').id;
  db.prepare('INSERT INTO account_config (user_id) VALUES (?)').run(userId);
  global.__corrUserId = userId;
});

// ─── Schema assertions ────────────────────────────────────────────────────────

test('classifications table has user_corrected_category column (CORRECT-01)', () => {
  const cols = db.prepare('PRAGMA table_info(classifications)').all().map(c => c.name);
  assert.ok(cols.includes('user_corrected_category'), 'user_corrected_category column must exist');
});

test('classifications table has corrected_at column (CORRECT-01)', () => {
  const cols = db.prepare('PRAGMA table_info(classifications)').all().map(c => c.name);
  assert.ok(cols.includes('corrected_at'), 'corrected_at column must exist');
});

test('sender_rules table exists with correct columns (D-04)', () => {
  const cols = db.prepare('PRAGMA table_info(sender_rules)').all().map(c => c.name);
  assert.ok(cols.includes('id'), 'sender_rules must have id column');
  assert.ok(cols.includes('user_id'), 'sender_rules must have user_id column');
  assert.ok(cols.includes('domain'), 'sender_rules must have domain column');
  assert.ok(cols.includes('category'), 'sender_rules must have category column');
  assert.ok(cols.includes('created_at'), 'sender_rules must have created_at column');
});

test('ai_feedback table exists with correct columns (D-11)', () => {
  const cols = db.prepare('PRAGMA table_info(ai_feedback)').all().map(c => c.name);
  assert.ok(cols.includes('id'), 'ai_feedback must have id column');
  assert.ok(cols.includes('summary_id'), 'ai_feedback must have summary_id column');
  assert.ok(cols.includes('user_id'), 'ai_feedback must have user_id column');
  assert.ok(cols.includes('vote'), 'ai_feedback must have vote column');
  assert.ok(cols.includes('created_at'), 'ai_feedback must have created_at column');
});

// ─── sender_rules uniqueness ──────────────────────────────────────────────────

test('sender_rules INSERT OR REPLACE does not duplicate on same unique tuple (CORRECT-05)', () => {
  const userId = global.__corrUserId;
  // Insert twice with INSERT OR REPLACE — should result in exactly one row
  db.prepare('INSERT OR REPLACE INTO sender_rules (user_id, domain, category) VALUES (?, ?, ?)')
    .run(userId, 'dedup-domain.com', 'financial');
  db.prepare('INSERT OR REPLACE INTO sender_rules (user_id, domain, category) VALUES (?, ?, ?)')
    .run(userId, 'dedup-domain.com', 'financial');
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM sender_rules WHERE user_id = ? AND domain = ? AND category = ?'
  ).get(userId, 'dedup-domain.com', 'financial');
  assert.equal(row.cnt, 1, 'INSERT OR REPLACE must not duplicate on same (user_id, domain, category)');
});

test('sender_rules unique index prevents duplicate (user_id, domain, category) tuples (CORRECT-05)', () => {
  const userId = global.__corrUserId;
  // Plain INSERT (not OR REPLACE) on same tuple must throw due to unique index
  db.prepare('INSERT INTO sender_rules (user_id, domain, category) VALUES (?, ?, ?)')
    .run(userId, 'conflict-domain.com', 'legal');
  assert.throws(
    () => db.prepare('INSERT INTO sender_rules (user_id, domain, category) VALUES (?, ?, ?)')
             .run(userId, 'conflict-domain.com', 'legal'),
    /UNIQUE constraint failed/,
    'plain INSERT on same unique tuple must throw a UNIQUE constraint error'
  );
});

// ─── ai_feedback UPSERT ───────────────────────────────────────────────────────

test('ai_feedback UPSERT replaces vote rather than duplicating (CORRECT-07)', () => {
  const userId = global.__corrUserId;
  // Create a classifications row to use as summary_id
  db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-feedback-upsert', 'INBOX', 'Feedback test', 'body', datetime('now'))
  `).run(userId);
  const emailId = db.prepare("SELECT id FROM emails WHERE message_id = 'mid-feedback-upsert'").get().id;
  db.prepare(`
    INSERT INTO classifications (user_id, email_id, category, source)
    VALUES (?, ?, 'financial', 'llm')
  `).run(userId, emailId);
  const clsId = db.prepare('SELECT id FROM classifications WHERE email_id = ?').get(emailId).id;

  // First vote: up
  db.prepare('INSERT OR REPLACE INTO ai_feedback (user_id, summary_id, vote) VALUES (?, ?, ?)')
    .run(userId, clsId, 'up');
  // Second vote: down (should replace, not add)
  db.prepare('INSERT OR REPLACE INTO ai_feedback (user_id, summary_id, vote) VALUES (?, ?, ?)')
    .run(userId, clsId, 'down');

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM ai_feedback WHERE user_id = ? AND summary_id = ?')
    .get(userId, clsId);
  assert.equal(countRow.cnt, 1, 'only one feedback row per (user_id, summary_id)');

  const voteRow = db.prepare('SELECT vote FROM ai_feedback WHERE user_id = ? AND summary_id = ?')
    .get(userId, clsId);
  assert.equal(voteRow.vote, 'down', 'most recent vote must be "down"');
});

test('ai_feedback vote CHECK constraint rejects invalid values (D-11)', () => {
  const userId = global.__corrUserId;
  // Create a separate email/classification to avoid state interference
  db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-feedback-check', 'INBOX', 'Check test', 'body', datetime('now'))
  `).run(userId);
  const emailId = db.prepare("SELECT id FROM emails WHERE message_id = 'mid-feedback-check'").get().id;
  db.prepare(`
    INSERT INTO classifications (user_id, email_id, category, source)
    VALUES (?, ?, 'other', 'rules')
  `).run(userId, emailId);
  const clsId = db.prepare('SELECT id FROM classifications WHERE email_id = ?').get(emailId).id;

  assert.throws(
    () => db.prepare('INSERT INTO ai_feedback (user_id, summary_id, vote) VALUES (?, ?, ?)')
             .run(userId, clsId, 'sideways'),
    /CHECK constraint failed/,
    'vote value "sideways" must be rejected by CHECK constraint'
  );
});

// ─── Sender rule promotion — full query shape ─────────────────────────────────

test('sender rule promotion: after 2 corrections same domain+category, sender_rules row exists (CORRECT-05)', () => {
  const userId = global.__corrUserId;
  const domain = 'promo-domain.com';
  const category = 'financial';

  // Seed 2 emails from same domain
  db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, from_address, body_text, received_at)
    VALUES (?, 'mid-promo-1', 'INBOX', 'Promo 1', ?, 'body', datetime('now'))
  `).run(userId, 'alice@' + domain);
  db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, from_address, body_text, received_at)
    VALUES (?, 'mid-promo-2', 'INBOX', 'Promo 2', ?, 'body', datetime('now'))
  `).run(userId, 'bob@' + domain);

  const emailId1 = db.prepare("SELECT id FROM emails WHERE message_id = 'mid-promo-1'").get().id;
  const emailId2 = db.prepare("SELECT id FROM emails WHERE message_id = 'mid-promo-2'").get().id;

  // Insert 2 user-correction classifications for these emails
  db.prepare(`
    INSERT INTO classifications (user_id, email_id, category, source, user_corrected_category, corrected_at)
    VALUES (?, ?, ?, 'user', ?, datetime('now'))
  `).run(userId, emailId1, category, category);
  db.prepare(`
    INSERT INTO classifications (user_id, email_id, category, source, user_corrected_category, corrected_at)
    VALUES (?, ?, ?, 'user', ?, datetime('now'))
  `).run(userId, emailId2, category, category);

  // Run the exact COUNT query shape used by the /reclassify endpoint (D-05)
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM classifications c
    JOIN emails e ON e.id = c.email_id AND e.user_id = c.user_id
    WHERE c.user_id = ? AND c.source = 'user'
      AND substr(e.from_address, instr(e.from_address, '@') + 1) = ?
      AND c.category = ?
  `).get(userId, domain, category);

  assert.ok(countRow.cnt >= 2, `expected at least 2 user corrections for domain=${domain}, got ${countRow.cnt}`);

  // Trigger sender rule promotion via UPSERT
  db.prepare('INSERT OR REPLACE INTO sender_rules (user_id, domain, category) VALUES (?, ?, ?)')
    .run(userId, domain, category);

  // Assert the rule now exists
  const rule = db.prepare('SELECT category FROM sender_rules WHERE user_id = ? AND domain = ?')
    .get(userId, domain);
  assert.ok(rule, 'sender_rules row must exist after promotion');
  assert.equal(rule.category, category, `sender rule category must be "${category}"`);
});

// ─── Tier 0 lookup ────────────────────────────────────────────────────────────

test('Tier 0 lookup returns undefined when no sender rule exists (CORRECT-05)', () => {
  const userId = global.__corrUserId;
  // Query for a domain that was never inserted into sender_rules
  const result = db.prepare('SELECT category FROM sender_rules WHERE user_id = ? AND domain = ?')
    .get(userId, 'unknown-domain.com');
  assert.equal(result, undefined, 'better-sqlite3 .get() returns undefined when no row found');
});
