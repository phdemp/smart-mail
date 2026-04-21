const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { signToken } = require('../auth');
const { testImap } = require('../imap');

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

  const token = signToken(userId, cfg.email);
  res.json({ token, user: { id: userId, email: cfg.email } });
});

module.exports = router;
