# Horizon Connect — Design System

A reference design system for **Horizon Connect**, a direct-to-hotel commission-tracking and affiliate platform that bridges hotels and tour operators. Hotels earn payouts on tours they refer; operators get measurable, transparent attribution; Horizon collects a transaction fee for building the bridge.

Horizon ships as a **sibling-brand family**:

| Brand | Audience | Register | Primary |
|---|---|---|---|
| **Horizon Connect** | Hotel staff, tour operators (B2B SaaS) | Considered, restrained, infrastructural | Blue `#4F5BFF` |
| **Horizon Tours** | Travellers booking guided experiences | Warm, generous, evocative | Sunset `#FF8A3D` |

The two share architecture (4 px grid, type scale, breakpoints, motion, semantic structure) and diverge on **primary colour**, **radius hierarchy** (Connect 4/8/12/16 vs Tours 8/12/16/20), **neutral temperature** (cool blue undertone vs warm sunset undertone), and **contextual spacing** (Tours runs more generous). The same components compose into both surfaces through the semantic token layer.

This project is the canonical kit for designing **against** Horizon — for prototypes, mockups, decks, and production handoff.

## Sources used to build this kit

- **Horizon repo:** [github.com/ivanmueller/horizon](https://github.com/ivanmueller/horizon) — the live codebase. **This design-system project is the source of truth.** `colors_and_type.css` is the authoritative single-import token bundle and [`horizon-source/`](horizon-source/) holds the canonical split files. The repo's `css_new/` folder is the **served derivative** — synced *from* [`production/css_new/`](production/) into `horizon/css_new/`, never edited independently or treated as upstream. The dashboard partner app under `dashboard/hotel/` and the marketing site at the root informed the UI kits.
- **Figma file:** "Stripe Connect Embedded Components – UI Toolkit (Community)" — used **only** as a reference for B2B dashboard component patterns (tables, payment rows, filters, status pills, onboarding flows). None of Stripe's brand visuals (gradient mesh, Söhne, indigo) carry over — Horizon's own blue/sunset palette governs.

Explore the source repo for: live dashboard code (`dashboard/`), the partner sign-up flow (`partners/`), motion + responsive rules (`css_new/*.md`), and the broader Tours marketing site (root).

---

## Content fundamentals

Voice across both brands is **plainspoken**, **specific**, and **infrastructural** — the product describes what it does in flat terms, then steps out of the way.

**Tone by surface**

| Surface | Tone | Example |
|---|---|---|
| Connect product chrome | Direct, low affect, technical when needed | *"Bookings will appear here as soon as guests book through your QR code or referral link."* |
| Connect marketing | Calm, confident, evidence-led | *"Direct commission tracking between hotels and operators. No middleman, no opaque payouts."* |
| Tours marketing | Warm, sensory, plainspoken | *"Small groups. Local guides. We take you to the spots in Banff National Park that people come here to see."* |
| Tours product chrome | Quietly enthusiastic, never breathless | *"Now Booking for Summer 2026"* |

**Voice rules**

- **"You", not "we" for product copy.** *"Your bookings"*, *"You can sign in with it next time."* "We" is reserved for the company taking responsibility (*"Your account isn't linked to any active hotel yet. Contact Horizon to get set up."*).
- **Concrete over abstract.** Don't promise "powerful insights" — show "$2,840 commission earned in the last 30 days."
- **Sentence case everywhere** — including headings, buttons, table headers. The only exception is the `.overline` eyebrow, which is uppercased letter-spaced via CSS, never typed.
- **No marketing softeners.** No "just", "simply", "easily", "powerful", "seamless". If something is genuinely simple, prove it with a screenshot instead of an adjective.
- **No emoji in product chrome.** Emoji only appears in informal Tours marketing footers (social icons) — and even then, replace with proper SVGs when handing off to production.
- **Numbers are the heroes.** Money, traveller counts, percentages get tabular figures (`font-variant-numeric: tabular-nums`) and the largest available weight in their context. The data is the argument.
- **Errors name the cause, then the fix.** *"Hotel slug 'banff-springs' is not an active partner. Contact Horizon."* — not *"Something went wrong."*
- **Capitalize the brands.** *Horizon Connect*, *Horizon Tours*. Lower-case "horizon" only inside the wordmark glyph.

**Words to prefer / avoid**

| Prefer | Avoid |
|---|---|
| Booking, payout, commission, referral, partner | Transaction, fee, cash, deal |
| Hotel, operator, traveller | User, customer (in B2B copy) |
| Set up, link, scan | Onboard, sync, integrate |
| Sign in | Log in (we already use sign in / sign out throughout the dashboard) |

---

## Visual foundations

### Colour

- **Single brand colour is a scarcity tool.** In Connect product UI, Horizon Blue appears at **≤ 5 % pixel coverage** — logo, primary CTA, active nav state, occasional accent. Marketing surfaces flip the ratio.
- **One canonical blue.** `--color-blue-500` (`#4F5BFF` — "Horizon Blue") is the primary brand colour everywhere: product, marketing, decks. `--color-blue-600` (`#3543E6`) plays the *hover* role, `--color-blue-700` (`#2530BB`) the *pressed* role. The earlier `marketing-vivid` distinction has been collapsed — a single vivid blue reads correctly in both registers and is friendlier for a hotel-facing surface.
- **Aurora orange (`#FF8A3D`)** is the rare accent. Premium-tier badges, payout-confirmed states, achievement moments. **≤ 2 % coverage** — if it shows up everywhere it loses meaning. (Same hue as Tours' primary; the shared colour signals the sibling-brand link.)
- **Pure-white page surface.** `--bg-page` is `#FFFFFF`, not a tinted off-white. Card separation comes from 1 px `border-subtle` and `shadow-e1`, never from a darker page tint. `--bg-subtle` (`#F4F3F8`) is reserved for hover backdrops, table column-headers, and sidebar-item active states — contextual surfaces only, never the page.
- **Cool-tinted neutrals.** Greys carry a faint cool undertone (`#FAFAFC`, `#25222E`, etc.) so the whole UI sits in one tonal family even on a pure-white background. Tours flips this to warm-tinted neutrals.
- **No improvised shades.** If the existing tokens don't solve it, the component is wrong, not the palette.

### Type

- **Inter** (`--font-sans`) at weights 400 and 500. **Two weights only**, no 600+, no italics in product chrome. Söhne is the licensed counterpart for marketing surfaces, with Inter as the open-source substitute throughout the system. **The kit ships with the brand-supplied Inter variable font** (`fonts/Inter-VariableFont_opsz_wght.ttf` — optical size + weight axes) plus the italic variable counterpart. Optical sizing is enabled globally via `font-optical-sizing: auto`, so Inter automatically swaps between its 18 pt / 24 pt / 28 pt masters at the right roles.
- **JetBrains Mono** (`--font-mono`) for confirmation codes, IDs, referral slugs, keyboard cap glyphs.
- **Eight semantic roles**: display 28 / heading 22 / subheading 18 / label 14 (500) / body 14 (400) / caption 12 / overline 11 (uppercase, +6 % tracking) / mono 13.
- **Tabular figures for money.** Every cell rendering currency, transaction amounts, commission percentages, or counts uses `font-variant-numeric: tabular-nums`. The system signal that this is a financial product.
- **Display + heading scale fluidly** between breakpoints via `clamp()`. Body, label, caption stay fixed — readability over scale.

### Spacing & layout

- **Single 4 px grid.** Allowed values: 0, 4, 8, 12, 16, 24, 32, 48, 64. Nothing else exists. Both brands share it.
- **Five breakpoints, mobile-first**: `sm` 640 / `md` 768 / `lg` 1024 / `xl` 1280 / `2xl` 1536. Container caps at 1280 (product) or 1440 (marketing). Beyond `2xl`, additional screen becomes gutter.
- **Contextual spacing tokens** (`--space-section`, `--space-page`, `--space-card`) scale with breakpoint; static element-level tokens (`xs`–`4xl`) don't.

### Surface & shape

- **Cards = `bg-surface` + 1 px `border-subtle` + `radius-lg` (12 px) + `shadow-e1`.** One card. Don't invent variants — context-specific appearance is the layout's responsibility (see `.auth-layout`, which flattens cards on auth screens).
- **Radius hierarchy is fixed.** Connect: inputs 4 / buttons 8 / cards 12 / modals 16. Pills (999 px) reserved for status badges and tags only — **never buttons**. Tours softens every stop by one notch.
- **Three elevations**: `e1` resting card / `e2` popover, dropdown, tooltip / `e3` modal, dialog. Plus `--shadow-focus-ring` on keyboard focus. Shadows tinted with the Obsidian channel (`rgba(14,14,20,...)`) — never pure black.

### Background patterns

- **No gradients in product UI.** No glass / blur / frost effects. No coloured section backgrounds. The data is the hero; the chrome stays out of the way.
- **Marketing heroes** may use a faint cool-tinted backdrop (`--bg-subtle`) or a full-bleed product photo (Tours only). No mesh gradients.
- **Auth pages** sit on `--bg-subtle` to let the card float without shadow.

### Borders, hover, press

- **Borders default to `--border-subtle`** (1 px), `--border-default` (1 px) on inputs, `--border-strong` on focus or emphasis.
- **Hover** = one ramp stop darker on coloured surfaces; subtle background tint (`--bg-subtle`) on ghost / icon controls.
- **Press** = two ramp stops darker, plus `transform: scale(0.98)` on `.btn:active` for tactile feedback.
- **Focus** = `--shadow-focus-ring` (3 px outer glow at 18 % opacity of brand colour). Never remove without replacement.

### Motion

- **Three durations, two easings, no exceptions.** `--motion-fast` 150 ms (color/opacity), `--motion-base` 200 ms (dropdowns, accordions), `--motion-slow` 300 ms (modals, drawers). `ease-out` for entering, `ease-in` for exiting. **Never** `linear`, `ease-in-out`, or `ease`.
- **Global rule** in `colors_and_type.css` transitions `background-color`, `border-color`, `color`, `box-shadow`, `opacity`, `transform` on every interactive element. Don't override.
- **Animate only `transform` and `opacity`.** Never width/height/margin/padding — they trigger layout. Never `transition: all`.
- **`prefers-reduced-motion` is honoured** at the token level (durations collapse to 0) and as a belt-and-suspenders global rule. Do not override.
- **No scroll-triggered reveals, no parallax, no page transitions, no decorative motion** in v1. Motion exists for state changes; nothing else.

### Iconography

- **Lucide** (`https://unpkg.com/lucide-static`) is the icon library. Stroke weight 1.75 px (matches the dashboard), 20 / 24 px sizes, `currentColor` stroke so icons inherit text colour. The system has no in-house icon set — Lucide was selected for stroke weight consistency with the existing dashboard SVGs in the repo (`docs/`, `dashboard/`).
- **Brand mark** lives at `assets/horizon-mark.svg` (rounded square, Horizon Blue fill, white horizon glyph). The wordmark — *horizon* + role suffix — sits in `assets/horizon-wordmark.svg`. Tours uses the same shape with Sunset orange fill (`assets/horizon-mark-tours.svg`).
- **No hand-drawn illustrations** in the system yet. Empty states use centred type + icon, never marketing-style illustrations. Photography (Tours only) ships through `srcset` with art-directed crops at major breakpoints.
- **No emoji in product chrome.** Unicode glyphs (▾, →) are acceptable for low-decoration UI affordances if no icon library is available, but Lucide is preferred.
- **CDN-substitution flag:** the original repo doesn't bundle an icon library — inline SVGs are used per-component. We pull Lucide from CDN here for kit convenience; production should vendor it.

### What we explicitly do NOT do

- No purple→pink gradients, no glassmorphism, no neumorphism.
- No emoji cards, no rainbow chart palettes (charts wait for v1.1).
- No coloured left-border accent cards.
- No more than two button variants in one view.
- No animated SVG illustrations or scroll-triggered reveals.
- No fonts other than Inter and JetBrains Mono.

---

## Index

| Path | What it is |
|---|---|
| `README.md` | This file. |
| `SKILL.md` | Cross-compatible Agent Skill manifest for downstream use. |
| `colors_and_type.css` | Single import — all tokens + semantic type roles. |
| `horizon-source/` | The canonical split source files (tokens, components, motion rules, responsive rules, kitchen sink). The repo's `css_new/` is synced *from here* (via `production/css_new/`) — this is upstream, not a mirror of the repo. |
| `assets/` | Brand marks (Connect blue, Tours sunset, wordmark). |
| `preview/` | Design-system card specimens (rendered in the Design System tab). |
| `ui_kits/connect-dashboard/` | Hotel partner dashboard — Connect's hotel-facing surface. |
| `ui_kits/connect-admin/` | **Internal** admin console — workspace switcher, hotels portfolio table, slide-in detail drawer. |
| `ui_kits/connect-marketing/` | Connect's marketing site (hero, features, pricing, FAQ). |
| `ui_kits/tours-marketing/` | Tours sibling brand sample — warm sunset orange, softened radii. |

## Open questions / next steps

- **Söhne licensing** — Inter is the open-source substitute and the variable font ships in `fonts/`. If Söhne is licensed for Horizon, the swap is a single `@font-face` block in `colors_and_type.css`.
- **Mono brand font** — JetBrains Mono is currently pulled from Google Fonts. The brand-fonts upload didn't include a mono family; if one gets licensed, vendor it next to Inter under `fonts/`.
- **Categorical chart palette** (analytics views) and **illustration palette** (empty states / onboarding) are deliberately out of scope for v1.
- **Icon library decision** — Lucide is the kit's default. The repo's production code uses bespoke inline SVGs; standardising on a single library would simplify maintenance.

*Last updated: May 2026 — v1.0.*
