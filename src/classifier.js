const { db, getConfig } = require('./db');
const llm = require('./llm');
const { CATEGORIES, URGENCIES } = require('./llm/providers/base');
const { fetchThreadContext, buildThreadContext } = require('./llm/thread');

let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }

// Per-user queue state
const queues = new Map(); // userId -> { queue: [], processing: false }
const attempts = new Map(); // `${userId}::${emailId}` -> attemptCount
const MAX_ATTEMPTS = 3;

function q(userId) {
  let s = queues.get(userId);
  if (!s) { s = { queue: [], processing: false }; queues.set(userId, s); }
  return s;
}

// ─── Tier 1: Rules-based classifier (instant, zero latency) ──────────────────

function rulesClassify(email) {
  const sub  = (email.subject      || '').toLowerCase();
  const from = (email.from_address || '').toLowerCase();
  // Widened body window from 300 → 1500 chars so phrases like "Booking Reference
  // ABC123", "Amount Due", "Scheduled for ..." that usually live deeper in the
  // body can still trigger a rule. Still cheap (<1 ms regex on 1500 chars).
  const body = (email.body_text    || '').substring(0, 1500).toLowerCase();
  const all  = sub + ' ' + body;

  // ── Travel ────────────────────────────────────────────────────────────────
  if (/\bpnr\b|booking confirm|flight booking|hotel reserv|check-in|check in|itinerary|e-ticket|boarding pass/.test(sub)) return 'travel';
  if (/indigo|spicejet|air india|airindia|vistara|goair|akasa|makemytrip|goibibo|cleartrip|booking\.com|airbnb|hotels\.com|marriott|oyo/.test(from)) return 'travel';
  if (/\bpnr[:\s]|booking reference|flight (?:number|pnr)|departure[:\s]|arrival[:\s]|check[\s-]?in date|boarding pass|itinerary id/.test(body)) return 'travel';

  // ── Financial ─────────────────────────────────────────────────────────────
  if (/statement|credit card bill|amount due|payment due|emi due|outstanding amount|invoice|receipt|transaction alert|payment sheet|payment schedule|payment summary|payment reminder|bill payment|payslip|salary slip|tax invoice/.test(sub)) return 'financial';
  if (/hdfc|icici|axis bank|sbi|kotak|paytm|razorpay|phonepe|gpay|navi|bajaj finance|cred\.club/.test(from)) return 'financial';
  if (/(?:amount|balance|total) due[:\s]|payment due (?:on|by|date)|minimum amount payable|outstanding balance|invoice (?:number|no|amount)|transaction (?:alert|details)|credited to your account|debited from your account/.test(body)) return 'financial';

  // ── Legal ─────────────────────────────────────────────────────────────────
  if (/legal notice|without prejudice|take notice|cease and desist|\bnda\b|non.disclosure|arbitration|litigation|summons/.test(sub)) return 'legal';
  if (/without prejudice|cease and desist|legal notice|pursuant to section|breach of contract|served with (?:a )?(?:notice|summons)|arbitration proceedings|non.?disclosure agreement/.test(body)) return 'legal';

  // ── Meeting / Calendar ───────────────────────────────────────────────────
  if (/\bmeeting\b|\binvite\b|calendar invite|has invited you|scheduled a|let's connect|quick call|video call|zoom link|google meet|teams meeting|webex/.test(sub)) return 'meeting_request';
  if (/\bmeeting\b|\binvite\b|scheduled a|has invited you/.test(body) && /zoom|meet|teams|webex|calendly/.test(all)) return 'meeting_request';
  if (/when[:\s].{0,80}(?:am|pm)|where[:\s](?:zoom|google meet|teams|webex|http)|join (?:the )?(?:zoom|meet|teams|webex|meeting)|calendar invite attached|begin:vcalendar|dtstart[:;]/.test(body)) return 'meeting_request';

  // ── Rewards / Awards ─────────────────────────────────────────────────────
  if (/points expir|miles expir|reward.*expir|cashback|loyalty point|bluechip|smartbuy|reward balance|voucher|gift card|award nominat|recognition/.test(sub)) return 'rewards_awards';
  if (/your (?:points|miles) (?:are )?expir|\d+ reward points|cashback credited|loyalty (?:program|tier)|redeem your (?:points|miles|voucher)|congratulations.{0,40}(?:award|nominat)/.test(body)) return 'rewards_awards';

  // ── Pitch deck / Investment ──────────────────────────────────────────────
  if (/pitch|investment opportun|series [abcd]|funding round|seeking investment|venture capital|\bvc\b.*fund/.test(sub)) return 'pitch_deck';
  if (/pitch deck (?:attached|included)|our (?:seed|series [a-d]) round|raising \$?\d|pre.?money valuation|(?:term sheet|cap table) attached|our portfolio includes/.test(body)) return 'pitch_deck';

  // ── FYI / Newsletters / System notifications ─────────────────────────────
  // Be precise. We deliberately do NOT match on body-level "unsubscribe" or
  // CAN-SPAM compliance phrases — every legitimate transactional email
  // (banking, SaaS access alerts, HR comms) contains an unsubscribe footer
  // and would otherwise be mis-bucketed as FYI.
  if (/newsletter|weekly digest|monthly update|round.?up/.test(all)) return 'fyi';
  if (/noreply@|no-reply@|newsletter@|digest@|updates@|mailer@|notifications@|donotreply@/.test(from)) return 'fyi';
  if (/\bdigest\b|\bnewsletter\b|\bweekly\b|\bmonthly\b/.test(sub) && !/meeting|invoice|statement/.test(sub)) return 'fyi';
  if (/emeritus|coursera|udemy|edx|canvas notification|assignment posted|week \d+ of|course update|programme.*notification/.test(from + ' ' + sub)) return 'fyi';
  if (/notification|alert|reminder|is now available|has been posted/.test(sub) && /noreply|system|auto/.test(from)) return 'fyi';

  // ── Speaking / conference invites ────────────────────────────────────────
  if (/invitation to speak|keynote|panelist|speaker.*invitation|invite you to|join us for|masterclass|webinar|conference.*invite/.test(sub)) return 'meeting_request';
  if (/one.to.one|1:1|catch.?up|sync.?up|quick chat/.test(sub)) return 'meeting_request';

  return null;
}

function rulesExtractedData(category, email) {
  const sub  = email.subject || '';
  const body = email.body_text || '';
  const from = email.from_name || email.from_address || '';

  if (category === 'travel') {
    const pnr = sub.match(/pnr[:\s]+([A-Z0-9-]{5,10})/i) || body.match(/pnr[:\s]+([A-Z0-9-]{5,10})/i);
    return { booking_reference: pnr ? pnr[1] : '', carrier: from, trip_dates: '', destination: '' };
  }
  if (category === 'financial') {
    const amt = body.match(/(?:rs\.?|₹|inr)\s*[\d,]+(?:\.\d{2})?/i);
    const due = body.match(/due (?:by |date[:\s]+)?(\w+ \d+,? \d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    return { institution: from, amount_due: amt ? amt[0] : '', due_date: due ? due[1] : '', account_last4: '' };
  }
  if (category === 'meeting_request') {
    const platform = /zoom/i.test(sub + body) ? 'Zoom' : /google meet/i.test(sub + body) ? 'Google Meet' : /teams/i.test(sub + body) ? 'Microsoft Teams' : /webex/i.test(sub + body) ? 'Webex' : '';
    return { organizer: from, platform, meeting_date: '', meeting_time: '', meeting_location: platform };
  }
  if (category === 'rewards_awards') {
    const pts = body.match(/[\d,]+ (?:points|miles)/i);
    return { program_name: from, points_balance: pts ? pts[0] : '', expiry_date: '', estimated_value: '' };
  }
  if (category === 'fyi') {
    return { topic: sub.substring(0, 60), sender_type: 'newsletter' };
  }
  return {};
}

function rulesUrgency(category, email) {
  const sub  = (email.subject   || '').toLowerCase();
  const body = (email.body_text || '').substring(0, 300).toLowerCase();

  if (category === 'legal') return { urgency: 'urgent', urgency_reason: 'Legal matter requires immediate attention' };
  if (/urgent|immediate|asap|today|expir|deadline|overdue|last chance|action required/.test(sub)) {
    return { urgency: 'urgent', urgency_reason: 'Marked urgent or time-sensitive' };
  }
  if (/tomorrow|this week|reminder|due soon|expir/.test(sub + body)) {
    return { urgency: 'moderate', urgency_reason: 'Time-sensitive action needed soon' };
  }
  return { urgency: 'normal', urgency_reason: null };
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function fallbackClassification() {
  return {
    category: 'other', urgency: 'normal', urgency_reason: null,
    summary: 'Classification unavailable.',
    extracted_data: JSON.stringify({ type: 'unknown' }),
    suggested_tone: 'professional',
    draft_reply: null
  };
}

// ─── Classification scope ────────────────────────────────────────────────────
//
// To bound LLM cost, only the smaller of {latest 100 emails, last 10 days} per
// user is eligible for classification. Out-of-scope emails store no row and
// surface in the UI as "uncategorized". The pending-count query in
// /api/llm/status applies the same predicate so the dashboard pill stays
// consistent.
const SCOPE_DAYS = 10;
const SCOPE_LIMIT = 100;

function isInClassificationScope(userId, emailId) {
  const row = db.prepare(`
    SELECT 1 FROM emails e
    WHERE e.id = ? AND e.user_id = ?
      AND e.received_at >= datetime('now', '-${SCOPE_DAYS} days')
      AND e.id IN (
        SELECT id FROM emails
        WHERE user_id = ?
        ORDER BY received_at DESC
        LIMIT ${SCOPE_LIMIT}
      )
  `).get(emailId, userId, userId);
  return !!row;
}

// ─── Core classification ──────────────────────────────────────────────────────

async function classifyEmail(userId, emailId) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(emailId, userId);
  if (!email) return;

  const existing = db.prepare('SELECT id FROM classifications WHERE email_id = ? AND user_id = ?').get(emailId, userId);
  if (existing) return;

  // Scope gate: skip emails outside the classification window. No row written —
  // pending-count query mirrors this predicate so they don't appear "stuck".
  if (!isInClassificationScope(userId, emailId)) return;

  // Attempt tracking (INFRA-02): cap retries to prevent unbounded API spend during outages.
  const attemptKey = `${userId}::${emailId}`;
  const currentAttempts = (attempts.get(attemptKey) || 0) + 1;
  attempts.set(attemptKey, currentAttempts);
  if (currentAttempts > MAX_ATTEMPTS) {
    // IN-02: pass the already-fetched email so storeClassification doesn't re-query.
    storeClassification(userId, emailId, { ...fallbackClassification(), source: 'failed' }, email);
    attempts.delete(attemptKey);
    return;
  }

  // Tier 1: instant rules
  const rulesCategory = rulesClassify(email);
  if (rulesCategory) {
    const { urgency, urgency_reason } = rulesUrgency(rulesCategory, email);
    const extracted = rulesExtractedData(rulesCategory, email);
    const sub = email.subject || '';
    const summary = `${email.from_name || email.from_address} sent: ${sub.substring(0, 80)}${sub.length > 80 ? '...' : ''}.`;
    attempts.delete(attemptKey);
    // IN-02: pass the already-fetched email to avoid a redundant DB round-trip.
    storeClassification(userId, emailId, {
      category: rulesCategory, urgency, urgency_reason, summary,
      extracted_data: extracted, suggested_tone: 'professional', draft_reply: null,
      source: 'rules'
    }, email);
    return;
  }

  // Tier 2: provider cascade (nvidia → groq → gemini → deepseek)
  try {
    const priorMessages = (() => {
      try { return fetchThreadContext(userId, email); } catch (_) { return []; }
    })();
    const threadContext = buildThreadContext(priorMessages) || undefined;
    const routed = await llm.router.classify(email, { mode: 'full', userId, threadContext });
    if (routed) {
      attempts.delete(attemptKey);
      // IN-02: pass the already-fetched email to avoid a redundant DB round-trip.
      storeClassification(userId, emailId, {
        category:       routed.category,
        urgency:        routed.urgency,
        urgency_reason: routed.urgency_reason,
        summary:        routed.summary,
        extracted_data: routed.extracted_data || {},
        suggested_tone: routed.suggested_tone || 'professional',
        draft_reply:    routed.draft_reply    || null,
        source:         'llm',
        low_confidence: routed.low_confidence || false
      }, email);
      return;
    }
  } catch (err) {
    console.error(`[classifier] router failed for user=${userId} email=${emailId}:`, err.message);
  }
  // IN-02: pass the already-fetched email to avoid a redundant DB round-trip.
  storeClassification(userId, emailId, { ...fallbackClassification(), source: 'fallback' }, email);
}

// IN-02: Accept an optional pre-fetched email object to avoid a redundant DB
// query on every classification. callers in classifyEmail already hold the
// email row; passing it here eliminates one SELECT per classification.
// External callers (e.g. the reclassify API route) can omit the parameter
// and the function will fall back to querying when needed.
function storeClassification(userId, emailId, data, emailRow) {
  // WR-04: Narrowed error handling — only the optional draft insert is silently
  // swallowed. The classification INSERT and broadcast are in a separate try so
  // a schema error, constraint violation, or migration mismatch surfaces in logs
  // and stops the function rather than silently producing no classification row.
  // Sanitize category/urgency at the storage boundary. parseProviderResponse
  // already does this for LLM output, but a defense-in-depth check here
  // catches any code path that constructs `data` directly (e.g. legacy
  // imports, future callers, or out-of-enum values like the historical
  // 'request' rows the old TF-IDF classifier wrote).
  const safeCategory = CATEGORIES.includes(data.category) ? data.category : 'other';
  const safeUrgency  = URGENCIES.includes(data.urgency)   ? data.urgency  : 'normal';

  try {
    db.prepare(`
      INSERT OR IGNORE INTO classifications
      (user_id, email_id, category, urgency, urgency_reason, summary, extracted_data, draft_reply, suggested_tone, source, low_confidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      userId, emailId, safeCategory, safeUrgency, data.urgency_reason,
      data.summary,
      typeof data.extracted_data === 'string' ? data.extracted_data : JSON.stringify(data.extracted_data || {}),
      data.draft_reply || null, data.suggested_tone, data.source || null,
      data.low_confidence ? 1 : 0
    );

    // CR-06: Use the sanitized local variables, not the raw data fields.
    // data.category/data.urgency may contain out-of-enum values (e.g. legacy
    // 'request' category) — clients listening to SSE events must receive the
    // same sanitized values that were written to the DB.
    broadcast('classification_done', {
      user_id: userId,
      email_id: emailId,
      category: safeCategory,
      urgency:  safeUrgency
    });
  } catch (e) {
    console.error('[classifier] storeClassification failed:', e.message);
    return; // Do not attempt the draft insert if classification INSERT failed
  }

  // Draft insert is truly optional — a failed draft must not block sync.
  try {
    // Create an empty draft row for EVERY email (regardless of category).
    // The draft editor will auto-regen on first open via the router, so users
    // get an LLM reply on every email — inbox, urgent, fyi, anything.
    // IN-02: use the pre-fetched emailRow if available to avoid a redundant SELECT.
    const email = emailRow || db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(emailId, userId);
    const existing = db.prepare('SELECT id FROM drafts WHERE email_id = ? AND user_id = ?').get(emailId, userId);
    if (!existing && email) {
      db.prepare('INSERT INTO drafts (user_id, email_id, body, tone, subject, to_address) VALUES (?,?,?,?,?,?)')
        .run(userId, emailId, '', data.suggested_tone || 'professional', 'Re: ' + email.subject, email.from_address);
    }
  } catch { /* silent: draft creation is optional and must not block sync */ }
}

async function processQueueFor(userId) {
  const s = q(userId);
  if (s.processing || s.queue.length === 0) return;
  s.processing = true;
  try {
    while (s.queue.length > 0) {
      const batch = s.queue.splice(0, 5);
      await Promise.all(batch.map(id => classifyEmail(userId, id)));
    }
  } finally {
    s.processing = false;
  }
}

function queueClassification(userId, emailId) {
  const s = q(userId);
  if (!s.queue.includes(emailId)) s.queue.push(emailId);
  setImmediate(() => processQueueFor(userId));
}

async function classifyAllUnclassifiedForUser(userId) {
  const rows = db.prepare(`
    SELECT e.id FROM emails e
    LEFT JOIN classifications c ON c.email_id = e.id AND c.user_id = e.user_id
    WHERE c.id IS NULL AND e.user_id = ?
  `).all(userId);
  for (const row of rows) queueClassification(userId, row.id);
}

// ─── Draft generation ─────────────────────────────────────────────────────────

async function generateDraft(userId, emailId) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(emailId, userId);
  if (!email) return null;
  try {
    const priorMessages = (() => {
      try { return fetchThreadContext(userId, email); } catch (_) { return []; }
    })();
    const threadContext = buildThreadContext(priorMessages) || undefined;
    const routed = await llm.router.generateDraft(email, { mode: 'draft', userId, threadContext });
    return routed?.draft_reply || 'Thank you for your email. I will review and respond shortly.';
  } catch (err) {
    // WR-03: Log failures so they are visible during debugging. Silent swallow
    // made LLM call failures invisible — the router could throw from a bug and
    // leave no trace in logs.
    console.warn('[classifier] generateDraft failed:', err.message);
    return 'Thank you for your email. I will review and respond shortly.';
  }
}

module.exports = {
  queueClassification,
  classifyAllUnclassifiedForUser,
  classifyEmail,
  generateDraft,
  setBroadcast,
  isInClassificationScope,
  SCOPE_DAYS,
  SCOPE_LIMIT
};
