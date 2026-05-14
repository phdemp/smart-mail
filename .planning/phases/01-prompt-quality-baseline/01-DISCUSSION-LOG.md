# Phase 1: Prompt Quality Baseline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 1-Prompt Quality Baseline
**Areas discussed:** Eval corpus format, Prompt split architecture, Boundary definitions format, JSON mode per provider

---

## Eval Corpus Format

| Option | Description | Selected |
|--------|-------------|----------|
| Export from live DB | Pull real emails from intellimail.db already with classifications | ✓ |
| Hand-craft synthetic emails | Write example emails for each category | |
| Mix: live DB + synthetic edge cases | Real emails for coverage, synthetic for hard boundaries | |

**User's choice:** Export from live DB

---

| Option | Description | Selected |
|--------|-------------|----------|
| Manual labeling by user | User reviews each email and sets ground-truth category | ✓ |
| Treat current classifications as ground truth | Use existing DB rows as labels | |
| LLM-as-judge labels them | Use Claude/GPT-4 to label the corpus | |

**User's choice:** Manual labeling by user

---

| Option | Description | Selected |
|--------|-------------|----------|
| Node.js script: scripts/eval-corpus.js | Run classifier against corpus, output accuracy % | ✓ |
| Manual comparison by hand | No script — eyeball the results | |
| Python eval script | Use Python with metrics library | |

**User's choice:** Node.js script

---

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal: id, subject, from, body_snippet, ground_truth_category | Lean schema, easy to maintain | ✓ |
| Full: adds urgency + notes fields | More useful for debugging, heavier to label | |
| Mirror DB schema | Same fields as emails table | |

**User's choice:** Minimal schema

---

## Prompt Split Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| buildDraftPrompt() in base.js + router.generateDraft() | Clean separation; two sibling functions | ✓ |
| Mode-based routing within classify() | Keep one function, use opts.mode | |
| New src/llm/draft.js module | Standalone module, duplicates cascade logic | |

**User's choice:** buildDraftPrompt() in base.js + router.generateDraft()

---

| Option | Description | Selected |
|--------|-------------|----------|
| On-demand: when user clicks Reply | Never during sync | ✓ |
| Lazy: triggered on first email open | Draft ready before user decides to reply | |
| Async background: queued after classification | Lower-priority background task | |

**User's choice:** On-demand on Reply click

---

| Option | Description | Selected |
|--------|-------------|----------|
| Email fields only (thread context in Phase 2) | Simple, no scope creep | ✓ |
| Full classification result + email fields | More LLM context | |
| Raw email only, no classification context | Clean separation | |

**User's choice:** Email fields only for Phase 1

---

| Option | Description | Selected |
|--------|-------------|----------|
| Placeholder row at classification, filled on Reply click | UI shows "Generating..." | ✓ |
| No draft row at classification; generated fresh each time | Simpler, changes current behavior | |
| Keep current: draft_reply stored at classification | Gradual migration, no token savings | |

**User's choice:** Placeholder row created at classification, filled on Reply click

---

## Boundary Definitions Format

| Option | Description | Selected |
|--------|-------------|----------|
| One-liner per category + disambiguation for 3 confused pairs | Tight, reasoning-rich | ✓ |
| Only disambiguation for confused pairs, no glossary | Minimal change | |
| Full glossary with examples for every category | Most explicit, more tokens | |

**User's choice:** One-liner per category + disambiguation rules

---

| Option | Description | Selected |
|--------|-------------|----------|
| End of SYSTEM_PROMPT, after rules section | Consistent with existing rules placement | ✓ |
| In user message, after email content | Closer to output generation | |
| Separate examples section in user message, before email | Stable system prompt, variable examples | |

**User's choice:** End of SYSTEM_PROMPT

---

| Option | Description | Selected |
|--------|-------------|----------|
| Subject + from + 1-line reasoning + correct category | Compact, reasoning-rich | ✓ |
| Full JSON output for each example | Demonstrates exact output format | |
| Subject line only + correct category | Minimal, no reasoning | |

**User's choice:** Subject + from + reasoning + category

---

## JSON Mode Per Provider

| Option | Description | Selected |
|--------|-------------|----------|
| Update each provider file individually | Simple, explicit, easy to test per provider | ✓ |
| Centralize in base.js with getRequestConfig() | Cleaner abstraction, adds indirection | |
| Config-driven: toggleable per provider | Flexible, adds DB complexity | |

**User's choice:** Update each provider file individually

---

| Option | Description | Selected |
|--------|-------------|----------|
| Basic json_object first, upgrade if parse errors occur | Works on all models | ✓ |
| Strict schema mode from the start | Token-level compliance, model-specific | |
| No change to Groq | Leave as-is | |

**User's choice:** Basic json_object first for Groq

---

| Option | Description | Selected |
|--------|-------------|----------|
| responseMimeType only | Simple, covers most parse errors | ✓ |
| Both responseMimeType + responseSchema | Strictest, more setup | |
| No change to Gemini | Leave as-is | |

**User's choice:** responseMimeType only for Gemini

---

## Claude's Discretion

- Body field truncation length for `buildDraftPrompt()` (research suggests 800–1000 chars)
- Exact wording of category one-liners in SYSTEM_PROMPT
- Whether `low_confidence` flag stored as DB column or only in router response

## Deferred Ideas

- Thread context for Call B draft prompt → Phase 2
- Per-provider prompt variants (lighter for Groq strict, more explicit for DeepSeek) → Phase 1 experiment only if parse errors motivate it
- Correction-informed prompting → needs Phase 3 correction corpus first
- Groq strict schema mode upgrade → defer until Phase 1 rollout parse error data
