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
  // Use a second isolated DB to avoid interference with the first test's DB
  const dbPath2 = path.join(__dirname, '..', 'intellimail-migration-test-2.db');
  try { fs.rmSync(dbPath2, { force: true }); } catch {}
  const db = new Database(dbPath2);
  db.exec(`
    CREATE TABLE account_config (id INTEGER PRIMARY KEY, email TEXT, password TEXT, user_id INTEGER);
    CREATE TABLE emails (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER);
    CREATE TABLE classifications (id INTEGER PRIMARY KEY AUTOINCREMENT, email_id INTEGER, user_id INTEGER);
    CREATE TABLE drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, email_id INTEGER, user_id INTEGER);
    CREATE TABLE sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.prepare('INSERT INTO account_config (id, email, password) VALUES (1, ?, ?)').run('idem@ex.com', 'pw');
  const { grandfatherIfNeeded } = require('../src/db-migration');
  grandfatherIfNeeded(db);
  grandfatherIfNeeded(db);
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM users').get().n, 1);
  db.close();
  try { fs.rmSync(dbPath2, { force: true }); } catch {}
});
