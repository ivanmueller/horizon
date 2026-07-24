# /rentals/ — Horizon Raft homepage

The raft rental arm: a sibling to Tours under `gowithhorizon.com`, with its own
Glacial-teal identity. Built from a Claude Design handoff, following
`Horizon_Raft_Rental_Design_Plan.md`.

```
rentals/
├── index.html   the full homepage scroll (SEO head from the original stub, unchanged)
├── raft.css     tokens + all component styles
├── raft.js      nav scroll state, mobile menu, sticky book bar, scroll reveals
└── README.md    this file
```

Static — no build step, no dependencies.

## Why this page is self-contained

It loads only `/rentals/raft.css` and `/rentals/raft.js`, plus `/js/referral.js`
so hotel/referral attribution keeps working across the page.

- **Not `css_new/`.** `STYLING.md` makes that folder a derivative synced from
  `design_files/`, never hand-edited. These are page styles for a new brand arm,
  not part of the Connect/Tours token kit, so they live next to the page.
- **No `legacy_css/style.legacy.css`, no `js/main.js`.** Both define
  `.nav` / `.nav__link(s)` / `.reveal` / `.btn` / `.review`, which collide with
  this page's classes; `main.js`'s nav and reveal handlers would double-bind
  against markup `raft.js` already drives. Namespace first if you ever want to
  pull either in.

## Design tokens

Defined once as custom properties at the top of `raft.css`:

| Token | Hex | Use |
|---|---|---|
| `--glacial` | `#2B6E7E` | primary brand, every CTA |
| `--stone` | `#3D3D3D` | headlines, body text |
| `--sandbar` | `#F5F0E8` | page background, card fills |
| `--driftwood` | `#A68B6B` | borders, eyebrows, metadata |
| `--summit` | `#E8E2D6` | secondary fills (step icons, add-on cards) |
| `--alpine` | `#1D4F5C` | hero base, footer, mobile menu |
| `--signal` | `#D4663A` | urgency only — defined, not yet used |

Display type is Instrument Sans (600/700), body and utility type is Inter
(400/500/600). Spacing is on the plan's 8px base; content max-width 1200px;
side padding 48px desktop / 20px mobile; section padding 80px / 48px.

## Content still to land

Placeholders, per the design conversation:

- **Photography.** `.hero__media` (full-bleed image or muted looping video — keep
  the scrim on top), four `.card__photo` slots at 3:2, five `.gallery__item`
  slots at 3:2 / 4:5 / 16:9 / 1:1. Swap each for an `<img>`, keep the ratio.
- **Pricing.** Every `from $XX` / `$XX` in the fleet cards and add-ons strip.
  Note the page's existing JSON-LD already advertises **$79 CAD** — reconcile the
  two when real prices land.
- **Route strip.** Landmark names, `X km` and the time markers are a rough
  concept. Update the `<text>` nodes and the path geometry in `.route__svg`, and
  update that svg's `aria-label` to match — it is the diagram's text alternative.
- **Reviews.** Three real quotes, names, dates, sources.
- **Since 2024** in the hero trust pills.

## Copy conflicts with the existing head metadata

The `<head>` was left exactly as it was found. Its metadata describes a different
offer than the design does — worth reconciling before launch:

| | Head metadata / JSON-LD | Design |
|---|---|---|
| Location | Banff | Canmore |
| Duration | 2–3 hours | 2–4 hours |
| Capacity | up to 6 per raft | 1–2 through 13+ |
| Price | $79 CAD | placeholder |

The favicon in the head is still the Tours orange `#FF6B4A`; the design gives the
raft arm a Glacial-teal mark.

## Links not yet built

Nav and fleet cards point at anchors for pages the plan defines but that don't
exist yet: `#safety`, `#groups`, `#fleet-solo`, `#fleet-small`, `#fleet-large`.
Footer `#` links (Gift Cards, Loyalty & Rewards, Partner Offers, Careers, and the
four social accounts) are the same. `#book` jumps to the final CTA — repoint it at
the booking wizard when it exists.

## Behaviour

- **Nav** starts transparent over the hero and gains `.is-scrolled` (Sandbar at
  95% with a 12px blur, hairline Driftwood border) past 80px. All colour changes
  are CSS on that one class. The "← Home" button returns to `/`.
- **Mobile nav** collapses to a hamburger below 940px; the overlay is full-screen
  Alpine with 28px items on 56px rows, traps focus, closes on Escape, restores
  focus to the toggle.
- **Sticky Book Now bar** appears at ≤768px, 56px tall in Glacial. Per plan §7 it
  hides when scrolling up and returns when scrolling down; it also stays put near
  the page bottom and while the menu is open.
- **Scroll reveals** fade sections up 20px over 400ms, once each, via
  IntersectionObserver. The route line draws itself when the strip enters view.
- **Reduced motion** is honoured: reveals render in place, the route line is drawn
  at rest, hover lifts are dropped, smooth scrolling is off.

Without JavaScript the page renders fully — reveals and the route draw simply
start in their finished state.

## Deviations from the design prototype

Two intentional, both easy to revert:

1. **Heading line-height.** The prototype's `<h2>`/`<h3>` inherit the 1.6 body
   value; here section titles use 1.2 and card titles 1.3, so headings that wrap
   on mobile don't open a large gap. Remove the `line-height` from
   `.section__title`, `.card__title`, `.step__title` and `.cta__title` to match
   the prototype exactly.
2. **Route strip on mobile.** Below 768px the svg holds a 560px minimum width and
   its container scrolls horizontally, rather than scaling the diagram down until
   the landmark labels are ~4px. Drop `.route__svg { min-width }` to scale to fit.
