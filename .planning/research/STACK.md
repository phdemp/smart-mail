# Stack Research — LLM Email Intelligence

**Project:** IntelliMail AI Quality Milestone
**Researched:** 2026-05-14
**Scope:** Prompt engineering, structured output, and context strategies for the existing 4-provider LLM cascade (NVIDIA NIM → Groq → Gemini → DeepSeek) on Node.js/Express/CommonJS

---

## Recommended Approaches

### 1. Task Decomposition: Split the Monolithic Prompt

**Current state:** One `buildPrompt()` call returns all seven fields at once (category, urgency, urgency_reason, summary, extracted_data, suggested_tone, draft_reply).

**Recommendation:** Keep classification + summary in one call; move draft_reply to a separate, dedicated call triggered only when the user opens or requests a draft.

**Rationale:** Research on multi-task prompting (MDPI Electronics, 2024) shows that classification-oriented tasks are resilient to combining a small number of well-defined structured outputs, but semantically generative tasks (draft reply) degrade quality of co-located classification tasks. The draft_reply field is also the most token-heavy output and consumes context budget that the classifier could use for thread history. CLAUDE.md itself states "One Claude API call per prompt — never ask Claude to do two things in one call" — the current template violates this for the draft case.

**Split:**
- **Call A (classification):** category, urgency, urgency_reason, summary, extracted_data, suggested_tone
- **Call B (draft, lazy):** draft_reply, generated only on demand with thread context

**Confidence:** HIGH — supported by task decomposition literature and the project's own CLAUDE.md directive.

---

### 2. Few-Shot Examples Over Zero-Shot for Category Boundaries

**Current state:** Zero-shot with rules listed in SYSTEM_PROMPT. The categories `fyi`, `rewards_awards`, and `other` are the most likely misclassification targets because their semantic boundaries overlap heavily.

**Recommendation:** Add one concrete few-shot example per ambiguous category boundary, embedded in the system prompt. Do NOT add examples for all eight categories — only the three boundary cases.

**Specific boundaries to cover:**
- `fyi` vs `other` (newsletters, automated digests, status updates)
- `rewards_awards` vs `fyi` (loyalty points emails that look like digests)
- `meeting_request` vs `other` (calendar notifications that aren't actual invites)

**Format:** Inline examples in the system prompt as labeled input→output pairs, not as separate chat turns. Chain both the email snippet and the expected JSON output.

**Why not all categories:** Cleanlab research on few-shot selection shows diminishing returns after 2–3 examples, and over-prompting with excessive examples paradoxically degrades performance in some models (arxiv 2509.13196). Focus examples on the ambiguous cases, not the obvious ones.

**Confidence:** HIGH — multiple converging sources; category-coverage selection is the recommended approach.

---

### 3. Structured Output: Use Provider-Native JSON Modes, Not Prompt-Only Enforcement

**Current state:** `extractJsonBlock()` handles three fallback parse paths (direct parse → code fence → brace extraction). This is necessary because the current prompt only instructs the model with natural language ("Respond with a single JSON object — and nothing else"), which is not enforced at the API level.

**Recommendation:** Enable provider-native structured output modes where available, keeping the fallback parser as a safety net for providers that don't support it.

**Per-provider guidance:**

| Provider | Mode | How |
|---|---|---|
| Groq | `response_format: { type: "json_object" }` | Works across all models. For `llama-3.3-70b` and `qwen-*` models, strict mode with a JSON schema is also available via `response_format: { type: "json_schema", json_schema: {...}, strict: true }` — guarantees schema compliance at token level |
| Gemini | `generationConfig: { responseMimeType: "application/json" }` + `responseSchema` | Available on Gemini 2.0+ models; native schema enforcement |
| NVIDIA NIM | OpenAI-compatible `response_format: { type: "json_object" }` | Supported; schema-level strict mode availability depends on the specific model deployed |
| DeepSeek | OpenAI-compatible `response_format: { type: "json_object" }` | Supported via OpenAI-shaped interface |

**Implementation approach:** Add `response_format` to each provider adapter's request construction, keyed off a capability flag in each provider module. Keep `extractJsonBlock()` as fallback — it handles the edge case where a provider ignores the format flag.

**Temperature:** Set to `0.0`–`0.1` for classification calls. Higher temperatures introduce format drift and category inconsistency. For draft_reply calls, `0.3`–`0.5` produces more natural text. Currently the codebase has no explicit temperature setting — this should be added.

**Confidence:** HIGH for Groq (official docs confirmed); MEDIUM for NVIDIA NIM and DeepSeek (OpenAI-compatible, schema enforcement varies by deployed model).

---

### 4. Thread Context: Selective Inclusion, Not Full Dump

**Current state:** `buildPrompt()` takes a single email object and slices `body_text` to 800 characters. There is no thread awareness — the classification sees only the triggering message.

**Recommendation:** Pass thread context in a structured, token-budgeted format — not a raw concatenation of all messages.

**Strategy:**
1. **Latest message first, full text up to 600 tokens.** The triggering message gets the most context budget.
2. **Previous messages: header + first 100 characters each, newest-first, up to 3 prior messages.** This gives the model enough to understand conversational context (who said what, topic continuity) without consuming budget on older boilerplate.
3. **Hard token budget for thread section: 400 tokens total** for prior context beyond the triggering message. Enforce by character truncation in `buildPrompt`.
4. **Thread role markers:** Label each message clearly:

```
--- LATEST MESSAGE ---
From: Alice <alice@example.com>
Subject: Re: Q3 Budget Review
[full body up to 600 tokens]

--- PRIOR CONTEXT (newest first) ---
[1] Bob <bob@example.com> — 2026-05-12: "Attached the revised numbers — let me know..."
[2] Alice <alice@example.com> — 2026-05-11: "Can you send the Q3 actuals before Friday?"
```

**Why not full thread:** Chroma's 2025 "context rot" research shows LLM output quality degrades measurably well before context window limits. A model's accuracy drops over 30% when key information sits in the middle of a long context. Cramming a 10-message thread into the prompt trades classification quality for false completeness.

**Why not just the latest message:** For reply classification (`reply-expected` detection), meeting requests in threads, and draft reply generation, single-message context produces systematically wrong urgency scores and misses the "who needs to act" signal.

**Confidence:** HIGH — context rot findings from Chroma research; selective context approach is well-established in context window management literature.

---

## Prompt Engineering Patterns

### For Category Classification

**Pattern: Constraint-first system prompt with explicit boundary definitions**

The current SYSTEM_PROMPT lists categories as an enum but does not define what distinguishes adjacent categories. Add a one-line definition per category immediately after the enum:

```
- meeting_request: calendar invites, Zoom/Teams/Meet links, scheduling requests
- financial: invoices, payment notices, bank statements, receipts, billing
- legal: contracts, NDAs, cease-and-desist, compliance notices — always urgent
- travel: booking confirmations, itineraries, check-in reminders
- pitch_deck: decks, proposals, sales outreach, partnership requests
- fyi: newsletters, digests, automated status reports, no-reply senders where no action is needed
- rewards_awards: loyalty points, miles, cashback, membership tier notifications
- other: everything else that does not clearly fit the above
```

**Pattern: Explicit fallback instruction**

Add: "When the email matches multiple categories, prefer the more specific one. When genuinely ambiguous, use 'other' rather than guessing."

This reduces overconfidence-driven misclassification. Research on LLM overconfidence (arxiv 2509.25498) shows models apply "interpretive overconfidence" — filling gaps with plausible-sounding but wrong answers. An explicit escape hatch ("use 'other'") reduces this.

**Pattern: Urgency as a derived field, not an independent judgment**

Replace the current free-form urgency judgment with a deterministic instruction:
- Legal → always "urgent" (already in code, but should also be in prompt, not only in parseProviderResponse)
- Explicit deadline mentions → "urgent"
- Financial overdue/past-due language → "urgent"
- Everything else → "normal" unless strong time-pressure language

This reduces urgency inflation (models tend to mark things urgent when unsure).

---

### For Email Summarization

**Pattern: Structural constraint over length constraint**

Current: "one-line summary (max 120 chars)" — models frequently ignore character limits.

Replace with: "One sentence. State what happened and what action (if any) is needed. Do not repeat the subject line."

Structural constraints ("one sentence", "state what action is needed") produce more consistent outputs than character counts.

**Pattern: Abstractive with grounding instruction**

For summaries, instruct the model to stay grounded in the email text: "Summarize only what is stated in the email. Do not infer intent or add context not present in the text."

This reduces hallucination in summaries — a known failure mode where models elaborate beyond the source material.

**Pattern: Action-orientation**

Frame the summary field as answering "what does the recipient need to know or do?" rather than "what is this email about?" This produces more actionable summaries and aligns with the product's core value.

---

### For Draft Reply Generation (Separate Call)

**Pattern: CO-STAR framing for the draft call**

Structure the draft prompt with:
- **Context:** The thread summary (not the full thread — use the summary already generated in Call A)
- **Objective:** Generate a reply that [answers / acknowledges / declines / schedules]
- **Style:** Match the tone of the incoming email's formality level
- **Tone:** Use `suggested_tone` from Call A as the tone directive

This produces more contextually appropriate drafts than the current approach of appending a tone instruction at the end of the classification prompt.

**Pattern: Thread role clarity**

For draft generation, explicitly label who the recipient is and what they need to do: "You are drafting a reply on behalf of the recipient. The recipient received the email above and needs to [acknowledge / schedule / provide information / decline]."

Without this, models sometimes draft from the sender's perspective or generate non-reply text.

**Pattern: Length control via structural instruction**

"Write 2–4 sentences. Be direct. Do not include a subject line. Do not use placeholder text like [your name]."

Placeholder text in draft replies is a common LLM output failure that damages user trust.

---

### For Thread-Aware Context Passing

**Pattern: Newest-first ordering**

Always pass thread messages newest-first. Models have recency bias — content at the end of context is attended to more strongly. The most recent message (the one being classified) must come last (or be called out explicitly as "LATEST MESSAGE").

Wait — this conflicts with reading order. Resolve by leading with an explicit marker:

```
LATEST MESSAGE (classify this):
[triggering email]

PRIOR THREAD CONTEXT (for background only):
[older messages, summarized]
```

The explicit marker overrides position bias and tells the model which message is the classification target.

**Pattern: Progressive summarization for long threads**

For threads longer than 5 messages, pre-summarize the older segment in a lightweight step before the main classification call. A 50-token summary of messages 4–N is cheaper and more accurate than including all 4–N messages verbatim.

This is not worth implementing in Phase 1 — it adds pipeline complexity. Flag for later when thread depth data justifies it.

---

## Structured Output

### JSON Schema Definition

Define the classification schema explicitly and embed it in the system prompt. The current prompt uses a pseudo-schema with inline comments — replace with a clean definition:

```javascript
const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: CATEGORIES },
    urgency: { type: 'string', enum: URGENCIES },
    urgency_reason: { type: ['string', 'null'] },
    summary: { type: 'string', maxLength: 160 },
    extracted_data: { type: 'object' },
    suggested_tone: { type: 'string', enum: TONES }
  },
  required: ['category', 'urgency', 'urgency_reason', 'summary', 'extracted_data', 'suggested_tone'],
  additionalProperties: false
};
```

This schema is passed as `response_format.json_schema` on Groq strict mode and as `responseSchema` on Gemini. On providers that don't support native schema, include the schema as a formatted block in the system prompt to anchor the model's output structure.

### Validation Layer

Current `parseProviderResponse()` already does field-level validation with enum whitelisting — this is correct and should be kept regardless of native JSON mode. Do not remove the fallback validator.

Enhancement: Add a `confidence` field to the parsed output — not from the LLM (models cannot reliably self-assess confidence) but derived from validation: if the model's returned category was out of the enum (replaced by default), flag the classification as `low_confidence: true`. This enables the UI to show a "needs review" indicator without any LLM changes.

### Parse Error Handling

Current `extractJsonBlock()` has three fallback paths. Add a fourth: if all paths fail, log the raw response (truncated to 200 chars) at WARN level and return DEFAULTS with `error: 'parse_failure'`. This eliminates silent failures (a project requirement from PROJECT.md).

---

## What to Avoid

### Anti-Pattern: "You are an expert email classifier" persona framing

Current SYSTEM_PROMPT opens with "You are an email classifier for IntelliMail." The vague role is fine. Do NOT expand this to "You are an expert email categorization AI with deep knowledge of business communication."

Research (arxiv 2311.10054, EMNLP 2024 findings): expert persona prompts reliably degrade classification accuracy. They do not add knowledge — they bias the model toward over-confident, style-mimicking responses. For classification tasks specifically, plain task description outperforms expert persona.

**Confidence:** HIGH — multiple independent studies; Wharton and ACL sources confirm.

### Anti-Pattern: Asking the LLM to validate its own output

"Check your answer before returning" instructions in prompts. Research shows this increases token usage without meaningfully improving accuracy for structured classification tasks. Validation belongs in `parseProviderResponse()`, not in the model's output loop.

### Anti-Pattern: Full email body without truncation strategy

Current code truncates to 800 characters of `body_text`. This is reasonable but the truncation is naive (hard slice). Improve by: (1) strip HTML tags and quoted reply boilerplate (`>` prefixed lines) before slicing, (2) truncate at a sentence boundary where possible. Boilerplate in the first 800 characters — common in forwarded emails — wastes budget and confuses classification.

### Anti-Pattern: Identical prompts for all providers

The cascade's strength is provider diversity. Using identical prompt text across all four providers wastes this. Each model has different sensitivities. Minimum differentiation: Groq with schema enforcement needs only a light prompt; DeepSeek benefits from more explicit rules (it is more literal). Add a `promptVariant: 'default' | 'explicit'` flag per provider adapter — explicit variant repeats each rule as a separate line rather than a comma-separated list.

### Anti-Pattern: Generating draft replies in the classification call

Covered above in task decomposition, but restated as an explicit anti-pattern because it is the highest-impact current issue. The draft reply is 50–200 tokens of generative output inside a 7-field structured classification call. This inflates the call's total token cost on every single email, even for emails the user never opens. Move draft generation to a lazy, on-demand call.

### Anti-Pattern: High temperature for classification

Using default or unset temperature (providers default to 0.7–1.0). For classification calls, this introduces token-level randomness that causes the same email to be classified differently on retry. Set temperature explicitly to 0.0 or 0.1 for Call A. This is not set anywhere in the current codebase.

### Anti-Pattern: Stuffing full thread history without structure

Concatenating all prior messages as raw text creates a "wall of email" that triggers context rot. Structure matters more than completeness. A labeled, truncated thread summary outperforms an unlabeled full dump.

### Anti-Pattern: Chain-of-thought for simple classification

Adding "think step by step" or reasoning scratchpad instructions to classification prompts. The 2025 Wharton research shows CoT increases token usage 20–80% with marginal or negative accuracy gains on classification tasks, especially for models at the capability level of Groq/DeepSeek. Reserve CoT-style reasoning for edge cases only — not as a default strategy.

---

## Confidence Levels

| Recommendation | Confidence | Basis |
|---|---|---|
| Split classification from draft reply | HIGH | Multi-task degradation research (MDPI 2024) + CLAUDE.md directive |
| Few-shot for boundary categories only | HIGH | Cleanlab, PromptHub, arxiv few-shot research; diminishing returns after 3 examples |
| Provider-native JSON modes | HIGH (Groq), MEDIUM (others) | Groq official docs confirmed; others via OpenAI-compatible interface |
| Temperature 0.0–0.1 for classification | HIGH | Established practice, multiple engineering sources |
| Selective thread context (not full dump) | HIGH | Chroma context rot research (2025); middle-of-context accuracy degradation |
| Newest-first thread ordering with explicit marker | MEDIUM | Context position research; specific application to email is inferred |
| Structural summary constraints over char limits | MEDIUM | Promptlayer summarization guide; PromptLayer 2025 practitioner guide |
| Avoid expert persona prompting | HIGH | EMNLP 2024, arxiv 2311.10054, Wharton 2025 — three independent sources |
| Avoid CoT for classification | HIGH | Wharton 2025 tech report; confirmed for smaller/faster models |
| Category boundary definitions in prompt | MEDIUM | Standard prompt engineering practice; no email-specific study found |
| Per-provider prompt variants | LOW | Plausible from provider diversity rationale; no direct research found |
| Progressive summarization for long threads | LOW | Logical extension of context management literature; not validated for email |

---

## Sources

- [Groq Structured Outputs — Official Docs](https://console.groq.com/docs/structured-outputs)
- [A Practitioner's Guide to Prompt Engineering in 2025 — Maxim AI](https://www.getmaxim.ai/articles/a-practitioners-guide-to-prompt-engineering-in-2025/)
- [Context Rot: How Increasing Input Tokens Impacts LLM Performance — Chroma Research](https://research.trychroma.com/context-rot)
- [The Decreasing Value of Chain of Thought in Prompting — Wharton Generative AI Labs](https://gail.wharton.upenn.edu/research-and-insights/tech-report-chain-of-thought/)
- [When "A Helpful Assistant" Is Not Really Helpful: Personas in System Prompts — EMNLP 2024](https://aclanthology.org/2024.findings-emnlp.888.pdf)
- [Personas in System Prompts Do Not Improve Performances (arxiv 2311.10054)](https://arxiv.org/abs/2311.10054)
- [The Few-shot Dilemma: Over-prompting Large Language Models (arxiv 2509.13196)](https://arxiv.org/html/2509.13196v1)
- [Not Wrong, But Untrue: LLM Overconfidence in Document-Based Queries (arxiv 2509.25498)](https://arxiv.org/html/2509.25498v1)
- [Degradation of Multi-Task Prompting Across Six NLP Tasks — MDPI Electronics 2024](https://www.mdpi.com/2079-9292/14/21/4349)
- [Ensuring Reliable Few-Shot Prompt Selection — Cleanlab](https://cleanlab.ai/blog/learn/reliable-fewshot-prompts/)
- [Prompt Engineering Guide to Summarization — PromptLayer](https://blog.promptlayer.com/prompt-engineering-guide-to-summarization/)
- [Managing Context Window Strategies — Context Engineering](https://jtanruan.medium.com/context-engineering-in-llm-based-agents-d670d6b439bc)
- [JSON Output from OpenAI, Groq, Gemini, and Mistral — EdocGen](https://www.edocgen.com/blogs/ai-json)
- [LLM-based Smart Reply (LSR) — arxiv 2306.11980](https://arxiv.org/html/2306.11980v5)
