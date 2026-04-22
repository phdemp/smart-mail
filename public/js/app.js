// ── IntelliMail Frontend ──────────────────────────────────────────────────────
// Alpine.js components + SSE listener + toast system + utilities

// ─── Auth plumbing ──────────────────────────────────────────────────────────
// IMPORTANT: these listeners must attach SYNCHRONOUSLY at script-load time,
// before HTMX processes any hx-trigger="load" elements. This script is loaded
// in <head> after the htmx CDN, so body-level hx-trigger="load" XHRs are
// intercepted correctly. Listening on `document` works before `<body>` exists.
function authFetch(url, opts = {}) {
  const token = localStorage.getItem('intellimail_token');
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const promise = fetch(url, { ...opts, headers });
  promise.then(r => {
    if (r.status === 401 && !url.startsWith('/api/auth/')) {
      localStorage.removeItem('intellimail_token');
      location.href = '/login';
    }
  }).catch(() => {});
  return promise;
}

document.addEventListener('htmx:configRequest', (evt) => {
  const token = localStorage.getItem('intellimail_token');
  if (token) evt.detail.headers['Authorization'] = 'Bearer ' + token;
});
document.addEventListener('htmx:responseError', (evt) => {
  if (evt.detail && evt.detail.xhr && evt.detail.xhr.status === 401) {
    localStorage.removeItem('intellimail_token');
    location.href = '/login';
  }
});

// ── Confirm modal ─────────────────────────────────────────────────────────────
// A single Alpine component (mounted once per page at the bottom of <body>)
// exposes window.confirmModal(title, message, opts?) returning Promise<boolean>.
// opts: { confirmLabel?: string, danger?: boolean }
function confirmModalComponent() {
  return {
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    danger: false,
    _resolve: null,
    init() {
      window.confirmModal = (title, message, opts = {}) => new Promise(resolve => {
        this.title = title;
        this.message = message;
        this.confirmLabel = opts.confirmLabel || 'Confirm';
        this.danger = !!opts.danger;
        this._resolve = resolve;
        this.open = true;
      });
    },
    cancel() {
      this.open = false;
      if (this._resolve) { this._resolve(false); this._resolve = null; }
    },
    confirm() {
      this.open = false;
      if (this._resolve) { this._resolve(true); this._resolve = null; }
    }
  };
}

// ── Alpine: App State ─────────────────────────────────────────────────────────

function appState() {
  return {
    sidebarCollapsed: false,
    stats: {
      urgent: 0, total_unread: 0,
      meeting_request: 0, financial: 0, legal: 0, travel: 0,
      pitch_deck: 0, fyi: 0, rewards_awards: 0, other: 0
    },
    syncMode: 'connecting',
    lastSync: null,
    theme: localStorage.getItem('im_theme') || 'dark',
    llmStatus: null,        // { has_cloud_keys, has_groq, has_gemini, fallback_count, pending_classification_count }
    pendingClassifying: 0,  // live count of emails currently queued / being classified
    classifyTotal: 0,       // peak value seen since last drain — used to compute progress %
    get classifyPct() {
      return this.classifyTotal > 0
        ? Math.round(((this.classifyTotal - this.pendingClassifying) / this.classifyTotal) * 100)
        : 0;
    },

    init() {
      // Apply saved theme
      this.applyTheme(this.theme);

      // Fetch initial stats
      authFetch('/api/stats')
        .then(r => r.json())
        .then(data => { this.stats = data; })
        .catch(() => {});

      // Fetch current sync status
      authFetch('/api/sync/status')
        .then(r => r.json())
        .then(d => { this.syncMode = d.mode; this.lastSync = d.lastSync; })
        .catch(() => {});

      // Fetch LLM config status (drives the "configure AI providers" banner + classify pill)
      this.refreshLlmStatus();
      // Re-poll every 10s so the banner / pill stays current when a reclassify
      // runs in another tab or provider health changes.
      setInterval(() => this.refreshLlmStatus(), 10000);

      // Set up SSE
      this.connectSSE();
    },

    async refreshLlmStatus() {
      try {
        const r = await authFetch('/api/llm/status');
        if (!r.ok) return;
        const d = await r.json();
        this.llmStatus = d;
        const backendPending = d.pending_classification_count || 0;
        // Reconcile the live counter with the server's truth:
        //  - If server says 0 and our SSE-driven counter hasn't hit 0, trust server.
        //  - If server says N > current local counter, adopt it (another tab's
        //    reclassify job or a missed SSE event).
        if (backendPending === 0) {
          this.pendingClassifying = 0;
          this.classifyTotal = 0;
        } else if (backendPending > this.pendingClassifying) {
          this.pendingClassifying = backendPending;
          if (backendPending > this.classifyTotal) this.classifyTotal = backendPending;
        }
      } catch {}
    },

    applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('im_theme', this.theme);
      this.applyTheme(this.theme);
    },

    async logout() {
      const ok = await window.confirmModal(
        'Log out of IntelliMail?',
        'You\'ll need to sign in again. Your IMAP sync keeps running in the background so your next login shows a fresh inbox.',
        { confirmLabel: 'Log out', danger: true }
      );
      if (!ok) return;
      localStorage.removeItem('intellimail_token');
      window.location.href = '/login';
    },

    connectSSE() {
      const es = new EventSource('/api/sse');

      es.onopen = () => {
        // Refresh sync status on reconnect
        authFetch('/api/sync/status')
          .then(r => r.json())
          .then(d => { this.syncMode = d.mode; this.lastSync = d.lastSync; })
          .catch(() => {});
      };

      es.addEventListener('new_email', (e) => {
        try {
          const d = JSON.parse(e.data);
          showToast('info', `📬 ${d.from_name}: ${(d.subject || '').substring(0, 50)}`);
          const listPanel = document.querySelector('.email-list-panel');
          if (listPanel && window.htmx) {
            htmx.trigger(listPanel, 'categoryChange');
          }
          authFetch('/api/stats').then(r => r.json()).then(data => { this.stats = data; }).catch(() => {});
          // New email is unclassified → bump the "classifying" counter.
          this.pendingClassifying += 1;
          if (this.pendingClassifying > this.classifyTotal) this.classifyTotal = this.pendingClassifying;
        } catch(err) {}
      });

      es.addEventListener('sync_status', (e) => {
        try {
          const d = JSON.parse(e.data);
          this.syncMode = d.mode;
          this.lastSync = d.lastSync;
        } catch(err) {}
      });

      es.addEventListener('stats_update', (e) => {
        authFetch('/api/stats').then(r => r.json()).then(data => { this.stats = data; }).catch(() => {});
      });

      es.addEventListener('heartbeat', () => {
        // Connection alive
      });

      es.addEventListener('classification_done', (e) => {
        const data = JSON.parse(e.data);
        // Decrement the "currently classifying" counter.
        if (this.pendingClassifying > 0) this.pendingClassifying -= 1;
        if (this.pendingClassifying === 0) this.classifyTotal = 0;
        // Refresh the email list so the pending badge updates to the real category
        const listPanel = document.querySelector('[hx-get*="/api/emails"]');
        if (listPanel) htmx.trigger(listPanel, 'refresh');
      });


      es.onerror = () => {
        this.syncMode = 'disconnected';
        setTimeout(() => this.connectSSE(), 5000);
        es.close();
      };
    },

    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      // Add .collapsed class for CSS-driven visibility (brand, labels, etc.)
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
      // Transition grid column — sidebar fills its column, so both move together
      const shell = document.querySelector('.app-shell');
      if (shell) {
        shell.style.gridTemplateColumns = this.sidebarCollapsed
          ? '48px 380px 1fr'
          : '240px 380px 1fr';
      }
    }
  };
}

// ── Alpine: Draft Editor ──────────────────────────────────────────────────────

function draftEditor({ emailId, initialBody, initialTone, initialSource, toAddress, subject }) {
  return {
    emailId,
    draftBody: initialBody || '',
    tone: initialTone || 'professional',
    source: initialSource || null,   // 'template' | 'llm' | 'user' | null
    toAddress: toAddress || '',
    subject: subject || '',
    regenerating: false,
    sending: false,
    saveStatus: 'Saved',

    get wordCount() {
      return this.draftBody.trim().split(/\s+/).filter(Boolean).length;
    },

    init() {
      // Set up debounced save — uses lodash if available, else manual
      if (typeof _ !== 'undefined' && _.debounce) {
        this.debouncedSave = _.debounce(() => this.saveDraft(), 2000);
      } else {
        let timer;
        this.debouncedSave = () => {
          clearTimeout(timer);
          timer = setTimeout(() => this.saveDraft(), 2000);
        };
      }
      // Auto-upgrade on first open: if the stored draft is empty OR was a
      // template fallback, try the router now. User-edited drafts (source='user')
      // and known-LLM drafts (source='llm') are left alone.
      const needsRegen = !this.draftBody || !this.draftBody.trim() || this.source === 'template';
      if (needsRegen) {
        this.tone = this.tone || 'professional';
        this.regenerateDraft();
      }
    },

    debouncedSave() {
      // Will be replaced in init() — fallback
      this.saveDraft();
    },

    async saveDraft() {
      this.saveStatus = 'Saving...';
      try {
        await authFetch(`/api/emails/${this.emailId}/draft/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: this.draftBody,
            tone: this.tone,
            subject: this.subject,
            to_address: this.toAddress
          })
        });
        // User-triggered save → server stores source='user'.
        // Reflect locally so the editor doesn't auto-upgrade on next mount.
        this.source = 'user';
        this.saveStatus = 'Saved';
      } catch(e) {
        this.saveStatus = 'Save failed';
      }
    },

    async changeTone(newTone) {
      this.tone = newTone;
      await this.regenerateDraft();
    },

    async regenerateDraft() {
      this.regenerating = true;
      this.saveStatus = 'Regenerating...';
      try {
        const res = await authFetch(`/api/emails/${this.emailId}/draft/regen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tone: this.tone })
        });
        if (res.ok) {
          const data = await res.json();
          this.draftBody = data.draft_reply || '';
          // Track provenance so next mount doesn't auto-regen again.
          this.source = data.source === 'template' ? 'template' : 'llm';
          if (data.warning) {
            this.saveStatus = 'Regenerated (template)';
            showToast('warning', '⚠ ' + data.warning);
          } else {
            this.saveStatus = 'Regenerated';
            showToast('success', '↻ Draft regenerated (' + (data.source || 'llm') + ')');
          }
        } else {
          const err = await res.json().catch(() => ({}));
          showToast('error', '❌ Regen failed: ' + (err.error || 'Unknown error'));
          this.saveStatus = 'Regen failed';
        }
      } catch(e) {
        showToast('error', '❌ Network error during regen');
        this.saveStatus = 'Error';
      } finally {
        this.regenerating = false;
      }
    },

    async sendDraft() {
      if (!this.toAddress) {
        showToast('error', '❌ No recipient address');
        return;
      }
      this.sending = true;
      try {
        const res = await authFetch(`/api/emails/${this.emailId}/draft/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: this.draftBody,
            tone: this.tone,
            subject: this.subject,
            to_address: this.toAddress
          })
        });
        if (res.ok) {
          showToast('success', '✅ Email sent successfully');
          this.saveStatus = 'Sent';
        } else {
          const err = await res.json();
          showToast('error', '❌ Send failed — ' + (err.error || 'check SMTP settings'));
        }
      } catch(e) {
        showToast('error', '❌ Send failed — network error');
      } finally {
        this.sending = false;
      }
    }
  };
}

// ── Toast System ──────────────────────────────────────────────────────────────

function showToast(type, message, duration = 4000) {
  const colors = {
    success: 'var(--accent-green)',
    error:   'var(--accent-red)',
    warning: 'var(--accent-amber)',
    info:    'var(--accent-cyan)'
  };
  const bg = {
    success: 'rgba(16,185,129,0.1)',
    error:   'rgba(239,68,68,0.1)',
    warning: 'rgba(245,158,11,0.1)',
    info:    'rgba(0,212,255,0.1)'
  };

  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = `
    background: var(--bg-raised);
    border: 1px solid ${colors[type] || colors.info};
    color: var(--text-primary);
    pointer-events: auto;
  `;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toast-in 300ms reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Utility Functions ─────────────────────────────────────────────────────────

function smartTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD === 1) return 'Yesterday';
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function avatarColor(name) {
  const colors = [
    '#3b82f6','#10b981','#f59e0b','#ef4444','#a78bfa',
    '#f97316','#06b6d4','#84cc16','#ec4899','#6366f1'
  ];
  let hash = 0;
  const str = name || '?';
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function categoryLabel(cat) {
  const map = {
    meeting_request: 'Meeting', financial: 'Financial', legal: 'Legal',
    travel: 'Travel', pitch_deck: 'Pitch', fyi: 'FYI',
    rewards_awards: 'Rewards', request: 'Request', other: 'Other'
  };
  return map[cat] || cat;
}

// ── HTMX config ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Configure HTMX to use JSON body for POST requests where applicable
  document.body.addEventListener('htmx:configRequest', (evt) => {
    // Ensure HTMX requests include the right headers
  });

  // Handle HTMX errors
  document.body.addEventListener('htmx:responseError', (evt) => {
    // 401 is handled by the auth plumbing (redirects to /login); don't show a toast
    if (evt.detail.xhr && evt.detail.xhr.status === 401) return;
    showToast('error', '❌ Request failed: ' + evt.detail.xhr.status);
  });
});
