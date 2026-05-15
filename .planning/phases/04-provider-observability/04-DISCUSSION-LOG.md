# Phase 4: Provider Observability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 4-provider-observability
**Areas discussed:** Dashboard degraded pill, Settings health panel, Startup warmup delay, Soft-failure cascade

---

## Dashboard Degraded Pill

| Option | Description | Selected |
|--------|-------------|----------|
| Any non-ok provider | Show pill if even one provider is rate_limited, breaker_open, or invalid_key | ✓ |
| Primary provider only | Only show if NVIDIA (first in cascade) is non-ok | |
| All providers non-ok | Only show when every provider is unhealthy | |

**User's choice:** Any non-ok provider

| Option | Description | Selected |
|--------|-------------|----------|
| Top of email list, above inbox header | Same zone as SSE notifications | ✓ |
| Sticky banner below top nav | Always visible while scrolling | |
| Inline in stats bar | Low-key, next to category stats | |

**User's choice:** Top of email list, above inbox header

| Option | Description | Selected |
|--------|-------------|----------|
| Navigate to Settings > AI Providers | Direct link to health panel | ✓ |
| Expand inline tooltip | Shows degraded providers inline | |
| Informational only | No action on click | |

**User's choice:** Navigate to Settings > AI Providers

| Option | Description | Selected |
|--------|-------------|----------|
| 30 seconds via HTMX hx-trigger | Same cadence as Settings panel | ✓ |
| SSE-driven only | Updates only on classification events | |
| 60 seconds | Halves request rate | |

**User's choice:** 30 seconds via HTMX hx-trigger

---

## Settings Health Panel

| Option | Description | Selected |
|--------|-------------|----------|
| Grey dot + "No activity yet" | Neutral, honest about no data | ✓ |
| Hide the provider row entirely | Only show active providers | |
| Show as 'ok' (assume healthy) | Optimistic default | |

**User's choice:** Grey dot + "No activity yet"

| Option | Description | Selected |
|--------|-------------|----------|
| Show hint link to Settings | "Check your API key →" per invalid_key row | ✓ |
| Status only | No guidance, operator-focused | |
| Show last error message only | Raw error string instead of hint | |

**User's choice:** Show hint link to Settings

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — add failed_count | Already available from /api/llm/status logic | ✓ |
| No — keep panel focused on provider status | Avoid duplication with stats bar | |

**User's choice:** Yes — add failed_count to health panel

---

## Startup Warmup Delay

| Option | Description | Selected |
|--------|-------------|----------|
| Delay classifyAllUnclassifiedForUser() by 30s | Minimum-touch setTimeout in init() | ✓ |
| Hold entire classify queue including new arrivals | Global 'warming up' flag in classifier.js | |
| Skip entirely | 3-attempt cap is sufficient | |

**User's choice:** Delay classifyAllUnclassifiedForUser() by 30s after init()

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-coded 30s | Simple, matches ROADMAP spec | ✓ |
| Configurable via config | Fine-tunable without code changes | |

**User's choice:** Hard-coded 30s

---

## Soft-Failure Cascade

| Option | Description | Selected |
|--------|-------------|----------|
| Null/invalid category + empty summary | Category null OR not in enum OR summary empty | ✓ |
| Null category only | Only reject if category is null | |
| Any falsy field | Category, summary, urgency all checked | |

**User's choice:** Null/invalid category + empty summary (low_confidence is NOT a trigger)

| Option | Description | Selected |
|--------|-------------|----------|
| 'soft_fail' — new distinct outcome | Queryable, distinguishes from HTTP errors | ✓ |
| 'error' — reuse existing | Simpler, conflates HTTP and semantic failures | |
| Don't log | Reduces noise but loses observability | |

**User's choice:** 'soft_fail' — new distinct outcome value

| Option | Description | Selected |
|--------|-------------|----------|
| No — soft fails don't trip the breaker | Content issue ≠ availability issue | ✓ |
| Yes — treat same as HTTP error | Aggressive breaker behavior | |

**User's choice:** No — soft fails do not increment br.fails

---

## Claude's Discretion

- Color values for status dots (use existing badge CSS variables)
- Exact HTML structure of health panel table
- Error message truncation implementation (60 chars)
- Column order in health panel table
- Relative vs ISO timestamp display for last_success_at

## Deferred Ideas

- Per-provider soft-failure rate analytics (aggregating llm_logs by outcome='soft_fail')
- Email notification when all providers are simultaneously breaker_open
- Configurable startup warmup delay
