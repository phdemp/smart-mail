const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTemplateReply } = require('../../src/llm/templates');

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
