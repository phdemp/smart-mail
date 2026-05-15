const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'intellimail.db');
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

// ─── LLM provider config + usage ─────────────────────────────────────────
const PROVIDER_COLS = [
  ['nvidia_api_key',        'TEXT'],
  ['groq_api_key',          'TEXT'],
  ['gemini_api_key',        'TEXT'],
  ['deepseek_api_key',      'TEXT'],
  ['nvidia_model',          "TEXT DEFAULT 'qwen/qwen3.5-122b-a10b'"],
  ['groq_model',            "TEXT DEFAULT 'llama-3.3-70b-versatile'"],
  ['gemini_model',          "TEXT DEFAULT 'gemini-flash-latest'"],
  ['deepseek_model',        "TEXT DEFAULT 'deepseek-chat'"],
  ['llm_provider_order',    "TEXT DEFAULT 'nvidia,groq,gemini,deepseek'"],
  ['llm_providers_enabled', "TEXT DEFAULT 'nvidia,groq,gemini,deepseek'"],
  ['nvidia_rpm',            'INTEGER'],
  ['nvidia_rpd',            'INTEGER'],
  ['groq_rpm',              'INTEGER'],
  ['groq_rpd',              'INTEGER'],
  ['gemini_rpm',            'INTEGER'],
  ['gemini_rpd',            'INTEGER'],
  ['deepseek_rpm',          'INTEGER'],
  ['deepseek_rpd',          'INTEGER'],
  // Legacy columns from the old Ollama-backed 'local' provider. SQLite
  // can't drop columns cheaply, and leaving them avoids breaking older
  // SELECT * callers — they're ignored by application code.
  ['local_rpm',             'INTEGER'],
  ['local_rpd',             'INTEGER']
];
for (const [col, type] of PROVIDER_COLS) {
  try { db.exec(`ALTER TABLE account_config ADD COLUMN ${col} ${type}`); } catch(e) {}
}

// Append 'deepseek' to existing provider_order / providers_enabled strings that don't already include it.
try {
  db.prepare(`UPDATE account_config SET llm_provider_order = llm_provider_order || ',deepseek'
              WHERE llm_provider_order IS NOT NULL
              AND llm_provider_order != ''
              AND llm_provider_order NOT LIKE '%deepseek%'`).run();
  db.prepare(`UPDATE account_config SET llm_providers_enabled = llm_providers_enabled || ',deepseek'
              WHERE llm_providers_enabled IS NOT NULL
              AND llm_providers_enabled != ''
              AND llm_providers_enabled NOT LIKE '%deepseek%'`).run();
} catch {}

// Rewrite legacy 'local' provider tokens to 'nvidia' in existing rows, and copy
// any per-user RPM/RPD overrides that were stored against 'local' into the new
// nvidia_* columns (only when nvidia_* is still NULL — never clobber a value
// the user has already set against the new provider).
try {
  db.prepare(`UPDATE account_config
              SET llm_provider_order = REPLACE(llm_provider_order, 'local', 'nvidia')
              WHERE llm_provider_order LIKE '%local%'`).run();
  db.prepare(`UPDATE account_config
              SET llm_providers_enabled = REPLACE(llm_providers_enabled, 'local', 'nvidia')
              WHERE llm_providers_enabled LIKE '%local%'`).run();
  db.prepare(`UPDATE account_config
              SET nvidia_rpm = local_rpm
              WHERE nvidia_rpm IS NULL AND local_rpm IS NOT NULL`).run();
  db.prepare(`UPDATE account_config
              SET nvidia_rpd = local_rpd
              WHERE nvidia_rpd IS NULL AND local_rpd IS NOT NULL`).run();
} catch {}

// Roll forward the nvidia_model default. SQLite locked the column DEFAULT
// at 'meta/llama-3.3-70b-instruct' when the column was first added; only
// rows still on that locked default are rewritten — users who actively
// chose meta/... or any other model are left alone.
try {
  db.prepare(`UPDATE account_config
              SET nvidia_model = 'qwen/qwen3.5-122b-a10b'
              WHERE nvidia_model = 'meta/llama-3.3-70b-instruct'`).run();
} catch {}

db.exec(`
CREATE TABLE IF NOT EXISTS provider_usage (
  provider TEXT NOT NULL,
  day DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, day)
);
CREATE INDEX IF NOT EXISTS idx_provider_usage_day ON provider_usage(day);
`);

// Prune provider_usage rows older than 7 days on boot
try { db.prepare("DELETE FROM provider_usage WHERE day < date('now', '-7 days')").run(); } catch(e) {}

// ─── Multi-user auth ─────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

const USER_ID_TABLES = ['account_config', 'emails', 'classifications', 'drafts', 'sync_log'];
for (const t of USER_ID_TABLES) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN user_id INTEGER REFERENCES users(id)`); } catch(e) {}
}

// Draft provenance. Values: 'template' | 'llm' | 'user' | NULL (legacy/unknown).
// 'template' drafts auto-upgrade to 'llm' the next time the email is opened.
// 'user' drafts are never overwritten.
try { db.exec(`ALTER TABLE drafts ADD COLUMN source TEXT`); } catch(e) {}

// Classification provenance. Values: 'rules' | 'llm' | 'fallback' | NULL (legacy).
// 'fallback' rows can be bulk-reclassified once the user configures an LLM key.
try { db.exec(`ALTER TABLE classifications ADD COLUMN source TEXT`); } catch(e) {}
// Backfill: fallback rows are identified by the sentinel summary text.
try {
  db.prepare("UPDATE classifications SET source = 'fallback' WHERE source IS NULL AND summary = 'Classification unavailable.'").run();
} catch {}

// Backfill: tag legacy drafts whose body text matches a known template string.
try {
  const { GENERIC, TABLE } = require('./llm/templates');
  const knownTemplates = new Set();
  for (const t of Object.values(GENERIC)) knownTemplates.add(t);
  for (const cat of Object.values(TABLE)) {
    if (cat && typeof cat === 'object') for (const t of Object.values(cat)) knownTemplates.add(t);
  }
  // Hardcoded fallbacks used elsewhere in the codebase
  knownTemplates.add('Thank you for your email. I will respond shortly.');
  knownTemplates.add('Thank you for your email. I will review and respond shortly.');
  const rows = db.prepare("SELECT id, body FROM drafts WHERE source IS NULL AND body IS NOT NULL AND body != ''").all();
  const upd = db.prepare('UPDATE drafts SET source = ? WHERE id = ?');
  for (const r of rows) if (knownTemplates.has(r.body)) upd.run('template', r.id);
} catch {}

db.exec(`
CREATE INDEX IF NOT EXISTS idx_emails_user          ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_classifications_user ON classifications(user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_user          ON drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_user        ON sync_log(user_id);
-- Powers the classification-scope check (latest 100 within last 10 days per user).
CREATE INDEX IF NOT EXISTS idx_emails_user_received ON emails(user_id, received_at DESC);
`);

// provider_usage needs its PK rebuilt to include user_id. SQLite can't ALTER PK,
// so rebuild the table in place. On fresh installs where user_id is already NULL
// and the composite PK doesn't exist, copy rows into the new shape.
const puHasUserId = db.prepare('PRAGMA table_info(provider_usage)').all().some(c => c.name === 'user_id');
if (!puHasUserId) {
  db.exec(`
    CREATE TABLE provider_usage_new (
      user_id INTEGER,
      provider TEXT NOT NULL,
      day DATE NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, provider, day)
    );
    INSERT INTO provider_usage_new (user_id, provider, day, request_count)
      SELECT NULL, provider, day, request_count FROM provider_usage;
    DROP TABLE provider_usage;
    ALTER TABLE provider_usage_new RENAME TO provider_usage;
    CREATE INDEX IF NOT EXISTS idx_provider_usage_day ON provider_usage(day);
    CREATE INDEX IF NOT EXISTS idx_provider_usage_user ON provider_usage(user_id, day);
  `);
}

// ─── Phase 3: User correction loop ──────────────────────────────────────────

// Phase 3: correction audit columns on classifications (CORRECT-01)
try { db.exec(`ALTER TABLE classifications ADD COLUMN user_corrected_category TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE classifications ADD COLUMN corrected_at DATETIME`); } catch(e) {}

// Phase 3: sender_rules table — stores promoted domain → category rules (D-04)
try {
  db.exec(`
    CREATE TABLE sender_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      domain TEXT,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch(e) {}
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sender_rules_uq ON sender_rules(user_id, domain, category)');
} catch(e) {}

// Phase 3: ai_feedback table — thumbs up/down votes on AI summaries (D-11)
try {
  db.exec(`
    CREATE TABLE ai_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      summary_id INTEGER REFERENCES classifications(id),
      user_id INTEGER,
      vote TEXT CHECK(vote IN ('up','down')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch(e) {}
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_feedback_uq ON ai_feedback(user_id, summary_id)');
} catch(e) {}

function getConfig(userId) {
  if (userId != null) {
    return db.prepare('SELECT * FROM account_config WHERE user_id = ?').get(userId);
  }
  // Legacy callers (e.g. imap startup before user context) — return first row
  return db.prepare('SELECT * FROM account_config ORDER BY id LIMIT 1').get();
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

function getStats(userId) {
  const where = userId != null ? 'AND e.user_id = ?' : '';
  const params = userId != null ? [userId] : [];

  const rows = db.prepare(`
    SELECT c.category, COUNT(*) as count
    FROM emails e
    JOIN classifications c ON c.email_id = e.id
    WHERE e.is_archived = 0 AND e.is_deleted = 0 AND e.folder = 'INBOX' ${where}
    GROUP BY c.category
  `).all(...params);

  const urgentCount = db.prepare(`
    SELECT COUNT(*) as count FROM emails e
    JOIN classifications c ON c.email_id = e.id
    WHERE c.urgency = 'urgent' AND e.is_archived = 0 AND e.is_deleted = 0 AND e.is_read = 0 ${where}
  `).get(...params);

  const totalUnread = db.prepare(`
    SELECT COUNT(*) as count FROM emails e
    WHERE is_read = 0 AND is_archived = 0 AND is_deleted = 0 AND folder = 'INBOX' ${where}
  `).get(...params);

  const trashCount = db.prepare(`
    SELECT COUNT(*) as count FROM emails e WHERE is_deleted = 1 ${where}
  `).get(...params);

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

const { grandfatherIfNeeded } = require('./db-migration');
grandfatherIfNeeded(db);

module.exports = { db, getConfig, saveConfig, getStats };
