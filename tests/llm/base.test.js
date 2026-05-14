const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPrompt,
  buildDraftPrompt,
  parseProviderResponse,
  CATEGORIES,
  DEFAULTS,
  SYSTEM_PROMPT
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

test('parseProviderResponse returns DEFAULTS with error on garbage input (no throw)', () => {
  const r = parseProviderResponse('not json at all, nothing here');
  assert.equal(r.category, DEFAULTS.category);
  assert.equal(r.error, 'parse_failure');
  assert.equal(r.low_confidence, true);
});

test('parseProviderResponse still throws when raw is not a string', () => {
  assert.throws(() => parseProviderResponse(null), /could not parse/i);
  assert.throws(() => parseProviderResponse(42), /could not parse/i);
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

// --- Wave 0 stubs turned GREEN (Plan 02) ---

// PROMPT-01: buildDraftPrompt exists as a separate function (Call B split)
test('PROMPT-01: buildDraftPrompt exists and is a function', () => {
  assert.equal(typeof buildDraftPrompt, 'function', 'buildDraftPrompt must be exported from base.js');
});

// PROMPT-01: buildPrompt does not include draft_reply instruction in any mode
test('buildPrompt does not include draft_reply instruction (Call A only)', () => {
  const out = buildPrompt({ from_address: 'a@b.com', subject: 'Hi', body_text: 'hello' }, { mode: 'full' });
  assert.ok(!out.includes('draft_reply'), 'buildPrompt must not include draft_reply after PROMPT-01 split');
});

// PROMPT-02: SYSTEM_PROMPT has one-liner per category
test('PROMPT-02: SYSTEM_PROMPT includes one-liner definitions for all 8 categories', () => {
  for (const cat of CATEGORIES) {
    assert.ok(SYSTEM_PROMPT.includes(cat), `SYSTEM_PROMPT must reference category: ${cat}`);
  }
});

// PROMPT-05: summary constraint is structural
test('PROMPT-05: SYSTEM_PROMPT uses structural summary constraint not character-count limit', () => {
  assert.ok(!SYSTEM_PROMPT.includes('max 120 chars'), 'old character-count constraint must be removed');
  assert.ok(SYSTEM_PROMPT.includes('action'), 'structural constraint must reference action');
});

// PROMPT-07: low_confidence set when category not in enum
test('PROMPT-07: parseProviderResponse sets low_confidence when category falls back to default', () => {
  const r = parseProviderResponse('{"category":"spam_folder","urgency":"normal","summary":"s"}');
  assert.equal(r.category, 'other');
  assert.equal(r.low_confidence, true);
});

// buildDraftPrompt basic structure (Call B prompt)
test('buildDraftPrompt includes from, subject, and body truncated to ~800', () => {
  const r = buildDraftPrompt({
    from_name: 'Bob', from_address: 'b@c.com',
    subject: 'Test', body_text: 'x'.repeat(2000)
  });
  assert.match(r, /From: Bob/);
  assert.match(r, /Subject: Test/);
  assert.ok(r.includes('x'.repeat(800)) && !r.includes('x'.repeat(801)),
    'body should be truncated to 800 chars');
});

// buildDraftPrompt tone instruction
test('buildDraftPrompt includes tone instruction when opts.tone provided', () => {
  const r = buildDraftPrompt(
    { from_address: 'a@b.com', subject: 'Hi', body_text: 'hello' },
    { tone: 'friendly' }
  );
  assert.ok(r.includes('friendly'), 'tone instruction must be present when opts.tone is provided');
});

// PROMPT-03: SYSTEM_PROMPT includes disambiguation examples for the 3 confused pairs
test('PROMPT-03: SYSTEM_PROMPT includes disambiguation examples for fyi/other, rewards_awards/fyi, meeting_request/other', () => {
  ['fyi', 'rewards_awards', 'meeting_request'].forEach(c => {
    const count = (SYSTEM_PROMPT.match(new RegExp('not ' + c, 'g')) || []).length;
    assert.ok(count >= 1, c + ' disambiguation missing from SYSTEM_PROMPT');
  });
  // Confirm all three 'not X' phrasings are explicitly present
  assert.ok(SYSTEM_PROMPT.includes('not fyi'), 'SYSTEM_PROMPT must include "not fyi"');
  assert.ok(SYSTEM_PROMPT.includes('not rewards_awards'), 'SYSTEM_PROMPT must include "not rewards_awards"');
  assert.ok(SYSTEM_PROMPT.includes('not meeting_request'), 'SYSTEM_PROMPT must include "not meeting_request"');
});
