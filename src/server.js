require('dotenv').config();
const express = require('express');
const path = require('path');
const { db, getConfig, getStats } = require('./db');
const { startSync, setBroadcast } = require('./imap');
const { classifyAllUnclassified, setBroadcast: setClassifierBroadcast } = require('./classifier');

const app = express();
const PORT = process.env.PORT || 3000;

// SSE clients registry
const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(payload); }
    catch(e) { sseClients.delete(client); }
  }
}

// SSE route — must be before body parsers
app.get('/api/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.add(client);

  // Send initial stats on connect
  try {
    const stats = getStats();
    res.write(`event: stats_update\ndata: ${JSON.stringify(stats)}\n\n`);
  } catch(e) {}

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    try { res.write('event: heartbeat\ndata: {}\n\n'); }
    catch(e) { sseClients.delete(client); clearInterval(heartbeat); }
  }, 30000);

  req.on('close', () => {
    sseClients.delete(client);
    clearInterval(heartbeat);
  });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Wire broadcast into IMAP module
setBroadcast((event, data) => {
  if (event === 'stats_update') {
    broadcast('stats_update', getStats());
  } else {
    broadcast(event, data);
  }
});
setClassifierBroadcast(broadcast);

// Routes
const pagesRouter = require('./routes/pages');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');
app.use('/', authRouter);
app.use('/', pagesRouter);
app.use('/', apiRouter);

// Startup
async function init() {
  classifyAllUnclassified();
  startSync();
}

app.listen(PORT, () => {
  console.log(`IntelliMail running at http://localhost:${PORT}`);
  init().catch(e => console.error('Init error:', e.message));
});

module.exports = { broadcast };
