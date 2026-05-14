# Features Research — Email AI Quality

**Project:** IntelliMail AI Quality Milestone
**Researched:** 2026-05-14
**Scope:** Subsequent milestone — production users already exist; brownfield Node.js/Express + SQLite

---

## Table Stakes

Features users expect from an AI email client. Absence makes the product feel broken or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Correct category on first classification | Users lose trust immediately on a wrong tag they cannot fix | Low (prompt improvement) | Already exists; accuracy is the gap |
| One-click correction for wrong category | SaneBox, Superhuman both teach this pattern — move = retrain | Low (UI + DB write) | Currently missing entirely |
| Summary that names the action required | "What it is about, who is involved, what action is needed" — Shortwave's explicit design goal | Medium (prompt redesign) | Current summaries are generic; no action extraction |
| Thread-aware context for classification | Single-email context misfires on reply threads where intent is in a prior message | Medium (context assembly) | Listed as active requirement; confirmed by research |
| Failed classification visible to user | Silent LLM failures leave emails uncategorized with no indication why | Low (UI flag + DB column) | CONCERNS.md flags silent failures as architectural risk |
| Draft reply that references the thread | A draft ignoring prior messages reads as generic AI output | Medium (thread context injection) | Already exists but thread context not used |
| Category badge visible before opening | Core triage value — email scored before user opens it | Low (already exists) | Existing; must stay stable |

---

## Differentiators

Features that give IntelliMail a competitive edge if done well. Not universally expected yet.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Urgency reason shown inline | Users want to know *why* something is urgent, not just that it is | Low (show existing urgency_reason field) | urgency_reason already stored in DB; just not surfaced in UI |
| Correction stored and visible | User's correction persists — they can see "you told us this was Financial, not FYI" | Low-Medium (corrections table + indicator) | Signals the system listened; builds trust over time |
| Extracted data shown in action panel | PNR number, amount due, due date surfaced without opening email | Low (already extracted; UI display gap) | rulesExtractedData() produces this; UI not fully using it |
| Provider health indicator | Users can see which LLM provider handled their email, last error, circuit status | Medium (status endpoint + UI widget) | Active requirement; differentiates from black-box AI |
| Summary quality rating (thumbs up/down) | Explicit signal on whether summaries are useful; drives prompt iteration | Low (UI + DB write) | Superhuman used thumbs up/down for internal rollout validation |
| Draft tone selector before generating | User picks tone (brief, formal, warm) before AI generates — reduces "robotic" feel | Low-Medium (UI prompt param) | Research shows tone customization is the single biggest factor in draft quality |
| Classification confidence visible on hover | Color-coded badge (green/amber/red) with tooltip: "High confidence — matched financial sender pattern" | Medium (confidence field in LLM response) | Cognitive overload risk if always visible; hover pattern mitigates this |
| Thread summary with participant attribution | "Alice asked X, Bob confirmed Y" — not just a generic digest | Medium-High (structured thread parse) | Shortwave does this; it is what separates useful from generic |

---

## Anti-Features

Things that backfire, erode trust, or create more friction than they solve.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-archive or auto-delete based on AI category | 84% of users regret irreversible AI actions on email (research: AI-written emails get ignored; AI-deleted emails cause panic) | Archive suggestions only; require explicit user confirmation |
| Confidence scores always visible as numbers | Cognitive overload; users anchor on the number rather than the email | Show on hover only; use color + label not percentages |
| Classification that silently degrades | Trust collapses when a previously-reliable category starts misfiring with no explanation | Surface failure reason: "Classified by rules (LLM unavailable)" |
| Draft that pastes full thread as context | Drafts read as AI-written when they echo phrases back verbatim from the thread | Summarize thread before injecting; instruct LLM to respond naturally not quote back |
| Asking for feedback on every email | Feedback fatigue — Superhuman tested this and used "launch and learn" with thumbs up/down only on new features | Feedback only on corrections (user moves email) and explicit rating on summaries |
| Blocking UI on LLM classification | IMAP push delivers email; if classification blocks render, latency is user-visible | Render immediately with "Analyzing..." state; fill in AI data asynchronously |
| Aggressive re-classification on correction | Immediately re-running LLM on every correction creates spinning and surprises | Store correction, apply on next new email from same sender/pattern; never re-classify silently |
| Showing raw LLM output in summary | "Based on the email provided, this appears to be..." — users recognize boilerplate instantly | Strip meta-commentary in post-processing; only emit the substantive sentences |

---

## User Feedback Loop Patterns

Specific UX patterns that work, drawn from SaneBox, Superhuman, Shortwave, and Canary Mail research.

### Pattern 1: Drag/Move = Implicit Correction (SaneBox model)
The lowest-friction feedback: when a user moves an email from one category folder to another, that is a correction signal. No dialog, no confirmation. SaneBox recalibrates within 5-15 minutes and notices almost immediately for corrections back to inbox.

**For IntelliMail:** When a user re-categorizes an email via the action panel dropdown (or a planned "wrong category" button), store the correction in a `classification_corrections` table with `(user_id, email_id, original_category, corrected_category, timestamp)`. Apply to future emails from the same sender domain or sender address as a rule override.

### Pattern 2: Explicit One-Click Correction Button
Place a small "Wrong category?" or pencil icon on the category badge. One click opens a popover with the 8 categories; selecting one stores the correction and immediately updates the badge. No full-page navigation.

**Key detail from research:** The correction UI must be dismissible in one keystroke. Any multi-step correction flow will be abandoned.

### Pattern 3: Thumbs Up / Thumbs Down on Summaries (Superhuman model)
Superhuman used thumbs up/down to validate AI feature rollout before GA. For IntelliMail, add a tiny thumbs-up / thumbs-down to each summary card. Store rating in `ai_feedback` table. Use aggregate data to identify which email types produce bad summaries — feed that back into prompt iteration, not into individual email re-classification.

**Do not:** Use feedback to re-generate the summary immediately. Users find this surprising and it wastes tokens. Use it as a batch quality signal.

### Pattern 4: Correction Confirmation Toast
After a user corrects a category, show a toast: "Moved to Financial. We'll remember this for future emails from HDFC Bank." This closes the feedback loop — user knows the system heard them. Disappears in 3 seconds, no action required.

### Pattern 5: Sender-Based Rule Learning
When a correction is stored, check if 2+ corrections from the same sender domain exist. If so, promote to a local rule (stored in DB as `user_sender_rules`) that bypasses LLM and applies the correction automatically. Surface this to the user: "You've always moved noreply@hdfcbank.com to Financial — we've made that permanent."

---

## AI Transparency Patterns

How to show reasoning and build trust without creating cognitive overload.

### Pattern T1: Tier Attribution Badge
Every classified email shows which tier made the decision:
- "Rule match" (green dot) — fast, deterministic, user trusts it
- "AI classified" (blue dot) — LLM-derived, slightly less certain
- "Classification failed" (red dot) — fallback used, reason shown on hover

This is the single most requested transparency feature in AI systems (source: Google PAIR research). It costs very little to implement: a `classification_tier` column already exists implicitly in the classifier flow.

### Pattern T2: Urgency Reason on Hover
The `urgency_reason` field is already stored in the DB. Surface it as a tooltip on the urgency badge: hover over "Urgent" → "Legal matter flagged in subject line." No new data needed — purely a UI gap.

### Pattern T3: Classification Rationale in Summary (selective)
For high-stakes categories (legal, financial), append a single-sentence rationale to the summary: "Classified as Financial because sender matches HDFC Bank and subject contains 'Amount Due'." Only for rule-based decisions — LLM rationale is less reliable and risks hallucinated justifications.

### Pattern T4: Provider Attribution in Footer
In the email detail view, a small footer line: "AI by Groq · Llama 3.3 70B · 1.2s". Shows which provider handled this email. Low prominence but available for users who care. Doubles as debugging signal when quality drops.

### Pattern T5: Confidence Color Only (not numbers)
Research finding: showing confidence percentages creates anchoring bias (users trust 91% even when it is wrong). Color is safer:
- Green badge = rule match or high-signal LLM output
- Amber badge = LLM classified, moderate signals
- Red badge = fallback, low-signal, or classification failed

Tooltip on hover explains the color in plain language. Never show a raw percentage to end users.

### Pattern T6: Correction History Visible
In settings or email detail: "You corrected this from FYI to Meeting Request on 12 May." Gives users confidence their input was recorded. Requires minimal DB space and zero LLM calls.

---

## Complexity Notes

| Feature | Implementation Difficulty | Risk | Dependencies |
|---------|--------------------------|------|--------------|
| One-click correction button | Low — UI popover + one DB write | Low | Needs `classification_corrections` table |
| Correction toast with sender memory | Low-Medium — toast is trivial; sender rule promotion needs logic | Low | Sender rule table + classifier hook |
| Urgency reason tooltip | Low — data already in DB; purely UI | Very Low | None; urgency_reason already stored |
| Thread context assembly | Medium — must deduplicate quoted text, cap tokens, order chronologically | Medium — token cost increases per thread | Needs thread fetch from IMAP |
| Summary with action extraction | Medium — prompt redesign, structured output (JSON) | Low-Medium — LLM output validation needed | Prompt redesign + output parser |
| Draft tone selector | Low — add tone param to existing draft prompt | Low | Prompt update only |
| Provider health indicator in UI | Medium — status endpoint exists; needs real-time SSE or polling | Low | Existing circuit breaker state; needs UI widget |
| Thumbs up/down on summaries | Low — two buttons + `ai_feedback` table insert | Low | New table; no LLM calls |
| Classification confidence color | Medium — requires LLM to return confidence signal; rules are deterministic | Medium — LLM confidence calibration unreliable | Prompt update + new response field |
| Participant-attributed thread summary | High — thread parsing, deduplication, speaker attribution, structured output | High — brittle on messy threads | Full thread fetch + complex prompt |
| Sender-based auto-rule promotion | Medium — correction aggregation + rule storage + classifier integration | Medium — wrong promotions are hard to undo UX-wise | Corrections table + classifier hook |

---

## MVP Recommendation for This Milestone

**Ship first (high value, low complexity):**
1. One-click correction button with toast confirmation
2. Urgency reason tooltip (data already there)
3. Thread context passed to LLM for classification + draft
4. Draft tone selector (brief / formal / warm)
5. Tier attribution badge (Rule / AI / Failed)

**Ship second (medium complexity, meaningful quality lift):**
6. Summary redesigned for action extraction (what, who, action needed)
7. Thumbs up/down on summaries
8. Provider health indicator widget in settings
9. Correction stored with sender-rule promotion after 2+ corrections

**Defer (high complexity or uncertain ROI):**
- Participant-attributed thread summaries (high implementation risk for marginal gain over action-extraction summaries)
- Raw confidence percentages (research shows this backfires)
- Auto-archive suggestions based on AI category (irreversibility risk with real users)
