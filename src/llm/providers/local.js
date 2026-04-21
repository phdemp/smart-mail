const URL = 'http://localhost:8765/classify';

async function call(email, opts, cfg) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject:      email.subject      || '',
        from_address: email.from_address || '',
        from_name:    email.from_name    || '',
        preview:      (email.body_text   || '').slice(0, 400),
        email_id:     email.id != null ? String(email.id) : undefined
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Local API error: ${res.status} ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  name: 'local',
  defaultModel: 'ollama:intellimail-qwen',
  limits: { rpm: 120, rpd: Number.POSITIVE_INFINITY },
  call
};
