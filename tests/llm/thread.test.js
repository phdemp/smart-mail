// Wave 0: src/llm/thread.js not yet created — tests will fail on import until Plan 03 lands.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Isolated DB — set BEFORE requiring src/db or src/llm/thread
const dbPath = path.join(__dirname, '..', '..', 'intellimail-thread-test.db');
process.env.DB_PATH = dbPath;

test.before(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });
test.after(() => { try { fs.rmSync(dbPath, { force: true }); } catch {} });

let db, fetchThreadContext, buildThreadContext, stripQuotedReplies;

test.before(async () => {
  ({ db } = require('../../src/db'));
  ({ fetchThreadContext, buildThreadContext, stripQuotedReplies } = require('../../src/llm/thread'));

  // seed user
  db.prepare('INSERT INTO users (email) VALUES (?)').run('thread@test.com');
  global.__threadUserId = db.prepare('SELECT id FROM users WHERE email = ?').get('thread@test.com').id;
});

// ---------------------------------------------------------------------------
// Pure-function tests: stripQuotedReplies (no DB needed)
// ---------------------------------------------------------------------------

test('stripQuotedReplies removes > lines', () => {
  const input = 'Hello\n> quoted line\nWorld';
  assert.equal(stripQuotedReplies(input), 'Hello\nWorld');
});

test('stripQuotedReplies removes On...wrote: attribution header', () => {
  const line = 'On Mon, Jan 1, 2024, Alice wrote:';
  const input = `Reply text\n${line}\n> original`;
  const result = stripQuotedReplies(input);
  assert.ok(!result.includes(line), 'attribution line should be removed');
});

test('stripQuotedReplies falls back to original when stripped result < 100 chars and original was longer', () => {
  // Build a body that is entirely > quotes — stripped will be empty, original is long
  const quoted = Array(10).fill('> ' + 'x'.repeat(20)).join('\n');
  const original = quoted;
  assert.equal(stripQuotedReplies(original), original,
    'should return original when stripped result would be under 100 chars');
});

test('stripQuotedReplies removes --- original message lines', () => {
  const input = 'My reply\n--- Original Message ---\n> some prior text';
  const result = stripQuotedReplies(input);
  assert.ok(!result.includes('--- Original Message ---'), 'separator line should be removed');
});

// ---------------------------------------------------------------------------
// Pure-function tests: buildThreadContext (no DB needed)
// ---------------------------------------------------------------------------

test('buildThreadContext returns null for empty array', () => {
  assert.equal(buildThreadContext([]), null);
});

test('buildThreadContext returns null for null input', () => {
  assert.equal(buildThreadContext(null), null);
});

test('buildThreadContext limits to 5 prior messages (oldest 2 dropped from 7)', () => {
  const msgs = Array.from({ length: 7 }, (_, i) => ({
    from_name: 'Alice',
    from_address: 'alice@example.com',
    subject: 'Subject ' + i,
    body_text: 'body ' + i
  }));
  const ctx = buildThreadContext(msgs);
  assert.ok(ctx !== null, 'should return a string');
  // Should contain at most 5 [From: blocks
  const blockCount = (ctx.match(/\[From:/g) || []).length;
  assert.ok(blockCount <= 5, `Expected <= 5 [From: blocks, got ${blockCount}`);
});

test('buildThreadContext enforces 6000 char budget for 5 messages with 600-char bodies', () => {
  const msgs = Array.from({ length: 5 }, () => ({
    from_name: 'Sender',
    from_address: 'sender@example.com',
    subject: 'Test Subject',
    body_text: 'x'.repeat(600)
  }));
  const ctx = buildThreadContext(msgs);
  assert.ok(ctx !== null, 'should return a string');
  assert.ok(ctx.length <= 6000, `Expected ctx.length <= 6000, got ${ctx.length}`);
});

test('buildThreadContext formats each message as [From: ...] [Subject: ...] body', () => {
  const msgs = [{
    from_name: 'Bob',
    from_address: 'bob@example.com',
    subject: 'Hello',
    body_text: 'Hi there'
  }];
  const ctx = buildThreadContext(msgs);
  assert.ok(ctx.includes('[From: Bob <bob@example.com>]'), 'should include From block');
  assert.ok(ctx.includes('[Subject: Hello]'), 'should include Subject block');
  assert.ok(ctx.includes('Hi there'), 'should include body text');
});

// ---------------------------------------------------------------------------
// DB integration tests: fetchThreadContext
// ---------------------------------------------------------------------------

test('fetchThreadContext returns prior emails via subject-normalized fallback', () => {
  const userId = global.__threadUserId;
  // Seed two emails with the same normalized subject (Re: Hello -> Hello)
  db.prepare(`INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-prior-1', 'INBOX', 'Hello', 'prior body', datetime('now', '-1 day'))`).run(userId);
  db.prepare(`INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-current-1', 'INBOX', 'Re: Hello', 'current body', datetime('now'))`).run(userId);
  const current = db.prepare("SELECT * FROM emails WHERE message_id = 'mid-current-1'").get();
  const result = fetchThreadContext(userId, current);
  assert.ok(Array.isArray(result), 'should return an array');
  assert.ok(result.some(r => r.subject === 'Hello'), 'should include prior email with matching subject');
});

test('fetchThreadContext never returns emails from other users (cross-user isolation)', () => {
  const userId = global.__threadUserId;

  // Create a second user
  db.prepare('INSERT INTO users (email) VALUES (?)').run('other@test.com');
  const otherUserId = db.prepare("SELECT id FROM users WHERE email = 'other@test.com'").get().id;

  // Seed email for other user with identical normalized subject
  db.prepare(`INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-other-user', 'INBOX', 'Shared Subject', 'other body', datetime('now', '-2 day'))`).run(otherUserId);

  // Seed triggering email for userId with same subject
  db.prepare(`INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-isolation-trigger', 'INBOX', 'Re: Shared Subject', 'my body', datetime('now'))`).run(userId);
  const current = db.prepare("SELECT * FROM emails WHERE message_id = 'mid-isolation-trigger'").get();

  const result = fetchThreadContext(userId, current);
  assert.ok(Array.isArray(result), 'should return an array');
  // Confirm none of the results belong to otherUserId
  const leaked = result.filter(r => r.user_id === otherUserId);
  assert.equal(leaked.length, 0, 'should not return emails from other users');
});

test('fetchThreadContext returns matching emails via header-based path (In-Reply-To)', () => {
  const userId = global.__threadUserId;

  // Seed a prior email with a specific message_id
  db.prepare(`INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'prior-msg-id@test', 'INBOX', 'Original Thread', 'prior message body', datetime('now', '-3 day'))`).run(userId);

  // Seed the triggering email with raw_headers containing in-reply-to
  const rawHeaders = JSON.stringify({ 'in-reply-to': 'prior-msg-id@test', 'references': '' });
  db.prepare(`INSERT INTO emails (user_id, message_id, folder, subject, body_text, raw_headers, received_at)
    VALUES (?, 'reply-msg-id@test', 'INBOX', 'Re: Original Thread', 'reply body', ?, datetime('now'))`).run(userId, rawHeaders);

  const current = db.prepare("SELECT * FROM emails WHERE message_id = 'reply-msg-id@test'").get();
  const result = fetchThreadContext(userId, current);
  assert.ok(Array.isArray(result), 'should return an array');
  // Should find the prior email via header-based path
  assert.ok(result.some(r => r.subject === 'Original Thread'), 'should include prior email found via In-Reply-To header');
});

test('fetchThreadContext excludes the triggering email itself from results', () => {
  const userId = global.__threadUserId;

  // Seed two emails with same normalized subject
  db.prepare(`INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-excl-prior', 'INBOX', 'Exclusion Test', 'prior body', datetime('now', '-1 day'))`).run(userId);
  db.prepare(`INSERT INTO emails (user_id, message_id, folder, subject, body_text, received_at)
    VALUES (?, 'mid-excl-current', 'INBOX', 'Re: Exclusion Test', 'current body', datetime('now'))`).run(userId);

  const current = db.prepare("SELECT * FROM emails WHERE message_id = 'mid-excl-current'").get();
  const result = fetchThreadContext(userId, current);
  assert.ok(Array.isArray(result), 'should return an array');
  // The triggering email itself should not appear in results
  const selfIncluded = result.filter(r => r.id === current.id);
  assert.equal(selfIncluded.length, 0, 'triggering email must be excluded from thread context results');
});
