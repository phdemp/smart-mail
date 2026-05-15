# Phase 3: User Correction Loop - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 3-user-correction-loop
**Areas discussed:** Correction affordance, Sender rule promotion, SSE + toast behavior, Summary thumbs

---

## Correction Affordance

| Option | Description | Selected |
|--------|-------------|----------|
| Extend the existing UI | Keep category picker panel, add SSE + toast + DB audit | ✓ |
| Build inline badge picker | Replace with compact picker on the badge itself | |
| Both — badge shows affordance, picker handles selection | Visual affordance on badge, existing picker panel for selection | |

**User's choice:** Extend the existing UI

---

| Option | Description | Selected |
|--------|-------------|----------|
| JavaScript setTimeout in email detail view | 3s timer adds CSS class to make affordance visible | ✓ |
| Skip the timer entirely for now | Show correction UI immediately | |
| You decide | Claude picks simplest implementation | |

**User's choice:** JavaScript setTimeout in email detail view

---

| Option | Description | Selected |
|--------|-------------|----------|
| Reload email detail with new category | SSE + HTMX re-fetch for live update | ✓ |
| Show 'correction confirmed' state, don't re-render | Static message, user navigates away and back | |
| You decide | Claude picks SSE approach | |

**User's choice:** Reload email detail with new category

---

## Sender Rule Promotion

| Option | Description | Selected |
|--------|-------------|----------|
| New sender_rules table | (id, user_id, domain, category, created_at) unique index on (user_id, domain, category) | ✓ |
| Extend account_config table | JSON blob in existing config | |
| You decide | Claude picks cleanest model | |

**User's choice:** New sender_rules table

---

| Option | Description | Selected |
|--------|-------------|----------|
| 2 corrections from same domain to same category | Exact CORRECT-05 match | ✓ |
| 2 corrections from same domain, any category | Risk of contradictory rules | |
| You decide | Claude interprets strictly | |

**User's choice:** 2 corrections from same domain to the same category

---

| Option | Description | Selected |
|--------|-------------|----------|
| Before regex rules (true Tier 1 override) | Short-circuit before any other classification | ✓ |
| After regex, before LLM | Regex still fires first | |
| You decide | Claude follows CORRECT-05 Tier 1 language | |

**User's choice:** Before regex rules

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fire silently — normal toast only | No separate 'rule created' notification | ✓ |
| Show distinct 'Rule created' toast on 2nd correction | Different message when threshold reached | |
| You decide | Claude picks simpler approach | |

**User's choice:** Fire silently — normal correction toast is the only signal

---

## SSE + Toast Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Server fetches from_address from emails table | Extends existing auth query | ✓ |
| Client passes sender domain in POST body | Simpler server, duplicates data | |
| You decide | Claude picks more correct approach | |

**User's choice:** Server fetches from emails table

---

| Option | Description | Selected |
|--------|-------------|----------|
| classification_updated with {email_id, category, source: 'user'} | Consistent with existing event naming | ✓ |
| category_corrected with full metadata | Richer but more verbose | |
| You decide | Claude picks minimal event | |

**User's choice:** classification_updated with {email_id, category, source: 'user', domain}
**Notes:** Domain added to payload so client can use it in toast message

---

| Option | Description | Selected |
|--------|-------------|----------|
| Client-side via SSE listener | showToast() called when SSE event received | ✓ |
| Server-side HTML fragment includes toast markup | HTMX trigger headers | |
| You decide | Claude follows showToast() pattern | |

**User's choice:** Client-side via SSE listener

---

## Summary Thumbs

| Option | Description | Selected |
|--------|-------------|----------|
| classifications.id | Summary belongs to classification row, no new ID column | ✓ |
| email_id | Use email as the summary unit | |
| You decide | Claude picks cleanest FK | |

**User's choice:** classifications.id

---

| Option | Description | Selected |
|--------|-------------|----------|
| Below the AI summary section, inline | Small 👍 👎 row below summary text | ✓ |
| Dedicated 'AI feedback' section at bottom of detail | Separate section for all AI feedback | |
| You decide | Claude places consistently with layout | |

**User's choice:** Below the AI summary section, inline

---

| Option | Description | Selected |
|--------|-------------|----------|
| Inline 'Thanks!' text replaces the thumbs | HTMX outerHTML swap, no toast, no re-generation | ✓ |
| Toast confirmation | Standard showToast() | |
| You decide | Claude picks lightweight response | |

**User's choice:** Inline 'Thanks!' text replaces thumbs, stored silently

---

## Claude's Discretion

- Exact HTMX trigger/swap attributes for live correction re-render
- Whether sender_rules check queries by exact domain or subdomains (strict match fine)
- vote TEXT CHECK(IN ('up','down')) constraint vs. application-level validation

## Deferred Ideas

- Correction-informed prompting (CORR-ADV-01) — needs 20+ corrections/category corpus; v2
- Category confusion matrix analytics (CORR-ADV-02) — v2
- Distinct "Rule created" toast on 2nd correction — deferred to Phase 5 UI polish if desired
