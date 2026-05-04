const { db } = require('../db');

function parseList(s) {
  if (!s) return [];
  return String(s).split(',').map(x => x.trim()).filter(Boolean);
}

function resolveConfig(userId) {
  const rowRaw = userId != null
    ? db.prepare('SELECT * FROM account_config WHERE user_id = ?').get(userId)
    : db.prepare('SELECT * FROM account_config ORDER BY id LIMIT 1').get();
  const row = rowRaw || {};
  const orderRaw = parseList(row.llm_provider_order);
  const enabledRaw = parseList(row.llm_providers_enabled);

  const keys = {
    nvidia:   process.env.NVIDIA_API_KEY   || row.nvidia_api_key   || null,
    groq:     process.env.GROQ_API_KEY     || row.groq_api_key     || null,
    gemini:   process.env.GEMINI_API_KEY   || row.gemini_api_key   || null,
    deepseek: process.env.DEEPSEEK_API_KEY || row.deepseek_api_key || null
  };
  const models = {
    nvidia:   row.nvidia_model   || 'meta/llama-3.3-70b-instruct',
    groq:     row.groq_model     || 'llama-3.3-70b-versatile',
    gemini:   row.gemini_model   || 'gemini-flash-latest',
    deepseek: row.deepseek_model || 'deepseek-chat'
  };
  // User-override limits; null values let the router fall back to provider defaults
  const limits = {
    nvidia:   { rpm: row.nvidia_rpm   ?? null, rpd: row.nvidia_rpd   ?? null },
    groq:     { rpm: row.groq_rpm     ?? null, rpd: row.groq_rpd     ?? null },
    gemini:   { rpm: row.gemini_rpm   ?? null, rpd: row.gemini_rpd   ?? null },
    deepseek: { rpm: row.deepseek_rpm ?? null, rpd: row.deepseek_rpd ?? null }
  };

  const order   = orderRaw.length   ? orderRaw   : ['nvidia', 'groq', 'gemini', 'deepseek'];
  const enabled = enabledRaw.length ? enabledRaw : ['nvidia', 'groq', 'gemini', 'deepseek'];

  // Auto-disable providers without a key
  const enabledFiltered = enabled.filter(p => keys[p]);

  return { order, enabled: enabledFiltered, keys, models, limits };
}

function saveProviderConfig(userId, upd) {
  const existing = db.prepare('SELECT id FROM account_config WHERE user_id = ?').get(userId);
  if (!existing) {
    db.prepare('INSERT INTO account_config (user_id) VALUES (?)').run(userId);
  }
  const orderStr   = Array.isArray(upd.order)   ? upd.order.join(',')   : upd.order;
  const enabledStr = Array.isArray(upd.enabled) ? upd.enabled.join(',') : upd.enabled;
  const intOrNull = v => (v === null || v === undefined || v === '') ? null : parseInt(v, 10);
  db.prepare(`UPDATE account_config SET
    nvidia_api_key   = COALESCE(?, nvidia_api_key),
    groq_api_key     = COALESCE(?, groq_api_key),
    gemini_api_key   = COALESCE(?, gemini_api_key),
    deepseek_api_key = COALESCE(?, deepseek_api_key),
    nvidia_model     = COALESCE(?, nvidia_model),
    groq_model       = COALESCE(?, groq_model),
    gemini_model     = COALESCE(?, gemini_model),
    deepseek_model   = COALESCE(?, deepseek_model),
    llm_provider_order    = COALESCE(?, llm_provider_order),
    llm_providers_enabled = COALESCE(?, llm_providers_enabled),
    nvidia_rpm   = COALESCE(?, nvidia_rpm),
    nvidia_rpd   = COALESCE(?, nvidia_rpd),
    groq_rpm     = COALESCE(?, groq_rpm),
    groq_rpd     = COALESCE(?, groq_rpd),
    gemini_rpm   = COALESCE(?, gemini_rpm),
    gemini_rpd   = COALESCE(?, gemini_rpd),
    deepseek_rpm = COALESCE(?, deepseek_rpm),
    deepseek_rpd = COALESCE(?, deepseek_rpd)
    WHERE user_id = ?`).run(
      upd.nvidia_api_key ?? null,
      upd.groq_api_key ?? null,
      upd.gemini_api_key ?? null,
      upd.deepseek_api_key ?? null,
      upd.nvidia_model ?? null,
      upd.groq_model ?? null,
      upd.gemini_model ?? null,
      upd.deepseek_model ?? null,
      orderStr ?? null,
      enabledStr ?? null,
      intOrNull(upd.nvidia_rpm),
      intOrNull(upd.nvidia_rpd),
      intOrNull(upd.groq_rpm),
      intOrNull(upd.groq_rpd),
      intOrNull(upd.gemini_rpm),
      intOrNull(upd.gemini_rpd),
      intOrNull(upd.deepseek_rpm),
      intOrNull(upd.deepseek_rpd),
      userId
    );
}

module.exports = { resolveConfig, saveProviderConfig };
