const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const cron = require('node-cron');
const crypto = require('crypto');
const { db, getConfig } = require('./db');
const { queueClassification } = require('./classifier');
const { mapAuthError } = require('./util/credentials');

let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }

// Per-user sync state.
const states = new Map();

function stateFor(userId) {
  let s = states.get(userId);
  if (!s) {
    s = {
      userId,
      syncMode: 'disconnected',
      lastSeenUID: 0,
      idleDropTimes: [],
      cronJob: null,
      recoveryInterval: null,
      renewalTimer: null,
      currentClient: null
    };
    states.set(userId, s);
  }
  return s;
}

function getSyncMode(userId) {
  return stateFor(userId).syncMode;
}

function setSyncMode(userId, mode) {
  stateFor(userId).syncMode = mode;
  broadcast('sync_status', { userId, mode, lastSync: new Date().toISOString() });
}

async function createClient(cfg) {
  const client = new ImapFlow({
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
  // imapflow emits 'error' on socket-level failures (ECONNRESET etc.); without a listener
  // Node.js treats unhandled EventEmitter errors as uncaught exceptions and crashes the process.
  // The existing catch blocks on idle()/connect() still fire via promise rejection.
  client.on('error', () => {});
  return client;
}

async function storeEmail(userId, parsed, folder) {
  const msgId = parsed.messageId || `uid-${Date.now()}-${Math.random()}`;
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO emails
      (user_id, message_id, uid, folder, from_address, from_name, to_address, cc_address,
       subject, body_text, body_html, received_at, is_read)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      userId,
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
      // Already existed — return existing id (scoped to this user)
      const existing = db.prepare(
        'SELECT id FROM emails WHERE message_id = ? AND user_id = ?'
      ).get(msgId, userId);
      return existing ? existing.id : null;
    }
    return result.lastInsertRowid;
  } catch (e) {
    console.error('Email store error:', e.message);
    return null;
  }
}

async function fetchMessages(userId, client, folder, limit) {
  const state = stateFor(userId);
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
      const id = await storeEmail(userId, parsed, folder);
      if (id) queueClassification(userId, id);
      if (parsed.uid && parsed.uid > state.lastSeenUID && folder === 'INBOX') {
        state.lastSeenUID = parsed.uid;
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

function checkCircuitBreaker(userId) {
  const state = stateFor(userId);
  const now = Date.now();
  state.idleDropTimes = state.idleDropTimes.filter(t => now - t < 5 * 60 * 1000);
  state.idleDropTimes.push(now);
  return state.idleDropTimes.length >= 3;
}

function clearRenewalTimer(userId) {
  const state = stateFor(userId);
  if (state.renewalTimer) { clearTimeout(state.renewalTimer); state.renewalTimer = null; }
}

async function startPolling(userId, cfg) {
  const state = stateFor(userId);
  setSyncMode(userId, 'polling');
  if (state.cronJob) state.cronJob.stop();

  state.cronJob = cron.schedule('*/60 * * * * *', async () => {
    if (state.syncMode !== 'polling') return;
    try {
      const client = await createClient(cfg);
      await client.connect();
      const newMsgs = await fetchSinceUID(client, 'INBOX', state.lastSeenUID);
      for (const parsed of newMsgs) {
        const id = await storeEmail(userId, parsed, 'INBOX');
        if (id) {
          queueClassification(userId, id);
          if (parsed.uid > state.lastSeenUID) state.lastSeenUID = parsed.uid;
          broadcast('new_email', {
            userId,
            id, subject: parsed.subject,
            from_name: parsed.from?.value?.[0]?.name || parsed.from?.value?.[0]?.address || 'Unknown'
          });
        }
      }
      await client.logout();
      broadcast('sync_status', { userId, mode: 'polling', lastSync: new Date().toISOString() });
      db.prepare(
        "INSERT INTO sync_log (user_id, sync_mode, folder, new_count) VALUES (?, 'polling', 'INBOX', ?)"
      ).run(userId, newMsgs.length);
    } catch (e) {
      db.prepare(
        "INSERT INTO sync_log (user_id, sync_mode, folder, error) VALUES (?, 'polling','INBOX',?)"
      ).run(userId, e.message);
    }
  });

  // Attempt IDLE recovery every 5 minutes
  if (!state.recoveryInterval) {
    state.recoveryInterval = setInterval(async () => {
      if (state.syncMode !== 'polling') return;
      try {
        state.idleDropTimes = [];
        await startIDLE(userId, cfg);
      } catch (e) { /* still polling */ }
    }, 5 * 60 * 1000);
  }
}

async function startIDLE(userId, cfg) {
  const state = stateFor(userId);
  clearRenewalTimer(userId);
  if (state.currentClient) {
    try { await state.currentClient.logout(); } catch(e) {}
    state.currentClient = null;
  }

  setSyncMode(userId, 'connecting');
  const client = await createClient(cfg);
  state.currentClient = client;

  await client.connect();
  await client.mailboxOpen('INBOX');

  if (!client.capabilities.has('IDLE')) {
    console.log('IMAP server does not support IDLE, switching to polling');
    await client.logout();
    state.currentClient = null;
    await startPolling(userId, cfg);
    return;
  }

  setSyncMode(userId, 'idle');
  if (state.cronJob) { state.cronJob.stop(); state.cronJob = null; }
  if (state.recoveryInterval) { clearInterval(state.recoveryInterval); state.recoveryInterval = null; }

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
        const newMsgs = await fetchSinceUID(fetchClient, 'INBOX', state.lastSeenUID);
        await fetchClient.logout();
        fetchClient = null;
        for (const parsed of newMsgs) {
          const id = await storeEmail(userId, parsed, 'INBOX');
          if (id) {
            queueClassification(userId, id);
            if (parsed.uid > state.lastSeenUID) state.lastSeenUID = parsed.uid;
            broadcast('new_email', {
              userId,
              id, subject: parsed.subject,
              from_name: parsed.from?.value?.[0]?.name || parsed.from?.value?.[0]?.address || 'Unknown'
            });
            broadcast('stats_update', { userId });
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
  state.renewalTimer = setTimeout(async () => {
    try {
      await startIDLE(userId, cfg);
    } catch (e) {
      if (checkCircuitBreaker(userId)) {
        await startPolling(userId, cfg);
      } else {
        setTimeout(() => startIDLE(userId, cfg), 5000);
      }
    }
  }, 1680000);

  try {
    await client.idle();
    // idle() resolves when server ends the IDLE session
    clearRenewalTimer(userId);
    await startIDLE(userId, cfg);
  } catch (e) {
    clearRenewalTimer(userId);
    state.currentClient = null;
    if (checkCircuitBreaker(userId)) {
      console.log('Circuit breaker tripped — switching to polling');
      await startPolling(userId, cfg);
    } else {
      setSyncMode(userId, 'reconnecting');
      const delay = Math.min(5000 * Math.pow(2, state.idleDropTimes.length - 1), 300000);
      setTimeout(() => startIDLE(userId, cfg), delay);
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
    // imapflow's e.message is often a generic "Command failed" — the actual
    // server reply (e.g. "Invalid credentials (Failure)" / "Application-
    // specific password required") lives on e.responseText. Prefer that, then
    // map known patterns to a friendlier hint.
    const raw = e.responseText || e.authMessage || e.message || 'IMAP connection failed';
    return { ok: false, error: mapAuthError(cfg.imap_host, raw) };
  }
}

async function startSyncForUser(userId) {
  const cfg = getConfig(userId);
  if (!cfg) {
    setSyncMode(userId, 'disconnected');
    return;
  }

  const state = stateFor(userId);

  try {
    setSyncMode(userId, 'connecting');

    // Check if we already have emails in DB (restart scenario) — scoped to this user
    const lastEmail = db.prepare(
      "SELECT MAX(CAST(uid AS INTEGER)) as maxuid FROM emails WHERE folder='INBOX' AND user_id = ?"
    ).get(userId);
    const priorUID = lastEmail?.maxuid || 0;

    const client = await createClient(cfg);
    await client.connect();

    if (priorUID > 0) {
      // Incremental: only fetch emails newer than last known UID — avoids re-scanning on restart
      state.lastSeenUID = priorUID;
      const newMsgs = await fetchSinceUID(client, 'INBOX', state.lastSeenUID);
      for (const parsed of newMsgs) {
        const id = await storeEmail(userId, parsed, 'INBOX');
        if (id) {
          queueClassification(userId, id);
          if (parsed.uid > state.lastSeenUID) state.lastSeenUID = parsed.uid;
        }
      }
    } else {
      // First run: full fetch of recent emails
      await fetchMessages(userId, client, 'INBOX', 200);
      const le = db.prepare(
        "SELECT MAX(CAST(uid AS INTEGER)) as maxuid FROM emails WHERE folder='INBOX' AND user_id = ?"
      ).get(userId);
      if (le?.maxuid) state.lastSeenUID = le.maxuid;
      await fetchMessages(userId, client, 'SENT', 100);
    }

    await client.logout();
    broadcast('stats_update', { userId });
    await startIDLE(userId, cfg);
  } catch (e) {
    console.error('IMAP startup error:', e.message);
    setSyncMode(userId, 'disconnected');
    setTimeout(() => startSyncForUser(userId), 30000);
  }
}

async function stopSyncForUser(userId) {
  const s = stateFor(userId);
  if (s.renewalTimer) { clearTimeout(s.renewalTimer); s.renewalTimer = null; }
  if (s.cronJob) { s.cronJob.stop(); s.cronJob = null; }
  if (s.recoveryInterval) { clearInterval(s.recoveryInterval); s.recoveryInterval = null; }
  if (s.currentClient) {
    try { await s.currentClient.logout(); } catch(e) {}
    s.currentClient = null;
  }
  s.syncMode = 'disconnected';
  broadcast('sync_status', { userId, mode: 'disconnected', lastSync: new Date().toISOString() });
}

async function flagAsDeleted(userId, uid, folder) {
  const cfg = getConfig(userId);
  if (!cfg || !uid) return;
  try {
    const client = await createClient(cfg);
    await client.connect();
    await client.mailboxOpen(folder || 'INBOX');
    await client.messageFlagsAdd(String(uid), ['\\Deleted'], { uid: true });
    await client.logout();
  } catch(e) {} // silent — local delete still recorded
}

async function expungeDeleted(userId) {
  const cfg = getConfig(userId);
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

module.exports = {
  startSyncForUser, stopSyncForUser, testImap, getSyncMode, setSyncMode,
  setBroadcast, flagAsDeleted, expungeDeleted
};
