function grandfatherIfNeeded(db) {
  const already = db.prepare("SELECT value FROM meta WHERE key = 'multi_user_migrated'").get();
  if (already && already.value === '1') return;

  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (userCount > 0) {
    // Users already exist; skip grandfather but mark migrated
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('multi_user_migrated', '1')").run();
    return;
  }

  const legacy = db.prepare('SELECT email FROM account_config WHERE id = 1').get();
  if (!legacy || !legacy.email) {
    // No legacy data — fresh install; nothing to grandfather, leave meta unset
    return;
  }

  const info = db.prepare('INSERT INTO users (email) VALUES (?)').run(legacy.email);
  const uid = info.lastInsertRowid;

  db.prepare('UPDATE account_config SET user_id = ? WHERE id = 1').run(uid);
  for (const t of ['emails', 'classifications', 'drafts', 'sync_log']) {
    db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`).run(uid);
  }
  // provider_usage already has user_id column after Task 4 rebuild
  try { db.prepare('UPDATE provider_usage SET user_id = ? WHERE user_id IS NULL').run(uid); } catch {}

  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('multi_user_migrated', '1')").run();
}

module.exports = { grandfatherIfNeeded };
