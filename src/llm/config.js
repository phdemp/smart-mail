const { db } = require('../db');

function parseList(s) {
  if (!s) return [];
  return String(s).split(',').map(x => x.trim()).filter(Boolean);
}

function resolveConfig() {
  const row = db.prepare('SELECT * FROM account_config WHERE id = 1').get() || {};
  const orderRaw = parseList(row.llm_provider_order);
  const enabledRaw = parseList(row.llm_providers_enabled);

  const keys = {
    local:  null,
    groq:   process.env.GROQ_API_KEY   || row.groq_api_key   || null,
    gemini: process.env.GEMINI_API_KEY || row.gemini_api_key || null
  };
  const models = {
    local:  null,
    groq:   row.groq_model   || 'llama-3.3-70b-versatile',
    gemini: row.gemini_model || 'gemini-2.5-flash'
  };

  const order   = orderRaw.length   ? orderRaw   : ['local', 'groq', 'gemini'];
  const enabled = enabledRaw.length ? enabledRaw : ['local', 'groq', 'gemini'];

  // Auto-disable cloud providers without a key
  const enabledFiltered = enabled.filter(p => p === 'local' || keys[p]);

  return { order, enabled: enabledFiltered, keys, models };
}

function saveProviderConfig({ groq_api_key, gemini_api_key, groq_model, gemini_model, order, enabled }) {
  const existing = db.prepare('SELECT id FROM account_config WHERE id = 1').get();
  if (!existing) {
    db.prepare('INSERT INTO account_config (id) VALUES (1)').run();
  }
  const orderStr   = Array.isArray(order)   ? order.join(',')   : order;
  const enabledStr = Array.isArray(enabled) ? enabled.join(',') : enabled;
  db.prepare(`UPDATE account_config SET
    groq_api_key   = COALESCE(?, groq_api_key),
    gemini_api_key = COALESCE(?, gemini_api_key),
    groq_model     = COALESCE(?, groq_model),
    gemini_model   = COALESCE(?, gemini_model),
    llm_provider_order    = COALESCE(?, llm_provider_order),
    llm_providers_enabled = COALESCE(?, llm_providers_enabled)
    WHERE id = 1`).run(
      groq_api_key ?? null,
      gemini_api_key ?? null,
      groq_model ?? null,
      gemini_model ?? null,
      orderStr ?? null,
      enabledStr ?? null
    );
}

module.exports = { resolveConfig, saveProviderConfig };
