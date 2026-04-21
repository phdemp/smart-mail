const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const cron = require('node-cron');
const crypto = require('crypto');
const { db, getConfig } = require('./db');
const { queueClassification } = require('./classifier');

let broadcast = () => {};
let syncMode = 'disconnected';
let lastSeenUID = 0;
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
    socketTimeout: 1800000, // 30 min — kills dead/silent connections before IDLE renewal fires
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    tls: {
      rejectUnauthorized: false,
      ciphers: 'DEFAULT:@SECLEVEL=0',
      maxVersion: 'TLSv1.2',
      secureOptions: crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION |
                     crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
    }
  });
}

async function storeEmail(parsed, folder) {
  const msgId = parsed.messageId || `uid-${Date.now()}-${Math.random()}`;
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO emails
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
    if (result.changes === 0) {
      // Already existed — return existing id
      const existing = db.prepare('SELECT id FROM emails WHERE message_id = ?').get(msgId);
      return existing ? existing.id : null;
    }
    return result.lastInsertRowid;
  } catch (e) {
    console.error('Email store error:', e.message);
    return null;
  }
}

async function fetchMessages(client, folder, limit) {
  try {
    await client.mailboxOpen(folder);
  } catch (e) {
    console.log(`Folder ${folder} not available:`, e.message);
    return;
  }
  const status = await client.status(folder, { messages: true });
  const total = status.messages;
  if (total === 0) return;

  const start = Math.max(1, total - limit + 1);

  for await (const msg of client.fetch(`${start}:*`, { source: true })) {
    try {
      const parsed = await simpleParser(msg.source);
      parsed.uid = msg.uid;
      const id = await storeEmail(parsed, folder);
      if (id) queueClassification(id);
      if (parsed.uid && parsed.uid > lastSeenUID && folder === 'INBOX') {
        lastSeenUID = parsed.uid;
      }
    } catch (e) {
      console.error('Parse/store error:', e.message);
    }
  }
}

async function fetchSinceUID(client, folder, sinceUID) {
  const newMsgs = [];
  try {
    await client.mailboxOpen(folder);
    // Third arg { uid: true } tells imapflow to treat range as UIDs, not sequence numbers
    for await (const msg of client.fetch(`${sinceUID + 1}:*`, { source: true, uid: true }, { uid: true })) {
      try {
        const parsed = await simpleParser(msg.source);
        parsed.uid = msg.uid;
        newMsgs.push(parsed);
      } catch (e) { /* skip malformed */ }
    }
  } catch (e) {
    if (e.message && !e.message.includes('No messages')) {
      console.error(`[imap] fetchSinceUID(${folder}, since=${sinceUID}) failed:`, e.message);
    }
  }
  return newMsgs;
}

function checkCircuitBreaker() {
  const now = Date.now();
  idleDropTimes = idleDropTimes.filter(t => now - t < 5 * 60 * 1000);
  idleDropTimes.push(now);
  return idleDropTimes.length >= 3;
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
        await startIDLE(cfg);
      } catch (e) { /* still polling */ }
    }, 5 * 60 * 1000);
  }
}

async function startIDLE(cfg) {
  clearRenewalTimer();
  if (currentClient) {
    try { await currentClient.logout(); } catch(e) {}
    currentClient = null;
  }

  setSyncMode('connecting');
  const client = await createClient(cfg);
  currentClient = client;

  await client.connect();
  await client.mailboxOpen('INBOX');

  if (!client.capabilities.has('IDLE')) {
    console.log('IMAP server does not support IDLE, switching to polling');
    await client.logout();
    currentClient = null;
    await startPolling(cfg);
    return;
  }

  setSyncMode('idle');
  if (cronJob) { cronJob.stop(); cronJob = null; }
  if (recoveryInterval) { clearInterval(recoveryInterval); recoveryInterval = null; }

  let existsDebounce = null;
  let existsFetching = false;
  client.on('exists', () => {
    // Debounce: coalesce rapid EXISTS notifications (e.g. bulk arrivals) into one fetch
    if (existsDebounce) clearTimeout(existsDebounce);
    existsDebounce = setTimeout(async () => {
      existsDebounce = null;
      if (existsFetching) return; // already fetching, skip
      existsFetching = true;
      let fetchClient;
      try {
        // Use a fresh connection so the IDLE connection stays dedicated
        fetchClient = await createClient(cfg);
        await fetchClient.connect();
        const newMsgs = await fetchSinceUID(fetchClient, 'INBOX', lastSeenUID);
        await fetchClient.logout();
        fetchClient = null;
        for (const parsed of newMsgs) {
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
      } catch (e) {
        console.error('Exists handler error:', e.message);
        if (fetchClient) try { await fetchClient.logout(); } catch(_) {}
      } finally {
        existsFetching = false;
        // Catch-up: if more EXISTS events arrived while we were fetching (and were
        // skipped by the existsFetching guard), do one more pass now to avoid missing them.
        if (!existsDebounce) {
          existsDebounce = setTimeout(() => client.emit('exists'), 200);
        }
      }
    }, 500); // 500ms debounce window
  });

  // IDLE renewal every 28 minutes (1,680,000ms) per RFC 2177
  // startIDLE handles logout of currentClient — no need to call idle() here first
  renewalTimer = setTimeout(async () => {
    try {
      await startIDLE(cfg);
    } catch (e) {
      if (checkCircuitBreaker()) {
        await startPolling(cfg);
      } else {
        setTimeout(() => startIDLE(cfg), 5000);
      }
    }
  }, 1680000);

  try {
    await client.idle();
    // idle() resolves when server ends the IDLE session
    clearRenewalTimer();
    await startIDLE(cfg);
  } catch (e) {
    clearRenewalTimer();
    currentClient = null;
    if (checkCircuitBreaker()) {
      console.log('Circuit breaker tripped — switching to polling');
      await startPolling(cfg);
    } else {
      setSyncMode('reconnecting');
      const delay = Math.min(5000 * Math.pow(2, idleDropTimes.length - 1), 300000);
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
    setSyncMode('disconnected');
    return;
  }

  try {
    setSyncMode('connecting');

    // Check if we already have emails in DB (restart scenario)
    const lastEmail = db.prepare(
      "SELECT MAX(CAST(uid AS INTEGER)) as maxuid FROM emails WHERE folder='INBOX'"
    ).get();
    const priorUID = lastEmail?.maxuid || 0;

    const client = await createClient(cfg);
    await client.connect();

    if (priorUID > 0) {
      // Incremental: only fetch emails newer than last known UID — avoids re-scanning on restart
      lastSeenUID = priorUID;
      const newMsgs = await fetchSinceUID(client, 'INBOX', lastSeenUID);
      for (const parsed of newMsgs) {
        const id = await storeEmail(parsed, 'INBOX');
        if (id) {
          queueClassification(id);
          if (parsed.uid > lastSeenUID) lastSeenUID = parsed.uid;
        }
      }
    } else {
      // First run: full fetch of recent emails
      await fetchMessages(client, 'INBOX', 200);
      const le = db.prepare(
        "SELECT MAX(CAST(uid AS INTEGER)) as maxuid FROM emails WHERE folder='INBOX'"
      ).get();
      if (le?.maxuid) lastSeenUID = le.maxuid;
      await fetchMessages(client, 'SENT', 100);
    }

    await client.logout();
    broadcast('stats_update', {});
    await startIDLE(cfg);
  } catch (e) {
    console.error('IMAP startup error:', e.message);
    setSyncMode('disconnected');
    setTimeout(startSync, 30000);
  }
}

async function stopSync() {
  clearRenewalTimer();
  if (cronJob) { cronJob.stop(); cronJob = null; }
  if (recoveryInterval) { clearInterval(recoveryInterval); recoveryInterval = null; }
  if (currentClient) {
    try { await currentClient.logout(); } catch(e) {}
    currentClient = null;
  }
  syncMode = 'disconnected';
  broadcast('sync_status', { mode: 'disconnected', lastSync: new Date().toISOString() });
}

async function flagAsDeleted(uid, folder) {
  const cfg = getConfig();
  if (!cfg || !uid) return;
  try {
    const client = await createClient(cfg);
    await client.connect();
    await client.mailboxOpen(folder || 'INBOX');
    await client.messageFlagsAdd(String(uid), ['\\Deleted'], { uid: true });
    await client.logout();
  } catch(e) {} // silent — local delete still recorded
}

async function expungeDeleted() {
  const cfg = getConfig();
  if (!cfg) return { ok: false };
  try {
    const client = await createClient(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    await client.expunge();
    await client.logout();
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { startSync, stopSync, testImap, getSyncMode, setBroadcast, flagAsDeleted, expungeDeleted };
