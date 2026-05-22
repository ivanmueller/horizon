---
name: horizon-design
description: Use this skill to generate well-branded interfaces and assets for Horizon Connect (B2B hotel-to-operator commission tracking) or its sibling brand Horizon Tours (consumer booking). Includes design tokens, brand fonts, semantic CSS, logos, and React UI kits for the partner dashboard and marketing surfaces. Use for production code, prototypes, mocks, decks, or any throwaway HTML artifact that needs to look on-brand.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files. The structure is:

- `README.md` — voice, content fundamentals, visual foundations, iconography, do's and don'ts.
- `colors_and_type.css` — the **only required import**. Brings in Inter via local `fonts/`, JetBrains Mono via CDN, and the entire token system (colors, type, spacing, radius, shadow, motion).
- `horizon-source/` — the authoritative token files mirrored from the upstream repo. Read `horizon-connect-tokens.css`, `horizon-connect-brand-kit.md`, and `horizon-motion-rules.md` before any design decision; read the Tours overrides in `horizon-tours-tokens.css` if working on the Tours sibling.
- `assets/` — brand marks (Connect violet, Tours amber, wordmark).
- `preview/` — reference specimens for colors, type, spacing, components.
- `ui_kits/connect-dashboard/` — JSX components for the hotel partner dashboard.
- `ui_kits/connect-marketing/` — static HTML for the Connect B2B marketing page.
- `ui_kits/tours-marketing/` — static HTML for the Tours sibling brand sample.

## Before you touch a design

**Confirm which brand the surface belongs to:**

- **Horizon Connect** — hotel partner portal, admin dashboard, B2B marketing, sales/onboarding for hotels. Violet primary, cool neutrals, tight radius hierarchy (4/8/12/16).
- **Horizon Tours** — public booking site, trip detail pages, customer account, post-booking experience. Amber primary, warm neutrals, softer radius hierarchy (8/12/16/20).
- **Cross-brand** — legal pages, parent "About Horizon" pages. Use Connect tokens.

If unclear, ask before designing. The brand determines which token file loads.

## When generating an HTML artifact

1. **Always** link `colors_and_type.css` at the top of `<head>`. Don't restate tokens inline — reference `var(--token-name)`.
2. For Tours surfaces, after the base sheet, override with the Tours token block (see `ui_kits/tours-marketing/tours.css` for the pattern).
3. Copy the brand mark from `assets/` rather than redrawing it.
4. Use the **eight semantic type roles only** (display / heading / subheading / label / body / caption / overline / mono) at the two declared weights (400 / 500). No 600+, no italics in product chrome.
5. Snap every dimension to the 4 px grid (xs through 4xl). No improvised values.
6. **Pills are for status badges only.** Buttons use `radius-md`. Never round buttons to 999px.
7. Add `font-variant-numeric: tabular-nums` on any cell rendering money, transaction amounts, counts, or percentages.
8. Brand colour pixel coverage **≤ 5 %** on product UI. Aurora amber appears at **≤ 2 %**, reserved for premium-tier badges, payout-confirmed states, achievements.
9. Motion uses the three duration tokens + two easing tokens declared in `colors_and_type.css`. Never `linear`, `ease-in-out`, or `transition: all`. Animate only `transform` and `opacity`.

## When generating production code

Read `horizon-source/horizon-connect-brand-kit.md` and the upstream `CLAUDE.md` linked from the repo before writing anything. The 27 unbreakable rules apply. Output should:

- Reference semantic tokens, not primitive ramps.
- Follow the audit / approach / code / self-check format the upstream prompt expects.
- Keep `prefers-reduced-motion` intact.

## What's intentionally NOT in this skill

- No categorical chart palette (analytics charts).
- No illustration system for empty states / onboarding.
- No Söhne font (Inter is the open-source substitute; brand-supplied Inter variable ships in `fonts/`).
- No dark-mode polish beyond what the source tokens declare.

If the user invokes this skill without further guidance, ask them what brand, what surface, and what device context — then act as the design systems engineer described in the upstream `CLAUDE.md`.
