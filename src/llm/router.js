const { parseProviderResponse, DEFAULTS } = require('./providers/base');
const { TokenBucket } = require('./ratelimiter');

function createRouter({ providers, getConfig, logger, usage }) {
  const byName = new Map(providers.map(p => [p.name, p]));
  const log = logger || (() => {});
  const usageApi = usage || require('./usage');

  // Keyed by `${userId}::${providerName}`. userId may be 'global' for legacy paths.
  const buckets = new Map();
  const breakers = new Map();

  const BREAKER_OPEN_MS = 5 * 60 * 1000;
  const BREAKER_FAILS = 3;

  function key(userId, name) { return `${userId == null ? 'global' : userId}::${name}`; }

  function getBucket(userId, provider) {
    const k = key(userId, provider.name);
    if (!buckets.has(k)) {
      const cfg = (getConfig && getConfig(userId)) || {};
      const userLim = (cfg.limits || {})[provider.name] || {};
      const rpm = (typeof userLim.rpm === 'number' && userLim.rpm > 0) ? userLim.rpm : provider.limits.rpm;
      buckets.set(k, new TokenBucket({ rpm }));
    }
    return buckets.get(k);
  }

  function getBreaker(userId, name) {
    const k = key(userId, name);
    if (!breakers.has(k)) breakers.set(k, { fails: 0, openedAt: 0 });
    return breakers.get(k);
  }

  function breakerOpen(userId, name) {
    const b = getBreaker(userId, name);
    if (b._sessionDisabled) return true;
    if (!b.openedAt) return false;
    if (Date.now() - b.openedAt >= BREAKER_OPEN_MS) { b.openedAt = 0; return false; }
    return true;
  }

  async function classify(email, opts = {}) {
    const userId = opts.userId;
    const cfg = (getConfig && getConfig(userId)) || { order: [], enabled: [], keys: {}, models: {}, limits: {} };
    const enabledSet = new Set(cfg.enabled || []);
    const order = (cfg.order || []).filter(n => enabledSet.has(n) && byName.has(n));

    for (const name of order) {
      const provider = byName.get(name);
      const providerCfg = {
        apiKey: (cfg.keys || {})[name],
        model:  (cfg.models || {})[name] || provider.defaultModel
      };

      if (breakerOpen(userId, name)) {
        log({ provider: name, mode: opts.mode, outcome: 'skipped_breaker', email_id: email.id, user_id: userId });
        continue;
      }

      const cfgLim = cfg.limits && cfg.limits[name];
      const effectiveRpd = (cfgLim && typeof cfgLim.rpd === 'number' && cfgLim.rpd > 0) ? cfgLim.rpd : provider.limits.rpd;
      if (Number.isFinite(effectiveRpd)) {
        const count = userId != null ? usageApi.getCount(userId, name) : usageApi.getCount(name);
        if (count >= effectiveRpd) {
          log({ provider: name, mode: opts.mode, outcome: 'skipped_quota', email_id: email.id, user_id: userId });
          continue;
        }
      }

      const maxWaitMs = opts.mode === 'regen' ? 2000 : 30000;
      const got = await getBucket(userId, provider).acquire(maxWaitMs);
      if (!got) {
        log({ provider: name, mode: opts.mode, outcome: 'skipped_bucket', email_id: email.id, user_id: userId });
        continue;
      }

      const start = Date.now();
      try {
        const rawResult = await provider.call(email, opts, providerCfg);
        const parsed = typeof rawResult === 'string'
          ? parseProviderResponse(rawResult)
          : { ...DEFAULTS, ...rawResult };
        try {
          if (userId != null) usageApi.increment(userId, name);
          else usageApi.increment(name);
        } catch {}
        getBreaker(userId, name).fails = 0;
        log({ provider: name, mode: opts.mode, outcome: 'success', latency_ms: Date.now() - start, email_id: email.id, user_id: userId });
        return { ...parsed, _provider: name };
      } catch (err) {
        const outcome = classifyError(err);
        log({ provider: name, mode: opts.mode, outcome, latency_ms: Date.now() - start, email_id: email.id, user_id: userId, err: err.message });
        const br = getBreaker(userId, name);
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
