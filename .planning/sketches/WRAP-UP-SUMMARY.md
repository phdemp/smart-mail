# Sketch Wrap-Up Summary

**Date:** 2026-05-14
**Sketches processed:** 2
**Design areas:** Layout & Panels, Email Rows & Badges
**Skill output:** `./.claude/skills/sketch-findings-NeuralInbox/`

## Included Sketches

| # | Name | Winner | Design Area |
|---|------|--------|-------------|
| 001 | two-panel-depth | B — Floating Panels (both convex, 16px gap) | Layout & Panels |
| 002 | email-rows-badges | A — Convex Row Cards (pressed on select) | Email Rows & Badges |

## Excluded Sketches

None — both included in full.

## Design Direction

Neomorphism white (#f0f0f0 base, `6px 6px 12px #d1d1d1, -6px -6px 12px #ffffff` double shadow). Three floating convex panel cards for the app shell. Convex row cards in the inbox list. Concave inputs/reply areas. FAILED badge is convex (raised red pill). Generating… state uses disabled textarea at 0.45 opacity with pulse-dot label.

## Key Decisions

| Concern | Decision |
|---------|----------|
| App shell layout | Three floating convex panel cards (nav 200px + inbox 320px + detail 1fr), 16px grid gap |
| Panel depth | `box-shadow: 10px 10px 20px #cbcbcb, -10px -10px 20px #ffffff` (convex-lg) |
| Email rows | Convex card pills (`convex-sm`), lift on hover (`hover`), concave/pressed on select |
| Badge — informational | Flat tinted pills (rgba tint, colored text, no shadow) |
| Badge — FAILED | Convex raised red pill (`box-shadow: convex-sm; color: #e05050`) — signals action needed |
| Reply/compose area | Concave inset well inside the detail panel (`concave-sm`) |
| Generating… loading | Disabled textarea at 0.45 opacity + pulse-dot above label |
| Failed email detail | Concave `✗` icon + red heading + retry button + raw body at 0.6 opacity |
| Border radius | 20px (xl) for panels, 14px (lg) for rows/inputs, 9999px for badges/buttons |
| Typography | Syne (UI), IBM Plex Mono (badges), Literata (email body) — no new fonts |
