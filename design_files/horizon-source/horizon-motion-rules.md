# Horizon Connect — Motion System v1.0

Addendum to the design system. Defines how motion behaves across the product. Same discipline as spacing and radius: small set of values, used consistently, never improvised.

---

## The two-axis vocabulary

Motion has exactly two dimensions in this system: **duration** (how long) and **easing** (how the speed curves over time). Three duration tokens, two easing tokens. Five total values. Everything composes from these.

### Duration

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | 150ms | Hover states, focus rings, button press, small colour/opacity changes |
| `--motion-base` | 200ms | Dropdowns, tooltips, accordions, tab switching, small slides |
| `--motion-slow` | 300ms | Modals, drawers, full-screen overlays, large content swaps |

Anything faster than 100ms feels jarring. Anything slower than 400ms feels sluggish. The premium-feel range is genuinely narrow.

### Easing

| Token | Curve | Use |
|---|---|---|
| `--motion-ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entering / appearing — decelerates as it arrives |
| `--motion-ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Exiting / disappearing — accelerates as it leaves |

**Default to ease-out.** ~80% of all transitions in the product use it. Reach for ease-in only when something is leaving the screen or being dismissed.

Do not introduce `linear`, `ease-in-out`, or the browser default `ease`. Each is almost always wrong:

- `linear` — feels mechanical, unnatural; appropriate only for indeterminate progress bars
- `ease-in-out` — feels lazy and slow; pulls the eye through the entire transition
- `ease` (browser default) — symmetric and characterless; the easing curve nobody chose

### Composed defaults

Pre-composed for convenience:

- `--transition-default` = `150ms ease-out` — the workhorse, applied globally to all interactive elements
- `--transition-base` = `200ms ease-out`
- `--transition-slow` = `300ms ease-out`

---

## The unbreakable motion rules

These extend the existing 21 rules. Same authority.

### Rule 22 — Every state change has a transition

State changes that snap (instant hover, instant active state, instant tab switch) are the giveaway of cheap-feeling UI. Every interactive element transitions between states. The global rule in `horizon-connect-tokens.css` handles this for buttons, links, inputs, and standard interactive roles automatically — don't override it without reason.

If a custom element has state changes (e.g., a custom toggle, a card that lifts on hover), it must also transition. Reference the duration and easing tokens; never hardcode values.

### Rule 23 — Three durations only, two easings only

Allowed motion values:

- Durations: `--motion-fast`, `--motion-base`, `--motion-slow`
- Easings: `--motion-ease-out`, `--motion-ease-in`

If a transition seems to need 250ms or 400ms, the answer is to pick the closer token (200ms or 300ms). The system is the right; tuned-by-feel values are how motion systems decay.

### Rule 24 — Match duration to motion distance

Larger motion needs more time for the eye to track. The token-to-distance mapping:

- **`--motion-fast` (150ms)** → property changes only (color, opacity, border, shadow). Element doesn't move.
- **`--motion-base` (200ms)** → small motion, ≤50px of travel (dropdowns expanding, tooltips appearing, accordion opening).
- **`--motion-slow` (300ms)** → large motion, 50px+ of travel (modals scaling in, drawers sliding across the screen, page-level content swaps).

Mismatched duration/distance is the most common motion mistake — a modal that opens in 150ms feels abrupt; a hover state that takes 300ms feels broken.

### Rule 25 — Reduced motion is non-negotiable

`@media (prefers-reduced-motion: reduce)` is honoured globally. The CSS file zeroes out all duration tokens and kills any non-token-referenced animations when the OS-level setting is enabled. Some users get migraines, vertigo, or seizures from motion — this is an accessibility requirement, not a preference. Do not override.

### Rule 26 — Motion does not earn brand differentiation

Motion tokens stay identical across Horizon Connect and Horizon Tours. Tours does not use longer or more elaborate timing to feel "warmer." The warmth comes from radius, spacing, and colour — not from making interactions slower. Slower interactions feel sluggish, not premium, regardless of brand.

The only brand-specific motion is in marketing-only patterns (hero panel reveals, scroll-triggered moments on horizontours.com). Those are scoped to marketing surfaces and don't enter the product motion system.

### Rule 27 — Defer page transitions, scroll animations, and decorative motion

Motion patterns in v1.0 are limited to UI state changes (hover, focus, modal open, dropdown open, etc.). Do not add page-level route transitions, scroll-triggered reveals, parallax effects, or decorative motion in v1.0. These rarely earn their place in B2B SaaS and almost always make the product feel slower, not more premium.

If a use case for these emerges later, add them deliberately as a v1.1+ extension with its own pattern definitions. Do not improvise.

---

## Standard motion patterns

The patterns below should be used consistently across the product. When you build a component that matches one of these patterns, use the pattern as defined. When you encounter a new use case not covered here, define a new pattern at the system level rather than inventing per-component.

### Hover state (any interactive element)

Background color, border color, or shadow transitions over `--motion-fast` with `--motion-ease-out`. Already handled by the global rule — no per-component code needed.

### Focus ring (keyboard navigation)

`box-shadow` transitions over `--motion-fast`. The focus ring (`--shadow-focus-ring`) appears smoothly rather than snapping. Already handled globally.

### Button press (active state)

On `:active`, scale to 0.98 + slight shadow reduction over `--motion-fast`. Provides tactile feedback that the click registered. Apply per button component:

```css
.btn:active { transform: scale(0.98); }
```

### Dropdown / popover / tooltip open

Translate down 4px + fade from 0 to 1 over `--motion-base` with `--motion-ease-out`. The directional slide gives the eye a hint about where the content came from.

### Modal / dialog open

Backdrop fades in over `--motion-base`. Modal scales from 0.95 to 1.0 + fades in over `--motion-slow` with `--motion-ease-out`. The slight scale gives the modal a sense of "arriving" rather than just appearing.

On close: reverse, but use `--motion-base` and `--motion-ease-in` (faster exit, accelerating curve).

### Drawer / side panel open

Translate from offscreen to in-place over `--motion-slow` with `--motion-ease-out`. On close, reverse over `--motion-base` with `--motion-ease-in`.

### Toast / notification appear

Translate in from screen edge (typically top-right) + fade in over `--motion-slow` with `--motion-ease-out`. On dismiss, fade out + translate 4px in dismissal direction over `--motion-base` with `--motion-ease-in`.

### Tab switch

Active state crossfades (background color, text color, border) over `--motion-fast`. Content panel may also fade swap, but only if content height is similar — fading between panels of very different heights causes layout jumps and looks worse than no transition.

### Accordion / disclosure expand

Height transitions over `--motion-base` with `--motion-ease-out`. CSS `height: auto` doesn't transition natively — use `grid-template-rows: 0fr` to `1fr` (modern), `max-height` (legacy), or a small JS helper. Pick one approach and use it consistently across all disclosure components.

### Loading skeleton

When data-fetching states are added in v1.1, skeletons pulse with `opacity` between 0.4 and 0.8 on a 1200ms loop with `ease-in-out` (the rare exception where ease-in-out is appropriate — symmetric breathing motion). Not in v1.0.

---

## What is forbidden

- **Tunable durations.** No `220ms`, `400ms`, `0.5s`. Use the tokens.
- **Tunable easings.** No `cubic-bezier(0.4, 0, 0.2, 1)` (Material's default — fine for them, not for us). No `ease-in-out`. Use the tokens.
- **Animations on `transition: all`.** Always specify the properties being animated; `all` causes performance issues and unintended transitions.
- **Animating `width`, `height`, `top`, `left`, `margin`, or `padding`.** These trigger layout. Use `transform` and `opacity` exclusively for performance reasons.
- **Decorative motion** without a clear UX purpose. If a motion can be removed without anyone noticing, it shouldn't have been added.
- **Sequential / staggered animations** in product UI. (Marketing surfaces are a separate conversation.) Multi-element coordinated animations make UI feel slow and theatrical. Everything transitions in parallel.
- **Bouncy / overshoot easing curves** (e.g., `cubic-bezier(0.34, 1.56, 0.64, 1)`). These are playful and inappropriate for a fintech-adjacent B2B product.

---

## Self-check additions

When redesigning a component or page, add to the existing self-check:

- All state transitions reference motion tokens (no hardcoded ms or easing): confirmed
- No `transition: all` used: confirmed
- Only `transform` and `opacity` animated (no width/height/margin transitions): confirmed
- `prefers-reduced-motion` not overridden: confirmed
- Any custom motion follows one of the patterns above (or is documented as a new pattern): list or "uses standard patterns only"

---

## Updating the prompt

The AI prompt should be updated to include these rules. Add this block to the "21 unbreakable rules" section, renaming it to "26 unbreakable rules":

> ### Rules 22–26 — motion behavior
>
> 22. **Every state change has a transition.** State changes that snap are the giveaway of cheap UI. Use the global default; don't override.
> 23. **Three durations, two easings.** `--motion-fast` / `-base` / `-slow` and `--motion-ease-out` / `-ease-in`. No improvised values.
> 24. **Match duration to motion distance.** Property changes → fast. Small slides → base. Large motion → slow.
> 25. **`prefers-reduced-motion` is non-negotiable.** Do not override the reduced-motion query.
> 26. **Motion does not earn brand differentiation.** Tours and Connect use identical motion tokens.
> 27. **Defer page transitions, scroll animations, decorative motion.** Not in v1.0.

And to the redesign self-check:

> **Motion:**
> - All state transitions reference tokens: confirmed
> - No `transition: all`: confirmed
> - Only `transform` and `opacity` animated: confirmed
> - Reduced-motion respected: confirmed
> - Custom patterns: list or "standard patterns only"

---

*Horizon Connect Motion System v1.0 — Last updated [date]. Compatible with Horizon Tours theme (motion tokens shared).*
