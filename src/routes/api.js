const express = require('express');
const router = express.Router();
const { db, getConfig, saveConfig, getStats } = require('../db');
const { queueClassification, classifyEmail, generateDraft } = require('../classifier');
const { sendEmail, testSmtp } = require('../smtp');
const { testImap, getSyncMode, startSyncForUser, stopSyncForUser, flagAsDeleted, expungeDeleted } = require('../imap');
const { normalizePassword } = require('../util/credentials');

// ─── Public endpoints (no auth required) ────────────────────────────────────
router.get('/api/users/any', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  res.json({ any: n > 0 });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// CR-01: Validate URL scheme before inserting into href to prevent javascript: XSS.
// escHtml alone does not strip "javascript:" URIs; this function only returns a
// safe URL when the scheme is http or https.
function safeHref(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return escHtml(u.href);
  } catch { return null; }
}

function smartTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD === 1) return 'Yesterday';
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function avatarColor(name) {
  const colors = [
    '#3b82f6','#10b981','#f59e0b','#ef4444','#a78bfa',
    '#f97316','#06b6d4','#84cc16','#ec4899','#6366f1'
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function categoryLabel(cat) {
  const map = {
    meeting_request: 'Meeting', financial: 'Financial', legal: 'Legal',
    travel: 'Travel', pitch_deck: 'Pitch', fyi: 'FYI',
    rewards_awards: 'Rewards', request: 'Request', other: 'Other', pending: 'Classifying...'
  };
  return map[cat] || cat;
}

function parsedExtractedData(str) {
  try { return JSON.parse(str || '{}'); } catch { return {}; }
}

// ─── Account Routes ──────────────────────────────────────────────────────────

router.post('/api/account/save', async (req, res) => {
  const cfg = {
    display_name: req.body.display_name,
    email: req.body.email,
    imap_host: req.body.imap_host,
    imap_port: parseInt(req.body.imap_port) || 993,
    imap_tls: (req.body.imap_tls === true || req.body.imap_tls === 1 || req.body.imap_tls === 'on' || req.body.imap_tls === '1') ? 1 : 0,
    smtp_host: req.body.smtp_host,
    smtp_port: parseInt(req.body.smtp_port) || 587,
    smtp_tls: (req.body.smtp_tls === true || req.body.smtp_tls === 1 || req.body.smtp_tls === 'on' || req.body.smtp_tls === '1') ? 1 : 0,
    username: req.body.username || req.body.email,
    password: req.body.password,
    sync_interval: parseInt(req.body.sync_interval) || 60
  };
  try {
    // Update-my-account path — scoped to the current user.
    const existing = db.prepare('SELECT id FROM account_config WHERE user_id = ?').get(req.user.id);
    if (existing) {
      db.prepare(`UPDATE account_config SET display_name=?, email=?, imap_host=?, imap_port=?, imap_tls=?,
        smtp_host=?, smtp_port=?, smtp_tls=?, username=?, password=?, sync_interval=?
        WHERE user_id=?`).run(cfg.display_name, cfg.email, cfg.imap_host, cfg.imap_port, cfg.imap_tls,
                               cfg.smtp_host, cfg.smtp_port, cfg.smtp_tls, cfg.username, cfg.password,
                               cfg.sync_interval || 60, req.user.id);
    } else {
      db.prepare(`INSERT INTO account_config (user_id, display_name, email, imap_host, imap_port, imap_tls,
        smtp_host, smtp_port, smtp_tls, username, password, sync_interval)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, cfg.display_name, cfg.email, cfg.imap_host,
                               cfg.imap_port, cfg.imap_tls, cfg.smtp_host, cfg.smtp_port, cfg.smtp_tls,
                               cfg.username, cfg.password, cfg.sync_interval || 60);
    }
    // Clear current user's demo/placeholder data and restart sync
    db.prepare('DELETE FROM emails WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM classifications WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM drafts WHERE user_id = ?').run(req.user.id);
    startSyncForUser(req.user.id);
    res.redirect('/dashboard');
  } catch (e) {
    // CR-02: Never reflect raw DB error messages — log server-side only.
    // e.message may contain user-supplied values from constraint violations
    // which could be used to inject extra query params or confuse client logic.
    console.error('[account/save] error:', e.message);
    res.redirect('/setup?error=' + encodeURIComponent('Save failed. Check your settings.'));
  }
});

function buildCfg(q) {
  // Strip whitespace from the password server-side. For Gmail hosts we strip
  // ALL internal whitespace too (matches Google's actual app-password format —
  // users paste the spaced "abcd efgh ijkl mnop" version Google displays).
  // Use the IMAP host as the basis for "is this gmail" since it's the host
  // we'll authenticate against first.
  const password = normalizePassword(q.imap_host || q.smtp_host, q.password);
  return {
    imap_host: q.imap_host, imap_port: parseInt(q.imap_port) || 993,
    imap_tls: q.imap_tls === '1' ? 1 : 0,
    smtp_host: q.smtp_host, smtp_port: parseInt(q.smtp_port) || 587,
    smtp_tls: q.smtp_tls === '1' ? 1 : 0,
    username: q.username || q.email, password,
    display_name: 'Test', email: q.email
  };
}

router.get('/api/account/test-imap', async (req, res) => {
  const cfg = buildCfg(req.query);
  // CR-04: Log only safe fields — never the password or full config object.
  console.log(`[IMAP TEST] host=${cfg.imap_host} port=${cfg.imap_port} tls=${cfg.imap_tls} user=${cfg.username}`);
  try {
    const result = await testImap(cfg);
    // CR-04: Strip sensitive fields before serialization — result must never echo passwords.
    const safeResult = { ok: result.ok, error: result.error };
    console.log(`[IMAP TEST] result:`, JSON.stringify(safeResult));
    res.json(result);
  } catch(e) {
    console.error(`[IMAP TEST] exception:`, e.message);
    res.json({ ok: false, error: e.message });
  }
});

router.get('/api/account/test-smtp', async (req, res) => {
  const cfg = buildCfg(req.query);
  // CR-04: Log only safe fields — never the password or full config object.
  console.log(`[SMTP TEST] host=${cfg.smtp_host} port=${cfg.smtp_port} tls=${cfg.smtp_tls} user=${cfg.username}`);
  try {
    const result = await testSmtp(cfg);
    // CR-04: Strip sensitive fields before serialization — result must never echo passwords.
    const safeResult = { ok: result.ok, error: result.error };
    console.log(`[SMTP TEST] result:`, JSON.stringify(safeResult));
    res.json(result);
  } catch(e) {
    console.error(`[SMTP TEST] exception:`, e.message);
    res.json({ ok: false, error: e.message });
  }
});

router.get('/api/account/test', async (req, res) => {
  const cfg = buildCfg(req.query);
  const results = { imap: null, smtp: null };

  try { results.imap = await testImap(cfg); } catch(e) { results.imap = { ok: false, error: e.message }; }
  try { results.smtp = await testSmtp(cfg); } catch(e) { results.smtp = { ok: false, error: e.message }; }

  res.json(results);
});

router.post('/api/providers/:name/test', async (req, res) => {
  const { name } = req.params;
  const allowed = new Set(['nvidia', 'groq', 'gemini', 'deepseek']);
  if (!allowed.has(name)) return res.status(400).json({ ok: false, error: 'Unknown provider' });

  const { resolveConfig } = require('../llm/config');
  // Scoped to the logged-in user — reads THEIR saved keys, not "first row".
  const cfg = resolveConfig(req.user.id);
  const providers = {
    nvidia:   require('../llm/providers/nvidia'),
    groq:     require('../llm/providers/groq'),
    gemini:   require('../llm/providers/gemini'),
    deepseek: require('../llm/providers/deepseek')
  };
  const provider = providers[name];
  const sampleEmail = {
    from_address: 'ping@intellimail.local',
    from_name:    'IntelliMail Test',
    subject:      'Test classification — please reply',
    body_text:    'This is a synthetic test email used to verify the provider responds correctly.'
  };
  const keyLen = (cfg.keys[name] || '').length;
  console.log(`[PROVIDER TEST] user=${req.user.id} provider=${name} model=${cfg.models[name]} key_len=${keyLen}`);
  try {
    const result = await provider.call(sampleEmail, { mode: 'full' }, {
      apiKey: cfg.keys[name],
      model:  cfg.models[name]
    });
    if (result && result._observedLimits) {
      const llm = require('../llm');
      llm.router.setObservedLimits(req.user.id, name, result._observedLimits);
    }
    console.log(`[PROVIDER TEST] OK user=${req.user.id} provider=${name} category=${result.category}`);
    res.json({ ok: true, category: result.category, provider: name });
  } catch (e) {
    console.log(`[PROVIDER TEST] FAIL user=${req.user.id} provider=${name} status=${e.status || '?'} msg=${e.message}`);
    res.status(200).json({ ok: false, error: e.message, status: e.status || null });
  }
});

router.post('/api/account/logout', async (req, res) => {
  try {
    const pendingDeletes = db.prepare(
      'SELECT COUNT(*) as c FROM emails WHERE is_deleted = 1 AND user_id = ?'
    ).get(req.user.id).c;
    if (!req.body.confirmed) {
      return res.json({ ok: false, pendingDeletes });
    }
    if (req.body.expunge && pendingDeletes > 0) {
      await expungeDeleted(req.user.id);
      db.prepare('DELETE FROM emails WHERE is_deleted = 1 AND user_id = ?').run(req.user.id);
      db.prepare("DELETE FROM classifications WHERE email_id NOT IN (SELECT id FROM emails) AND user_id = ?").run(req.user.id);
      db.prepare("DELETE FROM drafts WHERE email_id NOT IN (SELECT id FROM emails) AND user_id = ?").run(req.user.id);
    }
    await stopSyncForUser(req.user.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/account/reset', (req, res) => {
  try {
    db.prepare('DELETE FROM emails WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM classifications WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM drafts WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM sync_log WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM account_config WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    res.redirect('/setup');
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Stats ───────────────────────────────────────────────────────────────────

router.get('/api/stats', (req, res) => {
  res.json(getStats(req.user.id));
});

// ─── Sync ────────────────────────────────────────────────────────────────────

router.post('/api/sync/now', async (req, res) => {
  startSyncForUser(req.user.id);
  res.json({ ok: true, message: 'Sync triggered' });
});

router.get('/api/sync/status', (req, res) => {
  const mode = getSyncMode(req.user.id);
  const lastLog = db.prepare(
    "SELECT * FROM sync_log WHERE user_id = ? ORDER BY synced_at DESC LIMIT 1"
  ).get(req.user.id);
  const inboxCount = db.prepare(
    "SELECT COUNT(*) as c FROM emails WHERE folder='INBOX' AND user_id = ?"
  ).get(req.user.id).c;
  const sentCount = db.prepare(
    "SELECT COUNT(*) as c FROM emails WHERE folder='SENT' AND user_id = ?"
  ).get(req.user.id).c;

  const modeIcon = mode === 'idle' ? '🟢' : mode === 'polling' ? '🟡' : mode === 'reconnecting' ? '⟳' : mode === 'demo' ? '📧' : '✕';
  const modeLabel = mode === 'idle' ? 'Live' : mode === 'polling' ? 'Polling (60s)' : mode === 'reconnecting' ? 'Reconnecting...' : mode === 'demo' ? 'Demo Mode' : 'Disconnected';

  // Return both JSON (for JS) and HTML partial (for HTMX polling)
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    res.send(`
      <div hx-get="/api/sync/status" hx-trigger="every 10s" hx-swap="outerHTML"
           hx-headers='{"Accept":"text/html"}'
           style="padding:12px 16px;border-top:1px solid var(--border);font-size:12px;color:var(--text-muted);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span class="${mode === 'idle' ? 'sync-live' : mode === 'polling' ? 'sync-polling' : 'sync-error'}">${modeIcon}</span>
          <span style="font-family:'IBM Plex Mono',monospace;">${escHtml(modeLabel)}</span>
        </div>
        ${lastLog ? `<div style="color:var(--text-muted);font-size:10px;font-family:'IBM Plex Mono',monospace;">Last sync: ${smartTime(lastLog.synced_at)}</div>` : ''}
        <div style="color:var(--text-muted);font-size:10px;font-family:'IBM Plex Mono',monospace;margin-top:2px;">
          ${inboxCount} inbox · ${sentCount} sent
        </div>
      </div>
    `);
  } else {
    res.json({ mode, lastSync: lastLog?.synced_at, syncing: mode === 'connecting', inboxCount, sentCount });
  }
});

// ─── Email List ───────────────────────────────────────────────────────────────

router.get('/api/emails', (req, res) => {
  const { folder = 'INBOX', category = 'all', page = 1, search = '' } = req.query;
  const limit = 30;
  const offset = (parseInt(page) - 1) * limit;

  let whereClause = category === 'trash'
    ? "WHERE e.is_deleted = 1"
    : "WHERE e.is_archived = 0 AND e.is_deleted = 0";
  const params = [];

  whereClause += " AND e.user_id = ?";
  params.push(req.user.id);

  if (folder && folder !== 'all') {
    whereClause += " AND e.folder = ?";
    params.push(folder);
  }

  if (category === 'urgent') {
    whereClause += " AND c.urgency = 'urgent'";
  } else if (category && category !== 'all') {
    whereClause += " AND c.category = ?";
    params.push(category);
  }

  if (search) {
    whereClause += " AND (e.subject LIKE ? OR e.from_name LIKE ? OR e.from_address LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const emails = db.prepare(`
    SELECT e.*, c.category, c.urgency, c.urgency_reason, c.summary, c.extracted_data, c.suggested_tone
    FROM emails e
    LEFT JOIN classifications c ON c.email_id = e.id
    ${whereClause}
    ORDER BY e.received_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM emails e
    LEFT JOIN classifications c ON c.email_id = e.id
    ${whereClause}
  `).get(...params).c;

  if (emails.length === 0 && parseInt(page) === 1) {
    res.send(`
      <div style="padding:48px 24px;text-align:center;color:var(--text-muted);">
        <div style="font-size:32px;margin-bottom:12px;">📭</div>
        <div style="font-family:'Syne',sans-serif;font-size:14px;">No emails found</div>
        <div style="font-size:12px;margin-top:4px;">Try a different filter or sync your inbox</div>
      </div>
    `);
    return;
  }

  // Skeleton loaders (8 items, shown briefly by HTMX before swap)
  const skeletons = parseInt(page) === 1 ? `
    <style>
      .skeleton-container { display: none; }
      .skeleton-container:only-child { display: block; }
    </style>
  ` : '';

  const items = emails.map(email => {
    const cat = email.category || 'pending';
    const urg = email.urgency || 'normal';
    const color = avatarColor(email.from_name || email.from_address);
    const ini = initials(email.from_name || email.from_address);
    const preview = (email.summary || email.body_text || '').substring(0, 120).replace(/\s+/g, ' ');

    return `
      <div class="email-item urgency-${escHtml(urg)}"
           data-email-id="${email.id}"
           data-id="${email.id}"
           hx-get="/api/emails/${email.id}"
           hx-target="#email-detail"
           hx-swap="innerHTML"
           onclick="document.querySelectorAll('.email-item').forEach(e=>e.classList.remove('active')); this.classList.add('active');">
        <div class="email-avatar" style="background:${color};">${escHtml(ini)}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
            <span style="font-weight:${email.is_read ? '500' : '700'};font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${escHtml(email.from_name || email.from_address)}</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-muted);flex-shrink:0;margin-left:8px;">${smartTime(email.received_at)}</span>
          </div>
          <div style="font-size:13px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;">${escHtml(email.subject)}</div>
          <div style="font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:6px;font-family:'Literata',serif;">${escHtml(preview)}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span class="badge badge-${escHtml(cat)}">${escHtml(categoryLabel(cat))}</span>
            ${urg === 'urgent' ? '<span style="font-size:10px;color:var(--accent-red);font-family:\'IBM Plex Mono\',monospace;font-weight:600;">URGENT</span>' : ''}
            ${email.is_starred ? '<span style="font-size:11px;">⭐</span>' : ''}
          </div>
        </div>
        ${!email.is_read ? '<div class="unread-dot"></div>' : ''}
      </div>
    `;
  }).join('');

  const nextPage = parseInt(page) + 1;
  const hasMore = offset + emails.length < total;

  res.send(`
    ${skeletons}
    ${items}
    ${hasMore ? `
      <div style="padding:16px;text-align:center;">
        <button class="action-btn btn-ghost"
                hx-get="/api/emails?page=${nextPage}&folder=${escHtml(folder)}&category=${escHtml(category)}&search=${escHtml(search)}"
                hx-target="#email-list"
                hx-swap="beforeend"
                hx-indicator=".load-more-indicator">
          Load more
        </button>
        <div class="load-more-indicator htmx-indicator" style="text-align:center;padding:8px;color:var(--text-muted);font-size:12px;">Loading...</div>
      </div>
    ` : ''}
  `);
});

// ─── Email Detail ─────────────────────────────────────────────────────────────

router.get('/api/emails/:id', async (req, res) => {
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!email) return res.status(404).send('<div style="padding:48px;text-align:center;color:var(--text-muted);">Email not found</div>');

  const cls = db.prepare('SELECT * FROM classifications WHERE email_id = ? AND user_id = ?').get(email.id, req.user.id);
  const draft = db.prepare('SELECT * FROM drafts WHERE email_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(email.id, req.user.id);

  // Mark as read
  db.prepare('UPDATE emails SET is_read = 1 WHERE id = ? AND user_id = ?').run(email.id, req.user.id);

  const cat = cls?.category || 'other';
  const urg = cls?.urgency || 'normal';
  const extracted = parsedExtractedData(cls?.extracted_data);
  const color = avatarColor(email.from_name || email.from_address);
  const ini = initials(email.from_name || email.from_address);

  // Urgency banner
  let urgencyBanner = '';
  if (urg === 'urgent') {
    urgencyBanner = `<div class="banner-urgent">⚠️ URGENT — ${escHtml(cls?.urgency_reason || 'Requires immediate attention')}</div>`;
  } else if (urg === 'moderate') {
    urgencyBanner = `<div class="banner-warning">⏰ MODERATE — ${escHtml(cls?.urgency_reason || '')}</div>`;
  }

  // Legal always gets urgent banner
  if (cat === 'legal' && !urgencyBanner) {
    urgencyBanner = `<div class="banner-urgent">⚖️ LEGAL MATTER — Requires immediate attention</div>`;
  }

  // Extracted data cards
  const dataFields = Object.entries(extracted)
    .filter(([k, v]) => v && !k.startsWith('For '))
    .map(([k, v]) => `
      <div class="data-field">
        <label>${escHtml(k.replace(/_/g, ' ').toUpperCase())}</label>
        <span>${escHtml(String(v))}</span>
      </div>
    `).join('');

  // Action zone based on category
  const actionZone = renderActionZone(cat, email, cls, extracted);

  // Draft editor — generate on first open if empty.
  // The `source` column tracks provenance ('template' | 'llm' | 'user' | null).
  // The client auto-regenerates in-place when source='template' on open, so the
  // server-side path here only needs to handle genuinely empty bodies.
  let draftBody = draft?.body || cls?.draft_reply || '';
  const draftTone = draft?.tone || cls?.suggested_tone || 'professional';
  const draftSubject = draft?.subject || 'Re: ' + email.subject;
  const draftTo = draft?.to_address || email.from_address;
  const draftSource = draft?.source || null;

  const emailBody = email.body_html
    ? `<iframe srcdoc="${escHtml(email.body_html)}" style="width:100%;min-height:300px;border:none;background:white;border-radius:8px;" sandbox="allow-same-origin"></iframe>`
    : `<div style="font-family:'Literata',serif;font-size:14px;line-height:1.8;color:var(--text-secondary);white-space:pre-wrap;padding:16px;background:var(--bg-raised);border-radius:8px;">${escHtml(email.body_text || '')}</div>`;

  res.send(`
    <div style="padding:24px;">

      <!-- Header -->
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border);">
        <div class="email-avatar" style="background:${color};width:44px;height:44px;font-size:14px;flex-shrink:0;">${escHtml(ini)}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-weight:700;font-size:15px;color:var(--text-primary);">${escHtml(email.from_name || email.from_address)}</div>
              <div style="font-size:12px;color:var(--text-muted);font-family:'IBM Plex Mono',monospace;">${escHtml(email.from_address)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <span class="badge badge-${escHtml(cat)}">${escHtml(categoryLabel(cat))}</span>
              ${urg !== 'normal' ? `<span class="badge" style="background:${urg === 'urgent' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)'};color:${urg === 'urgent' ? 'var(--accent-red)' : 'var(--accent-amber)'};border-color:${urg === 'urgent' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'};">${urg.toUpperCase()}</span>` : ''}
              <button class="action-btn btn-ghost" style="padding:4px 10px;font-size:11px;"
                      hx-post="/api/emails/${email.id}/star"
                      hx-swap="none"
                      onclick="this.textContent=this.textContent==='⭐'?'☆':'⭐'">
                ${email.is_starred ? '⭐' : '☆'}
              </button>
              <button class="action-btn btn-ghost" style="padding:4px 10px;font-size:11px;"
                      hx-post="/api/emails/${email.id}/delete"
                      hx-swap="none"
                      onclick="showToast('info','🗑️ Moved to Trash'); htmx.trigger(document.querySelector('.email-list-panel'),'categoryChange'); this.closest('#email-detail').innerHTML='<div style=\'padding:48px;text-align:center;color:var(--text-muted);\'>Moved to Trash</div>'">
                🗑️ Delete
              </button>
            </div>
          </div>
          <div style="margin-top:6px;font-size:12px;color:var(--text-muted);">
            <span>To: ${escHtml(email.to_address || '')}</span>
            ${email.cc_address ? `<span style="margin-left:12px;">CC: ${escHtml(email.cc_address)}</span>` : ''}
            <span style="margin-left:12px;font-family:'IBM Plex Mono',monospace;">${new Date(email.received_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
        </div>
      </div>

      <h2 style="font-size:16px;font-weight:700;margin-bottom:16px;color:var(--text-primary);font-family:'Syne',sans-serif;">${escHtml(email.subject)}</h2>

      ${urgencyBanner}

      <!-- AI Summary -->
      ${cls?.summary ? `
        <div class="ai-summary">
          <div style="font-size:10px;font-family:'IBM Plex Mono',monospace;color:var(--accent-amber);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;font-style:normal;">✦ AI Summary</div>
          ${escHtml(cls.summary)}
        </div>
      ` : ''}

      <!-- Extracted Data -->
      ${dataFields ? `<div class="data-card">${dataFields}</div>` : ''}

      <!-- Email Body -->
      <div style="margin:20px 0;">
        ${emailBody}
      </div>

      <!-- Action Zone -->
      ${actionZone ? `
        <div style="margin:24px 0;border-top:1px solid var(--border);padding-top:20px;">
          <div style="font-size:11px;font-family:'IBM Plex Mono',monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;">— Suggested Actions —</div>
          ${actionZone}
        </div>
      ` : ''}

      <!-- Draft Editor -->
      <div style="border-top:1px solid var(--border);padding-top:20px;margin-top:8px;">
        <div style="font-size:11px;font-family:'IBM Plex Mono',monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;">— AI Draft Response —</div>
        <div class="draft-editor"
             x-data="draftEditor({
               emailId: '${email.id}',
               initialBody: \`${escHtml(draftBody).replace(/`/g, '\\`')}\`,
               initialTone: '${escHtml(draftTone)}',
               initialSource: ${JSON.stringify(draftSource)},
               toAddress: '${escHtml(draftTo)}',
               subject: '${escHtml(draftSubject)}'
             })">

          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
            <span style="font-weight:600;font-size:13px;color:var(--text-secondary);">AI Draft Response</span>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <span style="font-size:11px;color:var(--text-muted);">Tone:</span>
              <template x-for="t in ['formal','professional','friendly','brief']">
                <button class="action-btn btn-ghost"
                        style="padding:4px 10px;font-size:11px;"
                        :style="tone===t ? 'border-color:var(--accent-cyan);color:var(--accent-cyan)' : ''"
                        @click="changeTone(t)" x-text="t"></button>
              </template>
              <button class="action-btn btn-ghost" style="padding:4px 10px;font-size:11px;"
                      @click="regenerateDraft()" :disabled="regenerating">
                <span x-show="!regenerating">↻ Regen</span>
                <span x-show="regenerating">...</span>
              </button>
            </div>
          </div>

          <div style="margin-bottom:8px;">
            <label style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">To</label>
            <input x-model="toAddress" type="email"
                   style="width:100%;background:var(--bg-raised);border:1px solid var(--border);color:var(--text-primary);padding:6px 10px;border-radius:6px;font-size:13px;margin-top:4px;" />
          </div>

          <div style="margin-bottom:8px;">
            <label style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Subject</label>
            <input x-model="subject" type="text"
                   style="width:100%;background:var(--bg-raised);border:1px solid var(--border);color:var(--text-primary);padding:6px 10px;border-radius:6px;font-size:13px;margin-top:4px;" />
          </div>

          <textarea x-model="draftBody" @input="debouncedSave()" rows="8"></textarea>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;flex-wrap:wrap;gap:8px;">
            <div style="display:flex;gap:12px;align-items:center;">
              <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-muted);" x-text="wordCount + ' words'"></span>
              <span style="font-size:11px;color:var(--text-muted);" x-text="saveStatus"></span>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="action-btn btn-ghost" @click="saveDraft()">💾 Save</button>
              <button class="action-btn btn-send" @click="sendDraft()" :disabled="sending">
                <span x-show="!sending">📤 Send</span>
                <span x-show="sending">Sending...</span>
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  `);
});

// ─── Action Zone Renderer ────────────────────────────────────────────────────

function renderActionZone(cat, email, cls, extracted) {
  switch (cat) {
    case 'meeting_request': {
      const dueDate = extracted.meeting_date;
      return `
        <div class="data-card" style="margin-bottom:12px;">
          ${['meeting_date','meeting_time','meeting_location','organizer','platform'].map(k => extracted[k] ? `
            <div class="data-field">
              <label>${k.replace(/_/g,' ').toUpperCase()}</label>
              <span>${escHtml(extracted[k])}</span>
            </div>` : '').join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="action-btn btn-accept"
                  hx-post="/api/emails/${email.id}/draft/save"
                  hx-vals='{"body":"Thank you for the meeting invitation. I confirm my attendance.","tone":"professional"}'
                  hx-swap="none"
                  onclick="showToast('success','✅ Meeting accepted — draft updated')">
            ✅ Accept Meeting
          </button>
          <button class="action-btn btn-decline"
                  hx-post="/api/emails/${email.id}/draft/save"
                  hx-vals='{"body":"Thank you for the invitation. Unfortunately I am unable to attend at this time. Could we reschedule?","tone":"professional"}'
                  hx-swap="none"
                  onclick="showToast('info','Draft updated with decline message')">
            ❌ Decline Meeting
          </button>
          <a class="action-btn btn-ghost"
             href="/api/emails/${email.id}/ical"
             download style="text-decoration:none;">
            📅 Add to Calendar
          </a>
        </div>
      `;
    }

    case 'financial': {
      const dueDate = extracted.due_date ? new Date(extracted.due_date) : null;
      const now = new Date();
      let dueBanner = '';
      if (dueDate && !isNaN(dueDate)) {
        const daysLeft = Math.ceil((dueDate - now) / 86400000);
        if (daysLeft <= 3) dueBanner = `<div class="banner-urgent" style="animation:urgency-pulse 2s infinite;">⚠️ PAYMENT DUE IN ${daysLeft} DAYS — Pay immediately</div>`;
        else if (daysLeft <= 7) dueBanner = `<div class="banner-urgent">⚠️ PAYMENT DUE SOON — ${daysLeft} days remaining</div>`;
      }
      return `
        ${dueBanner}
        <div class="data-card" style="margin-bottom:12px;">
          ${['institution','amount_due','due_date','account_last4','statement_period'].map(k => extracted[k] ? `
            <div class="data-field">
              <label>${k.replace(/_/g,' ').toUpperCase()}</label>
              <span>${escHtml(extracted[k])}</span>
            </div>` : '').join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="action-btn btn-primary"
                  hx-post="/api/emails/${email.id}/read"
                  hx-swap="none"
                  onclick="showToast('success','✓ Marked as reviewed')">
            ✓ Mark Reviewed
          </button>
          <button class="action-btn btn-ghost" onclick="document.querySelector('.draft-editor textarea')?.focus()">
            ↩️ Draft Reply
          </button>
        </div>
      `;
    }

    case 'legal': {
      return `
        <div class="banner-urgent">⚖️ LEGAL MATTER — URGENT ATTENTION REQUIRED</div>
        <div class="data-card" style="margin-bottom:12px;">
          ${['firm_name','matter_description','deadline','action_required'].map(k => extracted[k] ? `
            <div class="data-field">
              <label>${k.replace(/_/g,' ').toUpperCase()}</label>
              <span>${escHtml(extracted[k])}</span>
            </div>` : '').join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="action-btn btn-decline"
                  hx-post="/api/emails/${email.id}/star"
                  hx-swap="none"
                  onclick="showToast('warning','📌 Flagged for lawyer review')">
            📌 Flag for Lawyer
          </button>
          <button class="action-btn btn-ghost" onclick="document.querySelector('.draft-editor textarea')?.focus()">
            ↩️ Draft Formal Acknowledgment
          </button>
        </div>
      `;
    }

    case 'travel': {
      const tripDate = extracted.trip_dates ? new Date(extracted.trip_dates) : null;
      const now = new Date();
      let tripBanner = '';
      if (tripDate && !isNaN(tripDate)) {
        const hoursLeft = (tripDate - now) / 3600000;
        if (hoursLeft <= 48) tripBanner = `<div class="banner-urgent">🛫 DEPARTING SOON — Check in now!</div>`;
        else if (hoursLeft <= 168) tripBanner = `<div class="banner-warning">✈️ Upcoming Travel — Departs in ${Math.ceil(hoursLeft/24)} days</div>`;
      }
      return `
        ${tripBanner}
        <div class="data-card" style="margin-bottom:12px;">
          ${['destination','trip_dates','booking_reference','carrier','checkin','checkout'].map(k => extracted[k] ? `
            <div class="data-field">
              <label>${k.replace(/_/g,' ').toUpperCase()}</label>
              <span>${escHtml(extracted[k])}</span>
            </div>` : '').join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a class="action-btn btn-primary"
             href="/api/emails/${email.id}/ical"
             download style="text-decoration:none;">
            📅 Add to Calendar
          </a>
          <button class="action-btn btn-ghost" onclick="document.querySelector('.draft-editor textarea')?.focus()">
            ↩️ Draft Reply
          </button>
        </div>
      `;
    }

    case 'pitch_deck': {
      return `
        <div class="data-card" style="margin-bottom:12px;">
          ${['company_name','founder_name','funding_ask','one_line_pitch'].map(k => extracted[k] ? `
            <div class="data-field">
              <label>${k.replace(/_/g,' ').toUpperCase()}</label>
              <span>${escHtml(extracted[k])}</span>
            </div>` : '').join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="action-btn btn-accept"
                  hx-post="/api/emails/${email.id}/draft/regen"
                  hx-vals='{"tone":"friendly"}'
                  hx-target=".draft-editor textarea"
                  hx-swap="none"
                  onclick="showToast('info','Draft updated — expressing interest')">
            👍 Interested — Draft Reply
          </button>
          <button class="action-btn btn-decline"
                  hx-post="/api/emails/${email.id}/draft/regen"
                  hx-vals='{"tone":"professional","intent":"decline"}'
                  hx-target=".draft-editor textarea"
                  hx-swap="none"
                  onclick="showToast('info','Draft updated — polite decline')">
            👎 Pass — Polite Decline
          </button>
        </div>
      `;
    }

    case 'fyi': {
      return `
        <div class="data-card" style="margin-bottom:12px;">
          ${['topic','sender_type'].map(k => extracted[k] ? `
            <div class="data-field">
              <label>${k.replace(/_/g,' ').toUpperCase()}</label>
              <span>${escHtml(extracted[k])}</span>
            </div>` : '').join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="action-btn btn-ghost"
                  hx-post="/api/emails/${email.id}/delete"
                  hx-swap="none"
                  onclick="showToast('info','🗑️ Moved to Trash'); htmx.trigger(document.querySelector('.email-list-panel'),'categoryChange'); this.closest('#email-detail').innerHTML='<div style=\'padding:48px;text-align:center;color:var(--text-muted);\'>Moved to Trash</div>'">
            🗑️ Delete
          </button>
          <button class="action-btn btn-ghost" onclick="document.querySelector('.draft-editor textarea')?.focus()">
            ↩️ Draft Reply
          </button>
        </div>
      `;
    }

    case 'rewards_awards': {
      const expiryDate = extracted.expiry_date ? new Date(extracted.expiry_date) : null;
      const now = new Date();
      let expiryBanner = '';
      if (expiryDate && !isNaN(expiryDate)) {
        const daysLeft = Math.ceil((expiryDate - now) / 86400000);
        if (daysLeft <= 7) expiryBanner = `<div class="banner-urgent">🔥 EXPIRING VERY SOON — ${daysLeft} days remaining. Redeem immediately!</div>`;
        else if (daysLeft <= 30) expiryBanner = `<div class="banner-warning">⏳ EXPIRING SOON — ${daysLeft} days remaining</div>`;
      }
      return `
        ${expiryBanner}
        <div class="data-card" style="margin-bottom:12px;">
          ${['program_name','points_balance','reward_type','expiry_date','estimated_value'].map(k => extracted[k] ? `
            <div class="data-field">
              <label>${k.replace(/_/g,' ').toUpperCase()}</label>
              <span>${escHtml(extracted[k])}</span>
            </div>` : '').join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${extracted.redeem_url ? (() => { const h = safeHref(extracted.redeem_url); return h ? `<a class="action-btn btn-primary" href="${h}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">🎁 Redeem Now</a>` : ''; })() : ''}
          <button class="action-btn btn-ghost"
                  hx-post="/api/emails/${email.id}/read"
                  hx-swap="none"
                  onclick="showToast('success','✓ Marked as noted')">
            ✓ Mark Noted
          </button>
          <button class="action-btn btn-ghost" onclick="document.querySelector('.draft-editor textarea')?.focus()">
            ↩️ Draft Reply
          </button>
        </div>
      `;
    }

    default: { // 'other'
      const domainFromAddress = email.from_address ? email.from_address.split('@')[1] || '' : '';
      return `
        <div class="data-card" style="margin-bottom:12px;">
          <div class="data-field">
            <label>DETECTED TYPE</label>
            <span>${escHtml(extracted.type || 'notification')}</span>
          </div>
          <div class="data-field">
            <label>SOURCE DOMAIN</label>
            <span>${escHtml(extracted.source_domain || domainFromAddress)}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="action-btn btn-ghost"
                  hx-post="/api/emails/${email.id}/delete"
                  hx-swap="none"
                  onclick="showToast('info','🗑️ Moved to Trash'); htmx.trigger(document.querySelector('.email-list-panel'),'categoryChange'); this.closest('#email-detail').innerHTML='<div style=\'padding:48px;text-align:center;color:var(--text-muted);\'>Moved to Trash</div>'">
            🗑️ Delete
          </button>
          <button class="action-btn btn-ghost" onclick="document.querySelector('.draft-editor textarea')?.focus()">
            ↩️ Draft Reply
          </button>
          <button class="action-btn btn-ghost"
                  x-data="{open:false}"
                  @click="open=!open">
            🏷️ Recategorize
          </button>
        </div>
        <!-- Recategorize modal trigger (Alpine-driven inline) -->
        <div x-data="{open:false}" style="margin-top:12px;">
          <template x-if="open">
            <div style="background:var(--bg-raised);border:1px solid var(--border-bright);border-radius:8px;padding:16px;">
              <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:12px;">Select new category:</div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;">
                ${['meeting_request','financial','legal','travel','pitch_deck','fyi','rewards_awards','other'].map(c => `
                  <button class="action-btn btn-ghost badge-${c}"
                          style="text-align:left;padding:8px 12px;"
                          hx-post="/api/emails/${email.id}/reclassify"
                          hx-vals='{"category":"${c}"}'
                          hx-target="#email-detail"
                          hx-swap="innerHTML"
                          onclick="showToast('info','Recategorizing...')">
                    ${escHtml(categoryLabel(c))}
                  </button>
                `).join('')}
              </div>
            </div>
          </template>
        </div>
      `;
    }
  }
}

// ─── Email Actions ────────────────────────────────────────────────────────────

router.post('/api/emails/:id/read', (req, res) => {
  const info = db.prepare('UPDATE emails SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

router.post('/api/emails/:id/delete', async (req, res) => {
  const email = db.prepare('SELECT uid, folder FROM emails WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });
  db.prepare('UPDATE emails SET is_deleted = 1, is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  flagAsDeleted(req.user.id, email.uid, email.folder || 'INBOX').catch(() => {});
  res.json({ ok: true });
});

router.post('/api/emails/:id/permanently-delete', async (req, res) => {
  const email = db.prepare('SELECT uid, folder FROM emails WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });
  await expungeDeleted(req.user.id);
  db.prepare('DELETE FROM emails WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  db.prepare(
    "DELETE FROM classifications WHERE email_id NOT IN (SELECT id FROM emails) AND user_id = ?"
  ).run(req.user.id);
  db.prepare(
    "DELETE FROM drafts WHERE email_id NOT IN (SELECT id FROM emails) AND user_id = ?"
  ).run(req.user.id);
  res.json({ ok: true });
});

// CR-05: Archive sets is_archived=1 (hide from inbox, keep accessible).
// The previous implementation set is_deleted=1 which was identical to
// the delete endpoint — archived emails were irrecoverable. The is_archived
// column already exists; the email list query already filters on it.
router.post('/api/emails/:id/archive', (req, res) => {
  const info = db.prepare(
    'UPDATE emails SET is_archived = 1, is_read = 1 WHERE id = ? AND user_id = ?'
  ).run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

router.post('/api/emails/:id/star', (req, res) => {
  const email = db.prepare(
    'SELECT is_starred FROM emails WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ ok: false, error: 'not_found' });
  db.prepare('UPDATE emails SET is_starred = ? WHERE id = ? AND user_id = ?')
    .run(email.is_starred ? 0 : 1, req.params.id, req.user.id);
  res.json({ ok: true, starred: !email.is_starred });
});

router.post('/api/emails/:id/reclassify', (req, res) => {
  const { category } = req.body;
  const validCategories = ['meeting_request','financial','legal','travel','pitch_deck','fyi','rewards_awards','other'];
  if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category' });

  // Ensure the email belongs to this user before we touch classifications.
  const email = db.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });

  // WR-07: Write the user-supplied category directly to the DB as source='user'
  // so the result matches what the user chose. The previous implementation
  // deleted the row and re-queued for LLM reclassification, meaning the actual
  // resulting category was whatever the LLM decided — not the user's choice.
  db.prepare('DELETE FROM classifications WHERE email_id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  // Legal is always urgent; everything else defaults to normal urgency.
  const userUrgency = category === 'legal' ? 'urgent' : 'normal';
  const userUrgencyReason = category === 'legal' ? 'Legal matter requires immediate attention' : null;
  db.prepare(`
    INSERT OR IGNORE INTO classifications
    (user_id, email_id, category, urgency, urgency_reason, summary, extracted_data, suggested_tone, source, low_confidence)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.user.id, req.params.id, category, userUrgency, userUrgencyReason,
    null, '{}', 'professional', 'user', 0
  );

  // Return placeholder — the email detail will reload with the user's category.
  res.send(`
    <div style="padding:48px;text-align:center;color:var(--text-muted);">
      <div style="font-size:24px;margin-bottom:12px;">✓</div>
      <div>Recategorized as ${escHtml(categoryLabel(category))}</div>
      <div style="font-size:12px;margin-top:8px;">Reload to see updated details</div>
    </div>
  `);
});

// ─── Draft Routes ─────────────────────────────────────────────────────────────

router.get('/api/emails/:id/draft', (req, res) => {
  // Ensure the parent email is owned by this user.
  const email = db.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });
  const draft = db.prepare(
    'SELECT * FROM drafts WHERE email_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(req.params.id, req.user.id);
  res.json(draft || {});
});

router.post('/api/emails/:id/draft/save', (req, res) => {
  const { body, tone, subject, to_address } = req.body;
  const email = db.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });
  const existing = db.prepare('SELECT id FROM drafts WHERE email_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (existing) {
    // User-saved edit — mark source='user' so auto-upgrade never clobbers it.
    db.prepare('UPDATE drafts SET body=?, tone=?, subject=?, to_address=?, source=?, last_edited=CURRENT_TIMESTAMP WHERE email_id=? AND user_id=?')
      .run(body, tone, subject, to_address, 'user', req.params.id, req.user.id);
  } else {
    db.prepare('INSERT INTO drafts (email_id, user_id, body, tone, subject, to_address, source) VALUES (?,?,?,?,?,?,?)')
      .run(req.params.id, req.user.id, body, tone, subject, to_address, 'user');
  }
  res.json({ ok: true });
});

router.post('/api/emails/:id/draft/send', async (req, res) => {
  const { body, tone, subject, to_address } = req.body;
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });

  try {
    await sendEmail({
      to: to_address || email.from_address,
      subject: subject || 'Re: ' + email.subject,
      body,
      replyToMessageId: email.message_id
    });
    db.prepare('UPDATE drafts SET sent=1, sent_at=CURRENT_TIMESTAMP WHERE email_id=? AND user_id=?')
      .run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/emails/:id/draft/regen', async (req, res) => {
  const { tone = 'professional' } = req.body;
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  const cls = db.prepare('SELECT * FROM classifications WHERE email_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!email) return res.status(404).json({ error: 'not_found' });

  const llm = require('../llm');
  const { buildTemplateReply } = require('../llm/templates');

  let draftReply, source, dbSource, warning = null;
  try {
    const routed = await llm.router.generateDraft(email, { mode: 'draft', tone, userId: req.user.id });
    if (routed && routed.draft_reply) {
      draftReply = routed.draft_reply;
      source = routed._provider;    // for the UI toast: 'nvidia' / 'groq' / 'gemini' / 'deepseek'
      dbSource = 'llm';             // for the drafts.source column
    } else {
      draftReply = buildTemplateReply(cls || { category: 'other' }, tone);
      source = 'template';
      dbSource = 'template';
      warning = 'All LLM providers unavailable — showing template reply';
    }
  } catch (e) {
    draftReply = buildTemplateReply(cls || { category: 'other' }, tone);
    source = 'template';
    dbSource = 'template';
    warning = 'LLM provider error — showing template reply';
  }

  const existing = db.prepare('SELECT id FROM drafts WHERE email_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (existing) {
    db.prepare('UPDATE drafts SET body=?, tone=?, source=?, last_edited=CURRENT_TIMESTAMP WHERE email_id=? AND user_id=?')
      .run(draftReply, tone, dbSource, req.params.id, req.user.id);
  } else {
    db.prepare('INSERT INTO drafts (email_id, user_id, body, tone, subject, to_address, source) VALUES (?,?,?,?,?,?,?)')
      .run(req.params.id, req.user.id, draftReply, tone, 'Re: ' + email.subject, email.from_address, dbSource);
  }

  res.json({ draft_reply: draftReply, source, ...(warning ? { warning } : {}) });
});

// ─── iCal Generation ─────────────────────────────────────────────────────────

router.get('/api/emails/:id/ical', (req, res) => {
  const email = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  const cls = db.prepare('SELECT * FROM classifications WHERE email_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!email || !cls) return res.status(404).send('Not found');

  const data = parsedExtractedData(cls.extracted_data);
  const uid = `intellimail-${email.id}-${Date.now()}@intellimail`;
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  function formatICSDate(dateStr, timeStr, offsetMinutes = 0) {
    try {
      const combined = dateStr && timeStr ? `${dateStr} ${timeStr}` : (dateStr || new Date().toDateString());
      const d = new Date(combined);
      if (isNaN(d)) return now;
      d.setMinutes(d.getMinutes() + offsetMinutes);
      return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    } catch { return now; }
  }

  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//IntelliMail//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:${now}\r\nSUMMARY:${(email.subject || '').replace(/[,;\\]/g, '\\$&')}\r\nDESCRIPTION:${(cls.summary || '').replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n')}\r\nORGANIZER;CN=${data.organizer || email.from_name}:MAILTO:${email.from_address}\r\nDTSTART:${formatICSDate(data.meeting_date, data.meeting_time)}\r\nDTEND:${formatICSDate(data.meeting_date, data.meeting_time, 60)}\r\nLOCATION:${(data.meeting_location || '').replace(/[,;\\]/g, '\\$&')}\r\nEND:VEVENT\r\nEND:VCALENDAR`;

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="meeting-${email.id}.ics"`);
  res.send(ics);
});

// ─── Settings ────────────────────────────────────────────────────────────────

router.get('/api/settings', (req, res) => {
  const cfg = getConfig(req.user.id) || {};
  const nvidiaProv   = require('../llm/providers/nvidia');
  const groqProv     = require('../llm/providers/groq');
  const geminiProv   = require('../llm/providers/gemini');
  const deepseekProv = require('../llm/providers/deepseek');
  // IMPORTANT: API keys and the password are never returned to the client.
  // We expose only presence flags ("has_*"). The Settings UI shows a
  // "✓ saved" badge when the flag is true; the input stays empty with a
  // "Leave blank to keep existing" placeholder.
  const out = {
    ...cfg,
    password:         undefined,
    nvidia_api_key:   '',
    groq_api_key:     '',
    gemini_api_key:   '',
    deepseek_api_key: '',
    has_password:     !!cfg.password,
    has_nvidia_key:   !!cfg.nvidia_api_key,
    has_groq_key:     !!cfg.groq_api_key,
    has_gemini_key:   !!cfg.gemini_api_key,
    has_deepseek_key: !!cfg.deepseek_api_key,
    nvidia_model:           cfg.nvidia_model   || 'qwen/qwen3.5-122b-a10b',
    groq_model:             cfg.groq_model     || 'llama-3.3-70b-versatile',
    gemini_model:           cfg.gemini_model   || 'gemini-1.5-flash-latest',  // IN-03: valid model ID
    deepseek_model:         cfg.deepseek_model || 'deepseek-chat',
    llm_provider_order:     cfg.llm_provider_order    || 'nvidia,groq,gemini,deepseek',
    llm_providers_enabled:  cfg.llm_providers_enabled || 'nvidia,groq,gemini,deepseek',
    limits_defaults: {
      nvidia:   { rpm: nvidiaProv.limits.rpm,   rpd: Number.isFinite(nvidiaProv.limits.rpd)   ? nvidiaProv.limits.rpd   : null },
      groq:     { rpm: groqProv.limits.rpm,     rpd: Number.isFinite(groqProv.limits.rpd)     ? groqProv.limits.rpd     : null },
      gemini:   { rpm: geminiProv.limits.rpm,   rpd: Number.isFinite(geminiProv.limits.rpd)   ? geminiProv.limits.rpd   : null },
      deepseek: { rpm: deepseekProv.limits.rpm, rpd: Number.isFinite(deepseekProv.limits.rpd) ? deepseekProv.limits.rpd : null }
    }
  };
  res.json(out);
});

router.post('/api/settings/save', async (req, res) => {
  const existing = getConfig(req.user.id);
  if (existing) {
    const cfg = {
      ...existing,
      display_name: req.body.display_name || existing.display_name,
      email: req.body.email || existing.email,
      imap_host: req.body.imap_host || existing.imap_host,
      imap_port: parseInt(req.body.imap_port) || existing.imap_port,
      imap_tls: (req.body.imap_tls === true || req.body.imap_tls === 1 || req.body.imap_tls === 'on' || req.body.imap_tls === '1') ? 1 : 0,
      smtp_host: req.body.smtp_host || existing.smtp_host,
      smtp_port: parseInt(req.body.smtp_port) || existing.smtp_port,
      smtp_tls: (req.body.smtp_tls === true || req.body.smtp_tls === 1 || req.body.smtp_tls === 'on' || req.body.smtp_tls === '1') ? 1 : 0,
      username: req.body.username || existing.username,
      password: req.body.password || existing.password,
      sync_interval: parseInt(req.body.sync_interval) || existing.sync_interval
    };
    db.prepare(`UPDATE account_config SET display_name=?, email=?, imap_host=?, imap_port=?, imap_tls=?,
      smtp_host=?, smtp_port=?, smtp_tls=?, username=?, password=?, sync_interval=?
      WHERE user_id=?`).run(cfg.display_name, cfg.email, cfg.imap_host, cfg.imap_port, cfg.imap_tls,
                             cfg.smtp_host, cfg.smtp_port, cfg.smtp_tls, cfg.username, cfg.password,
                             cfg.sync_interval || 60, req.user.id);
  }

  // Provider config
  try {
    const { saveProviderConfig } = require('../llm/config');
    const body = req.body || {};
    const providerUpdates = {};
    // Only overwrite saved API keys if the client actually sent a non-empty value.
    // Empty string from a blank password field means "keep existing", not "clear it".
    if (body.nvidia_api_key)   providerUpdates.nvidia_api_key   = body.nvidia_api_key;
    if (body.groq_api_key)     providerUpdates.groq_api_key     = body.groq_api_key;
    if (body.gemini_api_key)   providerUpdates.gemini_api_key   = body.gemini_api_key;
    if (body.deepseek_api_key) providerUpdates.deepseek_api_key = body.deepseek_api_key;
    if (body.nvidia_model)          providerUpdates.nvidia_model   = body.nvidia_model;
    if (body.groq_model)            providerUpdates.groq_model     = body.groq_model;
    if (body.gemini_model)          providerUpdates.gemini_model   = body.gemini_model;
    if (body.deepseek_model)        providerUpdates.deepseek_model = body.deepseek_model;
    if (body.llm_provider_order)    providerUpdates.order        = body.llm_provider_order;
    if (body.llm_providers_enabled) providerUpdates.enabled      = body.llm_providers_enabled;
    for (const col of ['nvidia', 'groq', 'gemini', 'deepseek']) {
      if (body[col + '_rpm'] !== undefined) providerUpdates[col + '_rpm'] = body[col + '_rpm'];
      if (body[col + '_rpd'] !== undefined) providerUpdates[col + '_rpd'] = body[col + '_rpd'];
    }
    if (Object.keys(providerUpdates).length) {
      saveProviderConfig(req.user.id, providerUpdates);
      // Reload the router so new keys/order take effect immediately
      require('../llm').reload();
    }
  } catch (e) { /* ignore provider errors to not block account save */ }

  res.json({ ok: true, message: 'Settings saved' });
});

router.get('/api/providers/usage', (req, res) => {
  const { todaySummary } = require('../llm/usage');
  const { resolveConfig } = require('../llm/config');
  const nvidiaProv   = require('../llm/providers/nvidia');
  const groqProv     = require('../llm/providers/groq');
  const geminiProv   = require('../llm/providers/gemini');
  const deepseekProv = require('../llm/providers/deepseek');
  const defs = { nvidia: nvidiaProv, groq: groqProv, gemini: geminiProv, deepseek: deepseekProv };

  const counts = todaySummary(req.user.id);          // { provider: count }
  const cfg = resolveConfig(req.user.id);
  const llm = require('../llm');
  const observed = llm.router.getObservedLimits(req.user.id) || {};
  const out = {};
  for (const name of Object.keys(defs)) {
    const def = defs[name];
    const userLim = (cfg.limits && cfg.limits[name]) || {};
    const rpm = (typeof userLim.rpm === 'number' && userLim.rpm > 0) ? userLim.rpm : def.limits.rpm;
    const rpd = (typeof userLim.rpd === 'number' && userLim.rpd > 0) ? userLim.rpd : def.limits.rpd;
    const count = counts[name] || 0;
    out[name] = {
      count,
      rpm,
      rpd: Number.isFinite(rpd) ? rpd : null,
      rpd_pct: Number.isFinite(rpd) && rpd > 0 ? Math.min(100, Math.round((count / rpd) * 100)) : null,
      observed: observed[name] || null
    };
  }
  res.json(out);
});

// Returns whether server-provided default API keys are still active for this
// user. Active only on the calendar day (UTC) of signup; after that the user
// must supply their own keys. Drives the trial banner in Settings → AI
// Providers and decides which env keys still count in the status / reclassify
// gates above.
router.get('/api/llm/default-keys-status', (req, res) => {
  const { defaultKeysStatusFor } = require('../llm/config');
  const status = defaultKeysStatusFor(req.user.id);
  // List which provider env keys are even configured — there's no point
  // showing a "trial active" banner if the server has no keys to lend.
  const configured = {
    nvidia:   !!process.env.NVIDIA_API_KEY,
    groq:     !!process.env.GROQ_API_KEY,
    gemini:   !!process.env.GEMINI_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY
  };
  let hoursRemaining = null;
  if (status.active && status.expires_at) {
    // expires_at is "YYYY-MM-DD HH:MM:SS" UTC from SQLite. Append 'Z' so
    // Date parses it as UTC, not local.
    const ms = new Date(status.expires_at + 'Z').getTime() - Date.now();
    hoursRemaining = Math.max(0, Math.round(ms / 3600_000));
  }
  res.json({
    active: status.active,
    expires_at: status.expires_at,
    hours_remaining: hoursRemaining,
    any_default_configured: Object.values(configured).some(Boolean),
    configured
  });
});

// ─── LLM key status + fallback reclassify ───────────────────────────────────
router.get('/api/llm/status', (req, res) => {
  const cfg = getConfig(req.user.id) || {};
  const { defaultKeysStatusFor } = require('../llm/config');
  const defaults = defaultKeysStatusFor(req.user.id);
  // Env-provided default keys only count while still inside the user's
  // signup-day window. After that the user MUST have their own DB key.
  const envOr = (envKey) => defaults.active ? !!process.env[envKey] : false;
  const hasNvidia   = !!cfg.nvidia_api_key   || envOr('NVIDIA_API_KEY');
  const hasGroq     = !!cfg.groq_api_key     || envOr('GROQ_API_KEY');
  const hasGemini   = !!cfg.gemini_api_key   || envOr('GEMINI_API_KEY');
  const hasDeepseek = !!cfg.deepseek_api_key || envOr('DEEPSEEK_API_KEY');
  const fallbackCount = db.prepare(
    "SELECT COUNT(*) as n FROM classifications WHERE user_id = ? AND source = 'fallback'"
  ).get(req.user.id).n;
  // Pending count mirrors the classification scope (see classifier.js):
  // only emails in the latest SCOPE_LIMIT received within the last
  // SCOPE_DAYS days are eligible — older / overflow emails are skipped
  // by classifyEmail and must NOT show as forever-pending.
  const { SCOPE_DAYS, SCOPE_LIMIT } = require('../classifier');
  const pendingCount = db.prepare(`
    SELECT COUNT(*) as n FROM emails e
    WHERE e.user_id = ?
      AND e.received_at >= datetime('now', '-${SCOPE_DAYS} days')
      AND e.id IN (
        SELECT id FROM emails WHERE user_id = ?
        ORDER BY received_at DESC LIMIT ${SCOPE_LIMIT}
      )
      AND NOT EXISTS (
        SELECT 1 FROM classifications c WHERE c.email_id = e.id AND c.user_id = e.user_id
      )
  `).get(req.user.id, req.user.id).n;

  // Per-provider live health (from router in-memory state).
  const llm = require('../llm');
  const health = llm.router.getProviderHealth(req.user.id) || {};

  // Is at least one provider plausibly usable right now?
  const hasKey = { nvidia: hasNvidia, groq: hasGroq, gemini: hasGemini, deepseek: hasDeepseek };
  const enabledList = ((cfg.llm_providers_enabled || 'nvidia,groq,gemini,deepseek').split(',')).map(s => s.trim());
  const isUsable = (name) => {
    if (!enabledList.includes(name)) return false;
    if (!hasKey[name]) return false;
    const h = health[name] || {};
    if (h.status === 'invalid_key' || h.status === 'breaker_open') return false;
    if (h.status === 'rate_limited') {
      // 10-min cooldown after a 429.
      if (h.last_error_at && Date.now() - new Date(h.last_error_at).getTime() < 10 * 60 * 1000) return false;
    }
    if (h.status === 'service_busy') {
      // Shorter cooldown for transient 503s — model overload usually clears in a few minutes.
      if (h.last_error_at && Date.now() - new Date(h.last_error_at).getTime() < 2 * 60 * 1000) return false;
    }
    return true;
  };
  const anyUsable = ['nvidia', 'groq', 'gemini', 'deepseek'].some(isUsable);

  res.json({
    has_cloud_keys: hasNvidia || hasGroq || hasGemini || hasDeepseek,
    has_nvidia: hasNvidia,
    has_groq: hasGroq,
    has_gemini: hasGemini,
    has_deepseek: hasDeepseek,
    fallback_count: fallbackCount,
    failed_count: db.prepare("SELECT COUNT(*) as n FROM classifications WHERE user_id = ? AND source = 'failed'").get(req.user.id).n,
    pending_classification_count: pendingCount,
    provider_health: health,
    any_provider_usable: anyUsable
  });
});

router.post('/api/classifications/reclassify-fallback', (req, res) => {
  const cfg = getConfig(req.user.id) || {};
  const { defaultKeysStatusFor } = require('../llm/config');
  const defaults = defaultKeysStatusFor(req.user.id);
  const envHas = (k) => defaults.active && !!process.env[k];
  const hasCloud = !!(
    cfg.nvidia_api_key   || envHas('NVIDIA_API_KEY') ||
    cfg.groq_api_key     || envHas('GROQ_API_KEY') ||
    cfg.gemini_api_key   || envHas('GEMINI_API_KEY') ||
    cfg.deepseek_api_key || envHas('DEEPSEEK_API_KEY')
  );
  if (!hasCloud) return res.status(400).json({ error: 'no_llm_configured' });

  const rows = db.prepare(
    "SELECT email_id FROM classifications WHERE user_id = ? AND source = 'fallback'"
  ).all(req.user.id);
  const ids = rows.map(r => r.email_id);

  if (ids.length === 0) return res.json({ queued: 0 });

  // Drop stale fallback classifications + their template/empty drafts.
  const delCls = db.prepare("DELETE FROM classifications WHERE email_id = ? AND user_id = ?");
  const delDraft = db.prepare(
    "DELETE FROM drafts WHERE email_id = ? AND user_id = ? AND (source = 'template' OR source IS NULL OR body IS NULL OR body = '')"
  );
  for (const id of ids) { delCls.run(id, req.user.id); delDraft.run(id, req.user.id); }

  // Re-queue through the classifier — Tier 1 rules first, then LLM.
  for (const id of ids) queueClassification(req.user.id, id);

  res.json({ queued: ids.length });
});

// Sidebar partial
router.get('/api/sidebar', (req, res) => {
  const stats = getStats(req.user.id);
  const cfg = getConfig(req.user.id);
  const isDemo = !cfg;

  // tip = native browser tooltip on hover. Helps users understand why a
  // given email landed in this bucket, especially for ambiguous categories
  // like FYI ('why is this here?').
  const folders = [
    { cat: 'urgent',          icon: '🔴', label: 'Urgent Attention',  color: 'var(--accent-red)',    count: stats.urgent,
      tip: 'Emails marked urgent or time-sensitive (deadlines, ASAP, action required, legal matters).' },
    { cat: 'meeting_request', icon: '📅', label: 'Meeting Requests',  color: 'var(--accent-blue)',   count: stats.meeting_request,
      tip: 'Calendar invites, Zoom / Google Meet / Teams / Webex links, 1:1 / catch-up requests.' },
    { cat: 'financial',       icon: '💳', label: 'Financial',         color: 'var(--accent-green)',  count: stats.financial,
      tip: 'Statements, invoices, payment / EMI reminders, transaction alerts, bank notifications.' },
    { cat: 'legal',           icon: '⚖️', label: 'Legal',              color: 'var(--accent-red)',    count: stats.legal,
      tip: 'Legal notices, NDAs, contracts, summons, arbitration. Always treated as urgent.' },
    { cat: 'travel',          icon: '✈️', label: 'Travel & Hotels',    color: 'var(--accent-purple)', count: stats.travel,
      tip: 'Flight & hotel bookings, PNRs, itineraries, e-tickets, check-in reminders.' },
    { cat: 'pitch_deck',      icon: '🚀', label: 'Pitch Decks',       color: 'var(--accent-orange)', count: stats.pitch_deck,
      tip: 'Investment pitches, funding rounds, term sheets, VC outreach.' },
    { cat: 'rewards_awards',  icon: '🏆', label: 'Rewards & Awards',   color: 'var(--accent-gold)',   count: stats.rewards_awards,
      tip: 'Loyalty points, cashback, miles expiry, vouchers, recognition emails.' },
    { cat: 'fyi',             icon: 'ℹ️', label: 'For Your Info',      color: 'var(--accent-gray)',   count: stats.fyi,
      tip: 'Newsletters, weekly / monthly digests, course-platform updates, and automated noreply / no-reply senders. Informational — not action-required.' },
    { cat: 'other',           icon: '📂', label: 'All Other',         color: 'var(--accent-slate)',  count: stats.other,
      tip: "Emails that didn't match any specific category. Often person-to-person mail without a clear topic." },
    { cat: 'trash',           icon: '🗑️', label: 'Trash',              color: 'var(--text-muted)',    count: stats.trash,
      tip: 'Deleted emails. Recoverable until you disconnect the mail server with "permanently delete".' }
  ];

  res.send(`
    <div style="padding:8px 0;flex:1;overflow-y:auto;" id="sidebar-nav">
      ${isDemo ? `
        <div style="margin:8px;padding:8px 12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:6px;font-size:11px;color:var(--accent-amber);font-family:'IBM Plex Mono',monospace;">
          DEMO MODE
        </div>
      ` : ''}
      ${folders.map(f => `
        <a class="folder-item" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;border-radius:6px;margin:2px 8px;transition:background 150ms;text-decoration:none;color:var(--text-secondary);"
           hx-get="/api/emails?category=${f.cat}" hx-target="#email-list" hx-swap="innerHTML"
           title="${escHtml(f.tip || f.label)}"
           onmouseenter="this.style.background='var(--bg-hover)'"
           onmouseleave="this.style.background=''">
          <span style="font-size:16px;flex-shrink:0;">${f.icon}</span>
          <span class="folder-label" style="flex:1;font-size:13px;font-family:'Syne',sans-serif;">${escHtml(f.label)}</span>
          ${f.count > 0 ? `<span class="folder-count" style="background:${f.color};color:${f.color === 'var(--accent-gray)' || f.color === 'var(--accent-slate)' ? 'white' : 'rgba(0,0,0,0.8)'};border-radius:100px;padding:1px 7px;font-size:10px;font-family:'IBM Plex Mono',monospace;font-weight:600;">${f.count}</span>` : ''}
        </a>
      `).join('')}
      <div style="border-top:1px solid var(--border);margin:8px 0;"></div>
      <a class="folder-item" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;border-radius:6px;margin:2px 8px;transition:background 150ms;text-decoration:none;color:var(--text-secondary);"
         hx-get="/api/emails?folder=INBOX&category=all" hx-target="#email-list" hx-swap="innerHTML"
         onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background=''">
        <span style="font-size:16px;flex-shrink:0;">📥</span>
        <span class="folder-label" style="flex:1;font-size:13px;font-family:'Syne',sans-serif;">All Inbox</span>
        ${stats.total_unread > 0 ? `<span class="folder-count" style="background:var(--accent-cyan);color:#000;border-radius:100px;padding:1px 7px;font-size:10px;font-family:'IBM Plex Mono',monospace;font-weight:600;">${stats.total_unread}</span>` : ''}
      </a>
      <a class="folder-item" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;border-radius:6px;margin:2px 8px;transition:background 150ms;text-decoration:none;color:var(--text-secondary);"
         hx-get="/api/emails?folder=SENT&category=all" hx-target="#email-list" hx-swap="innerHTML"
         onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background=''">
        <span style="font-size:16px;flex-shrink:0;">📤</span>
        <span class="folder-label" style="flex:1;font-size:13px;font-family:'Syne',sans-serif;">Sent</span>
      </a>
    </div>
  `);
});

module.exports = router;
