# Phase 1: Prompt Quality Baseline - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a labeled eval corpus from live production data, split the monolithic classification prompt from draft generation, add category boundary definitions and few-shot disambiguation examples, enable provider-native JSON output modes on all 4 providers, and add reliability infrastructure (parse fallback, retry cap). Every change is incremental and additive — no architecture changes, no new dependencies.

</domain>

<decisions>
## Implementation Decisions

### Eval Corpus

- **D-01:** Source emails from the live `intellimail.db` via a DB export script. Use real production emails — not synthetic ones — for the most realistic eval set.
- **D-02:** Ground-truth labels are set manually by the user. Do not use existing `classifications` rows as ground truth (they may themselves be wrong) and do not use LLM-as-judge labeling.
- **D-03:** Corpus schema is minimal: `{ id, subject, from, body_snippet, ground_truth_category }`. No urgency ground truth, no notes field in v1.
- **D-04:** Baseline scoring via a `scripts/eval-corpus.js` Node.js script. It runs each corpus email through the current classifier and compares the output category against `ground_truth_category`. Outputs category accuracy % to stdout. Must be run before and after every prompt change.
- **D-05:** Corpus file lives at `.planning/eval/corpus.json`. Baseline scores recorded in `.planning/eval/baseline.md`.

### Prompt Split

- **D-06:** Add `buildDraftPrompt(email, opts)` to `src/llm/providers/base.js` alongside the existing `buildPrompt()`. `buildPrompt()` is stripped of `draft_reply` — it becomes Call A (classification only). `buildDraftPrompt()` is Call B (draft only).
- **D-07:** Add `router.generateDraft(email, opts)` to `src/llm/router.js` alongside the existing `classify()`. `classifier.js generateDraft()` calls `router.generateDraft()` instead of `router.classify()` with `mode: 'regen'`.
- **D-08:** Draft generation is triggered on-demand: when the user clicks Reply. It is never triggered during email sync.
- **D-09:** Call B receives email fields only (subject, from, body_text). Thread context is Phase 2's addition — do not add it here.
- **D-10:** `storeClassification()` continues to create a placeholder draft row (`body = ''`, correct tone/subject/to_address). When user clicks Reply, the API calls `router.generateDraft()` and updates the row body. The UI shows a "Generating…" state while the call is in flight.

### Category Boundary Definitions

- **D-11:** Add one-line definitions for all 8 categories in `SYSTEM_PROMPT`, plus explicit disambiguation rules for the 3 most confused pairs: `fyi` vs `other`, `rewards_awards` vs `fyi`, `meeting_request` vs `other`.
- **D-12:** Few-shot examples go at the end of `SYSTEM_PROMPT`, after the rules section (not in the user message). 1–2 examples per confused pair, format: `Subject: X, From: Y → category (reason: Z)`.
- **D-13:** Example format: `Subject: [subject line], From: [sender] → [category] (not [confused_category]: [one-line reason])`. Compact and reasoning-rich.

### JSON Output Modes

- **D-14:** Update each provider file individually. No centralized abstraction in base.js.
- **D-15:** NVIDIA — already has `response_format: { type: 'json_object' }` and `temperature: 0.1`. No changes needed.
- **D-16:** Groq — add `response_format: { type: 'json_object' }` (basic mode first). Upgrade to strict schema only if parse errors are observed in production after rollout.
- **D-17:** Gemini — add `responseMimeType: 'application/json'` to `generationConfig`. No `responseSchema` in Phase 1.
- **D-18:** DeepSeek — add `response_format: { type: 'json_object' }` (OpenAI-compatible, same pattern as NVIDIA/Groq).

### Reliability Infrastructure

- **D-19:** `parseProviderResponse()` in base.js gets a 4th path: when `extractJsonBlock()` returns null, store DEFAULTS with `error: 'parse_failure'` and log at WARN with provider name and raw response excerpt (first 200 chars). No throw.
- **D-20:** Classification queue gets a per-email attempt counter. After 3 failed attempts (any combination of errors), store `source: 'failed'` and stop retrying. The UI treats `source: 'failed'` as "Classification failed" — visible state, not silent disappearance.

### Claude's Discretion

- Body field truncation length for `buildDraftPrompt()` (research suggests 800–1000 chars; match or slightly exceed `buildPrompt()`'s current 800-char limit)
- Exact wording of category one-liners in `SYSTEM_PROMPT` (keep concise, avoid verbose definitions)
- Whether `low_confidence: true` flag is stored as a column on `classifications` or only returned in the router response (REQUIREMENTS.md says attach to result; storage decision is Claude's call)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core source files (read before editing)
- `src/llm/providers/base.js` — SYSTEM_PROMPT, buildPrompt(), parseProviderResponse(), CATEGORIES, URGENCIES constants
- `src/llm/providers/nvidia.js` — reference implementation for JSON mode + temperature (already correct)
- `src/llm/providers/groq.js` — needs response_format added
- `src/llm/providers/gemini.js` — needs responseMimeType added
- `src/llm/providers/deepseek.js` — needs response_format added
- `src/llm/router.js` — createRouter() with classify(); needs generateDraft() added
- `src/classifier.js` — classifyEmail(), generateDraft(), storeClassification(); draft placeholder creation at line ~234
- `src/routes/api.js` — draft generation API endpoint; needs to call router.generateDraft()

### Planning docs
- `.planning/REQUIREMENTS.md` — 11 Phase 1 requirements (EVAL-01 through INFRA-02); MUST cover all of them
- `.planning/research/SUMMARY.md` — Phase 1 implementation guidance, pitfalls, and confidence levels
- `.planning/research/STACK.md` — Detailed prompt engineering research including temperature values, few-shot limits, JSON mode docs per provider

### Eval tooling
- `.planning/eval/` — directory to create; corpus.json and baseline.md live here

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseProviderResponse()` in base.js — already handles 3-tier JSON extraction; extend with the 4th DEFAULTS fallback path rather than replacing
- `buildPrompt()` in base.js — keep as Call A; add `buildDraftPrompt()` as a sibling function
- `extractJsonBlock()` in base.js — must be preserved as fallback; all providers fall through to it on non-JSON responses
- `generateDraft()` in classifier.js — already the right entry point; redirect it to `router.generateDraft()` instead of `router.classify()`
- `storeClassification()` in classifier.js — already creates a placeholder draft row at line ~234; keep this behavior but ensure `body = ''` is explicit
- `addColumn()` in db-migration.js — use this helper for any new columns on `classifications` (e.g., `low_confidence`)

### Established Patterns
- CommonJS modules: `require`/`module.exports` throughout — no ESM
- All DB ops via better-sqlite3 synchronous API
- `INSERT OR IGNORE` for idempotent classification writes
- Error outcome strings: `'http_429'`, `'http_401'`, `'http_503'`, `'timeout'`, `'network'`, `'invalid_json'` — add `'parse_failure'` to this set
- Test DB isolation: each test suite sets `DB_PATH` to a unique file; eval script should do the same if it touches the DB

### Integration Points
- `classify()` in router.js → called from `classifyEmail()` in classifier.js; new `generateDraft()` method added alongside
- Draft generation API route in `src/routes/api.js` — currently calls `classifier.generateDraft()`; this remains the right call path
- NVIDIA provider is the reference: copy its `response_format` + `temperature` pattern to the other 3 providers
- `SYSTEM_PROMPT` in base.js is the single source of truth for prompt text — all 4 providers import it; changes here affect all providers simultaneously

</code_context>

<specifics>
## Specific Ideas

- The eval script (`scripts/eval-corpus.js`) should output a human-readable accuracy report: category breakdown (how many correct per category, not just overall %) plus total. This makes it easy to spot which categories regressed after a prompt change.
- The `low_confidence` flag should be derived from `parseProviderResponse()` detecting that the category fell back to 'other' (the DEFAULTS value) because the parsed category wasn't in the CATEGORIES enum — not from any LLM self-assessment field.
- For the few-shot examples in SYSTEM_PROMPT, prioritize the fyi/other boundary — this is likely the most common misclassification for general business emails.

</specifics>

<deferred>
## Deferred Ideas

- Thread context for Call B (draft prompt) — Phase 2
- Per-provider prompt variants (lighter system prompt for Groq strict mode, more explicit rules for DeepSeek) — deferred; treat as Phase 1 experiment only if parse errors motivate it
- Correction-informed prompting — needs correction corpus from Phase 3 first
- Groq strict schema mode upgrade — deferred until parse error data from Phase 1 rollout

</deferred>

---

*Phase: 1-Prompt Quality Baseline*
*Context gathered: 2026-05-14*
