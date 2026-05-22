# Horizon Tours — Brand Theme v1.0

Sibling brand to Horizon Connect. Same architecture, calibrated for the warmer, more emotional Tours register.

---

## The sibling relationship

Tours and Connect are **two brands under one parent**. They share strategic foundations and component architecture — they look like family — but each is calibrated for its audience. This document explains the divergence; it assumes familiarity with `horizon-connect-brand-kit.md`.

| | Connect | Tours |
|---|---|---|
| Audience | Hotel staff, tour operators (B2B) | Travellers booking experiences (B2C) |
| Job | Operational reliability, commission tracking | Emotional purchase, experiential preview |
| Register | Considered, restrained, infrastructural | Warm, generous, evocative |
| Primary | Horizon Violet `#4920C4` | Horizon Amber `#B8862F` |
| Accent | Aurora `#F4B860` (rare) | Deep Violet `#4920C4` (rare, sibling-link) |
| Density | Tighter (more info per screen) | Looser (more whitespace per screen) |
| Radius | 4 / 8 / 12 / 16 (architectural) | 8 / 12 / 16 / 20 (friendlier) |

The complementarity is intentional. Each brand uses the *other's* signature colour as its accent — when the two brands appear together (a "Powered by Horizon Connect" footer on a Tours booking confirmation, an "Operated by Horizon Tours" trust badge on a Connect partner-portal page), the violet + amber pairing visually says "siblings" without anyone having to read the words.

---

## What stays identical to Connect

Do not diverge from Connect on any of the following — these are universal to the Horizon family:

- **The 4px spacing grid** (xs through 4xl tokens) — Tours doesn't get a 20px stop or a 28px stop any more than Connect does
- **Type scale and weights** — Inter, two weights (400 and 500), seven type tokens
- **Breakpoints** — 640 / 768 / 1024 / 1280 / 1536px
- **Responsive system** — fluid type for headings, fixed body, contextual spacing tokens, layout primitives
- **Elevation system** — e1 / e2 / e3 / focus-ring (just retinted warm)
- **Semantic token architecture** — `--text-primary`, `--bg-surface`, `--action-primary-default`, etc.
- **Status ramp anchors** — success/warning/danger/info ramps unchanged. (Tours uses `--feedback-warning-*` for warnings just like Connect. Aurora is no longer the "rare brand accent" in Tours; it's been promoted to primary, so warnings need their own dedicated ramp as before.)
- **Component architecture** — same buttons, cards, inputs, forms, navigation patterns. Different colour values flowing through the same components.

This is the discipline that makes a "sibling brand" structure work in practice. If you let too much diverge, you have two systems to maintain, two design conversations every time something changes, and components that have to be rebuilt twice. The right divergences are minimal and meaningful.

---

## What diverges, and why

### 1. The primary colour family

Tours' primary is **`#B8862F`** at `amber-600` (the product anchor) with **`#D4A155`** at `amber-500` (the marketing-vivid stop). This mirrors Connect's pattern: a deeper "product" version that holds WCAG AA contrast on white, and a richer "marketing" version used on hero panels and ad creative where the contrast requirement is looser.

The `#D4A155` you'll see on horizontours.com hero sections is the marketing-vivid. The amber colour inside the booking app at `Book this experience` CTAs is `#B8862F`. Same family, calibrated for context.

**Why amber instead of, say, a Rockies-water teal:** amber/gold is the colour of golden-hour light hitting Cascade Mountain, the Canadian Rockies' most reproduced tourism photograph. It's emotionally tied to the product (sunrise canoe trips, evening Moraine Lake tours, alpenglow stargazing). It signals warmth and premium adventure simultaneously. Teal would have signalled "lakes" specifically and limited Tours' future expansion into winter products, mountain experiences, and non-water tours.

### 2. The neutral ramp is warm-tinted

Connect's neutrals carry a subtle violet undertone (~2% violet in the grey). Tours' neutrals carry a subtle warm undertone (~3% amber). This is what makes the entire UI feel tonally connected to the primary instead of looking like brand colour layered on generic grey.

When you see a Tours card on its page, the card surface (`--bg-surface`, white), the page behind (`--bg-page`, `#FAF9F6`), and the muted backgrounds (`#F4F2EC`) all carry the same warm undertone as the primary. The eye reads the surface as a single tonal family. This is the same trick Connect plays with its violet-tinted greys; it just runs in the warm direction here.

### 3. Radius runs one stop softer

| Element | Connect | Tours |
|---|---|---|
| Inputs | 4px | **8px** |
| Buttons | 8px | **12px** |
| Cards | 12px | **16px** |
| Modals | 16px | **20px** |
| Pills | 999px | 999px (unchanged) |

This is the single most-felt difference between the two brands. Tours buttons are visibly softer than Connect buttons placed next to them. Cards on Tours' landing pages have noticeably rounder corners than the dashboard cards in Connect's hotel portal.

**Why one stop, not more:** going further (24px+ cards, fully pilled buttons) tips into "consumer mobile app" or "kids product" territory, which isn't right for a $300+ adventure tour. Tours wants warm-but-premium — closer to high-end hotel websites (Aman, Six Senses, Rosewood) than to TikTok or Duolingo. Those high-end brands all use moderate radius with lots of whitespace and good typography, not extreme rounding. The "one stop softer" increment hits that register.

**Don't override per-component.** If you find yourself wanting a button at 16px radius on a specific Tours page, you've identified that the Tours radius hierarchy is wrong — fix it at the token level, propagate everywhere. Per-component overrides are how systems decay.

### 4. Contextual spacing runs more generous

Tours' `--space-section`, `--space-page`, and `--space-card` are larger than Connect's at every breakpoint. The static spacing scale stays identical (the 4px grid is universal), but contextual padding scales up.

Practically this means: a Tours hero panel has more breathing room above and below than a Connect dashboard section. A Tours booking card has more internal padding than a Connect partner card. Tours pages feel airier. This is what "experiential" looks like at the layout level — content doesn't have to hustle for screen real estate the way it does in dense product UI.

### 5. Shadows are warm-tinted

Connect's shadows are `rgba(14, 14, 20, ...)` — a tiny bit of violet-blue mixed in. Tours' shadows are `rgba(20, 18, 14, ...)` — a tiny bit of warm brown mixed in. Imperceptible in isolation; felt as tonal coherence across the UI.

### 6. Focus ring is amber, not violet

Keyboard focus on Tours surfaces uses an amber ring (`rgba(184, 134, 47, 0.18)`) instead of violet. Same job, branded for the right product.

---

## The sibling-link accent

Deep Violet (`#4920C4`) — Connect's primary — appears in the Tours system as the **rare accent**, with ≤1% pixel coverage. Reserved for:

- "Operated by Horizon" trust badges
- Links from Tours pages to Horizon Connect
- Parent-brand footer attribution
- The "managed by Horizon" badge on bookings

Use the `.sibling-accent` class. Don't reach for `--color-brand-deep-violet` anywhere else.

The reverse mirrors: Aurora amber appears in Connect's system at ≤2% pixel coverage as the rare celebration accent. Each brand's primary is the other brand's rare accent. That's the visual grammar of "siblings."

---

## How to use this file

```css
/* In your Tours app or marketing site */
@import "horizon-connect-tokens.css";       /* core architecture — required */
@import "horizon-connect-responsive.css";   /* responsive layer — required */
@import "horizon-tours-tokens.css";          /* Tours overrides — last */
```

The Connect files supply the architecture. The Tours file overrides specific tokens. Components in either project read `--action-primary-default` (or `--text-primary`, etc.) and automatically get the right brand value depending on which file is imported last.

If you're building a unified component library that serves both products, components should reference semantic tokens only (`--action-primary-default`) and never primitives (`--color-blue-600` or `--color-amber-600`). The brand the component renders in is determined by which token file is loaded — the component itself stays brand-agnostic. This is exactly how Material 3 themes, Radix theming, and Shopify Polaris multi-brand work.

---

## Component build sequence

You don't need to rebuild any components for Tours. Components built for Connect work in Tours unchanged — same buttons, same cards, same forms — they just render in amber with softer corners and more padding because of the tokens flowing through them.

The only Tours-specific UI you'll need is:
- **Booking flow components** (date picker, guest selector, availability calendar, payment confirmation) — these don't exist in Connect
- **Marketing components** (hero panels with photography overlays, testimonial cards, itinerary timelines, gallery grids)
- **Trip detail surfaces** (interactive maps, weather/conditions widgets, what-to-bring lists)

These should be built fresh, but using the same component patterns as Connect — same auto-layout principles, same token discipline, same responsive rules. The Tours theme just makes them feel right for the consumer audience.

---

## Don't do this

- **Don't add a third brand colour to Tours.** "What if we used a green for nature tours?" No. The brand is amber. Different tour categories don't get different colours. Categorize via photography, copy, and content — not chrome.
- **Don't make Tours buttons fully pilled** (`--radius-pill`) by default. Pills are still reserved for tags and status badges in both brands. Pilled CTAs read as consumer-mobile-app, which is not the register.
- **Don't override radius or spacing per-component on Tours.** If a Tours card looks wrong with 16px radius, the issue is the layout context, not the radius. Fix the context.
- **Don't reduce Connect's discipline because Tours is "more relaxed."** Tours is *warmer*, not *looser-disciplined*. Same token rules, same audit process, same self-checks. The only thing that's relaxed is the visual register.
- **Don't let Tours and Connect diverge further over time.** Every divergence is a maintenance cost forever. The architecture is shared deliberately. Defend it.

---

*Horizon Tours Brand Theme v1.0 — Last updated [date]. Sibling to Horizon Connect Design System v1.1.*
