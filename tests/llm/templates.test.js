const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTemplateReply, GENERIC, TABLE } = require('../../src/llm/templates');

test('template for meeting_request professional', () => {
  const r = buildTemplateReply({ category: 'meeting_request' }, 'professional');
  assert.match(r, /meeting/i);
});

test('legal category forces professional tone', () => {
  const r = buildTemplateReply({ category: 'legal' }, 'friendly');
  assert.match(r, /acknowledge|notice/i);
  assert.doesNotMatch(r, /cheers|thanks!/i);
});

test('unknown category returns generic reply', () => {
  const r = buildTemplateReply({ category: 'spam' }, 'professional');
  assert.match(r, /thank|review/i);
});

test('unknown tone falls back to professional', () => {
  const r = buildTemplateReply({ category: 'fyi' }, 'sarcastic');
  assert.ok(typeof r === 'string' && r.length > 0);
});

// ─── Warm tone tests (D-11) ────────────────────────────────────────────────

test('GENERIC has warm key', () => {
  assert.ok(GENERIC.warm, 'GENERIC.warm is missing');
  assert.ok(typeof GENERIC.warm === 'string' && GENERIC.warm.length > 0, 'GENERIC.warm must be a non-empty string');
});

test('buildTemplateReply other warm returns non-undefined string', () => {
  const r = buildTemplateReply({ category: 'other' }, 'warm');
  assert.ok(r && typeof r === 'string', 'other warm returned undefined or non-string');
});

test('buildTemplateReply meeting_request warm returns non-undefined string', () => {
  const r = buildTemplateReply({ category: 'meeting_request' }, 'warm');
  assert.ok(r && typeof r === 'string', 'meeting_request warm returned undefined or non-string');
});

test('buildTemplateReply financial warm returns non-undefined string', () => {
  const r = buildTemplateReply({ category: 'financial' }, 'warm');
  assert.ok(r && typeof r === 'string', 'financial warm returned undefined or non-string');
});

test('buildTemplateReply travel warm returns non-undefined string', () => {
  const r = buildTemplateReply({ category: 'travel' }, 'warm');
  assert.ok(r && typeof r === 'string', 'travel warm returned undefined or non-string');
});

test('buildTemplateReply legal warm returns non-undefined string', () => {
  const r = buildTemplateReply({ category: 'legal' }, 'warm');
  assert.ok(r && typeof r === 'string', 'legal warm returned undefined or non-string');
});

test('buildTemplateReply fyi warm returns non-undefined string', () => {
  const r = buildTemplateReply({ category: 'fyi' }, 'warm');
  assert.ok(r && typeof r === 'string', 'fyi warm returned undefined or non-string');
});

test('buildTemplateReply rewards_awards warm returns non-undefined string', () => {
  const r = buildTemplateReply({ category: 'rewards_awards' }, 'warm');
  assert.ok(r && typeof r === 'string', 'rewards_awards warm returned undefined or non-string');
});

test('buildTemplateReply pitch_deck warm returns non-undefined string', () => {
  const r = buildTemplateReply({ category: 'pitch_deck' }, 'warm');
  assert.ok(r && typeof r === 'string', 'pitch_deck warm returned undefined or non-string');
});

test('TABLE meeting_request has warm key', () => {
  assert.ok(TABLE.meeting_request.warm, 'TABLE.meeting_request.warm is missing');
});

test('TABLE financial has warm key', () => {
  assert.ok(TABLE.financial.warm, 'TABLE.financial.warm is missing');
});

test('TABLE travel has warm key', () => {
  assert.ok(TABLE.travel.warm, 'TABLE.travel.warm is missing');
});

test('TABLE legal has warm key', () => {
  assert.ok(TABLE.legal.warm, 'TABLE.legal.warm is missing');
});

test('TABLE fyi has warm key', () => {
  assert.ok(TABLE.fyi.warm, 'TABLE.fyi.warm is missing');
});

test('TABLE rewards_awards has warm key', () => {
  assert.ok(TABLE.rewards_awards.warm, 'TABLE.rewards_awards.warm is missing');
});

test('TABLE pitch_deck has warm key', () => {
  assert.ok(TABLE.pitch_deck.warm, 'TABLE.pitch_deck.warm is missing');
});

test('existing formal tone entries unchanged', () => {
  assert.ok(TABLE.meeting_request.formal, 'meeting_request.formal missing');
  assert.ok(TABLE.financial.formal, 'financial.formal missing');
  assert.ok(GENERIC.formal, 'GENERIC.formal missing');
});

test('existing professional tone entries unchanged', () => {
  assert.ok(TABLE.meeting_request.professional, 'meeting_request.professional missing');
  assert.ok(TABLE.financial.professional, 'financial.professional missing');
  assert.ok(GENERIC.professional, 'GENERIC.professional missing');
});

test('existing friendly tone entries unchanged', () => {
  assert.ok(TABLE.meeting_request.friendly, 'meeting_request.friendly missing');
  assert.ok(TABLE.financial.friendly, 'financial.friendly missing');
  assert.ok(GENERIC.friendly, 'GENERIC.friendly missing');
});

test('existing brief tone entries unchanged', () => {
  assert.ok(TABLE.meeting_request.brief, 'meeting_request.brief missing');
  assert.ok(TABLE.financial.brief, 'financial.brief missing');
  assert.ok(GENERIC.brief, 'GENERIC.brief missing');
});
