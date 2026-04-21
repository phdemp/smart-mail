const { db, getConfig } = require('./db');
const llm = require('./llm');

let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }

let classificationQueue = [];
let processing = false;

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

// ─── Draft generation ─────────────────────────────────────────────────────────

async function generateDraft(emailId) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
  if (!email) return null;
  const routed = await llm.router.classify(email, { mode: 'regen' });
  return routed?.draft_reply || 'Thank you for your email. I will review and respond shortly.';
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

async function classifyEmail(emailId) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
  if (!email) return;

  const existing = db.prepare('SELECT id FROM classifications WHERE email_id = ?').get(emailId);
  if (existing) return;

  // Tier 1: instant rules
  const rulesCategory = rulesClassify(email);
  if (rulesCategory) {
    const { urgency, urgency_reason } = rulesUrgency(rulesCategory, email);
    const extracted = rulesExtractedData(rulesCategory, email);
    const sub = email.subject || '';
    const summary = `${email.from_name || email.from_address} sent: ${sub.substring(0, 80)}${sub.length > 80 ? '...' : ''}.`;
    storeClassification(emailId, {
      category: rulesCategory, urgency, urgency_reason, summary,
      extracted_data: extracted, suggested_tone: 'professional', draft_reply: null
    });
    return;
  }

  // Tier 2: provider cascade (local → groq → gemini → ...)
  const routed = await llm.router.classify(email, { mode: 'full' });
  if (routed) {
    storeClassification(emailId, {
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
  storeClassification(emailId, fallbackClassification());
}

function storeClassification(emailId, data) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO classifications
      (email_id, category, urgency, urgency_reason, summary, extracted_data, draft_reply, suggested_tone)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      emailId, data.category, data.urgency, data.urgency_reason,
      data.summary,
      typeof data.extracted_data === 'string' ? data.extracted_data : JSON.stringify(data.extracted_data || {}),
      data.draft_reply || null, data.suggested_tone
    );

    broadcast('classification_done', {
      email_id: emailId,
      category: data.category,
      urgency:  data.urgency
    });

    const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
    const existing = db.prepare('SELECT id FROM drafts WHERE email_id = ?').get(emailId);
    if (!existing && email && !['fyi', 'other'].includes(data.category)) {
      db.prepare('INSERT INTO drafts (email_id, body, tone, subject, to_address) VALUES (?,?,?,?,?)')
        .run(emailId, '', data.suggested_tone || 'professional', 'Re: ' + email.subject, email.from_address);
    }
  } catch (e) {
    // silent
  }
}

async function processQueue() {
  if (processing || classificationQueue.length === 0) return;
  processing = true;
  try {
    while (classificationQueue.length > 0) {
      const batch = classificationQueue.splice(0, 5);
      await Promise.all(batch.map(id => classifyEmail(id)));
    }
  } finally {
    processing = false;
  }
}

function queueClassification(...args) {
  // Accept both queueClassification(emailId) and queueClassification(userId, emailId).
  // Task 12 will use the userId. For now we only queue the emailId.
  const emailId = args[args.length - 1];
  if (!classificationQueue.includes(emailId)) {
    classificationQueue.push(emailId);
  }
  setImmediate(processQueue);
}

async function classifyAllUnclassified() {
  const rows = db.prepare(`
    SELECT e.id FROM emails e
    LEFT JOIN classifications c ON c.email_id = e.id
    WHERE c.id IS NULL
  `).all();
  for (const row of rows) queueClassification(row.id);
}

module.exports = { queueClassification, classifyAllUnclassified, classifyEmail, generateDraft, setBroadcast };
