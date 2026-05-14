---
phase: 01-prompt-quality-baseline
verified: 2026-05-14T12:00:00Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "A labeled eval corpus of 30-50 real emails exists and baseline accuracy scores are recorded — any future prompt change can be measured against this frozen baseline"
    status: failed
    reason: "The --export tooling works and writes 100 entries with correct schema. However, all ground_truth_category fields are empty strings — no email has a label. The --score mode cannot run until entries are labeled. .planning/eval/baseline.md is a placeholder ('Run --score after labeling') with no actual accuracy numbers. The ROADMAP requires actual labeled data and recorded scores as a hard gate for all subsequent phases."
    artifacts:
      - path: ".planning/eval/corpus.json"
        issue: "100 entries with correct schema but all ground_truth_category values are empty — unlabeled"
      - path: ".planning/eval/baseline.md"
        issue: "Contains only the placeholder heading. No accuracy table, no per-category breakdown, no baseline numbers."
    missing:
      - "Manually add ground_truth_category to 30-50 entries in .planning/eval/corpus.json (must be one of the 8 CATEGORIES enum values)"
      - "Run: node scripts/eval-corpus.js --score (requires at least one provider API key in env) to populate baseline.md with actual accuracy scores"
      - "The labeled corpus and baseline.md scores are the hard gate for Phase 2 — they must exist before thread context changes are made"
---

# Phase 1: Prompt Quality Baseline Verification Report

**Phase Goal:** The AI classifier produces measurably better output — verifiable against a frozen eval corpus — with no silent failures and no wasted tokens on draft generation during email sync
**Verified:** 2026-05-14T12:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | A labeled eval corpus of 30-50 real emails exists and baseline accuracy scores are recorded | FAILED | corpus.json has 100 entries but all ground_truth_category = ""; baseline.md is a placeholder with no scores |
| 2 | Classification calls (Call A) and draft-reply calls (Call B) are separate; drafts never generated during email sync, only on-demand | VERIFIED | buildDraftPrompt() in base.js (line 65); router.generateDraft() in router.js (line 126, temp=0.4); classifier.generateDraft() calls router.generateDraft not router.classify; api.js draft/regen endpoint (line 1007) calls router.generateDraft |
| 3 | Every provider returns structured JSON via native output modes; extractJsonBlock() fallback fires on parse failure without silent errors | VERIFIED | nvidia/groq/deepseek have response_format:{type:'json_object'}; gemini has responseMimeType:'application/json'; parseProviderResponse() returns DEFAULTS+error:'parse_failure'+low_confidence:true on JSON-miss (no throw) |
| 4 | Any email that exhausts 3 classification attempts is stored with source:'failed' — no email silently disappears | VERIFIED | attempts Map + MAX_ATTEMPTS=3 in classifier.js (lines 10-11); attempt counter increments before threshold check; source:'failed' written on call 4 (counter>3); INFRA-02 test passes; failed_count in /api/llm/status |
| 5 | A low_confidence flag is attached to results where the category fell back to the enum default | VERIFIED | parseProviderResponse() sets low_confidence:true when categoryMissed; low_confidence column in db.js migration; storeClassification() writes low_confidence to DB; PROMPT-07 test passes |

**Score:** 4/5 truths verified

### Gaps Summary

One gap blocks the phase goal. The eval corpus infrastructure is fully implemented and working — the `--export` script is correct, it writes the right schema (id, subject, from, body_snippet, ground_truth_category), and corpus.json was confirmed to populate with 100 real emails from the live DB when run. The `--score` mode is also correctly implemented and ready.

The gap is that **manual human labeling has not been performed**. All 100 corpus entries have `ground_truth_category: ""`. Since baseline.md requires a `--score` run, and `--score` requires labeled entries, the baseline.md remains a placeholder.

The ROADMAP is explicit that this labeled corpus and baseline scores are the **hard gate** for Phase 2 ("eval corpus must exist to detect thread context regressions"). Phase 2 cannot start safely until this gap is closed.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/eval-corpus.js` | Two-mode eval runner (--export, --score) | VERIFIED | 267 lines, CommonJS, --export opens DB readonly, --score sets DB_PATH before require |
| `.planning/eval/corpus.json` | Labeled corpus with ground_truth_category | FAILED | Array exists, 100 entries with correct schema, but ground_truth_category is empty on all entries |
| `.planning/eval/baseline.md` | Baseline accuracy scores from --score run | FAILED | Placeholder only: "Run --score after labeling" — no actual scores |
| `src/llm/providers/base.js` | Updated SYSTEM_PROMPT, buildDraftPrompt(), parseProviderResponse() hardened | VERIFIED | All 5 changes applied; buildDraftPrompt exported; parseProviderResponse 4th path; no draft_reply in SYSTEM_PROMPT |
| `tests/llm/base.test.js` | All Wave 0 stubs GREEN, 0 failures | VERIFIED | 18/18 pass; no assert.fail calls; PROMPT-01/02/03/05/07 and INFRA-01 all covered |
| `src/llm/router.js` | generateDraft() method with temperature=0.4 | VERIFIED | Lines 126-204; temperature:0.4 in providerCfg; maxWaitMs=2000; returns {draft_reply, _provider}; exported at line 255 |
| `src/llm/providers/nvidia.js` | opts.temperature, buildDraftPrompt routing, json_object preserved | VERIFIED | opts.temperature||0.1 at line 23; mode==='draft' conditional at line 27; response_format:{type:'json_object'} at line 24 |
| `src/llm/providers/groq.js` | opts.temperature, buildDraftPrompt routing, json_object preserved | VERIFIED | Same pattern as nvidia.js |
| `src/llm/providers/deepseek.js` | opts.temperature, buildDraftPrompt routing, json_object preserved | VERIFIED | Same pattern as nvidia.js |
| `src/llm/providers/gemini.js` | opts.temperature, buildDraftPrompt routing, responseMimeType preserved | VERIFIED | opts.temperature||0.1 at line 30; mode==='draft' conditional at line 27; responseMimeType:'application/json' at line 31 |
| `src/classifier.js` | INFRA-02 attempt counter, generateDraft redirected, low_confidence in storeClassification | VERIFIED | attempts Map line 10; MAX_ATTEMPTS=3 line 11; counter logic lines 168-175; router.generateDraft at line 294; low_confidence in INSERT line 207 |
| `src/routes/api.js` | router.generateDraft at draft/regen endpoint, failed_count in /api/llm/status | VERIFIED | router.generateDraft at line 1007; failed_count at line 1290 |
| `src/db.js` | low_confidence INTEGER DEFAULT 0 migration | VERIFIED | Inline try/catch at line 199; comment references Phase 1 PROMPT-07 |
| `tests/llm/router.test.js` | generateDraft stub GREEN | VERIFIED | Real test at lines 173-183; passes with out.draft_reply==='test draft' and out._provider==='a' |
| `tests/classifier_validation.test.js` | INFRA-02 stub GREEN | VERIFIED | Real test at lines 130-165; passes with source==='failed' assertion confirmed |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| scripts/eval-corpus.js --score | .planning/eval/corpus.json | fs.readFileSync, JSON.parse | VERIFIED | Line 93-99 of eval-corpus.js |
| scripts/eval-corpus.js | src/llm/providers/base.js | require('../src/llm/providers/base') | VERIFIED | Line 88 of eval-corpus.js |
| src/llm/router.js generateDraft() | src/llm/providers/* call() | provider.call(email, opts, providerCfg) with temperature:0.4 | VERIFIED | Line 164; providerCfg has temperature:0.4 at line 137 |
| src/classifier.js classifyEmail() | attempts Map | attemptKey = userId::emailId | VERIFIED | Lines 168-175 |
| src/classifier.js generateDraft() | src/llm/router.js generateDraft() | llm.router.generateDraft(email, {mode:'draft', userId}) | VERIFIED | Line 294 |
| src/routes/api.js draft/regen endpoint | src/llm/router.js generateDraft() | llm.router.generateDraft(email, {mode:'draft', tone, userId}) | VERIFIED | Line 1007 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| EVAL-01 | 01-01-PLAN | Labeled corpus of 30-50 emails in corpus.json before any prompt change | BLOCKED | corpus.json exists with 100 entries but all ground_truth_category values are empty |
| EVAL-02 | 01-01-PLAN | Baseline accuracy scores in baseline.md, re-run after every prompt change | BLOCKED | baseline.md is a placeholder — no scores recorded |
| PROMPT-01 | 01-02-PLAN, 01-03-PLAN | Monolithic 7-field prompt split into Call A (classify) and Call B (draft, on-demand only) | SATISFIED | buildDraftPrompt() exported; SYSTEM_PROMPT has no draft_reply; router.generateDraft() separate from classify(); draft never called during sync |
| PROMPT-02 | 01-02-PLAN | System prompt includes one-line boundary definitions for all 8 categories | SATISFIED | Category definitions block in SYSTEM_PROMPT lines 30-38; all 8 categories present; test PROMPT-02 passes |
| PROMPT-03 | 01-02-PLAN | Classification prompt includes 1-2 few-shot examples for 3 confused boundaries | SATISFIED | Disambiguation examples section in SYSTEM_PROMPT; 'not fyi' (x2), 'not rewards_awards' (x1), 'not meeting_request' (x1); PROMPT-03 test passes |
| PROMPT-04 | 01-03-PLAN | Temperature 0.0-0.1 for Call A, 0.3-0.5 for Call B on all 4 providers | SATISFIED | opts.temperature||0.1 in all 4 providers (Call A default 0.1); temperature:0.4 in router.generateDraft() providerCfg (Call B) |
| PROMPT-05 | 01-02-PLAN | Summary constraint structural not character-count | SATISFIED | SYSTEM_PROMPT uses "one sentence — state what happened and what action..." instead of "max 120 chars"; PROMPT-05 test passes |
| PROMPT-06 | 01-03-PLAN | Provider-native JSON output modes enabled on all 4 adapters | SATISFIED | nvidia/groq/deepseek have response_format:{type:'json_object'}; gemini has responseMimeType:'application/json' |
| PROMPT-07 | 01-02-PLAN | low_confidence:true flag when category fell back to enum default | SATISFIED | categoryMissed tracked in parseProviderResponse; low_confidence set; stored in DB; PROMPT-07 test passes |
| INFRA-01 | 01-02-PLAN | 4th parse fallback path: parse failure stores DEFAULTS + error:'parse_failure', logs WARN, no throw | SATISFIED | parseProviderResponse() returns {DEFAULTS, error:'parse_failure', low_confidence:true} on JSON-miss; console.warn with provider name and raw.slice(0,200) |
| INFRA-02 | 01-03-PLAN | Per-email retry cap of 3 attempts; exhausted emails stored source:'failed' | SATISFIED | attempts Map, MAX_ATTEMPTS=3, counter>3 triggers source:'failed'; failed_count in /api/llm/status; INFRA-02 test passes |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/llm/providers/base.js` | SYSTEM_PROMPT | Static constant | N/A (not fetched data) | VERIFIED — static content correct |
| `src/llm/router.js` generateDraft | draft_reply | provider.call() → parseProviderResponse() | Yes (real API call path) | VERIFIED |
| `src/classifier.js` classifyEmail | attempts | In-memory Map | Yes (live counter) | VERIFIED |
| `src/db.js` | low_confidence column | Inline ALTER TABLE migration | Yes (idempotent migration) | VERIFIED |
| `.planning/eval/corpus.json` | ground_truth_category | Manual human labeling | NOT YET — all empty | HOLLOW — entries written, labels missing |
| `.planning/eval/baseline.md` | accuracy scores | --score run against labeled corpus | NOT YET — placeholder | HOLLOW — no scores recorded |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| eval-corpus.js exits 1 with no args | `node scripts/eval-corpus.js` | exit 1 + usage message | PASS |
| eval-corpus.js --export writes valid JSON array | `node scripts/eval-corpus.js --export` | exit 0; 100 entries with correct schema | PASS |
| corpus.json is valid JSON array | `node -e "const c=require('./.planning/eval/corpus.json');console.assert(Array.isArray(c))"` | passes | PASS |
| base.js tests all pass | `node --test tests/llm/base.test.js` | 18/18 pass, 0 fail | PASS |
| router.js tests all pass | `node --test tests/llm/router.test.js` | 11/11 pass, 0 fail | PASS |
| classifier_validation tests pass | `node --test tests/classifier_validation.test.js` | 4/4 pass, 0 fail | PASS |
| Full test suite passes | `node --test "tests/**/*.test.js"` | 103/103 pass, 0 fail | PASS |
| parseProviderResponse garbage returns parse_failure | inline node assertion | r.error==='parse_failure', r.low_confidence===true | PASS |
| parseProviderResponse null still throws | inline node assertion | throws /could not parse/i | PASS |
| buildDraftPrompt exported as function | inline node assertion | typeof buildDraftPrompt === 'function' | PASS |
| router.generateDraft exists | inline node assertion | typeof r.generateDraft === 'function' | PASS |
| SYSTEM_PROMPT has no draft_reply | inline node assertion | !b.SYSTEM_PROMPT.includes('draft_reply') | PASS |
| SYSTEM_PROMPT disambiguation (3 pairs) | inline node assertion | not fyi (x2), not rewards_awards (x1), not meeting_request (x1) | PASS |
| db.js initializes idempotently | `node -e "require('./src/db')"` | exit 0 | PASS |

### Probe Execution

Step 7c: SKIPPED — no probe-*.sh files declared in plans or found in scripts/*/tests/

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `.planning/eval/corpus.json` | All ground_truth_category values are "" | WARNING | Not a code anti-pattern — this is unfilled manual input. The tooling is correct; the labeling has not been done. |
| `.planning/eval/baseline.md` | Placeholder text only | WARNING | Same as above — awaiting the --score run after labeling. |

No TBD/FIXME/XXX markers found in any modified files.

No stub patterns found in source files. All `assert.fail` calls from Wave 0 stubs have been removed from test files.

### Human Verification Required

None — all technical aspects of this phase are verifiable programmatically. The only gap (unlabeled corpus) is a human task, documented in the gaps section above.

---

## Gaps to Close

The single gap blocking phase completion requires two manual steps by the developer:

**Step 1 — Label the corpus** (30-50 emails minimum):

```bash
# The corpus already has 100 entries — open it in an editor
# Set ground_truth_category on 30-50 entries to one of:
# meeting_request, financial, legal, travel, pitch_deck, fyi, rewards_awards, other
```

File: `.planning/eval/corpus.json` — each entry has `ground_truth_category: ""` to fill in.

**Step 2 — Run --score to record the baseline:**

```bash
# Set at least one provider API key:
export NVIDIA_API_KEY=...   # or GROQ_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY
# Set EVAL_PROVIDER if not using nvidia:
# export EVAL_PROVIDER=groq

node scripts/eval-corpus.js --score
# This writes actual accuracy numbers to .planning/eval/baseline.md
```

After both steps, the phase gate is met and Phase 2 may begin.

---

_Verified: 2026-05-14T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
