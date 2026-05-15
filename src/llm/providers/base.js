// IN-01: Named constant for body truncation limit.
// Exported so tests can reference it directly — if the limit changes,
// only this one value needs updating (not 4+ separate occurrences).
const BODY_SNIPPET_LEN = 800;

const CATEGORIES = [
  'meeting_request', 'financial', 'legal', 'travel',
  'pitch_deck', 'fyi', 'rewards_awards', 'other'
];
const URGENCIES = ['urgent', 'moderate', 'normal'];
const TONES = ['formal', 'professional', 'friendly', 'brief'];

const DEFAULTS = {
  category: 'other',
  urgency: 'normal',
  urgency_reason: null,
  summary: 'Classification unavailable.',
  extracted_data: {},
  suggested_tone: 'professional',
  draft_reply: 'Thank you for your email. I will review and respond shortly.'
};

const SYSTEM_PROMPT = `You are an email classifier for IntelliMail. Classify the email below.

Respond with a single JSON object matching this schema — and nothing else:
{
  "category": one of [${CATEGORIES.map(c => `"${c}"`).join(', ')}],
  "urgency": one of ["urgent", "moderate", "normal"],
  "urgency_reason": short string or null,
  "summary": one sentence — state what happened and what action (if any) the recipient needs to take — do not repeat the subject line,
  "extracted_data": object with category-specific fields (may be empty),
  "suggested_tone": one of ["formal", "professional", "friendly", "brief"]
}

Category definitions:
- meeting_request: calendar invites, Zoom/Teams/Meet links, scheduling requests
- financial: invoices, payments, billing, expense reports, wire transfers
- legal: contracts, NDAs, compliance notices, court-related documents
- travel: flight/hotel/car bookings, itineraries, trip confirmations
- pitch_deck: startup pitches, investment decks, product proposals seeking funding
- fyi: newsletters, digests, announcements, noreply senders, no action needed
- rewards_awards: loyalty points, cashback, promo codes, membership rewards
- other: personal conversation, general questions, none of the above apply

Rules:
- Legal emails are always urgent.
- Calendar invites / Zoom / Teams / Meet links are meeting_request.
- Newsletters, digests, noreply senders are fyi.
- If unsure, use "other".

Disambiguation examples:
Subject: Q2 Company Newsletter, From: comms@company.com → fyi (not other: mass-distribution announcement, no action required; not rewards_awards: no redeemable benefit)
Subject: New feature shipped, From: product@startup.com → fyi (not other: digest-style update, noreply sender, no reply needed; not meeting_request: no scheduling intent)
Subject: You earned 500 points!, From: rewards@airline.com → rewards_awards (not fyi: loyalty program credit, contains redeemable value)
Subject: Your cashback is ready, From: noreply@bank.com → rewards_awards (not fyi: financial benefit attached, not purely informational)
Subject: Let's connect next week, From: colleague@firm.com → meeting_request (not other: scheduling intent, calendar coordination implied)
Subject: Zoom call tomorrow?, From: partner@vendor.com → meeting_request (not other: explicit video call link or scheduling request)`;

function buildPrompt(email, opts = {}) {
  const lines = [];
  lines.push(SYSTEM_PROMPT);
  lines.push('');
  if (opts.threadContext) {
    lines.push('## Prior thread context');
    lines.push('');
    lines.push(opts.threadContext);
    lines.push('');
    lines.push('## Current email');
    lines.push('');
  }
  lines.push(`From: ${email.from_name || ''} <${email.from_address || ''}>`);
  lines.push(`Subject: ${email.subject || ''}`);
  const body = (email.body_text || email.preview || '').slice(0, BODY_SNIPPET_LEN);
  if (body) lines.push('', body);
  return lines.join('\n');
}

function buildDraftPrompt(email, opts = {}) {
  const lines = [];
  lines.push('You are drafting a reply email on behalf of the recipient.');
  lines.push('Write a direct, complete reply. 2-4 sentences. No subject line. No placeholder text.');
  lines.push('');
  if (opts.threadContext) {
    lines.push('## Prior thread context');
    lines.push('');
    lines.push(opts.threadContext);
    lines.push('');
    lines.push('## Current email');
    lines.push('');
  }
  lines.push(`From: ${email.from_name || ''} <${email.from_address || ''}>`);
  lines.push(`Subject: ${email.subject || ''}`);
  const body = (email.body_text || email.preview || '').slice(0, BODY_SNIPPET_LEN);
  if (body) lines.push('', body);
  if (opts.tone) lines.push('', `Write in a ${opts.tone} tone.`);
  return lines.join('\n');
}

function extractJsonBlock(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

function parseProviderResponse(raw, opts = {}) {
  if (typeof raw !== 'string') {
    throw new Error('could not parse provider response: not a string');
  }
  const obj = extractJsonBlock(raw);
  if (!obj || typeof obj !== 'object') {
    const provider = opts.provider || 'unknown';
    const excerpt = raw.slice(0, 200);
    console.warn(`[llm/base] parse_failure provider=${provider} raw="${excerpt}"`);
    return { ...DEFAULTS, error: 'parse_failure', low_confidence: true };
  }
  const categoryMissed = !CATEGORIES.includes(obj.category);
  const out = { ...DEFAULTS };
  if (CATEGORIES.includes(obj.category)) out.category = obj.category;
  if (URGENCIES.includes(obj.urgency)) out.urgency = obj.urgency;
  if (typeof obj.urgency_reason === 'string') out.urgency_reason = obj.urgency_reason;
  if (typeof obj.summary === 'string') out.summary = obj.summary.slice(0, 200);
  if (obj.extracted_data && typeof obj.extracted_data === 'object') {
    out.extracted_data = obj.extracted_data;
  }
  if (TONES.includes(obj.suggested_tone)) out.suggested_tone = obj.suggested_tone;
  if (typeof obj.draft_reply === 'string') out.draft_reply = obj.draft_reply;
  if (out.category === 'legal') out.urgency = 'urgent';
  if (categoryMissed) out.low_confidence = true;
  return out;
}

module.exports = {
  CATEGORIES, URGENCIES, TONES, DEFAULTS,
  buildPrompt, buildDraftPrompt, parseProviderResponse, extractJsonBlock,
  SYSTEM_PROMPT, BODY_SNIPPET_LEN
};
