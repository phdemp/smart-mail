const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { signToken } = require('../auth');
const { testImap } = require('../imap');
const { requireAuth } = require('../middleware/auth');
const { normalizePassword, mapAuthError } = require('../util/credentials');

router.post('/api/auth/signup', async (req, res) => {
  const b = req.body || {};
  if (!b.email || !b.password || !b.imap_host || !b.smtp_host) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(b.email);
  if (existing) return res.status(409).json({ error: 'email_exists' });

  const cfg = {
    display_name: b.display_name || b.email,
    email: b.email,
    imap_host: b.imap_host,
    imap_port: parseInt(b.imap_port, 10) || 993,
    imap_tls: (b.imap_tls === true || b.imap_tls === 1 || b.imap_tls === '1' || b.imap_tls === 'on') ? 1 : 0,
    smtp_host: b.smtp_host,
    smtp_port: parseInt(b.smtp_port, 10) || 465,
    smtp_tls: (b.smtp_tls === true || b.smtp_tls === 1 || b.smtp_tls === '1' || b.smtp_tls === 'on') ? 1 : 0,
    username: b.username || b.email,
    // Normalize password server-side. Always trim edges; for Gmail hosts strip
    // all internal whitespace (Google displays app passwords with spaces).
    password: normalizePassword(b.imap_host, b.password),
    sync_interval: parseInt(b.sync_interval, 10) || 60
  };

  let imapResult;
  try { imapResult = await testImap(cfg); }
  catch (e) { imapResult = { ok: false, error: e.message }; }
  if (!imapResult || !imapResult.ok) {
    const detail = mapAuthError(cfg.imap_host, imapResult && imapResult.error) || 'IMAP test failed';
    return res.status(400).json({ error: 'imap_failed', detail });
  }

  const info = db.prepare('INSERT INTO users (email) VALUES (?)').run(cfg.email);
  const userId = info.lastInsertRowid;

  // Explicit provider order/enabled + nvidia_model — DON'T rely on the
  // column DEFAULTs. SQLite locks each column's default at the value
  // supplied when it was first added; updating PROVIDER_COLS in db.js
  // afterwards is a silent no-op for existing columns. Specifying values
  // here keeps fresh signups consistent with the live defaults
  // (nvidia listed first; qwen as the NVIDIA model).
  const PROVIDER_ORDER_DEFAULT = 'nvidia,groq,gemini,deepseek';
  const NVIDIA_MODEL_DEFAULT   = 'qwen/qwen3.5-122b-a10b';
  db.prepare(`
    INSERT INTO account_config (
      user_id, display_name, email, imap_host, imap_port, imap_tls,
      smtp_host, smtp_port, smtp_tls, username, password, sync_interval,
      llm_provider_order, llm_providers_enabled, nvidia_model
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(userId, cfg.display_name, cfg.email, cfg.imap_host, cfg.imap_port, cfg.imap_tls,
         cfg.smtp_host, cfg.smtp_port, cfg.smtp_tls, cfg.username, cfg.password, cfg.sync_interval,
         PROVIDER_ORDER_DEFAULT, PROVIDER_ORDER_DEFAULT, NVIDIA_MODEL_DEFAULT);

  // Kick off IMAP sync in the background — the caller gets their token right away.
  try {
    const { startSyncForUser } = require('../imap');
    startSyncForUser(userId);
  } catch (e) {
    console.error('[signup] failed to start sync for user', userId, e.message);
  }

  const token = signToken(userId, cfg.email);
  res.json({ token, user: { id: userId, email: cfg.email } });
});

router.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  const row = db.prepare(`
    SELECT u.id, u.email, ac.password, ac.imap_host
    FROM users u JOIN account_config ac ON ac.user_id = u.id
    WHERE u.email = ?
  `).get(email);
  // Apply the same password normalization the signup path uses so a user
  // pasting back Google's spaced app-password format can still log in.
  const cleaned = row ? normalizePassword(row.imap_host, password) : password;
  if (!row || row.password !== cleaned) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  // Nudge IMAP sync if it isn't already running for this user — covers cases
  // where the user disconnected manually or the server was restarted without
  // the boot-time per-user loop reaching them.
  try {
    const { startSyncForUser, getSyncMode } = require('../imap');
    if (getSyncMode(row.id) === 'disconnected') {
      startSyncForUser(row.id);
    }
  } catch (e) {
    console.error('[login] failed to restart sync for user', row.id, e.message);
  }
  const token = signToken(row.id, row.email);
  res.json({ token, user: { id: row.id, email: row.email } });
});

router.post('/api/auth/logout', (req, res) => {
  res.json({ ok: true });
});

router.get('/api/auth/check', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

module.exports = router;
