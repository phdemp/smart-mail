const test = require('node:test');
const assert = require('node:assert/strict');

// ─── Isolated helper imports ──────────────────────────────────────────────────
// We test tierBadge() and keyFactLine() in isolation.
// They are defined in src/routes/api.js but not exported.
// We re-define them here from their published spec so tests are self-contained.
// When the implementation is added, we will also verify the functions exist
// in the source file via fs.readFileSync checks.

const fs = require('fs');
const path = require('path');

const apiSrc = fs.readFileSync(path.join(__dirname, '../../src/routes/api.js'), 'utf8');

// ─── Source-level verification tests ─────────────────────────────────────────

test('api.js contains function tierBadge(', () => {
  assert.ok(apiSrc.includes('function tierBadge('), 'tierBadge helper missing from api.js');
});

test('api.js contains function keyFactLine(', () => {
  assert.ok(apiSrc.includes('function keyFactLine('), 'keyFactLine helper missing from api.js');
});

test('api.js SELECT includes c.source, c.low_confidence', () => {
  assert.ok(apiSrc.includes('c.source, c.low_confidence'), 'SQL SELECT missing c.source, c.low_confidence');
});

test('api.js list row calls tierBadge(email.source, email.low_confidence)', () => {
  assert.ok(apiSrc.includes('tierBadge(email.source, email.low_confidence)'), 'list row missing tierBadge call');
});

test('api.js list row calls keyFactLine(cat, email.extracted_data)', () => {
  assert.ok(apiSrc.includes('keyFactLine(cat, email.extracted_data)'), 'list row missing keyFactLine call');
});

test('api.js list row renders ${keyFact}', () => {
  assert.ok(apiSrc.includes('${keyFact}'), 'list row missing ${keyFact} interpolation');
});

test('api.js list row renders ${tierBadgeHtml}', () => {
  assert.ok(apiSrc.includes('${tierBadgeHtml}'), 'list row missing ${tierBadgeHtml} interpolation');
});

// ─── Behavioral tests via extracted helpers ────────────────────────────────────
// Extract the helper functions from api.js source using a minimal evaluation
// scope that supplies escHtml and parsedExtractedData.

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parsedExtractedData(str) {
  try { return JSON.parse(str || '{}'); } catch { return {}; }
}

// Evaluate helpers from source
const helperCode = (() => {
  // Extract just the function definitions from api.js
  const tierBadgeMatch = apiSrc.match(/function tierBadge\([\s\S]*?\n\}/);
  const keyFactMatch = apiSrc.match(/function keyFactLine\([\s\S]*?\n\}/);
  return (tierBadgeMatch ? tierBadgeMatch[0] : '') + '\n' + (keyFactMatch ? keyFactMatch[0] : '');
})();

let tierBadge, keyFactLine;
try {
  const fn = new Function('escHtml', 'parsedExtractedData', helperCode + '\nreturn { tierBadge, keyFactLine };');
  const helpers = fn(escHtml, parsedExtractedData);
  tierBadge = helpers.tierBadge;
  keyFactLine = helpers.keyFactLine;
} catch (e) {
  // Functions not yet implemented — tests will fail naturally
  tierBadge = () => { throw new Error('tierBadge not implemented'); };
  keyFactLine = () => { throw new Error('keyFactLine not implemented'); };
}

// ─── tierBadge() behavioral tests ─────────────────────────────────────────────

test('tierBadge rule source returns badge-tier-rule class and Rule label', () => {
  const html = tierBadge('rule', 0);
  assert.ok(html.includes('badge-tier-rule'), 'missing badge-tier-rule class');
  assert.ok(html.includes('Rule'), 'missing Rule label');
});

test('tierBadge rules source normalizes to Rule (D-02)', () => {
  const html = tierBadge('rules', 0);
  assert.ok(html.includes('badge-tier-rule'), 'rules not normalized to badge-tier-rule');
});

test('tierBadge llm source returns badge-tier-ai class and AI label', () => {
  const html = tierBadge('llm', 0);
  assert.ok(html.includes('badge-tier-ai'), 'missing badge-tier-ai class');
  assert.ok(html.includes('>AI<') || html.includes('>AI '), 'missing AI label');
});

test('tierBadge fallback source returns AI badge (D-02)', () => {
  const html = tierBadge('fallback', 0);
  assert.ok(html.includes('badge-tier-ai'), 'fallback not mapped to badge-tier-ai');
});

test('tierBadge llm with low_confidence=1 adds badge-tier-ai--uncertain and ? suffix', () => {
  const html = tierBadge('llm', 1);
  assert.ok(html.includes('badge-tier-ai--uncertain'), 'missing badge-tier-ai--uncertain class');
  assert.ok(html.includes('tier-lc-suffix'), 'missing tier-lc-suffix span');
  assert.ok(html.includes('?'), 'missing ? suffix');
});

test('tierBadge failed source returns badge-tier-failed class and Failed label', () => {
  const html = tierBadge('failed', 0);
  assert.ok(html.includes('badge-tier-failed'), 'missing badge-tier-failed class');
  assert.ok(html.includes('Failed'), 'missing Failed label');
});

test('tierBadge null source returns AI badge (null treated as AI per D-02)', () => {
  const html = tierBadge(null, 0);
  assert.ok(html.includes('badge-tier-ai'), 'null source not defaulting to AI badge');
});

// ─── keyFactLine() behavioral tests ───────────────────────────────────────────

test('keyFactLine travel with departure_date and flight_number returns flight fact', () => {
  const html = keyFactLine('travel', JSON.stringify({ departure_date: 'Dec 3', flight_number: 'BA456' }));
  assert.ok(html.includes('email-key-fact'), 'missing email-key-fact div');
  assert.ok(html.includes('Flight'), 'missing Flight label');
  assert.ok(html.includes('BA456'), 'missing flight number');
  assert.ok(html.includes('Dec 3'), 'missing departure date');
});

test('keyFactLine travel with only pnr returns PNR fact', () => {
  const html = keyFactLine('travel', JSON.stringify({ pnr: 'ABC123' }));
  assert.ok(html.includes('email-key-fact'), 'missing email-key-fact div');
  assert.ok(html.includes('PNR'), 'missing PNR label');
  assert.ok(html.includes('ABC123'), 'missing PNR value');
});

test('keyFactLine travel without departure_date and without pnr returns empty string', () => {
  const html = keyFactLine('travel', JSON.stringify({ airline: 'BA' }));
  assert.strictEqual(html, '', 'expected empty string for travel with no date or pnr');
});

test('keyFactLine financial with amount_due and due_date returns due fact', () => {
  const html = keyFactLine('financial', JSON.stringify({ amount_due: '$450', due_date: 'Apr 30' }));
  assert.ok(html.includes('email-key-fact'), 'missing email-key-fact div');
  assert.ok(html.includes('Due'), 'missing Due label');
  assert.ok(html.includes('$450'), 'missing amount');
  assert.ok(html.includes('Apr 30'), 'missing due date');
});

test('keyFactLine financial with only amount_due returns Due · amount', () => {
  const html = keyFactLine('financial', JSON.stringify({ amount_due: '$450' }));
  assert.ok(html.includes('email-key-fact'), 'missing email-key-fact div');
  assert.ok(html.includes('Due'), 'missing Due label');
  assert.ok(html.includes('$450'), 'missing amount');
  assert.ok(!html.includes('Apr'), 'should not have date when not present');
});

test('keyFactLine meeting_request with date and time returns Meeting fact', () => {
  const html = keyFactLine('meeting_request', JSON.stringify({ meeting_date: 'Thu', meeting_time: '3pm' }));
  assert.ok(html.includes('email-key-fact'), 'missing email-key-fact div');
  assert.ok(html.includes('Meeting'), 'missing Meeting label');
  assert.ok(html.includes('Thu'), 'missing meeting date');
  assert.ok(html.includes('3pm'), 'missing meeting time');
});

test('keyFactLine fyi returns empty string (D-08)', () => {
  const html = keyFactLine('fyi', JSON.stringify({ note: 'some info' }));
  assert.strictEqual(html, '', 'fyi should return empty string per D-08');
});

test('keyFactLine legal returns empty string (D-08)', () => {
  const html = keyFactLine('legal', JSON.stringify({ anything: 'foo' }));
  assert.strictEqual(html, '', 'legal should return empty string per D-08');
});

test('keyFactLine other returns empty string (D-08)', () => {
  const html = keyFactLine('other', JSON.stringify({ anything: 'bar' }));
  assert.strictEqual(html, '', 'other should return empty string per D-08');
});
