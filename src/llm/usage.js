const { db } = require('../db');

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Dual-shape:
//   getCount(userId, provider, day?) — per-user count
//   getCount(provider, day?)          — legacy aggregate across all users
function getCount(...args) {
  if (args.length >= 2 && typeof args[0] === 'number') {
    const [userId, provider, day = today()] = args;
    const row = db.prepare(
      'SELECT request_count FROM provider_usage WHERE user_id = ? AND provider=? AND day=?'
    ).get(userId, provider, day);
    return row ? row.request_count : 0;
  }
  const [provider, day = today()] = args;
  const row = db.prepare(
    'SELECT SUM(request_count) as n FROM provider_usage WHERE provider=? AND day=?'
  ).get(provider, day);
  return row && row.n ? row.n : 0;
}

// Dual-shape:
//   increment(userId, provider) — per-user increment
//   increment(provider)         — legacy NULL-user increment
function increment(...args) {
  const day = today();
  if (args.length >= 2 && typeof args[0] === 'number') {
    const [userId, provider] = args;
    db.prepare(`INSERT INTO provider_usage (user_id, provider, day, request_count)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(user_id, provider, day) DO UPDATE SET request_count = request_count + 1`
    ).run(userId, provider, day);
    return;
  }
  const [provider] = args;
  // Legacy single-arg path: user_id is NULL — use a compatible upsert.
  const existing = db.prepare(
    'SELECT request_count FROM provider_usage WHERE user_id IS NULL AND provider=? AND day=?'
  ).get(provider, day);
  if (existing) {
    db.prepare(
      'UPDATE provider_usage SET request_count = request_count + 1 WHERE user_id IS NULL AND provider=? AND day=?'
    ).run(provider, day);
  } else {
    db.prepare(
      'INSERT INTO provider_usage (user_id, provider, day, request_count) VALUES (NULL, ?, ?, 1)'
    ).run(provider, day);
  }
}

function todaySummary(userId) {
  if (userId != null) {
    const rows = db.prepare(
      'SELECT provider, request_count FROM provider_usage WHERE user_id = ? AND day=?'
    ).all(userId, today());
    const out = {};
    for (const r of rows) out[r.provider] = r.request_count;
    return out;
  }
  const rows = db.prepare(
    'SELECT provider, SUM(request_count) as n FROM provider_usage WHERE day=? GROUP BY provider'
  ).all(today());
  const out = {};
  for (const r of rows) out[r.provider] = r.n;
  return out;
}

module.exports = { getCount, increment, todaySummary };
