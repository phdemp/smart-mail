# SmartMail

A self-hosted email intelligence dashboard that monitors your inbox in real-time, classifies every email automatically, and surfaces what matters â€” urgent meetings, financial deadlines, legal notices, travel bookings, and investment pitches â€” in a three-panel dashboard.

This is **not** an email client. It is a read-and-act intelligence layer on top of your existing email.

---

## How It Works

```
IMAP Server
    â”‚
    â–¼  IDLE push (~1-2s) or 60s polling fallback
imapflow â”€â”€â–º mailparser â”€â”€â–º SQLite (emails)
                                  â”‚
                                  â–¼  async, non-blocking
                     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                     â”‚  3-Tier Classifier      â”‚
                     â”‚  1. Regex rules (0ms)   â”‚
                     â”‚  2. Local LLM (fast)    â”‚
                     â”‚  3. Fallback: "other"   â”‚
                     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                  â”‚
                                  â–¼
                     SQLite (classifications + drafts)
                                  â”‚
                                  â–¼
                     Server-Sent Events (SSE)
                                  â”‚
                                  â–¼
                     HTMX partial HTML swaps
                     Alpine.js reactive state
```

---

## Features

- **Real-time inbox** â€” IMAP IDLE with debounced EXISTS handler and catch-up fetch to ensure zero missed emails
- **8 email categories** â€” Meeting Request, Financial, Legal, Travel, Pitch Deck, FYI, Rewards & Awards, Other
- **Urgency detection** â€” Legal emails always urgent; keyword-based urgency for deadlines, payment due, expiry
- **Draft replies** â€” Pre-written context-aware replies with 4 tone modes (formal, professional, friendly, brief)
- **Demo mode** â€” 12 pre-seeded sample emails when no account is configured, no credentials needed
- **Settings page** â€” Live edit of IMAP/SMTP config, test connections, clear cache, reset everything

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express |
| Database | SQLite via better-sqlite3 |
| IMAP | imapflow (IDLE + UID-based fetch) |
| SMTP | nodemailer |
| Email parsing | mailparser |
| Classification | 3-tier: regex rules â†’ local LLM API â†’ fallback |
| Frontend | HTMX 1.9 + Alpine.js 3 + Tailwind CSS v3 (all CDN) |
| Real-time | Server-Sent Events (SSE) |
| Scheduling | node-cron |

---

## Prerequisites

- **Node.js 18+** â€” [nodejs.org](https://nodejs.org)
- An IMAP/SMTP email account (Gmail, Outlook, Yahoo, iCloud, or any custom server)
- **Local LLM API** (optional, for Tier 2 classification) â€” FastAPI service at `http://localhost:8765/classify`

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
# â†’ http://localhost:3000
```

The setup wizard guides you through connecting your email account. No `.env` file is required â€” all config is stored via the setup UI and persisted in SQLite.

---

## Email Provider Setup

### Gmail

Gmail requires an **App Password** (standard passwords are blocked for IMAP).

1. Enable 2-Step Verification on your Google account
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Create an App Password for "Mail"
4. Enable IMAP: Gmail Settings â†’ See all settings â†’ Forwarding and POP/IMAP â†’ Enable IMAP

| | Host | Port | SSL |
|--|------|------|-----|
| IMAP | `imap.gmail.com` | `993` | Yes |
| SMTP | `smtp.gmail.com` | `587` | No (STARTTLS) |

### Outlook / Microsoft 365

1. Enable IMAP in Outlook: Settings â†’ Mail â†’ Sync email â†’ IMAP
2. Use your full email as the username
3. If MFA is enabled, generate an App Password

| | Host | Port | SSL |
|--|------|------|-----|
| IMAP | `outlook.office365.com` | `993` | Yes |
| SMTP | `smtp.office365.com` | `587` | No (STARTTLS) |

### Yahoo Mail

1. Go to Yahoo Account Security â†’ Generate App Password for "Other app"

| | Host | Port | SSL |
|--|------|------|-----|
| IMAP | `imap.mail.yahoo.com` | `993` | Yes |
| SMTP | `smtp.mail.yahoo.com` | `587` | No (STARTTLS) |

### iCloud Mail

1. Go to [appleid.apple.com](https://appleid.apple.com) â†’ Sign-In and Security â†’ App-Specific Passwords

| | Host | Port | SSL |
|--|------|------|-----|
| IMAP | `imap.mail.me.com` | `993` | Yes |
| SMTP | `smtp.mail.me.com` | `587` | No (STARTTLS) |

---

## Local LLM Classifier (Tier 2)

Tier 1 (regex rules) handles most common emails instantly. For emails that don't match any rule, SmartMail calls a local FastAPI service:

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
| `meeting_request` | ðŸ“… | Calendar invites, Zoom/Teams/Meet links, 1:1 requests |
| `financial` | ðŸ’³ | Statements, invoices, payment due, EMI, bank alerts |
| `legal` | âš–ï¸ | Legal notices, NDAs, arbitration, cease and desist |
| `travel` | âœˆï¸ | Flight bookings, hotel reservations, PNR, itineraries |
| `pitch_deck` | ðŸš€ | Investment pitches, funding rounds, VC outreach |
| `rewards_awards` | ðŸ† | Loyalty points, cashback, award nominations |
| `fyi` | â„¹ï¸ | Newsletters, digests, automated notifications |
| `other` | ðŸ“‚ | Everything else |

**Legal emails are always flagged as urgent** regardless of content.

---

## IMAP Sync Modes

| Status | Meaning |
|--------|---------|
| ðŸŸ¢ Live (IDLE) | IMAP IDLE active, emails arrive in ~1-2 seconds |
| ðŸŸ¡ Polling | 60s fallback when IDLE is unsupported or circuit-broken |
| âŸ³ Reconnecting | Exponential backoff after connection drop |
| âœ• Disconnected | No config, or manual retry needed |

**Circuit breaker:** 3 IDLE drops within 5 minutes â†’ switches to polling. Auto-recovery to IDLE attempted every 5 minutes.

**IDLE renewal:** Reconnects every 28 minutes per RFC 2177.

---

## File Structure

```
SmartMail/
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ server.js           # Express + SSE, port 3000
â”‚   â”œâ”€â”€ db.js               # SQLite schema + getConfig/saveConfig/getStats
â”‚   â”œâ”€â”€ imap.js             # IMAP IDLE state machine, circuit breaker, UID fetch
â”‚   â”œâ”€â”€ classifier.js       # 3-tier classifier queue (max 5 concurrent)
â”‚   â”œâ”€â”€ smtp.js             # nodemailer SMTP send
â”‚   â”œâ”€â”€ demo.js             # 12 seed emails for demo mode
â”‚   â””â”€â”€ routes/
â”‚       â”œâ”€â”€ pages.js        # Page routes (/, /setup, /dashboard, /settings)
â”‚       â””â”€â”€ api.js          # 20+ API routes, HTML partials for HTMX
â”œâ”€â”€ views/
â”‚   â”œâ”€â”€ dashboard.html      # 3-panel HTMX dashboard
â”‚   â”œâ”€â”€ setup.html          # 4-step Alpine.js setup wizard
â”‚   â”œâ”€â”€ settings.html       # Config management (loads from server on open)
â”‚   â””â”€â”€ partials/           # Per-category action panels, email list, sidebar
â”œâ”€â”€ public/
â”‚   â”œâ”€â”€ css/app.css         # Full design system, dark theme
â”‚   â””â”€â”€ js/app.js           # appState() + draftEditor() Alpine components
â”œâ”€â”€ data/
â”‚   â”œâ”€â”€ build_tfidf.py      # Build TF-IDF model from training data
â”‚   â”œâ”€â”€ train_tfidf.py      # Training pipeline
â”‚   â”œâ”€â”€ labeled_training.jsonl
â”‚   â””â”€â”€ tfidf_model.joblib  # Trained model artifact
â”œâ”€â”€ package.json
â”œâ”€â”€ .env.example
â””â”€â”€ README.md
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment |

Copy `.env.example` to `.env` if needed. Email credentials and API keys are entered via the setup wizard and stored in `SmartMail.db`.

---

## Database

SQLite file: `SmartMail.db` (auto-created on first run, gitignored).

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
â†’ Restart the server after any code changes. Settings are loaded from the DB on page open via `GET /api/settings`.

**"IMAP authentication failed"**
â†’ Use an App Password for Gmail, Yahoo, and iCloud â€” not your account password.

**"IMAP connection timeout"**
â†’ Port 993 may be blocked by your firewall. SmartMail falls back to 60s polling automatically.

**"Could not connect to SMTP"**
â†’ Try port 465 with SSL=true (some providers require this instead of 587+STARTTLS).

**Emails not appearing**
â†’ Check sync status in the dashboard sidebar. If stuck on "Disconnected", go to Settings â†’ Test IMAP.

**Local LLM not classifying**
â†’ Ensure your FastAPI service is running on `http://localhost:8765`. Unclassified emails fall back to `other`.

**Demo mode not showing emails**
â†’ Delete `SmartMail.db` and restart. Demo mode activates automatically when no account is configured.

**Server won't start**
â†’ Run `node --version` â€” must be 18+. Run `npm install` to restore dependencies.

---

## License

MIT
