# IntelliMail

A self-hosted email intelligence dashboard that monitors your inbox in real-time, classifies every email automatically, and surfaces what matters — urgent meetings, financial deadlines, legal notices, travel bookings, and investment pitches — in a three-panel dashboard.

This is **not** an email client. It is a read-and-act intelligence layer on top of your existing email.

---

## How It Works

```
IMAP Server
    │
    ▼  IDLE push (~1-2s) or 60s polling fallback
imapflow ──► mailparser ──► SQLite (emails)
                                  │
                                  ▼  async, non-blocking
                     ┌────────────────────────┐
                     │  3-Tier Classifier      │
                     │  1. Regex rules (0ms)   │
                     │  2. Local LLM (fast)    │
                     │  3. Fallback: "other"   │
                     └────────────────────────┘
                                  │
                                  ▼
                     SQLite (classifications + drafts)
                                  │
                                  ▼
                     Server-Sent Events (SSE)
                                  │
                                  ▼
                     HTMX partial HTML swaps
                     Alpine.js reactive state
```

---

## Features

- **Real-time inbox** — IMAP IDLE with debounced EXISTS handler and catch-up fetch to ensure zero missed emails
- **8 email categories** — Meeting Request, Financial, Legal, Travel, Pitch Deck, FYI, Rewards & Awards, Other
- **Urgency detection** — Legal emails always urgent; keyword-based urgency for deadlines, payment due, expiry
- **Draft replies** — Pre-written context-aware replies with 4 tone modes (formal, professional, friendly, brief)
- **Demo mode** — 12 pre-seeded sample emails when no account is configured, no credentials needed
- **Settings page** — Live edit of IMAP/SMTP config, test connections, clear cache, reset everything

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express |
| Database | SQLite via better-sqlite3 |
| IMAP | imapflow (IDLE + UID-based fetch) |
| SMTP | nodemailer |
| Email parsing | mailparser |
| Classification | 3-tier: regex rules → local LLM API → fallback |
| Frontend | HTMX 1.9 + Alpine.js 3 + Tailwind CSS v3 (all CDN) |
| Real-time | Server-Sent Events (SSE) |
| Scheduling | node-cron |

---

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- An IMAP/SMTP email account (Gmail, Outlook, Yahoo, iCloud, or any custom server)
- **Local LLM API** (optional, for Tier 2 classification) — FastAPI service at `http://localhost:8765/classify`

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/phdemp/smart-mail.git
cd smart-mail

# 2. Install dependencies
npm install

# 3. Start the server
node src/server.js

# Or on a different port
PORT=3099 node src/server.js

# 4. Open in browser
# → http://localhost:3000
```

The setup wizard guides you through connecting your email account. No `.env` file is required — all config is stored via the setup UI and persisted in SQLite.

---

## Email Provider Setup

### Gmail

Gmail requires an **App Password** (standard passwords are blocked for IMAP).

1. Enable 2-Step Verification on your Google account
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Create an App Password for "Mail"
4. Enable IMAP: Gmail Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP

| | Host | Port | SSL |
|--|------|------|-----|
| IMAP | `imap.gmail.com` | `993` | Yes |
| SMTP | `smtp.gmail.com` | `587` | No (STARTTLS) |

### Outlook / Microsoft 365

1. Enable IMAP in Outlook: Settings → Mail → Sync email → IMAP
2. Use your full email as the username
3. If MFA is enabled, generate an App Password

| | Host | Port | SSL |
|--|------|------|-----|
| IMAP | `outlook.office365.com` | `993` | Yes |
| SMTP | `smtp.office365.com` | `587` | No (STARTTLS) |

### Yahoo Mail

1. Go to Yahoo Account Security → Generate App Password for "Other app"

| | Host | Port | SSL |
|--|------|------|-----|
| IMAP | `imap.mail.yahoo.com` | `993` | Yes |
| SMTP | `smtp.mail.yahoo.com` | `587` | No (STARTTLS) |

### iCloud Mail

1. Go to [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords

| | Host | Port | SSL |
|--|------|------|-----|
| IMAP | `imap.mail.me.com` | `993` | Yes |
| SMTP | `smtp.mail.me.com` | `587` | No (STARTTLS) |

---

## Local LLM Classifier (Tier 2)

Tier 1 (regex rules) handles most common emails instantly. For emails that don't match any rule, IntelliMail calls a local FastAPI service:

```
POST http://localhost:8765/classify
{
  "subject": "...",
  "from_address": "...",
  "from_name": "...",
  "preview": "first 400 chars of body",
  "email_id": "123"
}
```

Expected response:
```json
{
  "category": "meeting_request",
  "urgency": "urgent",
  "urgency_reason": "Meeting scheduled for today",
  "summary": "John has invited you to a call at 3pm",
  "extracted_data": {},
  "suggested_tone": "professional",
  "draft_reply": "Thank you for the invite..."
}
```

If the local API is unavailable, emails fall back to `category: other, urgency: normal`. No crash, no blocking.

The Python scripts in this repo (`main_staging.py`, `main_gpu_updated.py`, `train_tfidf.py`, `data/build_tfidf.py`) implement a TF-IDF + local model classifier for this endpoint.

---

## Email Categories

| Category | Icon | Description |
|----------|------|-------------|
| `meeting_request` | 📅 | Calendar invites, Zoom/Teams/Meet links, 1:1 requests |
| `financial` | 💳 | Statements, invoices, payment due, EMI, bank alerts |
| `legal` | ⚖️ | Legal notices, NDAs, arbitration, cease and desist |
| `travel` | ✈️ | Flight bookings, hotel reservations, PNR, itineraries |
| `pitch_deck` | 🚀 | Investment pitches, funding rounds, VC outreach |
| `rewards_awards` | 🏆 | Loyalty points, cashback, award nominations |
| `fyi` | ℹ️ | Newsletters, digests, automated notifications |
| `other` | 📂 | Everything else |

**Legal emails are always flagged as urgent** regardless of content.

---

## IMAP Sync Modes

| Status | Meaning |
|--------|---------|
| 🟢 Live (IDLE) | IMAP IDLE active, emails arrive in ~1-2 seconds |
| 🟡 Polling | 60s fallback when IDLE is unsupported or circuit-broken |
| ⟳ Reconnecting | Exponential backoff after connection drop |
| ✕ Disconnected | No config, or manual retry needed |

**Circuit breaker:** 3 IDLE drops within 5 minutes → switches to polling. Auto-recovery to IDLE attempted every 5 minutes.

**IDLE renewal:** Reconnects every 28 minutes per RFC 2177.

---

## File Structure

```
intellimail/
├── src/
│   ├── server.js           # Express + SSE, port 3000
│   ├── db.js               # SQLite schema + getConfig/saveConfig/getStats
│   ├── imap.js             # IMAP IDLE state machine, circuit breaker, UID fetch
│   ├── classifier.js       # 3-tier classifier queue (max 5 concurrent)
│   ├── smtp.js             # nodemailer SMTP send
│   ├── demo.js             # 12 seed emails for demo mode
│   └── routes/
│       ├── pages.js        # Page routes (/, /setup, /dashboard, /settings)
│       └── api.js          # 20+ API routes, HTML partials for HTMX
├── views/
│   ├── dashboard.html      # 3-panel HTMX dashboard
│   ├── setup.html          # 4-step Alpine.js setup wizard
│   ├── settings.html       # Config management (loads from server on open)
│   └── partials/           # Per-category action panels, email list, sidebar
├── public/
│   ├── css/app.css         # Full design system, dark theme
│   └── js/app.js           # appState() + draftEditor() Alpine components
├── data/
│   ├── build_tfidf.py      # Build TF-IDF model from training data
│   ├── train_tfidf.py      # Training pipeline
│   ├── labeled_training.jsonl
│   └── tfidf_model.joblib  # Trained model artifact
├── package.json
├── .env.example
└── README.md
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment |

Copy `.env.example` to `.env` if needed. Email credentials and API keys are entered via the setup wizard and stored in `intellimail.db`.

---

## Database

SQLite file: `intellimail.db` (auto-created on first run, gitignored).

| Table | Purpose |
|-------|---------|
| `account_config` | IMAP/SMTP credentials, sync settings |
| `emails` | All fetched emails (deduped by message_id) |
| `classifications` | AI classification results per email |
| `drafts` | Pre-generated reply drafts |
| `sync_log` | IMAP sync history and error log |

---

## Troubleshooting

**Settings page shows empty fields**
→ Restart the server after any code changes. Settings are loaded from the DB on page open via `GET /api/settings`.

**"IMAP authentication failed"**
→ Use an App Password for Gmail, Yahoo, and iCloud — not your account password.

**"IMAP connection timeout"**
→ Port 993 may be blocked by your firewall. IntelliMail falls back to 60s polling automatically.

**"Could not connect to SMTP"**
→ Try port 465 with SSL=true (some providers require this instead of 587+STARTTLS).

**Emails not appearing**
→ Check sync status in the dashboard sidebar. If stuck on "Disconnected", go to Settings → Test IMAP.

**Local LLM not classifying**
→ Ensure your FastAPI service is running on `http://localhost:8765`. Unclassified emails fall back to `other`.

**Demo mode not showing emails**
→ Delete `intellimail.db` and restart. Demo mode activates automatically when no account is configured.

**Server won't start**
→ Run `node --version` — must be 18+. Run `npm install` to restore dependencies.

---

## License

MIT
