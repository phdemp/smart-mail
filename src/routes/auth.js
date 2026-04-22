const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { signToken } = require('../auth');
const { testImap } = require('../imap');
const { requireAuth } = require('../middleware/auth');

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
    password: b.password,
    sync_interval: parseInt(b.sync_interval, 10) || 60
  };

  let imapResult;
  try { imapResult = await testImap(cfg); }
  catch (e) { imapResult = { ok: false, error: e.message }; }
  if (!imapResult || !imapResult.ok) {
    return res.status(400).json({ error: 'imap_failed', detail: imapResult && imapResult.error || 'IMAP test failed' });
  }

  const info = db.prepare('INSERT INTO users (email) VALUES (?)').run(cfg.email);
  const userId = info.lastInsertRowid;

  db.prepare(`
    INSERT INTO account_config (
      user_id, display_name, email, imap_host, imap_port, imap_tls,
      smtp_host, smtp_port, smtp_tls, username, password, sync_interval
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(userId, cfg.display_name, cfg.email, cfg.imap_host, cfg.imap_port, cfg.imap_tls,
         cfg.smtp_host, cfg.smtp_port, cfg.smtp_tls, cfg.username, cfg.password, cfg.sync_interval);

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
  console.log(`[LOGIN] attempt email=${email || '(missing)'} pw_len=${password ? password.length : 0}`);
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  const row = db.prepare(`
    SELECT u.id, u.email, ac.password
    FROM users u JOIN account_config ac ON ac.user_id = u.id
    WHERE u.email = ?
  `).get(email);
  if (!row) {
    console.log(`[LOGIN] no user+account_config join for ${email}`);
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (row.password !== password) {
    console.log(`[LOGIN] password mismatch for ${email} (stored len=${row.password ? row.password.length : 0}, got len=${password.length})`);
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  console.log(`[LOGIN] success uid=${row.id}`);
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
