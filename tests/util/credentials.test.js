const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePassword, mapAuthError, isGmailHost } =
  require('../../src/util/credentials');

// ─── isGmailHost ─────────────────────────────────────────────────────────

test('isGmailHost matches gmail.com / googlemail.com hosts', () => {
  assert.equal(isGmailHost('imap.gmail.com'), true);
  assert.equal(isGmailHost('smtp.gmail.com'), true);
  assert.equal(isGmailHost('IMAP.GMAIL.COM'), true);
  assert.equal(isGmailHost('imap.googlemail.com'), true);
  assert.equal(isGmailHost('outlook.office365.com'), false);
  assert.equal(isGmailHost('imap.mail.yahoo.com'), false);
  assert.equal(isGmailHost(''), false);
  assert.equal(isGmailHost(null), false);
  assert.equal(isGmailHost(undefined), false);
});

// ─── normalizePassword ───────────────────────────────────────────────────

test('normalizePassword strips ALL internal whitespace for Gmail', () => {
  // Google's displayed app-password format is four spaced 4-char blocks.
  assert.equal(
    normalizePassword('imap.gmail.com', 'abcd efgh ijkl mnop'),
    'abcdefghijklmnop'
  );
});

test('normalizePassword strips tabs and newlines for Gmail too', () => {
  assert.equal(
    normalizePassword('smtp.gmail.com', '  abcd\tefgh\nijkl mnop  '),
    'abcdefghijklmnop'
  );
});

test('normalizePassword only trims edges for non-Gmail hosts', () => {
  // Some users legitimately have spaces inside their password — don't strip.
  assert.equal(
    normalizePassword('outlook.office365.com', '  hello world  '),
    'hello world'
  );
  assert.equal(
    normalizePassword('imap.mail.yahoo.com', '\tpass word\n'),
    'pass word'
  );
});

test('normalizePassword passes already-clean passwords through unchanged', () => {
  assert.equal(
    normalizePassword('imap.gmail.com', 'abcdefghijklmnop'),
    'abcdefghijklmnop'
  );
  assert.equal(
    normalizePassword('imap.example.com', 'plain'),
    'plain'
  );
});

test('normalizePassword tolerates null / undefined / empty inputs', () => {
  assert.equal(normalizePassword('imap.gmail.com', null), null);
  assert.equal(normalizePassword('imap.gmail.com', undefined), undefined);
  assert.equal(normalizePassword('imap.gmail.com', ''), '');
});

// ─── mapAuthError ────────────────────────────────────────────────────────

test('mapAuthError translates "application-specific password required" for Gmail', () => {
  const out = mapAuthError(
    'smtp.gmail.com',
    '534-5.7.9 Application-specific password required. Learn more...'
  );
  assert.match(out, /App Password/);
  assert.match(out, /myaccount\.google\.com\/apppasswords/);
});

test('mapAuthError translates Gmail WebLoginRequired blocking', () => {
  const out = mapAuthError(
    'smtp.gmail.com',
    'Invalid login: 534-5.7.9 Please log in with your web browser and then try again. ' +
    'For more information, go to https://support.google.com/mail/?p=WebLoginRequired'
  );
  assert.match(out, /2-Step Verification|App Password/);
  assert.match(out, /apppasswords/);
});

test('mapAuthError translates imapflow "Invalid credentials" against Gmail', () => {
  const out = mapAuthError('imap.gmail.com', 'Invalid credentials (Failure)');
  assert.match(out, /App Password/);
  assert.match(out, /apppasswords/);
});

test('mapAuthError translates generic "Command failed" against Gmail (imapflow swallows the real reply)', () => {
  const out = mapAuthError('imap.gmail.com', 'Command failed');
  assert.match(out, /App Password/);
  assert.match(out, /apppasswords/);
});

test('mapAuthError keeps generic "Command failed" untouched for non-Gmail hosts', () => {
  const out = mapAuthError('imap.example.com', 'Command failed');
  // Non-Gmail: we don't know it's an auth issue, so leave it alone for the user to see.
  assert.equal(out, 'Command failed');
});

test('mapAuthError gives a generic friendly message for non-Gmail "invalid credentials"', () => {
  const out = mapAuthError('imap.example.com', 'Invalid credentials');
  assert.match(out, /username and password/i);
  assert.doesNotMatch(out, /apppasswords/); // no Gmail link for non-Gmail
});

test('mapAuthError passes unknown errors through unchanged', () => {
  assert.equal(
    mapAuthError('imap.gmail.com', 'ECONNREFUSED 1.2.3.4:993'),
    'ECONNREFUSED 1.2.3.4:993'
  );
});

test('mapAuthError tolerates falsy input', () => {
  assert.equal(mapAuthError('imap.gmail.com', null), null);
  assert.equal(mapAuthError('imap.gmail.com', undefined), undefined);
  assert.equal(mapAuthError('imap.gmail.com', ''), '');
});
