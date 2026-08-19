# Horizon Tours design system

**Status:** Foundation landed, components pending · **Scope:** the consumer
site (`gowithhorizon.com`) only

Companion to `docs/tours-redesign-plan.md` (sequencing) and
`docs/booking-contract.md` (what the booking engine needs). This file covers
the CSS: where it lives, how it is layered, and how to change it without
breaking a booking.

---

## 1. Why this lives outside `design_files/`

`STYLING.md` describes a chain where `design_files/` is the source of truth,
delivered wholesale by Claude Design, and copied down into `css_new/`. That
chain belongs to the **dashboards** — the admin console and the Connect
partner portal. Those are the only surfaces that load `css_new/`.

The consumer site was never on it. It loads `legacy_css/style.legacy.css`
plus a per-page `<style>` block, and the delivered `horizon-tours-tokens.css`
was never wired to anything.

So this system is **repo-owned**: `css/tours/` is authored here and nothing
overwrites it. That buys three things.

- A Claude Design kit refresh for the dashboards cannot clobber consumer
  styling, and vice versa.
- The consumer site can diverge as far as the brand needs, without dragging
  the dashboards along or forking a shared file.
- Ownership is unambiguous. Hand-editing `css_new/` is a mistake; hand-editing
  `css/tours/` is the entire point.

The cost is that the two systems will drift. That is the intended trade —
they are different products for different audiences.

---

## 2. Architecture

Clean sheet: nothing is inherited from the Connect token architecture.

```
css/tours/
  01-primitives.css   raw scales — ramps, type steps, space, radius, shadow
  02-semantic.css     roles — surface/text/border/action/feedback, + dark
  03-base.css         reset, element defaults, layout primitives
  _kitchen-sink.html  the review surface (open it in a browser)
```

**One rule, and everything else follows from it: components reference only
semantic tokens.** They never name a primitive ramp. That one-way dependency
is what makes a rebrand an edit to one file instead of a search-and-replace
across the site. `tools/check-tokens.mjs` enforces it, and CI runs it.

### Why numeric ramps instead of t-shirt sizes

`--space-6` is unambiguously 24px; `--space-lg` is an argument. Numeric ramps
extend without renaming — inserting a step between `md` and `lg` means
renaming everything downstream, while `--space-7` just exists.

### Why fluid type and space

Every type step and the two rhythm tokens (`--space-section`, `--gutter`) are
`clamp()`-based, so they interpolate between mobile and desktop with no
breakpoint bookkeeping. Most of the responsive work on a marketing site is
type and spacing; this removes it.

Breakpoints still exist for layout. **960px is load-bearing** — it must match
`mobileBreakpoint` in `HorizonBooking.mount()`, which decides whether the
booking CTA opens a bottom sheet or scrolls to the panel.

### Why `@layer`

Cascade order is declared once in `01-primitives.css`:

```css
@layer reset, tokens, base, layout, components, utilities;
```

Later layers win regardless of specificity, so component CSS never needs a
specificity escalation to beat base styles, and utilities always win without
`!important`.

### Dark mode is defined but not switched on

The dark palette exists and is complete, gated behind `[data-theme="dark"]`.
It deliberately does **not** respond to `prefers-color-scheme`, because
shipping an unaudited dark mode to every visitor whose OS is dark is a good
way to break a booking page for a large slice of traffic. Turning it on is a
one-block change once the components have been reviewed in dark — the
kitchen sink already renders both.

---

## 3. How to rebrand

1. Replace the `--brand-*` ramp in `01-primitives.css`. Keep the step count
   and the rough lightness curve, or the semantic assignments stop landing at
   usable contrast.
2. Replace `--accent-*` if the call-to-action hue should change. **The accent
   ramp is the booking CTA** — it is deliberately not the brand hue, so that
   "book" has its own signal. Reserving it is what makes it read as urgent.
3. Re-tint `--neutral-*` if the brand wants warmer or cooler greys.
4. Open `css/tours/_kitchen-sink.html` and read the contrast table. Fix
   anything red before going further.
5. `npm run test:booking` — the design-system guard runs with it.

You should not need to touch `02-semantic.css` unless a *role* changes (e.g.
primary actions should become the brand hue rather than the accent).

### The contrast table is not decoration

The placeholder palette shipped here failed its own audit on the first run:
the checkout button measured **3.56:1** against white. Button labels at 16px
semibold are not "large text", so they need the full 4.5:1 — the fix was
moving primary and secondary one ramp step darker. Two more failures followed.

A new palette will do the same to you. Buttons and status colours are where
it bites, and the person choosing the colours cannot see it.

---

## 4. Rules the booking engine imposes on CSS

`docs/booking-contract.md` §2 is authoritative. The parts a **CSS rewrite**
specifically walks into:

**`hidden` is state, not decoration.** The engine opens and closes the
travellers dropdown, the calendar, and the whole expansion card by toggling
the `hidden` *attribute*. A component that sets `display` on one of those
elements overrides the UA default and pins it open — with no error anywhere.
`03-base.css` reasserts `[hidden] { display: none !important }` for exactly
this reason, and `tests/design-system.spec.js` fails if it is lost.

**Do not convert that state to a class.** It is tempting during a rewrite
(`.is-open` reads better than an attribute). The engine toggles the
attribute; changing the CSS alone silently breaks every dropdown.

**The scarcity badge needs its own `[hidden]` rule** if it sets `display`.
`display: inline-block` beats the UA `[hidden]` default, which is why the old
stylesheet carried an explicit `.bp-expansion__badge[hidden] { display: none }`.
The blanket `!important` rule in `03-base.css` now covers this, but only while
that rule survives.

**Class renames go through the map, not the engine.** The engine generates
markup with its own class names (`cal-day`, `bp-stepper__btn`, …). Rename
them freely, then pass a `classes:` override to `mount()`. Never edit
`js/booking/panel.js` for a styling change.

```js
HorizonBooking.mount({
  productId: 1162721,
  classes: { calDay: 'c-calendar__day', stepperBtn: 'c-stepper__key' },
});
```

`tests/redesign.spec.js` already proves a from-scratch page works this way.

---

## 5. Migrating the pages

Per-page, in the risk order set by `docs/tours-redesign-plan.md` §4. A page
is migrated when it drops `legacy_css/style.legacy.css` and its inline
`<style>` block, and loads the three `css/tours/` files instead. No
coexistence period — a page is on one system or the other.

Inline CSS to absorb, by page:

| Page | Inline CSS | Notes |
|---|---:|---|
| `tours/banff-hidden-gem-canoe-tour/` | 1,336 | 43% of the total; the de-facto design system, worth harvesting |
| `checkout/` | 506 | skin only — see contract §9 |
| `partners/` | 333 | |
| `booking-confirmed/` | 235 | |
| `about/` · `contact/` | 171 · 170 | near-identical; likely one template |
| `tours/` | 123 | shares the `hzn_price_` cache with the tour page |
| `index.html` | 59 | |
| the rest | <50 each | |

**`legacy_css/style.legacy.css` cannot be deleted when the consumer pages are
done.** `dashboard/hotel/index.html` — the live partner dashboard, not a
consumer page — also loads it. Deleting it after the last tour page migrates
would silently unstyle a customer-facing dashboard. Either migrate that
dashboard too, or fork it a private copy first.

(`admin/index.html` loads `admin.legacy.css`, a separate file. Admin is safe.)

---

## 6. Tooling

```sh
node tools/check-tokens.mjs   # undefined tokens + semantic-layer violations
npm run test:booking          # includes the design-system guard
tools/visual-diff.sh <ref>    # did this "CSS-only" change move any pixels?
open css/tours/_kitchen-sink.html
```

`tests/design-system.spec.js` audits contrast in both themes against the
tokens **as the browser computes them**, so it catches a failure introduced
three `var()` hops away. All of its assertions are mutation-verified: revert
the CTA to the failing colour, reach past the semantic layer, or drop the
`[hidden]` rule, and the matching test fails.
