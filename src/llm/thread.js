'use strict';

const { db } = require('../db');

// D-04 / D-06: Token proxy = chars ÷ 4; 6000 chars ≈ 1500 tokens
const THREAD_BUDGET_CHARS  = 6000;
const THREAD_MAX_MESSAGES  = 5;
const THREAD_MSG_MAX_CHARS = 500;

/**
 * stripQuotedReplies(text) → string
 *
 * Removes quoted-reply boilerplate from an email body so that only the
 * original author's prose is passed to the LLM.
 *
 * Three patterns removed (D-07):
 *   1. Lines that start with '>'                    (quoted content)
 *   2. Lines matching /^On .{10,80} wrote:$/i       (attribution header)
 *   3. Lines matching /^-{3,} ?original message/i  (separator line)
 *
 * D-08 minimum threshold: if the stripped result is fewer than 100 chars
 * AND the original was longer, the original is returned unchanged (prevents
 * returning near-empty content when an email is almost entirely quoted text).
 */
function stripQuotedReplies(text) {
  if (!text) return '';
  const original = text;
  const lines    = text.split('\n');
  const filtered = lines.filter(line => {
    if (line.startsWith('>'))                          return false;
    if (/^On .{10,80} wrote:$/i.test(line))           return false;
    if (/^-{3,} ?original message/i.test(line))       return false;
    return true;
  });
  const stripped = filtered.join('\n').trim();

  // D-08: fall back to original when stripping removed nearly all content.
  // Fires when: the stripped result is < 100 chars AND the original was > 100
  // chars (i.e., the email was substantial but is now almost entirely stripped).
  // This prevents passing near-empty content to the LLM when the body is mostly
  // quoted text (e.g. an email that is 90%+ quoted replies).
  if (stripped.length < 100 && original.length > 100) return original;
  return stripped;
}

/**
 * buildThreadContext(priorMessages) → string | null
 *
 * Converts an array of prior email rows (from fetchThreadContext) into a
 * single string ready to be injected into an LLM prompt.
 *
 * Rules:
 *   - null / empty input  → returns null
 *   - At most THREAD_MAX_MESSAGES (5) messages included (newest preserved,
 *     oldest dropped when array is longer — .slice(-5))
 *   - Each message body stripped via stripQuotedReplies and capped at
 *     THREAD_MSG_MAX_CHARS (500) characters
 *   - Messages formatted oldest-first (input ordering preserved; caller is
 *     responsible for ORDER BY received_at ASC)
 *   - Budget enforcement: while total > THREAD_BUDGET_CHARS (6000) and more
 *     than 1 message remains, drop the oldest (shift) iteratively
 *   - Final hard cap: slice to THREAD_BUDGET_CHARS if single message is still
 *     too long
 */
function buildThreadContext(priorMessages) {
  if (!priorMessages || priorMessages.length === 0) return null;

  const msgs = priorMessages.slice(-THREAD_MAX_MESSAGES).map(msg => {
    const stripped = stripQuotedReplies(msg.body_text || '');
    const body     = stripped.slice(0, THREAD_MSG_MAX_CHARS);
    return `[From: ${msg.from_name || ''} <${msg.from_address || ''}>]\n[Subject: ${msg.subject || ''}]\n${body}`;
  });

  // D-06: drop oldest messages first when over the token budget
  while (msgs.length > 1 && msgs.join('\n\n').length > THREAD_BUDGET_CHARS) {
    msgs.shift();
  }

  let combined = msgs.join('\n\n');
  if (combined.length > THREAD_BUDGET_CHARS) combined = combined.slice(0, THREAD_BUDGET_CHARS);

  return combined;
}

/**
 * fetchThreadContext(userId, email) → email_row[]
 *
 * Returns an ordered array (oldest-first) of prior emails that belong to the
 * same thread as `email`, scoped strictly to `userId`.
 *
 * Two-path strategy (D-01 / D-02):
 *
 *   Path 1 — Header-based (D-01): If email.raw_headers contains valid JSON
 *     with 'in-reply-to' or 'references' values, look up stored emails by
 *     matching message_id. Returns immediately if any rows are found.
 *
 *   Path 2 — Subject-normalized fallback (D-02): Strip common prefixes
 *     (Re:, Fwd:, Fw:, etc.), lower-case the remainder, and match against
 *     other emails for the same user within the last 90 days.
 *
 * SECURITY: every SELECT includes AND user_id = ? — cross-user leakage is
 * prevented by a bind parameter, never by string interpolation (T-02-07).
 *
 * Returns [] on any error (silent fallback — never throws).
 */
function fetchThreadContext(userId, email) {
  try {
    // ── Path 1: header-based matching (D-01) ──────────────────────────────
    let headers = {};
    try {
      headers = JSON.parse(email.raw_headers || '{}');
    } catch (_) {
      headers = {};
    }

    const inReplyTo  = headers['in-reply-to']  || headers['In-Reply-To']  || '';
    const references = headers['references']    || headers['References']   || '';

    if (inReplyTo || references) {
      const refIds = [inReplyTo, ...references.split(/\s+/)]
        .map(s => s.trim())
        .filter(Boolean);

      if (refIds.length > 0) {
        const placeholders = refIds.map(() => '?').join(', ');
        const rows = db.prepare(
          `SELECT id, user_id, from_name, from_address, subject, body_text, received_at
             FROM emails
            WHERE user_id = ?
              AND message_id IN (${placeholders})
            ORDER BY received_at ASC
            LIMIT 5`
        ).all(userId, ...refIds);

        if (rows.length > 0) return rows;
      }
    }

    // ── Path 2: subject-normalized fallback (D-02) ────────────────────────
    const normalized = (email.subject || '')
      .replace(/^(re|fwd?|fw)\s*:?\s*/gi, '')
      .trim()
      .toLowerCase();

    if (!normalized) return [];

    return db.prepare(
      `SELECT id, user_id, from_name, from_address, subject, body_text, received_at
         FROM emails
        WHERE user_id = ?
          AND id != ?
          AND LOWER(TRIM(
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                  REPLACE(REPLACE(subject,'Re:',''),'RE:',''),'re:',''),
                  'Fwd:',''),'FWD:',''),'Fw:',''),'FW:','')
              )) = ?
          AND received_at >= datetime('now', '-90 days')
        ORDER BY received_at ASC
        LIMIT 5`
    ).all(userId, email.id, normalized);

  } catch (_) {
    return [];
  }
}

module.exports = { fetchThreadContext, buildThreadContext, stripQuotedReplies };
