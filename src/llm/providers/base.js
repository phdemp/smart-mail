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
  "summary": one-line summary (max 120 chars),
  "extracted_data": object with category-specific fields (may be empty),
  "suggested_tone": one of ["formal", "professional", "friendly", "brief"],
  "draft_reply": a complete suggested reply as a string
}

Rules:
- Legal emails are always urgent.
- Calendar invites / Zoom / Teams / Meet links are meeting_request.
- Newsletters, digests, noreply senders are fyi.
- If unsure, use "other".`;

function buildPrompt(email, opts = {}) {
  const lines = [];
  lines.push(SYSTEM_PROMPT);
  lines.push('');
  lines.push(`From: ${email.from_name || ''} <${email.from_address || ''}>`);
  lines.push(`Subject: ${email.subject || ''}`);
  const body = (email.body_text || email.preview || '').slice(0, 800);
  if (body) lines.push('', body);
  if (opts.mode === 'regen' && opts.tone) {
    lines.push('', `Generate the draft_reply in a ${opts.tone} tone.`);
  }
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

function parseProviderResponse(raw) {
  if (typeof raw !== 'string') {
    throw new Error('could not parse provider response: not a string');
  }
  const obj = extractJsonBlock(raw);
  if (!obj || typeof obj !== 'object') {
    throw new Error('could not parse provider response: no JSON object found');
  }
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
  return out;
}

module.exports = {
  CATEGORIES, URGENCIES, TONES, DEFAULTS,
  buildPrompt, parseProviderResponse, extractJsonBlock,
  SYSTEM_PROMPT
};
