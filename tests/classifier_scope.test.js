const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Isolated DB so we don't pollute intellimail.db
const dbPath = path.join(__dirname, '..', 'intellimail-scope-test.db');
process.env.DB_PATH = dbPath;

test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });

// Defer require to AFTER DB_PATH is set.
let db, isInClassificationScope, SCOPE_DAYS, SCOPE_LIMIT;

test.before(() => {
  ({ db } = require('../src/db'));
  ({ isInClassificationScope, SCOPE_DAYS, SCOPE_LIMIT } = require('../src/classifier'));

  db.prepare('INSERT INTO users (email) VALUES (?)').run('scope@test.com');
  const userId = db.prepare('SELECT id FROM users WHERE email = ?').get('scope@test.com').id;

  // Seed: 120 emails — 80 within last 10 days (mixed ages), 40 older than 10 days.
  const insert = db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, received_at)
    VALUES (?, ?, 'INBOX', ?, ?)
  `);
  // 80 recent (last 10 days, ranging 0..9 days old)
  for (let i = 0; i < 80; i++) {
    const daysAgo = i / 10; // 0..7.9 days
    const ts = new Date(Date.now() - daysAgo * 86400_000).toISOString();
    insert.run(userId, `m-recent-${i}`, `recent ${i}`, ts);
  }
  // 40 stale (15..54 days old)
  for (let i = 0; i < 40; i++) {
    const ts = new Date(Date.now() - (15 + i) * 86400_000).toISOString();
    insert.run(userId, `m-stale-${i}`, `stale ${i}`, ts);
  }
  // Stash userId on global for tests below
  global.__scopeUserId = userId;
});

test('scope constants', () => {
  assert.equal(SCOPE_DAYS, 10);
  assert.equal(SCOPE_LIMIT, 100);
});

test('emails within last 10 days and inside latest 100 → in scope', () => {
  const userId = global.__scopeUserId;
  // The 80 recent rows are all within 10 days AND fewer than 100 total per user
  // until we add stale rows — but stale are older so they don't crowd out recent
  // ones from the latest-100 window. Recent rows must be in scope.
  const recent = db.prepare(
    "SELECT id FROM emails WHERE user_id = ? AND message_id LIKE 'm-recent-%' LIMIT 1"
  ).get(userId);
  assert.equal(isInClassificationScope(userId, recent.id), true);
});

test('emails older than 10 days → out of scope', () => {
  const userId = global.__scopeUserId;
  const stale = db.prepare(
    "SELECT id FROM emails WHERE user_id = ? AND message_id LIKE 'm-stale-%' LIMIT 1"
  ).get(userId);
  assert.equal(isInClassificationScope(userId, stale.id), false);
});

test('beyond latest 100 even if within 10 days → out of scope', () => {
  const userId = global.__scopeUserId;
  // Add 30 MORE recent emails (within last 10 days) so the total recent count
  // exceeds 100. The OLDEST recent rows (still within 10 days) should now fall
  // outside the latest-100 cutoff.
  const insert = db.prepare(`
    INSERT INTO emails (user_id, message_id, folder, subject, received_at)
    VALUES (?, ?, 'INBOX', ?, ?)
  `);
  for (let i = 0; i < 30; i++) {
    // 0 days old — these are the absolute newest, will displace older recents
    const ts = new Date(Date.now() - (i * 60_000)).toISOString();
    insert.run(userId, `m-fresh-${i}`, `fresh ${i}`, ts);
  }
  // The oldest of the original recent rows (m-recent-79, ~7.9 days old) should
  // now fall outside the latest 100 because we have 30 newer ones plus the
  // original 80 = 110 within-10-days emails.
  const oldRecent = db.prepare(
    "SELECT id FROM emails WHERE user_id = ? AND message_id = 'm-recent-79'"
  ).get(userId);
  assert.equal(isInClassificationScope(userId, oldRecent.id), false);

  // The freshest one is definitely in scope.
  const freshest = db.prepare(
    "SELECT id FROM emails WHERE user_id = ? AND message_id = 'm-fresh-0'"
  ).get(userId);
  assert.equal(isInClassificationScope(userId, freshest.id), true);
});

test('non-existent / wrong-user email → out of scope', () => {
  const userId = global.__scopeUserId;
  assert.equal(isInClassificationScope(userId, 999_999), false);
  assert.equal(isInClassificationScope(userId + 999, 1), false);
});
