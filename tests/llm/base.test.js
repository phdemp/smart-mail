const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPrompt,
  parseProviderResponse,
  CATEGORIES,
  DEFAULTS
} = require('../../src/llm/providers/base');

test('buildPrompt includes sender, subject, and body truncated to 800', () => {
  const email = {
    from_name: 'Alice',
    from_address: 'alice@example.com',
    subject: 'Invoice #123',
    body_text: 'x'.repeat(2000)
  };
  const out = buildPrompt(email, { mode: 'full' });
  assert.match(out, /From: Alice <alice@example\.com>/);
  assert.match(out, /Subject: Invoice #123/);
  assert.ok(out.includes('x'.repeat(800)) && !out.includes('x'.repeat(801)),
    'body should be truncated to 800 chars');
});

test('buildPrompt in regen mode includes tone instruction', () => {
  const email = { from_name: '', from_address: 'a@b.com', subject: 'Hi', body_text: 'hello' };
  const out = buildPrompt(email, { mode: 'regen', tone: 'friendly' });
  assert.match(out, /friendly/i);
});

test('parseProviderResponse parses clean JSON and normalizes', () => {
  const raw = JSON.stringify({
    category: 'financial', urgency: 'urgent', urgency_reason: 'Due today',
    summary: 's', extracted_data: { amount: '100' },
    suggested_tone: 'professional', draft_reply: 'ok'
  });
  const r = parseProviderResponse(raw);
  assert.equal(r.category, 'financial');
  assert.equal(r.urgency, 'urgent');
  assert.equal(r.draft_reply, 'ok');
});

test('parseProviderResponse extracts JSON from markdown fence', () => {
  const raw = '```json\n{"category":"fyi","urgency":"normal","summary":"s","draft_reply":"x"}\n```';
  const r = parseProviderResponse(raw);
  assert.equal(r.category, 'fyi');
});

test('parseProviderResponse tolerates trailing chatter', () => {
  const raw = 'Here is my analysis: {"category":"legal","urgency":"urgent","summary":"s","draft_reply":"r"} Hope that helps!';
  const r = parseProviderResponse(raw);
  assert.equal(r.category, 'legal');
});

test('parseProviderResponse fills missing fields with defaults', () => {
  const raw = '{"category":"travel"}';
  const r = parseProviderResponse(raw);
  assert.equal(r.category, 'travel');
  assert.equal(r.urgency, 'normal');
  assert.equal(r.suggested_tone, 'professional');
  assert.equal(typeof r.summary, 'string');
  assert.deepEqual(r.extracted_data, {});
});

test('parseProviderResponse maps unknown category to other', () => {
  const raw = '{"category":"spam_folder","urgency":"normal","summary":"s","draft_reply":"r"}';
  const r = parseProviderResponse(raw);
  assert.equal(r.category, 'other');
});

test('parseProviderResponse throws on totally garbage input', () => {
  assert.throws(() => parseProviderResponse('not json at all, nothing here'),
    /could not parse/i);
});

test('CATEGORIES has the 8 expected values', () => {
  assert.deepEqual(new Set(CATEGORIES), new Set([
    'meeting_request','financial','legal','travel',
    'pitch_deck','fyi','rewards_awards','other'
  ]));
});

test('parseProviderResponse forces urgent urgency for legal category', () => {
  const raw = '{"category":"legal","urgency":"normal","summary":"s","draft_reply":"r"}';
  assert.equal(parseProviderResponse(raw).urgency, 'urgent');
});
