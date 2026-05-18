---
status: partial
phase: 05-ai-output-ui
source: [05-VERIFICATION.md]
started: 2026-05-18T00:00:00Z
updated: 2026-05-18T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Progressive disclosure full flow
expected: List view shows no summary/draft content; detail view shows summary but no draft; clicking Reply reveals the draft section with tone picker
result: [pending]

### 2. Urgency tooltip
expected: Hovering the urgency badge (HIGH/CRITICAL) shows a native browser tooltip containing the urgency_reason text from the database
result: [pending]

### 3. Attribution footer conditionality
expected: Footer "AI by {Provider} · {N}ms" absent for rule-classified emails, present for llm/fallback-classified emails
result: [pending]

### 4. Neomorphic shadow visual quality
expected: Tier badges (Rule/AI/Failed) and tone chips appear convex/raised against the white neomorphic background per design spec
result: [pending]

### 5. Tone chip triggers immediate draft generation
expected: Clicking Brief, Formal, or Warm chip immediately fires POST /api/emails/:id/draft/regen with no separate Generate button; draft content appears in textarea
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
