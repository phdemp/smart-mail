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

// Migration: add is_deleted for trash support
try { db.exec('ALTER TABLE emails ADD COLUMN is_deleted INTEGER DEFAULT 0'); } catch(e) {}

function getConfig() {
  return db.prepare('SELECT * FROM account_config WHERE id = 1').get();
}

function saveConfig(cfg) {
  const existing = getConfig();
  if (existing) {
    db.prepare(`UPDATE account_config SET
      display_name=?, email=?, imap_host=?, imap_port=?, imap_tls=?,
      smtp_host=?, smtp_port=?, smtp_tls=?, username=?, password=?,
      sync_interval=? WHERE id=1`
    ).run(cfg.display_name, cfg.email, cfg.imap_host, cfg.imap_port, cfg.imap_tls,
          cfg.smtp_host, cfg.smtp_port, cfg.smtp_tls, cfg.username, cfg.password,
          cfg.sync_interval || 60);
  } else {
    db.prepare(`INSERT INTO account_config (id, display_name, email, imap_host, imap_port, imap_tls,
      smtp_host, smtp_port, smtp_tls, username, password, sync_interval)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(cfg.display_name, cfg.email, cfg.imap_host, cfg.imap_port, cfg.imap_tls,
          cfg.smtp_host, cfg.smtp_port, cfg.smtp_tls, cfg.username, cfg.password,
          cfg.sync_interval || 60);
  }
}

function getStats() {
  const rows = db.prepare(`
    SELECT c.category, COUNT(*) as count
    FROM emails e
    JOIN classifications c ON c.email_id = e.id
    WHERE e.is_archived = 0 AND e.is_deleted = 0 AND e.folder = 'INBOX'
    GROUP BY c.category
  `).all();

  const urgentCount = db.prepare(`
    SELECT COUNT(*) as count FROM emails e
    JOIN classifications c ON c.email_id = e.id
    WHERE c.urgency = 'urgent' AND e.is_archived = 0 AND e.is_deleted = 0 AND e.is_read = 0
  `).get();

  const totalUnread = db.prepare(`
    SELECT COUNT(*) as count FROM emails WHERE is_read = 0 AND is_archived = 0 AND is_deleted = 0 AND folder = 'INBOX'
  `).get();

  const trashCount = db.prepare(
    'SELECT COUNT(*) as count FROM emails WHERE is_deleted = 1'
  ).get();

  const stats = {
    urgent: urgentCount.count,
    total_unread: totalUnread.count,
    trash: trashCount.count,
    meeting_request: 0, financial: 0, legal: 0, travel: 0,
    pitch_deck: 0, fyi: 0, rewards_awards: 0, other: 0
  };
  for (const row of rows) {
    if (stats.hasOwnProperty(row.category)) stats[row.category] = row.count;
  }
  return stats;
}

module.exports = { db, getConfig, saveConfig, getStats };
