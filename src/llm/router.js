const { parseProviderResponse, DEFAULTS } = require('./providers/base');
const { TokenBucket } = require('./ratelimiter');

function createRouter({ providers, getConfig, logger, usage }) {
  const byName = new Map(providers.map(p => [p.name, p]));
  const log = logger || (() => {});
  const usageApi = usage || require('./usage');
  const buckets = new Map();
  for (const p of providers) buckets.set(p.name, new TokenBucket({ rpm: p.limits.rpm }));

  const BREAKER_OPEN_MS = 5 * 60 * 1000;
  const BREAKER_FAILS = 3;
  const breakers = new Map();
  for (const p of providers) breakers.set(p.name, { fails: 0, openedAt: 0 });
  const breakerOpen = (name) => {
    const b = breakers.get(name);
    if (b._sessionDisabled) return true;
    if (!b.openedAt) return false;
    if (Date.now() - b.openedAt >= BREAKER_OPEN_MS) { b.openedAt = 0; return false; }
    return true;
  };

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

      if (breakerOpen(name)) {
        log({ provider: name, mode: opts.mode, outcome: 'skipped_breaker', email_id: email.id });
        continue;
      }

      if (Number.isFinite(provider.limits.rpd) && usageApi.getCount(name) >= provider.limits.rpd) {
        log({ provider: name, mode: opts.mode, outcome: 'skipped_quota', email_id: email.id });
        continue;
      }

      const maxWaitMs = opts.mode === 'regen' ? 2000 : 30000;
      const got = await buckets.get(name).acquire(maxWaitMs);
      if (!got) {
        log({ provider: name, mode: opts.mode, outcome: 'skipped_bucket', email_id: email.id });
        continue;
      }

      const start = Date.now();
      try {
        const rawResult = await provider.call(email, opts, providerCfg);
        const parsed = typeof rawResult === 'string'
          ? parseProviderResponse(rawResult)
          : { ...DEFAULTS, ...rawResult };
        try { usageApi.increment(name); } catch {}
        breakers.get(name).fails = 0;
        log({ provider: name, mode: opts.mode, outcome: 'success', latency_ms: Date.now() - start, email_id: email.id });
        return { ...parsed, _provider: name };
      } catch (err) {
        const outcome = classifyError(err);
        log({ provider: name, mode: opts.mode, outcome, latency_ms: Date.now() - start, email_id: email.id, err: err.message });
        const br = breakers.get(name);
        if (outcome === 'http_401') {
          // Session-disable: bad credentials won't fix themselves at runtime.
          br.openedAt = Date.now();
          br._sessionDisabled = true;
        } else if (outcome === 'http_429') {
          // Quota/rate-limit — not a health problem; token bucket will keep us honest.
        } else {
          br.fails += 1;
          if (br.fails >= BREAKER_FAILS) { br.openedAt = Date.now(); br.fails = 0; }
        }
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
