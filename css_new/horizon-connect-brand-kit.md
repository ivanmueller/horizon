# Horizon Connect — Brand Kit & Design System v1.0

The complete brand and design system for Horizon Connect. Three files, one source of truth:

- **`horizon-connect-tokens.json`** — design tokens for Figma (via Tokens Studio plugin)
- **`horizon-connect-tokens.css`** — CSS custom properties for the codebase
- **`horizon-connect-brand-kit.md`** — this file (human-readable reference)

---

## Quick start: importing into Figma

The fastest path is the **Tokens Studio for Figma** plugin. It's free and the de facto standard.

1. **Install Tokens Studio.** Open Figma → Resources → Plugins → search "Tokens Studio for Figma" → install.
2. **Open the plugin** in any Figma file: Plugins → Tokens Studio for Figma → run.
3. **Import the JSON.** In Tokens Studio, click the Settings icon → "Tools" → "Load from file/folder or preset" → select `horizon-connect-tokens.json`.
4. **Apply tokens to styles.** In Tokens Studio, click the three-dot menu next to any token set → "Create styles" (for colour and typography) and "Create variables" (Figma 2024+ supports both).
5. **Use them.** Your Figma colour, text, and effect styles now match the system. Update the JSON file once and re-import to propagate changes.

If your team uses **Figma's native variables** (Figma 2024+ without a plugin), you can also import the JSON via the "Variables Import" plugin — same source file, slightly different mapping.

---

## The architecture

The system is layered. You should know the difference, because mixing layers is how design systems decay.

### Primitives
Raw values. The 9-stop ramps for violet, neutral, success, warning, danger, info. Plus the three brand anchors (Horizon Violet, Marketing Vivid, Aurora). **Designers should not reference primitives directly in components** — they're the underlying material, not the interface.

### Semantic tokens
What components actually use. These are aliases that point at primitives — `text-primary` → `neutral-800`, `action-primary-default` → `violet-600`. The semantic layer is where you build. When dark mode flips or the brand pivots, only the semantic mappings change; component code stays the same.

### System tokens
Non-colour foundations: radius, spacing, elevation, typography. Same idea, same discipline.

---

## Foundation: brand anchors

| Token | Hex | Use |
|---|---|---|
| Horizon Violet | `#4920C4` | Primary brand. Logo, primary CTAs, brand mark. |
| Marketing Vivid | `#5B2DE8` | Marketing-only vivid version. Hero panels, ad creative, decks. |
| Obsidian | `#0E0E14` | Deepest text accent, dark-mode chrome. |
| Cloud | `#FAFAFC` | Default page background. |
| Aurora | `#F4B860` | Brand accent. Premium moments, payout-confirmed badges. **≤2% surface coverage.** |

These five hex values are immutable. Everything else derives from them.

---

## Colour ramps at a glance

Each ramp follows the same convention:

| Stop | Role |
|---|---|
| 50 | Subtle hover backgrounds, selected row tint |
| 100 | Light backgrounds for badges, banners, callouts |
| 200 | Borders on coloured components, light dividers |
| 300 | Disabled states on bold elements |
| 400 | Secondary fills, less-emphasised accents |
| 500 | Vivid version (often marketing/hero) |
| 600 | **Anchor — primary semantic application** |
| 700 | Hover state of 600 |
| 800 | Pressed state of 600, deep accents |
| 900 | (neutral only) Deepest text, dark-mode chrome |

Aurora at `#F4B860` lives at `warning-400`. The warning *primary* is `warning-600 = #C77E18`. Don't confuse the two.

---

## Semantic token map

These are the tokens designers and developers should reach for in components.

### Backgrounds
- `bg-page` — default page background
- `bg-surface` — card and panel surfaces (white in light mode)
- `bg-subtle` — subtle surface elevation, sidebars
- `bg-muted` — hover backgrounds, table row stripes
- `bg-inverse` — dark callouts, tooltips
- `bg-brand-subtle` — brand-tinted hover, selected rows
- `bg-brand-muted` — brand badges, info callouts

### Text
- `text-primary` — headings, primary content
- `text-body` — default body copy
- `text-secondary` — helper text, captions
- `text-tertiary` — placeholders, disabled
- `text-inverse` — text on dark/brand surfaces
- `text-brand` — brand-coloured text, links

### Borders
- `border-default` — most borders, dividers
- `border-subtle` — light dividers, table separators
- `border-strong` — emphasised borders, focus
- `border-brand` — active state, focus ring

### Action — primary (CTA)
- `action-primary-default` → `default` / `hover` / `pressed` / `disabled`
- Same pattern for `secondary` (white with border) and `destructive` (danger red)

### Feedback states
For each of `success`, `warning`, `danger`, `info`:
- `feedback-{state}-bg` — banner background
- `feedback-{state}-border` — banner border
- `feedback-{state}-icon` — icon stroke
- `feedback-{state}-text` — banner text

---

## Typography scale

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| `display` | 28 / 1.1 | 500 | Page-level display, dashboard hero number |
| `heading` | 22 / 1.2 | 500 | Primary page heading |
| `subheading` | 18 / 1.3 | 500 | Section heading, card title |
| `label` | 14 / 1.4 | 500 | Button labels, form labels, table headers |
| `body` | 14 / 1.5 | 400 | Default body copy |
| `caption` | 12 / 1.5 | 400 | Helper text, metadata, timestamps |
| `overline` | 11 / 1.4 | 500 | Section overline, eyebrow text (uppercase, +6% letter-spacing) |
| `mono` | 13 / 1.5 | 400 | Code, hex values, IDs |

**Two weights only — 400 and 500.** No 600+, no italics in product chrome. Body type is `Inter` (or `Söhne` if you license it). System fallback chain handles the rest.

---

## Radius

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 4px | Inputs, small badges |
| `radius-md` | 8px | Buttons, default |
| `radius-lg` | 12px | Cards, panels |
| `radius-xl` | 16px | Modals, large surfaces |
| `radius-pill` | 999px | Tags, status badges only |

Pills only for tags and status badges. Never for buttons.

---

## Spacing (4px base grid)

| Token | Value | Use |
|---|---|---|
| `space-xs` | 4px | Tight, icon-to-label |
| `space-sm` | 8px | Element gap |
| `space-md` | 12px | Row gap, dense components |
| `space-lg` | 16px | Component padding |
| `space-xl` | 24px | Section gap |
| `space-2xl` | 32px | Page gutter |
| `space-3xl` | 48px | Major section breaks |
| `space-4xl` | 64px | Hero / landing only |

Every padding, margin, and gap snaps to a multiple of 4. No arbitrary values.

---

## Elevation

| Token | Use |
|---|---|
| `shadow-e1` | Card resting state |
| `shadow-e2` | Popovers, dropdowns, tooltips |
| `shadow-e3` | Modals, dialogs, command palettes |
| `shadow-focus-ring` | Keyboard focus on interactive elements |

Shadow colour is rgba of Obsidian (`#0E0E14`) so shadows tonally harmonise with the neutral ramp. Never use pure black shadows.

---

## Card surface

Cards are the default container for grouped product content. Use the `.card` utility class (defined in `horizon-connect-responsive.css`) — it composes `bg-surface`, `border-subtle`, `radius-lg`, `space-card` padding, and `shadow-e1` elevation in one place. There is one card. Don't add variants — context-specific appearance is the layout's responsibility, not the component's.

---

## Auth layout

Auth pages (login, signup, password flows, future 2FA, email verification) use the `.auth-layout` wrapper, defined in `horizon-connect-components.css`. The wrapper provides a faintly tinted (`--bg-subtle`) background to anchor the card and removes card elevation in this context — the soft backdrop separates the card from the page on its own, so a shadow reads as noise.

```html
<body>
  <div class="auth-layout">
    <!-- brand mark -->
    <main class="card">…</main>
    <!-- optional footer -->
  </div>
</body>
```

This is the only context in the system where cards appear flat. New auth-flow pages don't need to make any decisions about elevation, background, or centring — wrap in `.auth-layout` and the appearance follows.

---

## Working principles

A few rules that make the system hold up under pressure:

**1. Reach for semantic, not primitive.** If you find yourself typing `violet-600` in a component, stop. Use `action-primary-default` or `text-brand` instead. Primitives are for token files, not components.

**2. The 6-of-50 rule.** You have ~50 colour tokens. Any single component should need at most 5–6. If you're using more, the component is doing too much.

**3. Brand colour is a scarcity tool.** In product UI, violet should appear at ≤5% pixel coverage — logo, primary CTA, active nav, occasional accents. Marketing surfaces flip the ratio.

**4. Aurora is rare, not frequent.** Reserve for premium-tier badges, payout-confirmed states, achievement moments. If Aurora shows up on more than 2% of surface, it loses meaning.

**5. Never improvise a new shade.** If the existing tokens don't solve the problem, the component design is wrong. Fix the design, not the palette.

**6. Marketing and product are different jobs.** Marketing surfaces use Marketing Vivid (`#5B2DE8`) heavily. Product surfaces use Horizon Violet (`#4920C4`) sparingly. Same brand, two different registers.

---

## What's not in v1.0

Deliberately omitted, to be added later:

- **Categorical chart palette** — the 6–8 hue palette for analytics charts where each series needs its own colour. Build when you build the analytics views.
- **Illustration palette** — for empty states, onboarding screens, marketing illustrations. Commission as a separate exercise.
- **Motion tokens** — durations and easing curves. Add when you start animating transitions.
- **Iconography system** — pick one library (Lucide, Phosphor, or a custom set) and standardise stroke weight + corner radius.

These are v1.1+ additions. Adding them now creates surface area for inconsistency before the core system has settled.

---

## Updating the system

The `.json` file is the source of truth. When values change:

1. Edit `horizon-connect-tokens.json`.
2. Re-import to Tokens Studio in Figma (it'll diff and update existing styles).
3. Regenerate or manually update `horizon-connect-tokens.css` for the codebase.
4. Bump the version in this README.

If a change breaks more than three components, it's not a token update — it's a system migration. Treat it as a v2.0 conversation, not a hotfix.

---

*Horizon Connect Design System v1.0 — Last updated [date of issue]. Maintained by [you / design lead].*
