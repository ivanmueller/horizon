# Consumer site redesign plan — gowithhorizon.com

**Status:** Phases 0 and 1 are **done** — the redesign is unblocked ·
**Scope:** the Tours (consumer) host only · **Non-goal:** any change to the
Bokun Worker, Supabase, Stripe, or the booking data flow.

This plan covers the full visual/structural revamp of the public site.
It is deliberately sequenced so that the one revenue-critical surface —
the Banff Hidden Gem Canoe Tour booking panel and its Bokun/Stripe
integration — is the *last* thing touched, and by then it is protected
by an extracted, tested module rather than by care alone.

It sits beside `docs/frontend-migration.md`, which governs the
**dashboards** (admin + Connect) and explicitly deferred Tours ("left
alone"). This document supersedes that deferral for the consumer host,
and keeps its core rule: **the backend is frozen.**

---

## 1. What is actually there today

### Consumer surface (~11.6k lines of HTML across 13 pages)

| Page | Lines | Backend-connected? |
|---|---|---|
| `/` | 650 | no |
| `/tours/` | 430 | **yes** — price-only (`/api/product`, `/api/availability`) |
| `/tours/banff-hidden-gem-canoe-tour/` | 3,465 | **yes — full booking engine** |
| `/tours/lake-louise-sunrise-canoe/` | 562 | no |
| `/tours/banff-town-highlights-gondola/` | 320 | no |
| `/checkout/` | 2,124 | **yes — Bokun options/submit + Stripe SetupIntent** |
| `/booking-confirmed/` | 672 | reads booking state |
| `/rentals/`, `/rentals/faq/` | 1,192 | no (own `raft.css`) |
| `/partners/` | 1,044 | no |
| `/about/`, `/contact/`, `/blog/*`, `/review/*` | ~1,150 | no |

**Only two pages carry the integration that must not break:** the canoe
tour page and `/checkout/`. Everything else is presentation.

### How the pages are built

- **No build step.** Hand-written HTML served straight off Cloudflare Pages.
- **Every page loads `legacy_css/style.legacy.css` (52 KB) *and* carries its
  own inline `<style>` block** — 1,335 lines of it on the canoe page alone.
  `STYLING.md` already marks `legacy_css/` as "kept only until the
  marketing/tours pages are migrated." This redesign *is* that migration.
- **A modern token system already exists and is unused here:**
  `css_new/horizon-tours-tokens.css` + `horizon-connect-components.css`,
  sourced from `design_files/`. The dashboards use it; the consumer site
  does not.
- **Nav and footer are copy-pasted into all 13 pages.** A sitewide header
  change today is a 13-file edit.

### Anatomy of the canoe tour page (3,465 lines, one file)

```
   1– 14  <head>, fonts, Leaflet CSS
  15–1350  inline <style>              ← 1,335 lines, page-local design system
1353–1356  JSON-LD TouristTrip         ← price is patched at runtime (SEO)
1359–2210  markup (nav, gallery, itinerary, booking panel, footer, modals)
2214–2382  BOKUN BOOTSTRAP             ← 3 parallel fetches, price cache, JSON-LD patch
2384–2385  /js/referral.js, /js/main.js
2399–2518  photo gallery / lightbox
2521–2894  BOOKING PANEL              ← traveller steppers, calendar, availability refetch
2897–3173  EXPANSION + CHECKOUT HANDOFF ← POST /api/booking/initiate → /checkout/?id=
3176–3232  mobile sticky CTA + bottom sheet
3235–3463  itinerary lightbox + pickup map (Leaflet/Mapbox)
```

Roughly **1,200 lines of business logic embedded in the same file as the
markup and the CSS**, in 8 anonymous IIFEs communicating through globals.

### The good news: the backend seam is already clean

Every backend touch from the tour page is an HTTPS call to one origin:

```
https://horizon-bokun.ivan-mueller02.workers.dev
  GET  /api/product/1162721
  GET  /api/pickup-places/1162721
  GET  /api/availability/1162721?start=&end=
  POST /api/booking/initiate        → { booking_id } → /checkout/?id=…
```

The Worker is a separate origin behind a CORS allowlist. **A redesign of
the HTML/CSS cannot break it.** Nothing in the revamp requires the Worker
to be redeployed or even read.

### The bad news: the seam is not *extracted*

What can break is the layer between the API and the pixels. The booking
logic is bound directly to element IDs, class names, dataset attributes,
globals and custom events that live in the markup being redesigned. That
binding is the entire risk of this project, and it is enumerable:

**DOM contract — element IDs the booking logic reads or writes**

```
Panel:      checkAvailBtn · travellersBtn · travellersLabel · travellersDropdown
            bp-travellers-rows · travellersContinue · btn-plus-<cat> · btn-minus-<cat>
            count-<cat> · dateBtn · dateLabel · calendarDropdown · calPrev · calNext
            calMonth1 · calMonth2 · calGrid1 · calGrid2
Expansion:  bpExpansion · expansionHeader · expansionBadge · expansionTitle
            expansionDuration · expansionDate · expansionStartTime · expansionCancelDate
            expansionCancelTime · expansionValidation · expansionTotal
            expansionBreakdown · bookNowBtn
Mobile:     mobileCta · mobileCtaPrice · mobileCtaBtn · mobileSheetBackdrop · mobileSheetClose
Pickup:     pickupMapBtn · pickupMapLightbox · pickupMapEl
```

**Class-selector contract (price rendering)**

```
.booking-panel · .booking-panel__price · .booking-panel__price-amount
.booking-panel__price-unit · .booking-panel__price--loading   (shimmer state)
.bp-expansion__card
```

**Global state contract**

```
window.BOKUN         { product, pickupPlaces, dropoffPlaces, availability,
                       pricePerCategory, lowestAdultPrice, currency, ready, error }
window.bokunBooking  { counts, mins, slot, rateId, startTimeId }
window.HORIZON       { hotel, ref, funnel }   ← set by /js/referral.js, ATTRIBUTION-CRITICAL
```

**Event contract**

```
bokun:ready · bokun:error · horizon:checkout_started
```

**Other implicit couplings**

- `dateBtn.dataset.selectedDate` — the selected ISO date lives on a DOM node.
- `localStorage['hzn_price_' + productId]` — a 1-hour price cache **shared
  with `/tours/`** so the price does not shimmer on navigation. Both pages
  must agree on the key and payload shape.
- The JSON-LD `offers.price` is rewritten at runtime from live Bokun data.
  A redesign that drops or restructures the `<script type="application/ld+json">`
  block silently degrades SEO rich results.
- `?hotel=<slug>` and `?ref=<CODE>` are captured on page load and carried
  into `/api/booking/initiate`. **This is the hotel-partner revenue
  attribution funnel.** It must survive every page it can land on.

That list is the contract. Anything not on it is free to change.

---

## 2. The recommended strategy

> **Extract the booking engine first. Redesign second. Never at the same time.**

The instinct on a revamp like this is to redesign the tour page and carry
the scripts across. That is the one approach that reliably breaks
bookings, because the scripts and the markup are edited in the same
commit and there is no way to tell a styling regression from an
integration regression.

Instead, invert it:

1. **Freeze and document the contract** (§1 is the first draft).
2. **Extract the ~1,200 lines of booking logic into versioned modules
   under `/js/booking/`, with zero visual change.** One commit, one
   deploy, one verification: the page looks byte-identical and still books.
   Now there is a boundary.
3. **Redesign against that boundary.** The new tour page mounts the same
   module. If a booking breaks after that, it is a mount-point problem
   with a known, short list of causes — not a needle in 3,465 lines.

The extraction is roughly 2–3 days of mechanical work and it is the single
highest-leverage thing in this plan. It converts "redesigning the tour page
is scary" into "redesigning the tour page is a template change."

### Three decisions worth making up front

**a) Keep Tours static HTML. Do not make it a SPA.**
`docs/frontend-migration.md` correctly picked a Vite/React SPA for the
*dashboards* on the grounds that SSR/SEO buys nothing behind a login. The
consumer site is the exact inverse: it lives or dies on organic search,
JSON-LD rich results, canonical URLs, and first-paint speed on hotel-lobby
mobile. Static HTML is the right answer here and always was. The two
surfaces should diverge, not converge.

**b) Introduce a minimal static build (Eleventy).**
This is the difference between a revamp and a rewrite you do again in a
year. Today the nav lives in 13 files and the next bookable tour is a
3,465-line copy-paste. With Eleventy:
- nav/footer/head become one layout each;
- a tour page becomes `tours/<slug>.md` + a data file, rendered through
  one `tour.njk` template;
- output is still plain static HTML into the same Pages project, same
  URLs, same `functions/_middleware.js`, same host split. Nothing about
  deployment or routing changes.

If the team would rather not take on a build step, the fallback is a small
Node script that inlines shared partials — worse, but the duplication
problem must be solved somehow, or the revamp decays immediately.

**c) Make the tour page data-driven, and treat "one bookable tour" as the
opportunity it is.**
Right now there is a template with exactly one instance, and the other two
tour pages are hand-built one-offs with no booking. Coming out of this
revamp, adding a Bokun product ID to a data file should be all it takes to
make tour #2 bookable. That is worth more than any visual change in this
plan.

---

## 3. Phases

Each phase is independently shippable and independently revertible.

### Phase 0 — Safety net ✅ DONE

- [x] Contract ratified and expanded into `docs/booking-contract.md`.
- [x] 33-test suite (`npm run test:booking`), 32 of them offline and
      deterministic, plus a live mode for pre-deploy. Wired to CI.
- [x] Mutation-tested: breaking the category collapse, the JSON-LD patch, the
      price cache, capacity validation, the missing-element guard, the load
      order, or `revealCalendar` each fails its test.
- [x] Attribution deliberately **not** gated, per the site owner.

<details><summary>Original Phase 0 checklist</summary>

- [ ] Ratify §1's contract list; keep it as `docs/booking-contract.md`.
- [ ] Write a **booking smoke test** (Playwright — Chromium is already
      available): load the tour page → set travellers → pick the first
      available date → check availability → assert the expansion renders a
      total → click Continue → assert redirect to `/checkout/?id=<uuid>`.
      Stop there; do not submit payment.
- [ ] Add a second assertion for attribution: load with `?hotel=x&ref=Y`
      and assert both land in the `/api/booking/initiate` payload.
- [ ] Run it against production once and record the baseline.

</details>

### Phase 1 — Extract the booking engine ✅ DONE

The engine lives in `/js/booking/` behind a selector map. The tour page went
from 3,465 to ~2,640 lines with no visual or functional change. Verified
three ways: the suite passes unchanged against the pre-extraction page, every
assertion is mutation-checked, and `tests/redesign.spec.js` runs the whole
flow against a page rebuilt from scratch that shares no id, class, or naming
convention with production.

**What this means for the redesign:** you can now restructure the tour page
freely. Rename ids and classes, and pass `selectors` / `classes` overrides to
`mount()` instead of editing booking logic. `docs/booking-contract.md` §7 is
the step-by-step.

Still outstanding before a deploy: the **Stripe test lane** (§4) — without it,
a full checkout run on a preview URL hits live Stripe.

<details><summary>Original Phase 1 plan</summary>

### Phase 1 — Extract the booking engine (no visual change)

Split lines 2214–3232 into modules under `/js/booking/`:

```
/js/booking/
  bokun-client.js     fetch wrappers for the 4 endpoints + the hzn_price_ cache
  booking-state.js    window.BOKUN / window.bokunBooking, category math, totals
  panel.js            travellers steppers, calendar, availability refetch
  expansion.js        slot summary, validation, /api/booking/initiate + handoff
  mount.js            single entry: HorizonBooking.mount({ productId, mountEl, … })
```

Rules for this phase:
- **Behaviour-identical.** No renaming of IDs, no CSS changes, no markup
  changes. The diff is "code moved out of the file."
- Keep the globals (`window.BOKUN`, `window.bokunBooking`) exported as-is —
  `/checkout/` and future pages may read them. Tidy them in a later phase,
  not this one.
- Give `mount()` an explicit **selector map** with the current IDs as
  defaults. That is what lets the redesign rename things later without
  editing logic.
- Ship it. Verify with the Phase 0 test. Watch a real booking land.

**Gate:** do not start Phase 2 until a live booking has completed on the
extracted engine.

</details>

### Phase 2 — Design system for the consumer site

- [ ] Take `css_new/horizon-tours-tokens.css` as the base (it already
      exists and is generated from `design_files/` — respect the chain in
      `STYLING.md`: author upstream, never hand-edit `css_new/`).
- [ ] Build `tours-components.css`: nav, footer, buttons, cards, section
      rhythm, the booking panel, modals/lightboxes.
- [ ] Harvest the good parts of the canoe page's 1,335 inline lines — that
      block is the de-facto design system and much of it is worth keeping.
- [ ] Extend the existing `_kitchen-sink.html` pattern into a consumer-site
      component gallery. Review the redesign there, not on live pages.

Nothing ships to a page in this phase. It is pure groundwork.

### Phase 3 — Build pipeline + templates

- [ ] Add Eleventy. Output to the existing Pages output dir; confirm every
      current URL still resolves (`/tours/<slug>/` trailing slashes matter —
      `_redirects` is intentionally empty and the middleware assumes the
      current shapes).
- [ ] Layouts: `base.njk`, `marketing.njk`, `tour.njk`, `post.njk`.
- [ ] One data file per tour (`src/_data/tours.js` or per-page frontmatter)
      carrying: slug, title, Bokun `productId` (nullable), hero, gallery,
      itinerary stops, meeting point, FAQ, JSON-LD fields.
- [ ] `tour.njk` mounts `HorizonBooking` **only when `productId` is set**;
      otherwise it renders the enquiry/waitlist state the two unbooked
      tours need today.
- [ ] Regenerate the *current* design through the templates first and
      diff against production. Templates and visuals must not change in
      the same step.

### Phase 4 — Redesign, in ascending order of risk

1. `/about/`, `/contact/`, `/blog/`, `/review/*` — no integration at all.
2. `/rentals/`, `/rentals/faq/` — already off `legacy_css`; fold onto the
   new tokens.
3. `/partners/` — marketing for the hotel programme.
4. `/` homepage.
5. `/tours/` listing — **first integration touch.** Keep the `hzn_price_`
   cache contract intact; verify the price still lands without a shimmer
   on navigation into the tour page.
6. `/tours/banff-hidden-gem-canoe-tour/` — the real one. New markup, new
   CSS, same engine, updated selector map. Run the Phase 0 test on every
   commit.
7. `/booking-confirmed/` — skin only.
8. `/checkout/` — **skin only, and last.** See §4.

By the time step 6 lands, the engine has been running unchanged in
production for weeks and the only new variable is the mount point.

### Phase 5 — Cutover and cleanup

- [ ] Deploy to a `.pages.dev` preview (already CORS-allowed by the
      Worker) and run the full booking flow in **Stripe test mode** (§4).
- [ ] Lighthouse + Core Web Vitals against the current site as the
      baseline; the revamp should not regress LCP on mobile.
- [ ] Verify JSON-LD with Google's Rich Results Test on every tour page.
- [ ] Re-check canonical URLs and that no URL changed shape. If any did,
      add 301s in `functions/_middleware.js`, not `_redirects` (host-conditional).
- [ ] Delete `legacy_css/style.legacy.css` once no consumer page loads it,
      and update `STYLING.md` to record that the migration is done.

---

## 4. Risks and how each is handled

**Live Stripe key on a preview deploy.**
`STRIPE_PUBLISHABLE_KEY` on the tour page is a `pk_live_…` key, and the
Worker's CORS allowlist already accepts `*.pages.dev` and `localhost`.
Every preview deployment therefore talks to **live** Stripe and live
Bokun — a full test booking on a preview URL creates a real reservation
and a real payment method. Before Phase 5, add a test lane: a
`pk_test_…` key selected by hostname, matched by a test-mode secret in
the Worker. `0B_VALIDATION.md` documents the Bokun test-mode setup; reuse
it. Until that lane exists, stop preview testing at "Continue to
checkout."

**`/checkout/` is more fragile than the tour page.**
2,124 lines running a four-section state machine over Bokun
`/checkout/options` → `/checkout/submit`, a Stripe SetupIntent and
`confirmSetup`, a 15-minute KV hold with an expiry path, and a
REDIRECT-vs-TOKEN channel branch, all coordinated by five custom events
(`horizon:checkout-ready`, `section1-complete`, `section2-complete`,
`hold-expired`, `booking_confirmed`). Restyle it — tokens, type, spacing,
buttons — but **do not restructure it in this project.** It deserves its
own extraction pass afterwards, on the same extract-then-redesign pattern.

**Attribution silently breaking.**
`?hotel=` / `?ref=` capture and `/js/referral.js` hydration are how hotel
partners get paid. A dropped script tag on a redesigned landing page
breaks it with no visible symptom — bookings still succeed, they just stop
being attributed. Mitigation: `/js/referral.js` goes into the base layout
so it cannot be forgotten per-page, plus the Phase 0 attribution
assertion.

**The price cache contract spanning two pages.**
`/tours/` writes `hzn_price_<id>`; the tour page reads it on load to avoid
a shimmer. Redesign them in the same phase (Phase 4 step 5–6) or keep the
key and payload byte-compatible.

**JSON-LD regression.**
The `<script type="application/ld+json">` block is patched at runtime with
the live price. In Eleventy it should be generated from the tour data
file, with the runtime patch retained. Verify per page in Phase 5.

**Scope creep into the Worker.**
The temptation during a redesign is "while we're here, let's add an
endpoint." Don't. The rule from `docs/frontend-migration.md` holds
unchanged: the backend is frozen, and the only permitted change is
additive `ALLOWED_ORIGINS` entries.

---

## 5. Sequencing summary

| Order | Phase | Risk | Touches integration? |
|---|---|---|---|
| ✅ | Phase 0 — smoke test + contract doc | none | reads only |
| ✅ | Phase 1 — extract booking engine | **medium** | yes — but zero visual change |
| 3 | Phase 2 — design system | none | no |
| 4 | Phase 3 — Eleventy + templates | low | no |
| 5 | Phase 4 steps 1–4 — marketing pages | none | no |
| 6 | Phase 4 steps 5–6 — listing + tour page | medium | yes |
| 7 | Phase 4 steps 7–8 — confirmed + checkout skin | low | skin only |
| 8 | Phase 5 — cutover | low | verification |

The two genuinely risky moments are Phase 1 and Phase 4 step 6. Phase 1 has
landed; the soak before step 6 is what the remaining phases buy. Start with
the marketing pages while the extracted engine runs in production
unchanged.
