# IntelliMail Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build IntelliMail — a production-ready intelligent email intelligence dashboard that monitors IMAP/SMTP accounts, classifies emails via Claude AI, and enables rapid action — fully from the spec.

**Architecture:** Node.js/Express backend with imapflow IMAP IDLE + 60s polling fallback, better-sqlite3 storage, @anthropic-ai/sdk for classification, and manual SSE for real-time push. Frontend uses HTMX 1.9 for zero-reload partial swaps, Alpine.js 3 for reactive local state, Tailwind CSS v3 and custom CSS for the deep-dark 3-panel desktop-app layout.

**Tech Stack:** Node.js 18+, Express 4, imapflow, mailparser, nodemailer, @anthropic-ai/sdk, better-sqlite3, node-cron, HTMX 1.9 (CDN), Alpine.js 3 (CDN), Tailwind CSS v3 (CDN), IBM Plex Mono + Literata + Syne (Google Fonts)

**Project root:** `I:\xgen-intel\intellimail\`

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "intellimail",
  "version": "1.0.0",
  "description": "Intelligent Email Intelligence Dashboard",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js"
  },
  "dependencies": {
    "imapflow": "^1.0.162",
    "mailparser": "^3.6.5",
    "nodemailer": "^6.9.7",
    "@anthropic-ai/sdk": "^0.27.0",
    "better-sqlite3": "^9.4.3",
    "express": "^4.18.2",
    "node-cron": "^3.0.3",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

**Step 2: Create .env.example**

```
PORT=3000
NODE_ENV=development
# Optional: Claude API key can also be stored via setup wizard UI
ANTHROPIC_API_KEY=sk-ant-
```

**Step 3: Create .gitignore**

```
node_modules/
.env
*.db
*.sqlite
```

**Step 4: Install dependencies**

Run: `npm install`
Expected: node_modules created, no errors

**Step 5: Commit**

```bash
git init
git add package.json .env.example .gitignore
git commit -m "feat: project scaffold"
```

---

## Task 2: Database Layer (src/db.js)

**Files:**
- Create: `src/db.js`

**Step 1: Implement db.js**

Complete module that:
1. Opens/creates `intellimail.db` via better-sqlite3
2. Creates all 5 tables on startup (account_config, emails, classifications, drafts, sync_log)
3. Exports `db` instance + helper functions: `getConfig()`, `saveConfig()`, `getStats()`

```javascript
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'intellimail.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
CREATE TABLE IF NOT EXISTS account_config (
  id INTEGER PRIMARY KEY,
  display_name TEXT,
  email TEXT,
  imap_host TEXT,
  imap_port INTEGER,
  imap_tls INTEGER DEFAULT 1,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_tls INTEGER DEFAULT 1,
  username TEXT,
  password TEXT,
  claude_api_key TEXT,
  sync_interval INTEGER DEFAULT 60,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT UNIQUE,
  uid TEXT,
  folder TEXT,
  from_address TEXT,
  from_name TEXT,
  to_address TEXT,
  cc_address TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at DATETIME,
  is_read INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  raw_headers TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
  category TEXT,
  urgency TEXT,
  urgency_reason TEXT,
  summary TEXT,
  extracted_data TEXT,
  draft_reply TEXT,
  suggested_tone TEXT,
  classified_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
  body TEXT,
  tone TEXT DEFAULT 'professional',
  subject TEXT,
  to_address TEXT,
  last_edited DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent INTEGER DEFAULT 0,
  sent_at DATETIME
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_mode TEXT,
  folder TEXT,
  new_count INTEGER DEFAULT 0,
  error TEXT,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

function getConfig() {
  return db.prepare('SELECT * FROM account_config WHERE id = 1').get();
}

function saveConfig(cfg) {
  const existing = getConfig();
  if (existing) {
    db.prepare(`UPDATE account_config SET
      display_name=?, email=?, imap_host=?, imap_port=?, imap_tls=?,
      smtp_host=?, smtp_port=?, smtp_tls=?, username=?, password=?,
      claude_api_key=?, sync_interval=? WHERE id=1`
    ).run(cfg.display_name, cfg.email, cfg.imap_host, cfg.imap_port, cfg.imap_tls,
          cfg.smtp_host, cfg.smtp_port, cfg.smtp_tls, cfg.username, cfg.password,
          cfg.claude_api_key, cfg.sync_interval || 60);
  } else {
    db.prepare(`INSERT INTO account_config (id, display_name, email, imap_host, imap_port, imap_tls,
      smtp_host, smtp_port, smtp_tls, username, password, claude_api_key, sync_interval)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(cfg.display_name, cfg.email, cfg.imap_host, cfg.imap_port, cfg.imap_tls,
          cfg.smtp_host, cfg.smtp_port, cfg.smtp_tls, cfg.username, cfg.password,
          cfg.claude_api_key, cfg.sync_interval || 60);
  }
}

function getStats() {
  const rows = db.prepare(`
    SELECT c.category, COUNT(*) as count
    FROM emails e
    JOIN classifications c ON c.email_id = e.id
    WHERE e.is_archived = 0 AND e.folder = 'INBOX'
    GROUP BY c.category
  `).all();

  const urgentCount = db.prepare(`
    SELECT COUNT(*) as count FROM emails e
    JOIN classifications c ON c.email_id = e.id
    WHERE c.urgency = 'urgent' AND e.is_archived = 0 AND e.is_read = 0
  `).get();

  const totalUnread = db.prepare(`
    SELECT COUNT(*) as count FROM emails WHERE is_read = 0 AND is_archived = 0 AND folder = 'INBOX'
  `).get();

  const stats = {
    urgent: urgentCount.count,
    total_unread: totalUnread.count,
    meeting_request: 0, financial: 0, legal: 0, travel: 0,
    pitch_deck: 0, fyi: 0, rewards_awards: 0, other: 0
  };
  for (const row of rows) {
    if (stats.hasOwnProperty(row.category)) stats[row.category] = row.count;
  }
  return stats;
}

module.exports = { db, getConfig, saveConfig, getStats };
```

**Step 2: Verify**
Run: `node -e "require('./src/db'); console.log('DB OK')"`
Expected: `DB OK` and `intellimail.db` created

---

## Task 3: Demo Mode (src/demo.js)

**Files:**
- Create: `src/demo.js`

**Step 1: Implement demo.js**

Seeds 12 realistic pre-classified emails with full body text, extracted_data, and draft_reply. Only seeds if emails table is empty.

```javascript
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
```

**Step 2: Verify**
Run: `node -e "require('./src/db'); require('./src/demo').seedDemoData(); console.log('Demo OK')"`
Expected: `Demo data seeded: 12 emails`

---

## Task 4: AI Classifier (src/classifier.js)

**Files:**
- Create: `src/classifier.js`

Implement the classification queue with:
- Anthropic client initialized from DB config or env
- System prompt exactly as specified
- Max 3 concurrent classifications
- Retry once after 10s on failure
- Fallback classification on API error
- Stores result in classifications + drafts tables

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const { db, getConfig } = require('./db');

let classificationQueue = [];
let processing = false;

function getClient() {
  const cfg = getConfig();
  const apiKey = (cfg && cfg.claude_api_key) || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

const SYSTEM_PROMPT = `You are an elite email intelligence engine for a busy executive.
Analyze the email and return ONLY valid JSON with no markdown fences,
no explanation, no preamble. Use exactly this schema:
{
  "category": one of exactly: "meeting_request" | "financial" | "legal" | "travel" | "pitch_deck" | "fyi" | "rewards_awards" | "other",
  "urgency": one of exactly: "urgent" | "moderate" | "normal",
  "urgency_reason": "string if urgent/moderate, null if normal",
  "summary": "2-3 sentence plain English summary of what this email is about and what action if any is needed",
  "extracted_data": {
    "For meeting_request": { "meeting_date": "", "meeting_time": "", "meeting_location": "", "organizer": "", "platform": "" },
    "For financial": { "institution": "", "amount_due": "", "due_date": "", "account_last4": "", "statement_period": "" },
    "For legal": { "firm_name": "", "matter_description": "", "deadline": "", "action_required": "" },
    "For travel": { "trip_dates": "", "destination": "", "booking_reference": "", "checkin": "", "checkout": "", "carrier": "" },
    "For pitch_deck": { "company_name": "", "founder_name": "", "funding_ask": "", "one_line_pitch": "" },
    "For fyi": { "topic": "", "sender_type": "" },
    "For rewards_awards": { "program_name": "", "points_balance": "", "reward_type": "", "expiry_date": "", "estimated_value": "", "redeem_url": "" },
    "For other": { "type": "", "source_domain": "" }
  },
  "suggested_tone": one of: "formal" | "professional" | "friendly" | "brief",
  "draft_reply": "Complete ready-to-send reply email body. Never use placeholders like [Your Name]."
}

Category guidance:
- meeting_request: calendar invites, meeting requests, interview scheduling, demo requests
- financial: bank statements, credit card bills, invoices, payment confirmations, tax docs
- legal: contracts, legal notices, compliance emails, NDAs, dispute notices
- travel: flight bookings, hotel reservations, car rentals, travel itineraries, visa docs
- pitch_deck: startup pitches, investment proposals, partnership proposals, sales decks
- fyi: newsletters, updates, announcements, informational emails requiring no action
- rewards_awards: loyalty points, cashback notifications, miles statements, reward redemptions, award nominations, recognition emails, gift cards, hotel/airline points expiry notices
- other: automated notifications, app alerts, social digests, anything not fitting above 7`;

function fallbackClassification() {
  return {
    category: 'other', urgency: 'normal', urgency_reason: null,
    summary: 'AI classification unavailable.',
    extracted_data: JSON.stringify({ type: 'unknown', source_domain: '' }),
    suggested_tone: 'professional',
    draft_reply: 'Thank you for your email. I will review and respond shortly.'
  };
}

async function classifyEmail(emailId, retryCount = 0) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
  if (!email) return;

  const existing = db.prepare('SELECT id FROM classifications WHERE email_id = ?').get(emailId);
  if (existing) return;

  const client = getClient();
  if (!client) {
    storeClassification(emailId, fallbackClassification());
    return;
  }

  const userMessage = `Subject: ${email.subject}\nFrom: ${email.from_name} <${email.from_address}>\nDate: ${email.received_at}\n\n${(email.body_text || '').substring(0, 2000)}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const text = response.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to extract JSON if wrapped
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Invalid JSON from Claude');
    }

    storeClassification(emailId, parsed);
  } catch (err) {
    if (retryCount === 0) {
      setTimeout(() => classifyEmail(emailId, 1), 10000);
    } else {
      storeClassification(emailId, fallbackClassification());
    }
  }
}

function storeClassification(emailId, data) {
  const cfg = getConfig();
  const displayName = cfg ? cfg.display_name : 'Me';

  try {
    db.prepare(`
      INSERT OR IGNORE INTO classifications
      (email_id, category, urgency, urgency_reason, summary, extracted_data, draft_reply, suggested_tone)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      emailId, data.category, data.urgency, data.urgency_reason,
      data.summary,
      typeof data.extracted_data === 'string' ? data.extracted_data : JSON.stringify(data.extracted_data || {}),
      data.draft_reply, data.suggested_tone
    );

    // Upsert draft
    const existing = db.prepare('SELECT id FROM drafts WHERE email_id = ?').get(emailId);
    const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
    if (!existing && email) {
      db.prepare(`
        INSERT INTO drafts (email_id, body, tone, subject, to_address)
        VALUES (?,?,?,?,?)
      `).run(emailId, data.draft_reply, data.suggested_tone,
             'Re: ' + email.subject, email.from_address);
    }
  } catch (e) {
    // DB write failure — log and continue
    console.error('DB write error in classifier:', e.message);
  }
}

async function processQueue() {
  if (processing || classificationQueue.length === 0) return;
  processing = true;
  try {
    while (classificationQueue.length > 0) {
      const batch = classificationQueue.splice(0, 3);
      await Promise.all(batch.map(id => classifyEmail(id)));
    }
  } finally {
    processing = false;
  }
}

function queueClassification(emailId) {
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

module.exports = { queueClassification, classifyAllUnclassified, classifyEmail };
```

---

## Task 5: SMTP Sender (src/smtp.js)

**Files:**
- Create: `src/smtp.js`

```javascript
const nodemailer = require('nodemailer');
const { getConfig } = require('./db');

async function sendEmail({ to, subject, body, replyToMessageId }) {
  const cfg = getConfig();
  if (!cfg) throw new Error('No account configuration found');

  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: cfg.smtp_port,
    secure: cfg.smtp_tls === 1 && cfg.smtp_port === 465,
    auth: { user: cfg.username, pass: cfg.password },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000
  });

  await transporter.verify();

  const mailOptions = {
    from: `${cfg.display_name} <${cfg.email}>`,
    to,
    subject,
    text: body
  };
  if (replyToMessageId) {
    mailOptions.inReplyTo = replyToMessageId;
    mailOptions.references = replyToMessageId;
  }

  const info = await transporter.sendMail(mailOptions);
  return info;
}

async function testSmtp() {
  const cfg = getConfig();
  if (!cfg) return { ok: false, error: 'No config' };
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host, port: cfg.smtp_port,
      secure: cfg.smtp_tls === 1 && cfg.smtp_port === 465,
      auth: { user: cfg.username, pass: cfg.password },
      tls: { rejectUnauthorized: false }, connectionTimeout: 10000
    });
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { sendEmail, testSmtp };
```

---

## Task 6: IMAP Engine (src/imap.js)

**Files:**
- Create: `src/imap.js`

Full IMAP IDLE state machine with:
- Phase 1: IDLE (primary)
- Phase 2: 60s polling (fallback)
- Phase 3: Auto-recovery to IDLE
- SENT folder sync
- Circuit breaker (3 drops in 5 min)
- IDLE renewal every 28 minutes
- SSE broadcast integration

```javascript
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const cron = require('node-cron');
const { db, getConfig } = require('./db');
const { queueClassification } = require('./classifier');

let broadcast = () => {};
let syncMode = 'disconnected';
let lastSeenUID = 0;
let idleDropCount = 0;
let idleDropTimes = [];
let cronJob = null;
let recoveryInterval = null;
let renewalTimer = null;
let currentClient = null;

function setBroadcast(fn) { broadcast = fn; }
function getSyncMode() { return syncMode; }

function setSyncMode(mode) {
  syncMode = mode;
  broadcast('sync_status', { mode, lastSync: new Date().toISOString() });
}

async function createClient(cfg) {
  return new ImapFlow({
    host: cfg.imap_host,
    port: cfg.imap_port,
    secure: cfg.imap_tls === 1,
    auth: { user: cfg.username, pass: cfg.password },
    logger: false,
    socketTimeout: 0,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    tls: { rejectUnauthorized: false }
  });
}

async function storeEmail(parsed, folder) {
  const msgId = parsed.messageId || `uid-${Date.now()}-${Math.random()}`;
  const existing = db.prepare('SELECT id FROM emails WHERE message_id = ?').get(msgId);
  if (existing) return existing.id;

  try {
    const result = db.prepare(`
      INSERT INTO emails
      (message_id, uid, folder, from_address, from_name, to_address, cc_address,
       subject, body_text, body_html, received_at, is_read)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      msgId, String(parsed.uid || ''), folder,
      parsed.from?.value?.[0]?.address || '',
      parsed.from?.value?.[0]?.name || '',
      parsed.to?.value?.[0]?.address || '',
      parsed.cc?.value?.[0]?.address || '',
      parsed.subject || '(No Subject)',
      (parsed.text || '').substring(0, 100000),
      (parsed.html || '').substring(0, 200000),
      (parsed.date || new Date()).toISOString(),
      0
    );
    return result.lastInsertRowid;
  } catch (e) {
    console.error('Email store error:', e.message);
    return null;
  }
}

async function fetchMessages(client, folder, limit) {
  await client.mailboxOpen(folder);
  const status = await client.status(folder, { messages: true });
  const total = status.messages;
  if (total === 0) return;

  const start = Math.max(1, total - limit + 1);
  const messages = [];

  for await (const msg of client.fetch(`${start}:*`, { source: true })) {
    try {
      const parsed = await simpleParser(msg.source);
      parsed.uid = msg.uid;
      messages.push(parsed);
    } catch (e) {
      console.error('Parse error:', e.message);
    }
  }

  for (const parsed of messages) {
    const id = await storeEmail(parsed, folder);
    if (id) queueClassification(id);
    if (parsed.uid && parsed.uid > lastSeenUID) lastSeenUID = parsed.uid;
  }
}

async function fetchSinceUID(client, folder, sinceUID) {
  await client.mailboxOpen(folder);
  const seq = `${sinceUID + 1}:*`;
  const newMsgs = [];
  try {
    for await (const msg of client.fetch(seq, { source: true, uid: true })) {
      try {
        const parsed = await simpleParser(msg.source);
        parsed.uid = msg.uid;
        newMsgs.push(parsed);
      } catch (e) { /* skip malformed */ }
    }
  } catch (e) {
    // No new messages
  }
  return newMsgs;
}

function checkCircuitBreaker() {
  const now = Date.now();
  idleDropTimes = idleDropTimes.filter(t => now - t < 5 * 60 * 1000);
  idleDropTimes.push(now);
  idleDropCount = idleDropTimes.length;
  return idleDropCount >= 3;
}

function clearRenewalTimer() {
  if (renewalTimer) { clearTimeout(renewalTimer); renewalTimer = null; }
}

async function startPolling(cfg) {
  setSyncMode('polling');
  if (cronJob) cronJob.stop();

  cronJob = cron.schedule('*/60 * * * * *', async () => {
    if (syncMode !== 'polling') return;
    try {
      const client = await createClient(cfg);
      await client.connect();
      const newMsgs = await fetchSinceUID(client, 'INBOX', lastSeenUID);
      for (const parsed of newMsgs) {
        const id = await storeEmail(parsed, 'INBOX');
        if (id) {
          queueClassification(id);
          if (parsed.uid > lastSeenUID) lastSeenUID = parsed.uid;
          broadcast('new_email', {
            id, subject: parsed.subject,
            from_name: parsed.from?.value?.[0]?.name || parsed.from?.value?.[0]?.address || 'Unknown'
          });
        }
      }
      await client.logout();
      broadcast('sync_status', { mode: 'polling', lastSync: new Date().toISOString() });
      db.prepare("INSERT INTO sync_log (sync_mode, folder, new_count) VALUES ('polling', 'INBOX', ?)")
        .run(newMsgs.length);
    } catch (e) {
      db.prepare("INSERT INTO sync_log (sync_mode, folder, error) VALUES ('polling','INBOX',?)")
        .run(e.message);
    }
  });

  // Attempt IDLE recovery every 5 minutes
  if (!recoveryInterval) {
    recoveryInterval = setInterval(async () => {
      if (syncMode !== 'polling') return;
      try {
        idleDropTimes = [];
        idleDropCount = 0;
        await startIDLE(cfg);
      } catch (e) { /* still polling */ }
    }, 5 * 60 * 1000);
  }
}

async function startIDLE(cfg) {
  clearRenewalTimer();
  if (currentClient) { try { await currentClient.logout(); } catch(e){} }

  setSyncMode('connecting');
  currentClient = await createClient(cfg);

  await currentClient.connect();
  await currentClient.mailboxOpen('INBOX');

  if (!currentClient.capabilities.has('IDLE')) {
    console.log('IMAP server does not support IDLE, switching to polling');
    await currentClient.logout();
    await startPolling(cfg);
    return;
  }

  setSyncMode('idle');
  if (cronJob) { cronJob.stop(); cronJob = null; }
  if (recoveryInterval) { clearInterval(recoveryInterval); recoveryInterval = null; }

  currentClient.on('exists', async (data) => {
    try {
      const uid = data.count;
      const msgs = await fetchSinceUID(currentClient, 'INBOX', lastSeenUID);
      for (const parsed of msgs) {
        const id = await storeEmail(parsed, 'INBOX');
        if (id) {
          queueClassification(id);
          if (parsed.uid > lastSeenUID) lastSeenUID = parsed.uid;
          broadcast('new_email', {
            id, subject: parsed.subject,
            from_name: parsed.from?.value?.[0]?.name || parsed.from?.value?.[0]?.address || 'Unknown'
          });
          broadcast('stats_update', {});
        }
      }
    } catch (e) { console.error('Exists handler error:', e.message); }
  });

  // IDLE renewal every 28 minutes
  renewalTimer = setTimeout(async () => {
    try {
      await currentClient.idle();
      await startIDLE(cfg);
    } catch (e) {
      if (checkCircuitBreaker()) {
        await startPolling(cfg);
      } else {
        setTimeout(() => startIDLE(cfg), 5000);
      }
    }
  }, 28 * 60 * 1000);

  try {
    await currentClient.idle();
    // idle() resolves when server ends IDLE
    await startIDLE(cfg);
  } catch (e) {
    clearRenewalTimer();
    if (checkCircuitBreaker()) {
      console.log('Circuit breaker tripped, switching to polling');
      await startPolling(cfg);
    } else {
      setSyncMode('reconnecting');
      const delay = Math.min(5000 * Math.pow(2, idleDropCount - 1), 300000);
      setTimeout(() => startIDLE(cfg), delay);
    }
  }
}

async function testImap(cfg) {
  try {
    const client = await createClient(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    await client.logout();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function startSync() {
  const cfg = getConfig();
  if (!cfg) {
    console.log('No account config — running in demo mode');
    setSyncMode('demo');
    return;
  }

  try {
    setSyncMode('connecting');
    const client = await createClient(cfg);
    await client.connect();

    // Initial fetch: 200 INBOX + 100 SENT
    await fetchMessages(client, 'INBOX', 200);
    // Store last UID
    const lastEmail = db.prepare("SELECT MAX(CAST(uid AS INTEGER)) as maxuid FROM emails WHERE folder='INBOX'").get();
    if (lastEmail && lastEmail.maxuid) lastSeenUID = lastEmail.maxuid;

    await fetchMessages(client, 'SENT', 100);
    await client.logout();

    broadcast('stats_update', {});
    await startIDLE(cfg);
  } catch (e) {
    console.error('IMAP startup error:', e.message);
    setSyncMode('disconnected');
    setTimeout(startSync, 30000);
  }
}

module.exports = { startSync, testImap, getSyncMode, setBroadcast };
```

---

## Task 7: SSE + Express Server (src/server.js)

**Files:**
- Create: `src/server.js`

```javascript
require('dotenv').config();
const express = require('express');
const path = require('path');
const { db, getConfig, getStats } = require('./db');
const { seedDemoData } = require('./demo');
const { startSync, setBroadcast } = require('./imap');
const { classifyAllUnclassified } = require('./classifier');

const app = express();
const PORT = process.env.PORT || 3000;

// SSE clients registry
const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(payload); }
    catch(e) { sseClients.delete(client); }
  }
}

// SSE route
app.get('/api/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.add(client);

  const heartbeat = setInterval(() => {
    try { res.write('event: heartbeat\ndata: {}\n\n'); }
    catch(e) { sseClients.delete(client); clearInterval(heartbeat); }
  }, 30000);

  // Send initial stats
  try {
    const stats = getStats();
    res.write(`event: stats_update\ndata: ${JSON.stringify(stats)}\n\n`);
  } catch(e) {}

  req.on('close', () => {
    sseClients.delete(client);
    clearInterval(heartbeat);
  });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Pass broadcast to IMAP module
setBroadcast((event, data) => {
  if (event === 'stats_update') {
    broadcast('stats_update', getStats());
  } else {
    broadcast(event, data);
  }
});

// Routes
const pagesRouter = require('./routes/pages');
const apiRouter = require('./routes/api');
app.use('/', pagesRouter);
app.use('/', apiRouter);

// Startup
async function init() {
  const cfg = getConfig();
  if (!cfg) {
    seedDemoData();
  }
  classifyAllUnclassified();
  startSync();
}

app.listen(PORT, () => {
  console.log(`IntelliMail running at http://localhost:${PORT}`);
  init();
});

module.exports = { broadcast };
```

---

## Task 8: Page Routes (src/routes/pages.js)

**Files:**
- Create: `src/routes/pages.js`

Simple HTML file serving with redirect logic:

```javascript
const express = require('express');
const path = require('path');
const { getConfig } = require('../db');
const router = express.Router();

const views = path.join(__dirname, '..', '..', 'views');

router.get('/', (req, res) => {
  const cfg = getConfig();
  res.redirect(cfg ? '/dashboard' : '/setup');
});

router.get('/setup', (req, res) => {
  res.sendFile(path.join(views, 'setup.html'));
});

router.get('/dashboard', (req, res) => {
  res.sendFile(path.join(views, 'dashboard.html'));
});

router.get('/settings', (req, res) => {
  res.sendFile(path.join(views, 'settings.html'));
});

module.exports = router;
```

---

## Task 9: API Routes (src/routes/api.js)

**Files:**
- Create: `src/routes/api.js`

This is the largest single file. Implement all API endpoints:
- `/api/account/*` — setup, test, reset
- `/api/emails` — list with filtering/pagination
- `/api/emails/:id` — detail partial
- `/api/emails/:id/*` — read, archive, star, reclassify, draft ops, ical
- `/api/sync/*` — status, trigger
- `/api/stats` — badge counts

Key implementation notes:
- All email list/detail responses return HTML partials (not JSON)
- Use template literals for HTML rendering (no template engine)
- Avatar color is deterministic from sender initials
- Smart time: "Just now", "2h ago", "Yesterday", date for older
- All HTML must be sanitized (use text content, never innerHTML from DB)

Full implementation — see the spec sections:
- "API Routes (api.js)" for all route signatures
- "Email List Items" for email-item HTML
- "Email Detail Panel" for email-detail HTML
- "All 8 Action Zones" for action zone HTML
- ".ics Generation" for ical endpoint

(This task produces the largest file — ~800 lines. Implement completely per spec, no stubs.)

---

## Task 10: CSS (public/css/app.css)

**Files:**
- Create: `public/css/app.css`

Implement the full CSS from the spec exactly:
- Google Fonts import (IBM Plex Mono, Literata, Syne)
- All CSS variables in :root
- `.app-shell` 3-panel grid layout
- All component styles: email-item, badge, skeleton, urgency, draft-editor, sync, toast, avatar, ai-summary, banner, data-card, action-btn variants
- Mobile responsive media query

---

## Task 11: Frontend JS (public/js/app.js)

**Files:**
- Create: `public/js/app.js`

Implement:
1. `appState()` Alpine component — top-level state: stats, sidebarCollapsed, syncMode
2. `draftEditor({...})` Alpine component — full implementation per spec
3. SSE EventSource listener — new_email, sync_status, stats_update, heartbeat
4. `showToast(type, message, duration)` — per spec
5. Helper: `smartTime(dateStr)` — "Just now", "Xm ago", "Xh ago", "Yesterday", date
6. Helper: `avatarColor(name)` — deterministic color from name hash
7. Helper: `categoryLabel(cat)` — human-readable category names

Note: Import lodash debounce via CDN in layout.html for draftEditor.

---

## Task 12: HTML Views

**Files:**
- Create: `views/layout.html` (shared head with all CDN imports)
- Create: `views/dashboard.html` (3-panel shell, uses layout)
- Create: `views/setup.html` (4-step wizard, standalone)
- Create: `views/settings.html` (settings sections)

### layout.html (head content, included via JS or self-contained per page)
CDN imports needed in every page:
```html
<script src="https://unpkg.com/htmx.org@1.9.12"></script>
<script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"></script>
<link rel="stylesheet" href="/css/app.css">
<script src="/js/app.js" defer></script>
```

Since Express serves static files, all pages are self-contained HTML files (no server-side template engine). Include the full `<html>`, `<head>`, and `<body>` in each file.

### dashboard.html
Full 3-panel layout per spec:
- `.app-shell` grid with sidebar, email-list-panel, email-detail-panel
- HTMX loads `/api/emails?folder=INBOX&category=all` into `#email-list` on load
- HTMX loads `/api/sidebar` into `#sidebar-nav` on load
- SSE connected via app.js
- Alpine `x-data="appState()"` on app-shell

### setup.html
4-step wizard with Alpine.js step tracking:
- Step 1: Provider selector grid (Gmail, Outlook, Yahoo, iCloud, Custom)
- Step 2: Credential form (all fields, show/hide password)
- Step 3: Test connection results (HTMX or fetch)
- Step 4: Launch button
- Progress dots, glassmorphism card, background glow

### settings.html
All settings sections with save buttons. HTMX for test connections.

---

## Task 13: HTML Partials (views/partials/)

**Files:**
- Create: `views/partials/sidebar.html` — smart folders nav (rendered by API route)
- Create: `views/partials/email-list.html` — skeleton + email items (template)
- Create: `views/partials/email-detail.html` — full detail (template)
- Create: `views/partials/action-meeting.html`
- Create: `views/partials/action-financial.html`
- Create: `views/partials/action-legal.html`
- Create: `views/partials/action-travel.html`
- Create: `views/partials/action-pitch.html`
- Create: `views/partials/action-fyi.html`
- Create: `views/partials/action-rewards.html`
- Create: `views/partials/action-other.html`
- Create: `views/partials/draft-editor.html`
- Create: `views/partials/sync-status.html`

Note: These partials are used as templates — the API routes read them and substitute values using string replace, OR the API routes render the HTML directly as template literals in api.js. **Recommended:** render inline in api.js using template literals for simplicity (no template engine needed).

---

## Task 14: README

**Files:**
- Create: `README.md`

Include exactly as specified:
- What IntelliMail is (2 paragraphs)
- Prerequisites: Node.js 18+
- Quick start: git clone → npm install → npm run dev → open localhost:3000
- Gmail App Password instructions
- Outlook, Yahoo setup
- Architecture overview
- Environment variables reference
- Troubleshooting

---

## Task 15: Final Verification

Run through the Definition of Done checklist (29 items):

1. `npm install && npm run dev` starts without errors on port 3000
2. Demo mode shows 12 emails with no credentials
3. Demo mode banner visible with [Connect Account]
4. Setup wizard shows provider selector with pre-fills
5. Setup wizard tests all 3 connections live
6. Dashboard 3-panel layout with correct fonts
7. Color system matches spec
8. All routes respond (no 404s)
9. SSE `/api/sse` connects and sends heartbeat every 30s
10. Email list loads and renders email items
11. Clicking email loads detail panel
12. Meeting action zone shows Accept/Decline/Propose buttons
13. Financial shows payment due banner
14. Legal always shows urgent banner
15. Travel shows departure banner
16. Rewards shows expiry banner
17. Draft editor pre-filled, editable, tone switcher works
18. Regenerate button calls API
19. Sidebar badge counts update
20. Sidebar collapses to 48px
21. Settings page accessible
22. Mobile layout stacks panels
23. No credentials in console.log
24. All HTMX hx-get/hx-post point to real routes
25. SSE heartbeat confirmed at 30s interval
26. Circuit breaker logic present in imap.js
27. IDLE renewal timer at exactly 28 minutes
28. Classification queue limits concurrency to 3
29. .ics generation valid RFC 5545

**Fix any issues found before marking done.**

---

## Execution Order

Tasks should be executed in this order (dependencies):

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15

Each task builds on the previous. Task 9 (API routes) is the largest and references output from tasks 2-8.
