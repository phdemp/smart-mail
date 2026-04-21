const { parseProviderResponse, DEFAULTS } = require('./providers/base');

function createRouter({ providers, getConfig, logger }) {
  const byName = new Map(providers.map(p => [p.name, p]));
  const log = logger || (() => {});

  async function classify(email, opts = {}) {
    const cfg = getConfig() || { order: [], enabled: [], keys: {}, models: {} };
    const enabledSet = new Set(cfg.enabled || []);
    const order = (cfg.order || []).filter(n => enabledSet.has(n) && byName.has(n));

    for (const name of order) {
      const provider = byName.get(name);
      const providerCfg = {
        apiKey: (cfg.keys || {})[name],
        model: (cfg.models || {})[name] || provider.defaultModel
      };
      const start = Date.now();
      try {
        const rawResult = await provider.call(email, opts, providerCfg);
        const parsed = typeof rawResult === 'string'
          ? parseProviderResponse(rawResult)
          : { ...DEFAULTS, ...rawResult };
        log({ provider: name, mode: opts.mode, outcome: 'success', latency_ms: Date.now() - start, email_id: email.id });
        return { ...parsed, _provider: name };
      } catch (err) {
        log({ provider: name, mode: opts.mode, outcome: classifyError(err), latency_ms: Date.now() - start, email_id: email.id, err: err.message });
        continue;
      }
    }
    return null;
  }

  function classifyError(err) {
    if (err.status === 429) return 'http_429';
    if (err.status === 401 || err.status === 403) return 'http_401';
    if (err.status >= 500) return 'http_5xx';
    if (err.name === 'AbortError') return 'timeout';
    if (/could not parse/i.test(err.message)) return 'invalid_json';
    return 'network';
  }

  return { classify, _byName: byName };
}

module.exports = { createRouter };
