const { db, getConfig } = require('./db');
const llm = require('./llm');

let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }

// Per-user queue state
const queues = new Map(); // userId -> { queue: [], processing: false }

function q(userId) {
  let s = queues.get(userId);
  if (!s) { s = { queue: [], processing: false }; queues.set(userId, s); }
  return s;
}

// ─── Tier 1: Rules-based classifier (instant, zero latency) ──────────────────

function rulesClassify(email) {
  const sub  = (email.subject      || '').toLowerCase();
  const from = (email.from_address || '').toLowerCase();
  const body = (email.body_text    || '').substring(0, 300).toLowerCase();
  const all  = sub + ' ' + body;

  if (/\bpnr\b|booking confirm|flight booking|hotel reserv|check-in|check in|itinerary|e-ticket|boarding pass/.test(sub)) return 'travel';
  if (/indigo|spicejet|air india|airindia|vistara|goair|akasa|makemytrip|goibibo|cleartrip|booking\.com|airbnb|hotels\.com|marriott|oyo/.test(from)) return 'travel';

  if (/statement|credit card bill|amount due|payment due|emi due|outstanding amount|invoice|receipt|transaction alert/.test(sub)) return 'financial';
  if (/hdfc|icici|axis bank|sbi|kotak|paytm|razorpay|phonepe|gpay|navi|bajaj finance|cred\.club/.test(from)) return 'financial';

  if (/legal notice|without prejudice|take notice|cease and desist|\bnda\b|non.disclosure|arbitration|litigation|summons/.test(sub)) return 'legal';

  if (/\bmeeting\b|\binvite\b|calendar invite|has invited you|scheduled a|let's connect|quick call|video call|zoom link|google meet|teams meeting|webex/.test(sub)) return 'meeting_request';
  if (/\bmeeting\b|\binvite\b|scheduled a|has invited you/.test(body) && /zoom|meet|teams|webex|calendly/.test(all)) return 'meeting_request';

  if (/points expir|miles expir|reward.*expir|cashback|loyalty point|bluechip|smartbuy|reward balance|voucher|gift card|award nominat|recognition/.test(sub)) return 'rewards_awards';

  if (/pitch|investment opportun|series [abcd]|funding round|seeking investment|venture capital|\bvc\b.*fund/.test(sub)) return 'pitch_deck';

  if (/newsletter|weekly digest|monthly update|round.?up|unsubscribe/.test(all)) return 'fyi';
  if (/noreply@|no-reply@|newsletter@|digest@|updates@|mailer@|notifications@|donotreply@/.test(from)) return 'fyi';
  if (/\bdigest\b|\bnewsletter\b|\bweekly\b|\bmonthly\b/.test(sub) && !/meeting|invoice|statement/.test(sub)) return 'fyi';
  if (/emeritus|coursera|udemy|edx|canvas notification|assignment posted|week \d+ of|course update|programme.*notification/.test(from + ' ' + sub)) return 'fyi';
  if (/notification|alert|reminder|is now available|has been posted/.test(sub) && /noreply|system|auto/.test(from)) return 'fyi';

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

// ─── Core classification ──────────────────────────────────────────────────────

async function classifyEmail(userId, emailId) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(emailId, userId);
  if (!email) return;

  const existing = db.prepare('SELECT id FROM classifications WHERE email_id = ? AND user_id = ?').get(emailId, userId);
  if (existing) return;

  // Tier 1: instant rules
  const rulesCategory = rulesClassify(email);
  if (rulesCategory) {
    const { urgency, urgency_reason } = rulesUrgency(rulesCategory, email);
    const extracted = rulesExtractedData(rulesCategory, email);
    const sub = email.subject || '';
    const summary = `${email.from_name || email.from_address} sent: ${sub.substring(0, 80)}${sub.length > 80 ? '...' : ''}.`;
    storeClassification(userId, emailId, {
      category: rulesCategory, urgency, urgency_reason, summary,
      extracted_data: extracted, suggested_tone: 'professional', draft_reply: null
    });
    return;
  }

  // Tier 2: provider cascade (local → groq → gemini → ...)
  try {
    const routed = await llm.router.classify(email, { mode: 'full', userId });
    if (routed) {
      storeClassification(userId, emailId, {
        category:       routed.category,
        urgency:        routed.urgency,
        urgency_reason: routed.urgency_reason,
        summary:        routed.summary,
        extracted_data: routed.extracted_data || {},
        suggested_tone: routed.suggested_tone || 'professional',
        draft_reply:    routed.draft_reply    || null
      });
      return;
    }
  } catch (err) {
    console.error(`[classifier] router failed for user=${userId} email=${emailId}:`, err.message);
  }
  storeClassification(userId, emailId, fallbackClassification());
}

function storeClassification(userId, emailId, data) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO classifications
      (user_id, email_id, category, urgency, urgency_reason, summary, extracted_data, draft_reply, suggested_tone)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      userId, emailId, data.category, data.urgency, data.urgency_reason,
      data.summary,
      typeof data.extracted_data === 'string' ? data.extracted_data : JSON.stringify(data.extracted_data || {}),
      data.draft_reply || null, data.suggested_tone
    );

    broadcast('classification_done', {
      user_id: userId,
      email_id: emailId,
      category: data.category,
      urgency:  data.urgency
    });

    // Create an empty draft row for EVERY email (regardless of category).
    // The draft editor will auto-regen on first open via the router, so users
    // get an LLM reply on every email — inbox, urgent, fyi, anything.
    const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(emailId, userId);
    const existing = db.prepare('SELECT id FROM drafts WHERE email_id = ? AND user_id = ?').get(emailId, userId);
    if (!existing && email) {
      db.prepare('INSERT INTO drafts (user_id, email_id, body, tone, subject, to_address) VALUES (?,?,?,?,?,?)')
        .run(userId, emailId, '', data.suggested_tone || 'professional', 'Re: ' + email.subject, email.from_address);
    }
  } catch (e) {
    // silent: classifier failures shouldn't block sync
  }
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
    const routed = await llm.router.classify(email, { mode: 'regen', userId });
    return routed?.draft_reply || 'Thank you for your email. I will review and respond shortly.';
  } catch {
    return 'Thank you for your email. I will review and respond shortly.';
  }
}

module.exports = {
  queueClassification,
  classifyAllUnclassifiedForUser,
  classifyEmail,
  generateDraft,
  setBroadcast
};
