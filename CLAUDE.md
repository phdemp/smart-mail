# CLAUDE.md — AI-First Universal Email Client

## UI Design Findings

- **Sketch findings for NeuralInbox** (validated design decisions, CSS patterns, visual direction — neomorphism white theme) → `Skill("sketch-findings-NeuralInbox")`

## Mission
Build an AI-first email PWA. Email only — no contacts, tasks, notes, or calendar.
Every decision should ask: does this make AI feel native, not bolted on?

---

## Stack
| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS (mobile-first) |
| Deployment | Vercel (free tier) |
| Database | Supabase (Postgres) |
| AI / Agents | `@ax-llm/ax` (DSPy-style TypeScript framework) |
| AI Model | Claude Sonnet 4.6 (runtime) via Anthropic SDK |
| Embeddings | text-embedding-3-small (OpenAI) — 1536 dimensions |
| Testing | Vitest (unit/integration), Playwright (E2E), DeepEval (AI evals) |

---

## What We Are Building
A mobile-ready PWA email client that supports:
- **Gmail** — OAuth2 + Gmail API
- **Office 365** — MSAL + Microsoft Graph API
- **IMAP/SMTP** — imapflow library (Yahoo, AOL, any IMAP server)

### Core email features
- Unified inbox across all connected accounts
- Account switching
- Compose / Reply / Forward
- Search (hybrid: keyword + semantic)
- Labels, Archive, Delete
- Draft persistence

### AI-first features (default-on, never opt-in)
- **Smart prioritization** — every incoming email scored 1–5, tagged automatically
- **Thread summaries** — 2-sentence summary shown before reading, cached after first open
- **AI reply drafts** — full thread context passed to Claude, ready-to-edit draft on reply
- **Pre-send tone check** — hook runs before every send, flags aggressive or unclear tone
- **Label classification** — incoming emails auto-tagged: action-needed / fyi / newsletter / reply-expected

---

## Architecture

### Provider abstraction
All email access goes through `IEmailProvider` — never raw API calls from agents.

```
providers/
  gmail.ts          — GmailProvider implements IEmailProvider
  office365.ts      — Office365Provider implements IEmailProvider
  imap.ts           — ImapProvider implements IEmailProvider (Yahoo, AOL)
  registry.ts       — ProviderRegistry: holds all accounts, unified inbox merge
types/
  provider.ts       — IEmailProvider interface, EmailMessage, Address, Attachment
```

Key interface methods: `fetchMessages`, `fetchThread`, `sendMessage`, `saveDraft`,
`archiveMessage`, `deleteMessage`, `addLabel`, `removeLabel`, `search`, `watchInbox`

### Agent layer (Ax framework)
Agents communicate only via the Ax message bus — no direct imports between agents.
UI dispatches to bus — never imports agent modules directly.

```
agents/
  orchestrator.ts   — bootstrap, route tasks to sub-agents, manage session context
  inbox-agent.ts    — fetch, sync, paginate, archive, delete
  compose-agent.ts  — draft, reply, forward, send
  search-agent.ts   — hybrid BM25 + HNSW semantic search
  ai-agent.ts       — summarize, prioritize, draft replies (uses Ax signatures)
```

### Ax signatures (replace inline prompts)
```typescript
const summarize  = ax('emailThread:string -> summary:string, keyPoints:string[]')
const prioritize = ax('emailThread:string, senderHistory:string -> urgencyScore:number, tag:class "action-needed, fyi, newsletter, reply-expected"')
const draftReply = ax('emailThread:string, tone:string -> draft:string, subjectLine:string')
```

### AxFlow pipelines
Inbox load runs summarize + prioritize in parallel (auto-parallelism via AxFlow DAG).

### Skills
```
skills/
  email-parse.ts      — extract thread structure, headers, metadata
  ai-draft.ts         — call Claude to generate reply drafts
  label-classify.ts   — auto-tag incoming messages
```

### Hooks
```
hooks/
  pre-send.ts         — tone check + PII scan before every send
  on-receive.ts       — trigger AI prioritization + invalidate ai_cache for thread
  sync-complete.ts    — rebuild unified inbox state after full sync
```

### Plugins
```
plugins/
  label-classify.ts   — extensible label taxonomy
```

---

## Database (Supabase / Postgres)

### What is stored
| Table | Stores |
|---|---|
| `accounts` | Connected email accounts + encrypted OAuth tokens |
| `email_metadata` | id, threadId, subject, from, date, labels, snippet (200 chars), embedding |
| `ai_cache` | summaries, priority scores, tags, draft replies — keyed by threadId |
| `drafts` | locally saved drafts before sending |
| `user_preferences` | default account, AI features toggle |

### What is NEVER stored
- Full email body HTML/text — always fetched from provider on demand
- Attachments — streamed directly from provider
- Contact data — out of scope

### Search indexes
Three indexes on `email_metadata`:

**1. BM25 — GIN index (keyword relevance)**
```sql
create index idx_email_bm25 on email_metadata
using gin(to_tsvector('english',
  coalesce(subject,'') || ' ' || coalesce(snippet,'') || ' ' ||
  coalesce(from_name,'') || ' ' || coalesce(from_email,'')
));
```

**2. HNSW — pgvector (semantic search, default for all accounts)**
```sql
create index idx_email_hnsw on email_metadata
using hnsw (embedding vector_cosine_ops)
with (m = 16, ef_construction = 200);
```

**3. IVFFlat — pgvector (fallback for accounts with >100k emails)**
```sql
create index idx_email_ivfflat on email_metadata
using ivfflat (embedding vector_cosine_ops)
with (lists = 500);  -- tune: rows/1000 up to 1M rows, sqrt(rows) above
```

### Hybrid search (RRF)
Search combines BM25 + HNSW results using Reciprocal Rank Fusion (k=60).
Exposed as a Postgres function `hybrid_search(query_text, query_embedding, account_id)`.
Called from the search agent via `supabase.rpc('hybrid_search', {...})`.

### AI cache invalidation
- On new message in a thread → delete `ai_cache` row for that `thread_id`
- On prompt version bump → stale cache auto-regenerates on next access
- Track prompt version in `ai_cache.prompt_version`, constant in `lib/constants.ts`

---

## Testing Strategy (3 layers)

### Layer 1 — Vitest (unit + integration)
- Runs on every commit
- Every agent tested with a mocked `IEmailProvider`
- Every skill, hook, and provider adapter has unit tests
- Uses mocked Claude responses — no real API calls

```
__tests__/
  agents/         — inbox, compose, search, ai-agent tests
  providers/      — Gmail, O365, IMAP adapter tests (mocked API)
  hooks/          — pre-send, on-receive, sync-complete tests
  skills/         — email-parse, ai-draft, label-classify tests
```

### Layer 2 — Playwright (E2E browser)
- Runs on every commit against sandboxed test account
- Covers: login → inbox load → open thread → AI summary visible → compose → send
- Also covers: account switching, search, archive, delete, tone warning on send

### Layer 3 — DeepEval (AI quality evals — Python sidecar)
- Runs only on merge to main (costs real API tokens)
- Runner: `deepeval test run evals/test_agents.py`
- Evaluator LLM: `claude-sonnet-4-6` via Anthropic integration
- Metrics per feature:

| Feature | Metric | Threshold |
|---|---|---|
| Thread summarization | `FaithfulnessMetric` | ≥ 0.90 |
| Priority scoring | `AnswerRelevancyMetric` | ≥ 0.85 |
| Inbox agent task | `TaskCompletionMetric` | ≥ 0.80 |
| Compose agent tool use | `ToolCorrectnessMetric` | ≥ 0.85 |
| Pre-send tone check | `GEval` (custom criteria) | ≥ 0.85 |

```
evals/
  test_agents.py  — DeepEval pytest suite (all 5 metrics)
  fixtures.py     — ground truth dataset (20+ email scenarios)
```

CI order: `vitest run && playwright test && deepeval test run evals/test_agents.py`
DeepEval only runs on `main` branch push.

---

## Project Conventions

### File structure
```
agents/           — Ax-powered sub-agents
hooks/            — pre-send, on-receive, sync-complete
plugins/          — extensible plugins
prompts/          — all Claude prompt templates (versioned: summarize-v2.txt)
providers/        — IEmailProvider adapters
skills/           — reusable AI skill modules
specs/            — spec files written before code
types/            — shared TypeScript interfaces
evals/            — DeepEval Python eval suite
__tests__/        — Vitest unit/integration tests
e2e/              — Playwright E2E specs
supabase/
  migrations/     — SQL migration files
```

### Code rules
- File names: kebab-case
- Components: PascalCase
- No `any` except in test mocks — use `unknown` + type guard
- Agents communicate ONLY via Ax message bus — no direct imports between agents
- All Claude prompts live in `prompts/` — never inline in agent code
- One Claude API call per prompt — never ask Claude to do two things in one call
- Commits: `feat/fix/chore(scope): description`
- PR title must reference a spec file in `specs/`

### Spec-driven development
Write the spec file in `specs/` before writing any code.
Spec files define: inputs, outputs, edge cases, acceptance criteria.
Existing specs: `inbox.md`, `compose.md`, `ai-features.md`, `providers.md`

### What Claude Code must never do
- Add contacts, calendar, tasks, or notes features — email only
- Call email provider APIs outside of `providers/` adapters
- Write inline Claude prompts — always reference `prompts/`
- Merge a PR without all three test layers passing
- Store full email body or attachments in the database
- Use `any` type outside of test mocks
- Use IVFFlat for accounts with <100k emails — use HNSW

---

## Environment Variables
```
ANTHROPIC_API_KEY        — Claude API (agents + RAGAS evals)
OPENAI_API_KEY           — text-embedding-3-small for email embeddings
NEXT_PUBLIC_SUPABASE_URL — Supabase project URL
SUPABASE_SERVICE_KEY     — Supabase service role key (server only)
GOOGLE_CLIENT_ID         — Gmail OAuth2
GOOGLE_CLIENT_SECRET     — Gmail OAuth2
MICROSOFT_CLIENT_ID      — Office 365 MSAL
MICROSOFT_CLIENT_SECRET  — Office 365 MSAL
TEST_EMAIL               — Playwright E2E test account
TEST_PASSWORD            — Playwright E2E test account
```

---

## Key Dependencies
```json
{
  "@ax-llm/ax": "latest",
  "@anthropic-ai/sdk": "latest",
  "@supabase/supabase-js": "latest",
  "imapflow": "latest",
  "nodemailer": "latest",
  "openai": "latest",
  "next": "14",
  "tailwindcss": "latest"
}
```
Dev: `vitest`, `@playwright/test`, `tsx`
Python (evals): `deepeval`, `langchain-anthropic`

---

## Deployment
- Platform: Vercel (free tier)
- All env vars set in Vercel dashboard
- `vercel --prod` from Next.js root
- Supabase migrations run via `supabase db push` before deploy
- DeepEval evals run in GitHub Actions on push to `main`

---

## Claude Code Model Strategy

Three models in rotation. Each has a specific job.

### Model tiers (May 2026)

| Model | ID | SWE-bench | Cost (per 1M tokens) | Speed | Use for |
|---|---|---|---|---|---|
| Opus 4.7 | `claude-opus-4-7` | ~81% | $5 in / $25 out | Slow | Architecture, schema, prompt tuning |
| Sonnet 4.6 | `claude-sonnet-4-6` | 79.6% | $3 in / $15 out | Fast | Daily coding, agent impl, E2E tests |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | 73.3% | $1 in / $5 out | Fastest | Boilerplate, unit tests, file edits |

### Decision rule

```
Touching >3 files or making an irreversible decision?  → claude-opus-4-7
Repetitive pattern, boilerplate, simple edits?         → claude-haiku-4-5-20251001
Everything else (most sessions)?                       → claude-sonnet-4-6
```

### Per-agent model assignment

| Agent / Task | Model | Reason |
|---|---|---|
| **Orchestrator** — architecture decisions, cross-agent refactor | `claude-opus-4-7` (plan mode) | Highest-stakes, multi-file, irreversible |
| **Inbox agent** — fetchMessages, sync, unified inbox merge | `claude-sonnet-4-6` | Multi-file, well-scoped |
| **Compose agent** — reply threading, draft persistence, send | `claude-sonnet-4-6` | Moderate complexity |
| **Search agent** — TypeScript impl, embedding pipeline | `claude-sonnet-4-6` | Standard complexity |
| **Search agent** — hybrid RRF SQL function only | `claude-opus-4-7` | Complex SQL, run once |
| **AI Insights agent** — Ax signatures, agent wiring | `claude-sonnet-4-6` | Standard impl |
| **AI Insights agent** — prompt tuning when eval scores drop | `claude-opus-4-7` | Judgment-heavy |
| **Provider adapters** — OAuth2, MSAL, token refresh | `claude-sonnet-4-6` | Security-critical auth |
| **Provider adapters** — boilerplate methods (archive, label) | `claude-haiku-4-5-20251001` | Repetitive patterns |
| **Schema migrations** | `claude-opus-4-7` | Irreversible in production |
| **Vitest unit tests** | `claude-haiku-4-5-20251001` | Fast, repetitive, pattern-based |
| **Playwright E2E tests** | `claude-sonnet-4-6` | Needs full flow understanding |
| **DeepEval GEval metrics + fixtures** | `claude-opus-4-7` | Prompt quality judgment |

### How to switch mid-session

```bash
# Start every session (default)
claude --model claude-sonnet-4-6

# Hit a complex problem → switch up
/model claude-opus-4-7
# solve it, then immediately switch back
/model claude-sonnet-4-6

# Need to generate many similar files → switch down
/model claude-haiku-4-5-20251001
# generate boilerplate
/model claude-sonnet-4-6
```

### Runtime model (in Ax agents — production)

All four agents use `claude-sonnet-4-6` at runtime in production.
Opus is only used during development (Claude Code sessions) — never at runtime in the app.
Haiku is never used at runtime for this project — email AI quality requires Sonnet minimum.

```typescript
// lib/ai.ts — single source of truth for runtime model
export const CLAUDE_RUNTIME_MODEL  = 'claude-sonnet-4-6'   // all Ax agents
export const CLAUDE_EVAL_MODEL     = 'claude-sonnet-4-6'   // DeepEval evaluator
export const CURRENT_PROMPT_VERSION = 'v3'                  // bump when prompts change
```
