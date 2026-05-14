---
sketch: 001
name: two-panel-depth
question: "How should the two-panel layout (inbox list + email detail) establish depth hierarchy in neomorphism white?"
winner: "B"
tags: [layout, neomorphism, depth, inbox, two-panel]
---

# Sketch 001: Two-Panel Depth Hierarchy

## Design Question

In a neomorphism white UI (#f0f0f0 base), what is the correct spatial relationship between the inbox list panel and the email detail panel? Neomorphism's convex/concave language creates strong depth metaphors — this sketch tests three interpretations.

## How to View

```
open .planning/sketches/001-two-panel-depth/index.html
```

## Variants

- **A: Deep-Well (both concave)** — Both inbox and detail panels are recessed concave wells pressed into the #f0f0f0 surface. The background IS the app shell; panels are voids carved into it. Reply/compose area is a lighter inset within the concave detail.
- **B: Floating Panels (both convex)** — Both panels are raised cards floating above the background. The nav sidebar is also a raised card. Panels have spacing between them (gap). Reply area is a concave inset within the convex detail card.
- **C: Asymmetric (inbox concave / detail convex)** — Inbox list is a concave well (you're scrolling through content stored "below" the surface). Detail/reading panel is a convex elevated card (content is "brought forward" for reading). This creates a spatial narrative: select → content rises toward you.

## What to Look For

1. **Visual weight** — Does the layout feel balanced or does one panel dominate?
2. **Depth reading** — Can you immediately tell which panel is "primary" (detail) vs "secondary" (list)?
3. **Eye fatigue** — Neomorphism's double shadows can feel heavy at scale. Does any variant feel too dark/heavy after 30 seconds of looking?
4. **Reply area** — The "Generating draft…" loading state (disabled textarea + pulse dot) appears in the detail panel. Does it read clearly against each panel background?
5. **FAILED badge** — The red FAILED badge on the 5th email (Amazon AWS) should be clearly visible. Does it stand out enough in each variant?

## State Cycling

Click emails in the list to select them and see the detail update. Click "✦ Draft with AI" to trigger the 2-second "Generating draft…" loading state (disabled textarea + pulse animation).
