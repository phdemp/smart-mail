---
sketch: 002
name: email-rows-badges
question: "How do email rows, category badges (incl. FAILED), and the 'Generating…' draft state look in neomorphism?"
winner: "A"
tags: [email-rows, badges, loading-state, neomorphism, failed-badge]
---

# Sketch 002: Email Rows & Badge States

## Design Question

Using the Sketch 001 winner (floating panels, both convex), how should individual email rows within the inbox panel behave in neomorphism? Three treatments for row selection — and three treatments for the `.badge-failed` styling.

## How to View

```
open .planning/sketches/002-email-rows-badges/index.html
```

## Variants

- **A: Convex Row Cards** — Each email is a separate raised card (box-shadow: convex). Hover lifts further. Selected becomes concave/pressed. FAILED badge is also convex (raised red pill).
- **B: Flat Rows → Convex on Select** — Rows are flat with subtle dividers. The selected row pops out as a convex raised card (floats above its neighbors). Standard flat FAILED badge with border.
- **C: Concave Row Slots** — Each email is a concave pressed slot. Scrolling through them feels like slots in a card tray. FAILED badge is concave (pressed red pill).

## What to Look For

1. **Row density** — Variant A's cards have more spacing between rows. Does that feel spacious or wasteful at inbox scale?
2. **Selection clarity** — In each variant, can you immediately tell which email is selected?
3. **FAILED badge legibility** — The AWS email (row 5) has a FAILED badge. Is it visually distinct from the AI/RULE/FINANCIAL badges? Does it feel alarming enough to prompt action without being panic-inducing?
4. **Generating… state** — Click "✦ Draft with AI" on a normal email. Watch the textarea go disabled with the pulse-dot label. Does the loading state communicate clearly in each row variant's context?
5. **Failed email detail** — Use the toolbar's "FAILED email" button or click the AWS row. Observe how the detail panel communicates a failed classification.

## State Cycling

- Click any email row to see it selected and the detail updated
- Click "✦ Draft with AI" to trigger the 2.2-second generating state
- Use the toolbar buttons (Normal / Generating… / FAILED email) to preview all states simultaneously across all variants
