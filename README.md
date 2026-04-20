# IntelliMail — Intelligent Email Intelligence Dashboard

IntelliMail is a self-hosted email intelligence command center that monitors your IMAP/SMTP email accounts in real-time and automatically classifies every incoming email using Claude AI. It surfaces what matters — urgent meetings, financial deadlines, legal notices, travel departures, and investment pitches — in a beautifully designed three-panel dashboard.

This is **not** an email client. It is a read-and-act intelligence layer on top of your existing email. IntelliMail fetches emails via IMAP IDLE (real-time push, ~1-2s latency), classifies them with Claude AI into 8 smart categories, generates AI draft replies pre-loaded with context, and pushes updates to your browser via Server-Sent Events — all without any full page reloads.

## Features

- **Real-time inbox monitoring** — IMAP IDLE for instant notifications, 60s polling fallback
- **AI classification** — 8 smart categories: Meeting Requests, Financial, Legal, Travel, Pitch Decks, FYI, Rewards & Awards, Other
- **Urgency detection** — Automatic banners for urgent meetings, payment due dates, legal deadlines, expiring rewards
- **AI draft replies** — Context-aware pre-written replies with 4 tone modes (formal, professional, friendly, brief)
- **Draft regeneration** — One-click re-generate with different tone via Claude API
- **Meeting calendar** — Download .ics files for meeting requests
- **Demo mode** — Works without credentials using 12 pre-classified sample emails

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- A Claude API key — [console.anthropic.com](https://console.anthropic.com)
- An IMAP/SMTP email account (Gmail, Outlook, Yahoo, iCloud, or custom)

## Quick Start

```bash
# Clone or download the project
cd intellimail

# Install dependencies
npm install

# Start the server
npm run dev

# Open in browser
# → http://localhost:3000
```

The setup wizard will guide you through connecting your email account. No `.env` file is required — all configuration is stored in the setup wizard UI.

## Email Provider Setup

### Gmail

Gmail requires an **App Password** if you have 2-Step Verification enabled (which is required for most accounts).

1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Select "Mail" as the app
3. Copy the 16-character App Password
4. Use this password (not your Gmail password) in IntelliMail setup
5. IMAP must be enabled: Gmail Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP

**IMAP:** `imap.gmail.com:993` (SSL)
**SMTP:** `smtp.gmail.com:587` (STARTTLS)

### Outlook / Microsoft 365

1. Enable IMAP in Outlook: Settings → Mail → Sync email → IMAP
2. Use your full email address as the username
3. If using Microsoft 365 with MFA, generate an App Password

**IMAP:** `outlook.office365.com:993` (SSL)
**SMTP:** `smtp.office365.com:587` (STARTTLS)

### Yahoo Mail

1. Go to Yahoo Account Security settings
2. Generate an App Password for "Other app"
3. Use this App Password in IntelliMail

**IMAP:** `imap.mail.yahoo.com:993` (SSL)
**SMTP:** `smtp.mail.yahoo.com:587` (STARTTLS)

### iCloud Mail

1. Go to [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords
2. Generate a new App Password for IntelliMail
3. Enable IMAP in iCloud Mail settings

**IMAP:** `imap.mail.me.com:993` (SSL)
**SMTP:** `smtp.mail.me.com:587` (STARTTLS)

## Architecture

```
IMAP Server
    │
    ▼ IDLE (real-time push, 1-2s) or Poll (60s fallback)
imapflow ──► mailparser ──► SQLite (emails table)
                                 │
                                 ▼ (async, non-blocking)
                          @anthropic-ai/sdk
                          claude-sonnet-4-20250514
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
                    Tailwind CSS + Custom CSS
```

**Sync modes:**
- 🟢 **Live (IDLE)** — imapflow IMAP IDLE active, real-time push
- 🟡 **Polling (60s)** — node-cron fallback when IDLE unsupported or circuit-broken
- ⟳ **Reconnecting** — exponential backoff after connection drop
- ✕ **Disconnected** — manual retry needed

**Circuit breaker:** After 3 IDLE drops within 5 minutes, automatically switches to polling. Auto-recovery to IDLE attempted every 5 minutes.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment mode |
| `ANTHROPIC_API_KEY` | — | Optional: Claude API key (can also be set in setup UI) |

Copy `.env.example` to `.env` and fill in values as needed. The Claude API key can also be entered in the setup wizard instead.

## File Structure

```
intellimail/
├── src/
│   ├── server.js       # Express server + SSE
│   ├── db.js           # SQLite schema + helpers
│   ├── imap.js         # IMAP IDLE state machine
│   ├── classifier.js   # Claude AI classification queue
│   ├── smtp.js         # SMTP email sending
│   ├── demo.js         # Demo mode data seeder
│   └── routes/
│       ├── pages.js    # HTML page routes
│       └── api.js      # All API endpoints + HTML partials
├── views/
│   ├── dashboard.html  # 3-panel dashboard
│   ├── setup.html      # 4-step setup wizard
│   ├── settings.html   # Settings page
│   └── partials/       # Reference partial templates
├── public/
│   ├── css/app.css     # Full design system
│   └── js/app.js       # Alpine.js components + SSE
├── package.json
└── .env.example
```

## Troubleshooting

**"IMAP authentication failed"**
→ Check your credentials. For Gmail/Yahoo/iCloud, use an App Password, not your account password.

**"IMAP connection timeout"**
→ Check your firewall — port 993 must be reachable. IntelliMail will fall back to 60s polling.

**"Could not connect to SMTP"**
→ Try port 465 with SSL=true (some providers require this instead of 587+STARTTLS).

**"AI classification unavailable"**
→ Check your Claude API key in Settings. The key must have access to `claude-sonnet-4-20250514`.

**Demo mode not showing emails**
→ The `intellimail.db` file may have stale data. Delete it and restart the server.

**Server won't start**
→ Ensure Node.js 18+ is installed (`node --version`). Run `npm install` again if dependencies are missing.

## License

MIT
