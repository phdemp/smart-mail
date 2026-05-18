# Phase 5: AI Output UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 05-ai-output-ui
**Areas discussed:** Tier badge & source mapping, Provider attribution approach, Draft UX, Extracted data in list row, Urgency tooltip design, low_confidence flag, Summary progressive disclosure

---

## Tier Badge & Source Mapping

| Option | Description | Selected |
|--------|-------------|----------|
| After category badge | Inline with existing badge row | ✓ |
| Before category badge | Tier dot leads the badge row | |
| Top-right of the row | Small corner dot like unread indicator | |

**fallback source mapping:**

| Option | Description | Selected |
|--------|-------------|----------|
| Treat as AI (blue dot) | Fallback is still an LLM pipeline result | ✓ |
| Treat as Failed (red dot) | Fallback may be less reliable | |
| Separate 'Fallback' badge | Amber dot, distinguishes from clean AI | |

**rules source inconsistency:**

| Option | Description | Selected |
|--------|-------------|----------|
| Normalize both to 'Rule' in display layer | No DB change, render treats rule=rules | ✓ |
| Fix source values in classifier.js | Always write 'rule', migrate old rows | |

**Notes:** Source values `rule` and `rules` are a classifier code smell; normalization happens in the rendering function only.

---

## Provider Attribution Approach

**Data source:**

| Option | Description | Selected |
|--------|-------------|----------|
| JOIN llm_logs at render time | No schema change; query latest success row for email_id | ✓ |
| Add columns to classifications | ALTER TABLE to add provider_name, latency_ms | |
| Skip provider attribution (defer UI-06) | Model name gap makes this partial anyway | |

**Model name handling:**

| Option | Description | Selected |
|--------|-------------|----------|
| Show provider only, skip model | "AI by Groq · 234ms" — accurate with available data | ✓ |
| Hard-code model per provider | Map provider → current default model | |
| Add model to llm_logs schema | ALTER TABLE + provider adapter changes | |

**Notes:** Model name is not stored anywhere. Footer format settled as "AI by [Provider] · [latency]ms". Model tracking deferred.

---

## Draft UX (UI-04 + UI-05)

**Draft trigger:**

| Option | Description | Selected |
|--------|-------------|----------|
| Existing Reply button | No new affordance; clicking reveals draft section | ✓ |
| New 'Generate AI draft' button | Separate from plain Reply, signals AI intent explicitly | |

**Draft reveal flow:**

| Option | Description | Selected |
|--------|-------------|----------|
| Tone picker → auto-generates on selection | One tap to get a draft | ✓ |
| Tone picker → 'Generate' button → draft | Two taps, explicit confirmation | |

**Tone labels:**

| Option | Description | Selected |
|--------|-------------|----------|
| Brief / Formal / Warm (per spec) | Aligns with ROADMAP UI-05; update existing draftEditor | ✓ |
| Keep existing Professional / Friendly / Formal / Brief | No code change to tone labels | |

**Plain compose option:**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — 'Write yourself' link below tone picker | Secondary link, skips AI, opens empty textarea | ✓ |
| No — Reply always goes through AI draft | Simpler flow, users can edit AI output | |

---

## Extracted Data in List Row

**What to show:**

| Option | Description | Selected |
|--------|-------------|----------|
| One key fact per relevant category | Travel: date. Financial: amount + date. Meeting: date + time. 3rd text line. | ✓ |
| All extracted fields as chips | Multiple chips inline after badges; row height grows | |
| Skip list row — detail only | Keeps rows compact; deviates from UI-03 | |

**Visual treatment:**

| Option | Description | Selected |
|--------|-------------|----------|
| Small text line in IBM Plex Mono | 11px, var(--text-muted), 3rd line below preview | ✓ |
| Inline chip after category badge | Compact pill, more horizontal crowding | |

**Sparse categories:**

| Option | Description | Selected |
|--------|-------------|----------|
| Only show data when there is data | Rows without extracted data unchanged | ✓ |
| Show fallback line for all categories | Consistent height but redundant for non-structured categories | |

---

## Urgency Tooltip Design

**Tooltip trigger:**

| Option | Description | Selected |
|--------|-------------|----------|
| CSS title attribute | Native browser tooltip via title='urgency_reason'. Zero JS. | ✓ |
| Custom Alpine tooltip | Styled neomorphism div on @mouseenter. Full control. | |
| HTMX tooltip panel | hx-get on hover. Heavy for data already on the page. | |

**Banner vs tooltip:**

| Option | Description | Selected |
|--------|-------------|----------|
| Keep both — banner for level, tooltip for reason | Additive; banner communicates severity, tooltip adds why | ✓ |
| Replace banner with badge + tooltip | Calmer but less prominent urgency signal | |
| Banner stays, urgency badge gets title attribute | Same as "keep both" framing | |

---

## low_confidence Flag

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — small indicator on AI tier badge | "AI ?" with amber ? suffix when low_confidence=1 | ✓ |
| Yes — subtle italic on category badge | Category label in italic when low_confidence | |
| No — skip in Phase 5 | Defer to analytics/admin phase | |

---

## Summary Progressive Disclosure

| Option | Description | Selected |
|--------|-------------|----------|
| No change needed — current behavior is correct | Summary already on email open; satisfies UI-07 | ✓ |
| Collapse behind 'Show summary' toggle | More progressive, but may reduce AI value | |
| Show 1-line summary in list row | Changes list row; different scope | |

**Notes:** Current behavior already satisfies UI-07. No implementation change needed for summary.

---

## Claude's Discretion

- Exact pixel values for tier badge dot size and gap (within 4-point scale)
- Which data field to prefer when travel has both PNR and departure date (prefer date, PNR as fallback)
- HTML element for "Write yourself →" link (ghost button pattern)

## Deferred Ideas

- Model name in attribution footer — `model_id` not stored; requires `llm_logs` schema + provider adapter changes
- `low_confidence` analytics view — category confusion matrix (CORR-ADV-02, v2 requirements)
- Extracted data completeness validation — verify `extracted_data` populated consistently before surfacing the panel
