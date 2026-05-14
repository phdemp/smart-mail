const { parseProviderResponse, DEFAULTS } = require('./providers/base');
const { TokenBucket } = require('./ratelimiter');

function createRouter({ providers, getConfig, logger, usage }) {
  const byName = new Map(providers.map(p => [p.name, p]));
  const log = logger || (() => {});
  const usageApi = usage || require('./usage');

  // Keyed by `${userId}::${providerName}`. userId may be 'global' for legacy paths.
  const buckets = new Map();
  const breakers = new Map();
  const observedLimits = new Map();  // captured from provider response headers (Groq/DeepSeek)

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
        // Capture provider-reported limits if the provider attached them.
        if (rawResult && typeof rawResult === 'object' && rawResult._observedLimits) {
          observedLimits.set(key(userId, name), rawResult._observedLimits);
        }
        const parsed = typeof rawResult === 'string'
          ? parseProviderResponse(rawResult)
          : { ...DEFAULTS, ...rawResult };
        delete parsed._observedLimits;  // don't leak into caller's payload
        try {
          if (userId != null) usageApi.increment(userId, name);
          else usageApi.increment(name);
        } catch {}
        const br = getBreaker(userId, name);
        br.fails = 0;
        br.lastSuccessAt = Date.now();
        br.lastError = null;
        br.lastErrorAt = null;
        br.lastErrorMsg = null;
        log({ provider: name, mode: opts.mode, outcome: 'success', latency_ms: Date.now() - start, email_id: email.id, user_id: userId });
        return { ...parsed, _provider: name };
      } catch (err) {
        const outcome = classifyError(err);
        log({ provider: name, mode: opts.mode, outcome, latency_ms: Date.now() - start, email_id: email.id, user_id: userId, err: err.message });
        const br = getBreaker(userId, name);
        br.lastError = outcome;
        br.lastErrorAt = Date.now();
        br.lastErrorMsg = String(err.message || '').slice(0, 300);
        if (outcome === 'http_401') {
          // Session-disable: bad credentials won't fix themselves at runtime.
          br.openedAt = Date.now();
          br._sessionDisabled = true;
        } else if (outcome === 'http_429' || outcome === 'http_503') {
          // 429 = quota / rate-limit. 503 = provider-side "model busy / high
          // demand" — both are transient and shouldn't trip the breaker.
        } else {
          br.fails += 1;
          if (br.fails >= BREAKER_FAILS) { br.openedAt = Date.now(); br.fails = 0; }
        }
        continue;
      }
    }
    return null;
  }

  async function generateDraft(email, opts = {}) {
    const userId = opts.userId;
    const cfg = (getConfig && getConfig(userId)) || { order: [], enabled: [], keys: {}, models: {}, limits: {} };
    const enabledSet = new Set(cfg.enabled || []);
    const order = (cfg.order || []).filter(n => enabledSet.has(n) && byName.has(n));

    for (const name of order) {
      const provider = byName.get(name);
      const providerCfg = {
        apiKey: (cfg.keys || {})[name],
        model:  (cfg.models || {})[name] || provider.defaultModel,
        temperature: 0.4
      };

      if (breakerOpen(userId, name)) {
        log({ provider: name, mode: 'draft', outcome: 'skipped_breaker', email_id: email.id, user_id: userId });
        continue;
      }

      const cfgLim = cfg.limits && cfg.limits[name];
      const effectiveRpd = (cfgLim && typeof cfgLim.rpd === 'number' && cfgLim.rpd > 0) ? cfgLim.rpd : provider.limits.rpd;
      if (Number.isFinite(effectiveRpd)) {
        const count = userId != null ? usageApi.getCount(userId, name) : usageApi.getCount(name);
        if (count >= effectiveRpd) {
          log({ provider: name, mode: 'draft', outcome: 'skipped_quota', email_id: email.id, user_id: userId });
          continue;
        }
      }

      const maxWaitMs = 2000;
      const got = await getBucket(userId, provider).acquire(maxWaitMs);
      if (!got) {
        log({ provider: name, mode: 'draft', outcome: 'skipped_bucket', email_id: email.id, user_id: userId });
        continue;
      }

      const start = Date.now();
      try {
        const rawResult = await provider.call(email, opts, providerCfg);
        if (rawResult && typeof rawResult === 'object' && rawResult._observedLimits) {
          observedLimits.set(key(userId, name), rawResult._observedLimits);
        }
        const parsed = typeof rawResult === 'string'
          ? parseProviderResponse(rawResult)
          : { ...DEFAULTS, ...rawResult };
        delete parsed._observedLimits;
        try {
          if (userId != null) usageApi.increment(userId, name);
          else usageApi.increment(name);
        } catch {}
        const br = getBreaker(userId, name);
        br.fails = 0;
        br.lastSuccessAt = Date.now();
        br.lastError = null;
        br.lastErrorAt = null;
        br.lastErrorMsg = null;
        log({ provider: name, mode: 'draft', outcome: 'success', latency_ms: Date.now() - start, email_id: email.id, user_id: userId });
        return { draft_reply: parsed.draft_reply || null, _provider: name };
      } catch (err) {
        const outcome = classifyError(err);
        log({ provider: name, mode: 'draft', outcome, latency_ms: Date.now() - start, email_id: email.id, user_id: userId, err: err.message });
        const br = getBreaker(userId, name);
        br.lastError = outcome;
        br.lastErrorAt = Date.now();
        br.lastErrorMsg = String(err.message || '').slice(0, 300);
        if (outcome === 'http_401') {
          br.openedAt = Date.now();
          br._sessionDisabled = true;
        } else if (outcome === 'http_429' || outcome === 'http_503') {
          // transient — don't trip the breaker
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
    if (err.status === 503) return 'http_503';   // provider overloaded (transient)
    if (err.status >= 500) return 'http_5xx';    // genuine 500/502/504 — breaker-worthy
    if (err.name === 'AbortError') return 'timeout';
    if (/could not parse/i.test(err.message)) return 'invalid_json';
    return 'network';
  }

  // Snapshot per-user provider health for UI display.
  function getProviderHealth(userId) {
    const out = {};
    for (const [providerName] of byName) {
      const br = breakers.get(key(userId, providerName));
      if (!br) { out[providerName] = { status: 'unknown', last_error: null, last_error_at: null, last_success_at: null, last_error_msg: null }; continue; }
      let status = 'unknown';
      if (br._sessionDisabled) status = 'invalid_key';
      else if (br.openedAt && Date.now() - br.openedAt < 5 * 60 * 1000) status = 'breaker_open';
      else if (br.lastError === 'http_429') status = 'rate_limited';
      else if (br.lastError === 'http_503') status = 'service_busy';
      else if (br.lastError && br.lastErrorAt && (!br.lastSuccessAt || br.lastErrorAt > br.lastSuccessAt)) status = br.lastError;
      else if (br.lastSuccessAt) status = 'ok';
      out[providerName] = {
        status,
        last_error: br.lastError || null,
        last_error_at: br.lastErrorAt ? new Date(br.lastErrorAt).toISOString() : null,
        last_error_msg: br.lastErrorMsg || null,
        last_success_at: br.lastSuccessAt ? new Date(br.lastSuccessAt).toISOString() : null
      };
    }
    return out;
  }

  function getObservedLimits(userId) {
    const out = {};
    for (const [providerName] of byName) {
      out[providerName] = observedLimits.get(key(userId, providerName)) || null;
    }
    return out;
  }

  // Public setter — called by the test endpoint which bypasses classify().
  function setObservedLimits(userId, providerName, limits) {
    if (limits && typeof limits === 'object') {
      observedLimits.set(key(userId, providerName), limits);
    }
  }

  return { classify, generateDraft, _byName: byName, getProviderHealth, getObservedLimits, setObservedLimits };
}

module.exports = { createRouter };
