const { db } = require('../db');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getCount(provider, day = today()) {
  const row = db.prepare('SELECT request_count FROM provider_usage WHERE provider=? AND day=?').get(provider, day);
  return row ? row.request_count : 0;
}

function increment(provider) {
  const day = today();
  db.prepare(`INSERT INTO provider_usage (provider, day, request_count)
              VALUES (?, ?, 1)
              ON CONFLICT(provider, day) DO UPDATE SET request_count = request_count + 1`).run(provider, day);
}

function todaySummary() {
  const rows = db.prepare('SELECT provider, request_count FROM provider_usage WHERE day=?').all(today());
  const out = {};
  for (const r of rows) out[r.provider] = r.request_count;
  return out;
}

module.exports = { getCount, increment, todaySummary };
