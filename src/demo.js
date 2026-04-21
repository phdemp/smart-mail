const { db } = require('./db');

const DEMO_EMAILS = [
  {
    message_id: 'demo-001@intellimail',
    uid: '1001', folder: 'INBOX',
    from_address: 'sarah.chen@acmecorp.com', from_name: 'Sarah Chen',
    to_address: 'you@example.com',
    subject: 'Q4 Strategy Review — Tomorrow 10am',
    received_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    is_read: 0, is_starred: 1,
    body_text: `Hi,

I wanted to confirm our Q4 Strategy Review meeting scheduled for tomorrow at 10:00 AM IST.

We'll be connecting via Google Meet. Here's the link: meet.google.com/abc-defg-hij

Agenda:
1. Q3 performance review (15 min)
2. Q4 goals and OKRs (30 min)
3. Budget allocation discussion (20 min)
4. Open floor (10 min)

Please come prepared with your team's Q3 numbers and Q4 projections. I've attached the Q4 planning template for reference.

Looking forward to a productive session.

Best,
Sarah Chen
Head of Strategy, AcmeCorp`,
    classification: {
      category: 'meeting_request', urgency: 'urgent',
      urgency_reason: 'Meeting is tomorrow morning — requires immediate confirmation',
      summary: 'Sarah Chen from AcmeCorp has scheduled a Q4 Strategy Review for tomorrow at 10am IST via Google Meet. The 75-minute meeting covers Q3 review, Q4 OKRs, and budget. Your confirmation is needed today.',
      extracted_data: JSON.stringify({ meeting_date: 'Tomorrow', meeting_time: '10:00 AM IST', meeting_location: 'Google Meet', organizer: 'Sarah Chen', platform: 'Google Meet' }),
      suggested_tone: 'professional',
      draft_reply: `Hi Sarah,

Thank you for the calendar invite. I confirm my attendance for tomorrow's Q4 Strategy Review at 10:00 AM IST via Google Meet.

I'll have the Q3 numbers and Q4 projections ready for the discussion.

Looking forward to it.

Best regards`
    }
  },
  {
    message_id: 'demo-002@intellimail',
    uid: '1002', folder: 'INBOX',
    from_address: 'raj.patel@startupxyz.io', from_name: 'Raj Patel',
    to_address: 'you@example.com',
    subject: 'Product Demo Request — Next Week',
    received_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    is_read: 0, is_starred: 0,
    body_text: `Hello,

I'm Raj Patel, Head of Partnerships at StartupXYZ. We've been following your work and would love to schedule a 30-minute product demo next week.

We're particularly interested in how your platform handles enterprise integrations and would like to explore potential partnership opportunities.

Our preferred slots (IST):
- Tuesday, 2-3 PM
- Wednesday, 11 AM - 12 PM
- Thursday, 3-4 PM

Please let me know which works best for you, and I'll send a calendar invite.

Best,
Raj Patel
Head of Partnerships`,
    classification: {
      category: 'meeting_request', urgency: 'normal',
      urgency_reason: null,
      summary: 'Raj Patel from StartupXYZ requests a 30-minute product demo next week to explore enterprise integrations and partnership opportunities. He has provided three time slots for your selection.',
      extracted_data: JSON.stringify({ meeting_date: 'Next week (Tue/Wed/Thu)', meeting_time: 'See options in email', meeting_location: 'TBD', organizer: 'Raj Patel', platform: 'TBD' }),
      suggested_tone: 'professional',
      draft_reply: `Hi Raj,

Thank you for reaching out. I'd be happy to schedule a product demo.

Wednesday, 11 AM - 12 PM works well for me. Please go ahead and send the calendar invite with the meeting link.

Looking forward to connecting.

Best regards`
    }
  },
  {
    message_id: 'demo-003@intellimail',
    uid: '1003', folder: 'INBOX',
    from_address: 'statements@hdfcbank.com', from_name: 'HDFC Bank',
    to_address: 'you@example.com',
    subject: 'HDFC Credit Card Statement — October 2024',
    received_at: new Date(Date.now() - 18 * 3600000).toISOString(),
    is_read: 0, is_starred: 0,
    body_text: `Dear Valued Customer,

Your HDFC Credit Card Statement for October 2024 is now available.

Card Number: **** **** **** 4821
Statement Period: 01 Oct 2024 – 31 Oct 2024
Total Amount Due: ₹24,500.00
Minimum Amount Due: ₹2,450.00
Payment Due Date: 18 November 2024

To avoid late payment charges, please pay your dues before the payment due date.

Pay now at: netbanking.hdfcbank.com/netbanking

If you have already paid, please disregard this reminder.

Thank you for banking with HDFC Bank.

HDFC Bank Customer Service`,
    classification: {
      category: 'financial', urgency: 'moderate',
      urgency_reason: 'Payment due in 5 days — ₹24,500 outstanding',
      summary: 'Your HDFC Credit Card statement for October 2024 shows ₹24,500 due by November 18, 2024. Payment is due in 5 days. Minimum due is ₹2,450.',
      extracted_data: JSON.stringify({ institution: 'HDFC Bank', amount_due: '₹24,500.00', due_date: '18 November 2024', account_last4: '4821', statement_period: 'Oct 2024' }),
      suggested_tone: 'brief',
      draft_reply: `Thank you for sending the statement. Payment will be processed before the due date.`
    }
  },
  {
    message_id: 'demo-004@intellimail',
    uid: '1004', folder: 'INBOX',
    from_address: 'noreply@axisbank.com', from_name: 'Axis Bank',
    to_address: 'you@example.com',
    subject: 'Axis Bank Account Statement — October 2024',
    received_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    is_read: 1, is_starred: 0,
    body_text: `Dear Customer,

Please find your Axis Bank Savings Account statement for October 2024.

Account Number: XXXX XXXX 7234
Statement Period: 01 October 2024 to 31 October 2024
Opening Balance: ₹1,85,420.50
Closing Balance: ₹2,12,875.00

Total Credits: ₹85,000.00
Total Debits: ₹57,545.50

For a detailed transaction list, please log in to Axis Mobile or visit axisbank.com.

This is an auto-generated email. Please do not reply.

Warm regards,
Axis Bank Digital Team`,
    classification: {
      category: 'financial', urgency: 'normal',
      urgency_reason: null,
      summary: 'Axis Bank October 2024 savings account statement. Account ending 7234 shows closing balance of ₹2,12,875. Credits of ₹85,000 and debits of ₹57,545.50 for the month.',
      extracted_data: JSON.stringify({ institution: 'Axis Bank', amount_due: null, due_date: null, account_last4: '7234', statement_period: 'Oct 2024' }),
      suggested_tone: 'brief',
      draft_reply: `Thank you for the statement. Noted.`
    }
  },
  {
    message_id: 'demo-005@intellimail',
    uid: '1005', folder: 'INBOX',
    from_address: 'advocate@mehtaassociates.in', from_name: 'Mehta & Associates',
    to_address: 'you@example.com',
    subject: 'Legal Notice — Contract Dispute Re: Services Agreement dated March 2024',
    received_at: new Date(Date.now() - 6 * 3600000).toISOString(),
    is_read: 0, is_starred: 1,
    body_text: `WITHOUT PREJUDICE

Dear Sir/Madam,

We represent XYZ Pvt. Ltd. ("our Client") in the matter of an ongoing commercial dispute arising from the Services Agreement dated 15 March 2024 entered into between our Client and your company.

Our Client alleges that you have failed to deliver the software modules as stipulated in Schedule 2 of the Agreement, resulting in financial losses of INR 15,00,000 (Indian Rupees Fifteen Lakhs).

TAKE NOTICE that you are hereby called upon to:
1. Provide a written explanation within 14 (fourteen) calendar days of receipt of this notice
2. Propose a remediation plan for the pending deliverables
3. Settle the damages claim of INR 15,00,000

Failure to respond within the stipulated time will compel our Client to initiate appropriate legal proceedings without further notice.

Yours faithfully,
Advocate Priya Mehta
Mehta & Associates, Advocates & Solicitors`,
    classification: {
      category: 'legal', urgency: 'urgent',
      urgency_reason: 'Legal notice requiring written response within 14 days — failure risks litigation',
      summary: 'Mehta & Associates has sent a formal legal notice on behalf of XYZ Pvt. Ltd. alleging breach of a March 2024 Services Agreement and claiming ₹15 lakh in damages. Written response required within 14 days or litigation may follow.',
      extracted_data: JSON.stringify({ firm_name: 'Mehta & Associates', matter_description: 'Contract dispute — Services Agreement dated March 2024, damages claim ₹15,00,000', deadline: '14 days from receipt', action_required: 'Written explanation + remediation plan + damages response' }),
      suggested_tone: 'formal',
      draft_reply: `Dear Advocate Mehta,

We acknowledge receipt of your legal notice dated and write to confirm that the matter is under review by our legal counsel.

We shall revert with a formal response within the stipulated timeline.

This acknowledgment is without prejudice to our rights and contentions.

Yours faithfully`
    }
  },
  {
    message_id: 'demo-006@intellimail',
    uid: '1006', folder: 'INBOX',
    from_address: 'noreply@indigo.in', from_name: 'IndiGo Airlines',
    to_address: 'you@example.com',
    subject: 'Your IndiGo Booking Confirmed — PNR: 6A-XY123',
    received_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    is_read: 0, is_starred: 0,
    body_text: `Dear Passenger,

Your booking is confirmed. Have a great flight!

PNR: 6A-XY123
Flight: 6E 204
Route: Mumbai (BOM) → Delhi (DEL)
Departure: Tomorrow, 07:15 AM
Arrival: Tomorrow, 09:20 AM
Seat: 14A (Window)

Passenger: As per your profile
Baggage: 15kg check-in included

Check-in opens 48 hours before departure and closes 60 minutes before.
Online check-in: goindigo.in

Terminal: T2, Mumbai International Airport

Safe travels!
IndiGo Team`,
    classification: {
      category: 'travel', urgency: 'urgent',
      urgency_reason: 'Flight departs in approximately 36 hours — check-in is now open',
      summary: 'IndiGo flight 6E 204 from Mumbai to Delhi confirmed for tomorrow at 7:15 AM. PNR: 6A-XY123, Seat 14A. Online check-in is open now at goindigo.in.',
      extracted_data: JSON.stringify({ trip_dates: 'Tomorrow', destination: 'Delhi (DEL)', booking_reference: '6A-XY123', checkin: 'Online check-in now open', checkout: null, carrier: 'IndiGo 6E 204' }),
      suggested_tone: 'brief',
      draft_reply: `Thank you for the booking confirmation. Noted.`
    }
  },
  {
    message_id: 'demo-007@intellimail',
    uid: '1007', folder: 'INBOX',
    from_address: 'reservations@marriott.com', from_name: 'Marriott Hotels',
    to_address: 'you@example.com',
    subject: 'Reservation Confirmed — JW Marriott Mumbai — Dec 15-18',
    received_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    is_read: 1, is_starred: 0,
    body_text: `Dear Guest,

Thank you for choosing JW Marriott Mumbai. Your reservation is confirmed.

Reservation Details:
Confirmation #: MRRT-4829371
Property: JW Marriott Mumbai Juhu
Room Type: Deluxe Ocean View Room
Check-in: Sunday, 15 December 2024 (from 3:00 PM)
Check-out: Tuesday, 17 December 2024 (until 12:00 PM)
Duration: 2 nights
Rate: ₹12,500 per night + taxes

Cancellation Policy: Free cancellation until 5 December 2024. After that, one night's charges apply.

We look forward to welcoming you.

JW Marriott Mumbai Reservations`,
    classification: {
      category: 'travel', urgency: 'normal',
      urgency_reason: null,
      summary: 'JW Marriott Mumbai hotel reservation confirmed for December 15-17, 2024 (2 nights). Confirmation #MRRT-4829371, Deluxe Ocean View room at ₹12,500/night. Free cancellation until December 5.',
      extracted_data: JSON.stringify({ trip_dates: 'Dec 15-17, 2024', destination: 'Mumbai (Juhu)', booking_reference: 'MRRT-4829371', checkin: '15 Dec, 3:00 PM', checkout: '17 Dec, 12:00 PM', carrier: 'JW Marriott Mumbai' }),
      suggested_tone: 'brief',
      draft_reply: `Thank you for the reservation confirmation. Looking forward to the stay.`
    }
  },
  {
    message_id: 'demo-008@intellimail',
    uid: '1008', folder: 'INBOX',
    from_address: 'ananya@climateai.io', from_name: 'Ananya Krishnan',
    to_address: 'you@example.com',
    subject: 'Series A Pitch — ClimateAI Solutions | ₹5Cr Ask',
    received_at: new Date(Date.now() - 4 * 3600000).toISOString(),
    is_read: 0, is_starred: 0,
    body_text: `Dear Investor,

I'm Ananya Krishnan, CEO and Co-founder of ClimateAI Solutions. We're building India's first B2B AI platform for enterprise carbon footprint management and ESG compliance automation.

The Problem: Indian enterprises face ₹500Cr+ in regulatory penalties by 2026 due to new SEBI ESG compliance mandates. Manual reporting takes 3 months and costs ₹50L per company annually.

Our Solution: ClimateAI automates ESG data collection, carbon accounting, and regulatory reporting in 2 weeks at 90% lower cost.

Traction:
- 8 enterprise pilots (Tata, L&T, Infosys, 5 others)
- ARR: ₹1.2Cr, growing 40% MoM
- LOIs from 12 more enterprises

The Ask: ₹5 Crore Series A to scale sales team and expand to Southeast Asia.

Deck: drive.google.com/deck-climateai-2024

Would love 20 minutes to walk you through our vision.

Ananya Krishnan | ananya@climateai.io | +91 98765 43210`,
    classification: {
      category: 'pitch_deck', urgency: 'normal',
      urgency_reason: null,
      summary: 'Ananya Krishnan, CEO of ClimateAI Solutions, is seeking ₹5 Crore Series A investment for a B2B AI platform automating enterprise ESG/carbon compliance reporting. The company has 8 enterprise pilots including Tata and L&T with ₹1.2Cr ARR growing 40% MoM.',
      extracted_data: JSON.stringify({ company_name: 'ClimateAI Solutions', founder_name: 'Ananya Krishnan', funding_ask: '₹5 Crore Series A', one_line_pitch: "India's first B2B AI platform for enterprise carbon footprint management and ESG compliance automation" }),
      suggested_tone: 'friendly',
      draft_reply: `Hi Ananya,

Thank you for sharing the ClimateAI pitch. The ESG compliance automation angle is compelling, especially given the SEBI mandate timelines.

The traction with Tata and L&T is impressive for this stage. I'd love to learn more.

Could we schedule 20 minutes next week? Please share your calendar link or a few available slots.

Best regards`
    }
  },
  {
    message_id: 'demo-009@intellimail',
    uid: '1009', folder: 'INBOX',
    from_address: 'rewards@hdfcbank.com', from_name: 'HDFC SmartBuy',
    to_address: 'you@example.com',
    subject: 'Your SmartBuy Points Expiring in 6 Days — 8,500 Points',
    received_at: new Date(Date.now() - 3 * 3600000).toISOString(),
    is_read: 0, is_starred: 0,
    body_text: `Dear Customer,

Your HDFC Bank SmartBuy reward points are expiring soon!

Points Balance: 8,500 points
Estimated Value: ₹850 (₹0.10 per point)
Expiry Date: 10 November 2024 (6 days remaining)

Redeem your points for:
✓ Amazon/Flipkart vouchers
✓ Flight tickets on MakeMyTrip
✓ Cashback on credit card outstanding
✓ 500+ partner brands

Redeem now before they expire: smartbuy.hdfcbank.com/redeem

Points redeemed after expiry are not eligible for reinstatement.

HDFC Bank SmartBuy Team`,
    classification: {
      category: 'rewards_awards', urgency: 'urgent',
      urgency_reason: '8,500 SmartBuy points (₹850 value) expiring in 6 days — immediate action required',
      summary: 'Your HDFC SmartBuy rewards balance of 8,500 points (worth ~₹850) expires in 6 days on November 10, 2024. Redeem immediately at smartbuy.hdfcbank.com for vouchers, flights, or cashback.',
      extracted_data: JSON.stringify({ program_name: 'HDFC SmartBuy', points_balance: '8,500 points', reward_type: 'Reward Points', expiry_date: '10 November 2024 (6 days)', estimated_value: '₹850', redeem_url: 'smartbuy.hdfcbank.com/redeem' }),
      suggested_tone: 'brief',
      draft_reply: `Thank you for the reminder. I will redeem the points before the expiry date.`
    }
  },
  {
    message_id: 'demo-010@intellimail',
    uid: '1010', folder: 'INBOX',
    from_address: 'bluchip@goindigo.in', from_name: 'IndiGo BluChip',
    to_address: 'you@example.com',
    subject: 'Your BluChip Miles Statement — October 2024',
    received_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    is_read: 1, is_starred: 0,
    body_text: `Dear BluChip Member,

Your IndiGo BluChip miles statement for October 2024 is ready.

Member ID: BC-7829341
Tier: Blue

Opening Balance: 10,200 miles
Miles Earned this month: 3,400 miles (Flights: 6E 204, 6E 891)
Miles Redeemed: 1,200 miles
Closing Balance: 12,400 miles

Miles Value: Approximately ₹2,480 (₹0.20/mile)
Miles Validity: Valid until March 2026

Upcoming earning opportunities:
- Book flights at goindigo.in to earn 3x miles this November
- Redeem miles for seat upgrades and free flights

View your account: bluchip.goindigo.in

Safe travels!
IndiGo BluChip Team`,
    classification: {
      category: 'rewards_awards', urgency: 'normal',
      urgency_reason: null,
      summary: 'IndiGo BluChip October statement shows 12,400 miles balance (worth ~₹2,480). Earned 3,400 miles this month from two flights. Miles valid until March 2026 — no immediate action required.',
      extracted_data: JSON.stringify({ program_name: 'IndiGo BluChip', points_balance: '12,400 miles', reward_type: 'Airline Miles', expiry_date: 'March 2026', estimated_value: '₹2,480', redeem_url: 'bluchip.goindigo.in' }),
      suggested_tone: 'brief',
      draft_reply: `Thank you for the miles statement. Noted.`
    }
  },
  {
    message_id: 'demo-011@intellimail',
    uid: '1011', folder: 'INBOX',
    from_address: 'newsletter@techcrunch.com', from_name: 'TechCrunch',
    to_address: 'you@example.com',
    subject: 'TechCrunch Weekly: AI Funding Surges, India Startup Boom',
    received_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    is_read: 1, is_starred: 0,
    body_text: `TechCrunch Weekly Digest — Week of November 4, 2024

THIS WEEK IN TECH:

🤖 AI FUNDING: Global AI startups raised $18.2B in Q3 2024, a 340% YoY increase. OpenAI, Anthropic, and xAI led mega-rounds.

🇮🇳 INDIA MOMENT: India's startup ecosystem crossed $100B in cumulative funding. Bengaluru now ranks #3 globally for AI startups.

📱 MOBILE WARS: Apple iPhone 16 sales disappoint in China; Samsung gains 8% market share in premium segment.

💊 HEALTHTECH: Ola Electric's battery tech spinoff raises $200M at $1.2B valuation.

🔗 READS THIS WEEK:
- How DeepSeek changed the LLM cost curve forever
- Why Indian B2B SaaS is having its moment
- The quiet death of the enterprise software monolith

See you next week,
TechCrunch Editorial`,
    classification: {
      category: 'fyi', urgency: 'normal',
      urgency_reason: null,
      summary: 'TechCrunch Weekly Digest covering AI funding surge ($18.2B in Q3), India startup ecosystem reaching $100B cumulative funding, Apple iPhone 16 sales, and healthtech funding news.',
      extracted_data: JSON.stringify({ topic: 'Tech industry weekly news roundup', sender_type: 'Newsletter / Media' }),
      suggested_tone: 'brief',
      draft_reply: `Thank you for the digest. Very informative.`
    }
  },
  {
    message_id: 'demo-012@intellimail',
    uid: '1012', folder: 'INBOX',
    from_address: 'noreply@github.com', from_name: 'GitHub Actions',
    to_address: 'you@example.com',
    subject: '[intellimail] workflow \'deploy-prod\' completed successfully',
    received_at: new Date(Date.now() - 1 * 3600000).toISOString(),
    is_read: 0, is_starred: 0,
    body_text: `Your workflow deploy-prod completed successfully.

Repository: your-org/intellimail
Workflow: deploy-prod
Branch: main
Commit: a3f8b2d — "feat: add IMAP IDLE reconnection logic"
Status: ✅ Success
Duration: 3m 42s

Job Summary:
✅ build (ubuntu-latest) — 1m 20s
✅ test (ubuntu-latest) — 58s
✅ deploy-staging — 42s
✅ deploy-production — 42s

View run: github.com/your-org/intellimail/actions/runs/12345678

GitHub Actions`,
    classification: {
      category: 'other', urgency: 'normal',
      urgency_reason: null,
      summary: 'GitHub Actions notification: the deploy-prod workflow for the intellimail repository completed successfully in 3m 42s. All jobs passed including staging and production deployment.',
      extracted_data: JSON.stringify({ type: 'CI/CD notification', source_domain: 'github.com' }),
      suggested_tone: 'brief',
      draft_reply: `Thank you for the notification.`
    }
  }
];

function seedDemoData() {
  const count = db.prepare('SELECT COUNT(*) as c FROM emails').get();
  if (count.c > 0) return; // Already seeded

  const insertEmail = db.prepare(`
    INSERT OR IGNORE INTO emails
    (message_id, uid, folder, from_address, from_name, to_address, subject,
     body_text, received_at, is_read, is_starred)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertClassification = db.prepare(`
    INSERT INTO classifications
    (email_id, category, urgency, urgency_reason, summary, extracted_data, draft_reply, suggested_tone)
    VALUES (?,?,?,?,?,?,?,?)
  `);

  const insertDraft = db.prepare(`
    INSERT INTO drafts (email_id, body, tone, subject, to_address)
    VALUES (?,?,?,?,?)
  `);

  for (const email of DEMO_EMAILS) {
    const { classification, ...emailData } = email;
    const result = insertEmail.run(
      emailData.message_id, emailData.uid, emailData.folder,
      emailData.from_address, emailData.from_name, emailData.to_address,
      emailData.subject, emailData.body_text, emailData.received_at,
      emailData.is_read, emailData.is_starred
    );
    const emailId = result.lastInsertRowid;
    insertClassification.run(
      emailId, classification.category, classification.urgency,
      classification.urgency_reason, classification.summary,
      classification.extracted_data, classification.draft_reply,
      classification.suggested_tone
    );
    insertDraft.run(
      emailId, classification.draft_reply, classification.suggested_tone,
      'Re: ' + emailData.subject, emailData.from_address
    );
  }
  console.log('Demo data seeded: 12 emails');
}

module.exports = { seedDemoData };
