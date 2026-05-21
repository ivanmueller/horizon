# Horizon Connect — Responsive Rules (Amendment to Design System v1.1)

This document extends the core design system with rules for behavior across screen sizes. Add it to the AI prompt alongside the core brand kit. Treat the rules below as having the same authority as the original ten unbreakable rules.

---

## The breakpoint system

Five breakpoints, mobile-first. Default styles target mobile; media queries progressively enhance up.

| Token | Width | Real-world device | Primary context |
|---|---|---|---|
| (default) | 0–639px | Phones, portrait | Quick checks, on-the-go |
| `--bp-sm` | 640px+ | Large phones, small tablets | Tablet portrait |
| `--bp-md` | 768px+ | Tablets, small laptops | iPad at front desk |
| `--bp-lg` | 1024px+ | Laptops, tablets landscape | **Primary product target** |
| `--bp-xl` | 1280px+ | Desktops | Hotel back office |
| `--bp-2xl` | 1536px+ | Wide monitors, ultrawide | Marketing, executive viewing |

**Most product UI is designed at the `--bp-lg` to `--bp-xl` range, then adapted up and down.** Marketing surfaces are designed at `--bp-2xl` first.

---

## The eleven additional unbreakable rules

### Rule 11 — Mobile-first, always

Every component is built mobile-first. Default styles target the smallest screen (no media query). Larger screens use `@media (min-width: ...)` to add or modify styles. **Never the reverse** — never write desktop styles as defaults and use `max-width` queries to override them on mobile. Mobile-first is structurally simpler and produces better mobile experiences as a side effect.

### Rule 12 — Use breakpoint tokens, not raw pixel values

```css
/* ❌ Wrong */
@media (min-width: 1024px) { ... }

/* ✅ Right (CSS doesn't allow var() in media queries directly — use the value, but reference the token in comments) */
@media (min-width: 1024px) /* --bp-lg */ { ... }
```

If a custom property polyfill or PostCSS plugin is in use, prefer `@media (min-width: var(--bp-lg))`. Otherwise document the breakpoint token in a comment so changes can be made systematically.

### Rule 13 — Containers cap content width

No content spans the full width of the viewport. Every page has a `.container` (or equivalent) with a max-width. Defaults:

- Product UI: `--container-xl` (1280px max)
- Marketing pages: `--container-2xl` (1440px max)
- Long-form text (terms, privacy, blog posts): `--container-prose` (720px max)

Content slammed against the edge of a 27-inch monitor looks unprofessional. Capped, centred content with generous gutters looks intentional.

### Rule 14 — Use fluid type for headings, fixed for body

Headings (display, heading, subheading) use `clamp()` to scale fluidly between mobile and desktop. The tokens already handle this — just reference them, don't override.

Body text, captions, labels, and overlines stay at fixed sizes. Body text growing on large screens makes paragraphs comically wide; body text shrinking on small screens hurts readability. Both are wrong. Keep body fixed.

### Rule 15 — Spacing scales by context

Three spacing tokens are responsive — they automatically expand on larger screens:

- `--space-section` — gap between major page sections (32 → 80px across breakpoints)
- `--space-page` — page-level padding from edge (16 → 48px)
- `--space-card` — card internal padding (16 → 24px)

For these contexts, use the responsive tokens. For element-to-element spacing (gap between two buttons, padding inside an input), use the static tokens (`--space-sm`, `--space-md`, etc.) — they should not change across breakpoints.

### Rule 16 — Touch targets are sacred on mobile

Every interactive element on touch devices (any screen below `--bp-lg` AND `pointer: coarse`) must be **at least 44×44px**. This is non-negotiable — it's an accessibility requirement, not a preference. Small icon buttons that are 24×24 visually need an invisible 44×44 hit area via padding.

The CSS already enforces this globally via the touch target media query. Do not override it.

### Rule 17 — Layouts collapse predictably

The standard collapse patterns:

- **Multi-column grid**: use `auto-fit` with `minmax()` — the grid automatically reflows when columns can no longer fit. Don't write explicit breakpoint queries for grid column counts unless you need very specific behavior.
- **Sidebar + content**: sidebar collapses below the content (or hides into a drawer) below `--bp-lg`. Use the `.sidebar-layout` utility.
- **Multi-step forms**: become single-column on mobile. Steps stack vertically.
- **Wide tables**: become stacked cards on mobile. Use the `.responsive-table` pattern. **Never let a table scroll horizontally on mobile** — it's the worst UX pattern in the modern web.
- **Dashboard cards**: 4-column grid on desktop → 2-column on tablet → 1-column on mobile. Use `auto-fit` to handle this without explicit queries.

### Rule 18 — Navigation adapts, not just shrinks

Top navigation patterns by breakpoint:

- **Mobile (below `--bp-md`)**: hamburger menu, full-screen drawer when open. No horizontal nav links visible by default — they don't fit.
- **Tablet (`--bp-md` to `--bp-lg`)**: horizontal nav with primary items only, secondary items in a "More" dropdown.
- **Desktop (`--bp-lg`+)**: full horizontal nav, no compromises.

Sidebar navigation patterns:

- **Mobile**: sidebar is hidden behind a hamburger, slides in from left.
- **Tablet**: sidebar is collapsed to icons-only by default, expands on hover or via toggle.
- **Desktop**: sidebar is fully expanded with labels.

### Rule 19 — Hide sparingly, adapt preferentially

It's tempting to hide content on mobile to "make it fit." Resist. Hidden content that exists on desktop but disappears on mobile teaches users the platform is incomplete on phones. Better patterns:

- **Reduce fidelity, not content**: A chart with 12 metrics on desktop becomes a chart with 4 key metrics on mobile, with a "View all" link to the full version. The information is still accessible.
- **Stack instead of hide**: A 3-column comparison on desktop becomes a stacked 1-column list on mobile. All three items are still there.
- **Progressive disclosure**: Long forms become multi-step wizards on mobile, single-page on desktop. Same content, different rhythm.

Hide elements only when they're genuinely chrome (decorative dividers, secondary indicators) or when there's truly no equivalent. Use `.hide-below-md` and `.hide-from-lg` utility classes; document why in a comment.

### Rule 20 — Test at three sizes minimum

Every redesigned page must work at:

1. **375px** (iPhone SE / smallest modern phone — your hardest constraint)
2. **1024px** (laptop — your primary product target)
3. **1920px** (desktop monitor — most common modern desktop)

Optionally also test at 768px (tablet) and 2560px (wide monitor) for marketing pages. If a layout breaks at any of these widths, it's not done.

### Rule 21 — Wide screens get wider gutters, not wider content

Past `--bp-2xl` (1536px), do not let content keep expanding. The container width is capped; the additional screen real estate becomes gutter. This is the difference between a product that looks designed and one that looks like an unstyled webpage stretched to the screen.

For marketing pages, the exception is hero panels — full-bleed background with capped content inside. The background fills the screen; the content stays readable.

---

## How responsive enters the redesign workflow

When redesigning a page, the audit and approach steps now include responsive considerations:

### Audit additions

- Are there any hardcoded breakpoints (e.g., `@media (min-width: 1024px)` instead of token-referenced)?
- Does the page have a max-width container, or does content stretch to the viewport edge?
- Are touch targets ≥44×44px on mobile?
- Does the layout have a defined collapse strategy or does it just shrink?
- Are there hidden-on-mobile elements? Why?

### Approach additions

In one sentence, describe the responsive strategy:

- What's the desktop layout (typically `--bp-lg` to `--bp-xl`)?
- How does it adapt at tablet (`--bp-md`)?
- How does it collapse at mobile (below `--bp-sm`)?
- What's the navigation pattern at each size?

### Self-check additions

Append to the existing self-check:

- Tested mentally at 375px, 1024px, 1920px? Confirmed: yes/no
- All touch targets ≥44px on mobile? Confirmed: yes/no
- Container max-width applied? Confirmed: yes/no
- No horizontal scroll at any breakpoint? Confirmed: yes/no
- Hidden elements documented with reason? List or "none hidden"

---

## What's still not in v1.1

Deliberately omitted, for v1.2 if needed:

- **Print stylesheet** — most B2B SaaS doesn't need this; add when a customer asks
- **High-density (Retina) image rules** — handled at the asset level, not tokens
- **Reduced-motion preferences** — relevant once you add transitions/animations
- **Right-to-left language support** — relevant when you expand to Arabic/Hebrew markets

These don't matter for North American + European launch. Address when the use case forces the question.
