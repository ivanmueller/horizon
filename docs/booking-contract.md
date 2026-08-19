# Booking engine contract

**Status:** Authoritative · **Applies to:** the Bokun/Stripe booking flow on
`/tours/banff-hidden-gem-canoe-tour/` and its handoff to `/checkout/`

This is the durable record of what the booking flow depends on, written so
the site can be redesigned without anyone having to reverse-engineer 1,200
lines of scripting first. It is the companion to
`docs/tours-redesign-plan.md`.

**Read §7 first if you are here to redesign a page.**

---

## 1. Where the code lives

```
/js/booking/
  bokun-client.js   HTTP + price cache + date helpers   ← zero DOM
  booking-state.js  globals, derivations, validation    ← zero DOM
  panel.js          travellers + calendar
  expansion.js      confirm card + checkout handoff
  mobile-cta.js     sticky bar + bottom sheet
  mount.js          selector map + orchestration        ← THE FILE YOU EDIT
```

The tour page loads these as six classic `<script>` tags and calls:

```js
HorizonBooking.mount({
  productId: 1162721,
  tourImage: 'https://gowithhorizon.com/tours/banff-hidden-gem-canoe-tour/images/hero.jpg',
  preferredStartTimeId: 5438571,
});
```

Load order matters (`client → state → panel → expansion → mobile-cta →
mount`). Concatenating them into one bundle later is safe; reordering is not.

**Do not add `defer` or `async` to these tags.** They are classic scripts and
the `mount()` call runs inline during parse — deferring the files without
deferring that call breaks the page. If you want them non-blocking, defer
*all* of them **and** move `mount()` into a `DOMContentLoaded` handler, then
re-run the suite. Dependencies are resolved lazily, so a broken order reports
itself rather than throwing `cannot read properties of undefined`:

```
[HorizonBooking] HorizonBokunClient is not loaded. The booking files must load in
order: bokun-client, booking-state, panel, expansion, mobile-cta, mount — as
classic scripts, with no defer/async. See docs/booking-contract.md §1.
```

The two zero-DOM files are the important boundary. Everything that talks to
Bokun or Stripe is on one side of it; everything a redesign touches is on the
other.

---

## 2. DOM contract

The engine never hard-codes a selector. Every lookup resolves through the
map in `mount.js`, whose defaults are the ids the page shipped with. **To
rename anything, pass an override — do not edit engine files.**

```js
HorizonBooking.mount({
  productId: 1162721,
  selectors: { bookNowBtn: '#checkout-cta', dateBtn: '[data-datepicker]' },
  classes:   { calDay: 'c-calendar__day' },
});
```

### Elements the engine reads or writes

| Key | Default | What the engine does to it |
|---|---|---|
| `panel` | `.booking-panel` | reads `getComputedStyle().top` for the sticky scroll offset |
| `bookAnchor` | `#book` | `scrollIntoView` target from the mobile CTA on desktop |
| `price` | `.booking-panel__price` | removes the `priceLoading` class |
| `priceAmount` | `.booking-panel__price-amount` | `textContent` = `$269` |
| `priceUnit` | `.booking-panel__price-unit` | `textContent` = ` CAD per person` |
| `travellersBtn` | `#travellersBtn` | click, `classList`, `aria-expanded` |
| `travellersLabel` | `#travellersLabel` | `textContent` = `Adult x 2, Youth x 1` |
| `travellersDropdown` | `#travellersDropdown` | `.hidden`, click (stopPropagation) |
| `travellersRows` | `#bp-travellers-rows` | `innerHTML` — **fully generated** |
| `travellersContinue` | `#travellersContinue` | click |
| `dateBtn` | `#dateBtn` | click, `classList`, `aria-expanded`, **`dataset.selectedDate`** |
| `dateLabel` | `#dateLabel` | `textContent` = `June 14, 2026` |
| `calendar` | `#calendarDropdown` | `.hidden`, click (stopPropagation) |
| `calPrev` / `calNext` | `#calPrev` / `#calNext` | click, `.disabled` |
| `calMonth1` / `calMonth2` | `#calMonth1` / `#calMonth2` | `textContent` |
| `calGrid1` / `calGrid2` | `#calGrid1` / `#calGrid2` | `innerHTML` — **fully generated** |
| `checkAvailBtn` | `#checkAvailBtn` | click |
| `expansion` | `#bpExpansion` | `.hidden`, `getBoundingClientRect()` |
| `expansionCard` | `.bp-expansion__card` | queried **inside** `expansion`; skeleton class |
| `expansionBadge` | `#expansionBadge` | `textContent`, `.hidden` |
| `expansionTitle` / `expansionDuration` | ids | `textContent` from the live product |
| `expansionDate` / `expansionStartTime` | ids | `textContent` |
| `expansionCancelDate` / `expansionCancelTime` | ids | `textContent` |
| `expansionValidation` | `#expansionValidation` | `textContent`, `.hidden`, error class |
| `expansionTotal` / `expansionBreakdown` | ids | `textContent` |
| `bookNowBtn` | `#bookNowBtn` | click, `.disabled`, `textContent` save/restore |
| `mobileCta` / `mobileCtaBtn` | ids | click |
| `mobileCtaPrice` | `#mobileCtaPrice` | `innerHTML` |
| `mobileSheetBackdrop` / `mobileSheetClose` | ids | click |
| `jsonLd` | `script[type="application/ld+json"]` | `textContent` rewritten — see §4 |

### Classes the engine adds, removes, or generates

`priceLoading` · `selectRowOpen` · `travellersRow` · `travellersInfo` ·
`travellersName` · `travellersAge` · `stepper` · `stepperBtn` ·
`stepperCount` · `calDay` · `calDayNum` · `calDayPrice` · `calDayPast` ·
`calDayUnavailable` · `calDayAvailable` · `calDaySelected` ·
`expansionCardSkeleton` · `validationError` · `mobileCtaUnit` · `sheetOpen`

Classes that only appear in static markup are **not** listed and are free to
rename without telling the engine.

### Generated stepper ids

Traveller steppers are created at runtime, one set per Bokun pricing
category, keyed by the lowercased category title:

```
btn-plus-{cat}   btn-minus-{cat}   count-{cat}
```

`{cat}` ∈ `adult` · `senior` · `youth` · `child` · `infant`. Override the
templates with `stepperIds` if you need a different scheme.

### Structural requirements the selector map cannot express

1. `expansionCard` is queried **within** `expansion` — it must stay a
   descendant.
2. `travellersRows` and the two calendar grids have their `innerHTML`
   replaced. Do not put hand-authored markup inside them.
3. **`hidden` is a state machine, not decoration.** `travellersDropdown`,
   `calendar`, `expansion`, `expansionBadge` and `expansionValidation` are all
   seeded `hidden` in the markup, and the engine *reads it back* to decide
   whether a toggle opens or closes (`travellersDropdown.hidden ? open :
   close`). Ship the markup without those seeds and both dropdowns and the
   whole expansion card render open on load, with every toggle inverted.
4. **The CSS is entangled with that same attribute**, so swapping `hidden`
   for an `is-open` class breaks two things silently:
   - `.bp-dropdown:not([hidden])` and `.bp-expansion:not([hidden])` carry the
     open animations — they simply stop running.
   - `.bp-expansion__badge` sets `display: inline-block`, which beats the UA's
     `[hidden] { display: none }`. A dedicated `.bp-expansion__badge[hidden]`
     rule puts it back. Drop it and the scarcity badge shows permanently,
     with stale text.

   If you do want class-based state, change the engine and the CSS in the
   same commit and re-run `tests/page-integrity.spec.js`.

---

## 3. Global + event contract

```js
window.BOKUN = {
  product, pickupPlaces, dropoffPlaces, availability,
  pricePerCategory, lowestAdultPrice, currency, ready, error,
}
window.bokunBooking = { counts, mins, date, slot, startTimeId, rateId }
window.HORIZON      = { hotel, ref, funnel }   // set by /js/referral.js — see §8
window.HorizonBooking = { mount, paintCachedPrice, instance, DEFAULT_SELECTORS, … }
window.__horizonShowExpansion                  // back-compat alias for expansion.show
```

`window.BOKUN.ready` / `.error` are the supported signal that the bootstrap
finished. The test suite and live debugging both rely on them.

Events dispatched on `document`:

| Event | When | Detail |
|---|---|---|
| `bokun:ready` | product + pickup + availability all loaded | `window.BOKUN` |
| `bokun:error` | any of the three failed | the Error |
| `horizon:checkout_started` | just before navigating to `/checkout/` | `{ booking_id, tour_id, hotel }` |

`bokun:ready` fires **after** the engine has already updated its own UI, so a
listener can assume prices and rows are rendered.

`/checkout/` has its own separate event set (`horizon:checkout-ready`,
`section1-complete`, `section2-complete`, `hold-expired`,
`booking_confirmed`). That page is **not** covered by this extraction — see
§9.

---

## 3a. Page-local code must call the engine, never reach into it

Anything on the page that is *not* the booking engine — a photo viewer, a
sticky header, a hero CTA — must go through the public API rather than
grabbing an element the selector map owns. Hardcoding `#dateBtn` works
today and breaks silently the moment someone renames it.

```js
var booking = window.HorizonBooking && window.HorizonBooking.instance;
if (booking && booking.panel) booking.panel.revealCalendar(400);
```

Available on `HorizonBooking.instance`:

| | |
|---|---|
| `panel.revealCalendar(delayMs)` | scroll the date control into view, then open the calendar |
| `panel.openCalendar()` / `closeCalendar()` | open/close without scrolling |
| `panel.renderCalendar()` | force a redraw |
| `expansion.show()` / `hide()` | open/close the confirm card |
| `expansion.getBookingData()` | the current `{ date, adults, youth, infants }` |
| `mobileCta.openSheet()` / `closeSheet()` | mobile bottom sheet |
| `reload()` | re-run the whole Bokun bootstrap |

The photo viewer's "Check availability" button is the worked example — it
used to click `#dateBtn` directly and now calls `revealCalendar()`.

### The price selectors are shared with an inline snippet

The pre-paint snippet (§4) cannot use the engine, because it must run before
the engine loads. So the page defines the price selectors **once** and hands
the same values to both:

```js
var HORIZON_PRICE = {
  productId: 1162721,
  amount: '.booking-panel__price-amount',
  unit:   '.booking-panel__price-unit',
  wrap:   '.booking-panel__price',
  loadingClass: 'booking-panel__price--loading',
};
// …the snippet reads HORIZON_PRICE…
HorizonBooking.mount({
  productId: HORIZON_PRICE.productId,
  selectors: { priceAmount: HORIZON_PRICE.amount, priceUnit: HORIZON_PRICE.unit, price: HORIZON_PRICE.wrap },
  classes:   { priceLoading: HORIZON_PRICE.loadingClass },
});
```

Rename the price markup and both follow. Split them apart again and the
shimmer quietly returns for repeat visitors, with nothing failing.

---

## 4. Cross-page contracts

**Price cache.** `/tours/` writes and the tour page reads:

```
localStorage['hzn_price_' + productId] = { price: <number>, exp: <epoch ms> }   // 1h TTL
```

Both pages must agree on key and shape. Change one, change both in the same
commit.

**Pre-paint snippet.** A ~15-line inline `<script>` in the tour page reads
that cache and paints the price before first paint, so a repeat visitor never
sees the shimmer. It **must stay inline and must stay above the engine's
script tags** — an external or deferred version paints too late.
`HorizonBooking.paintCachedPrice()` is the same logic if you would rather
call it, but it is only available after `mount.js` has loaded, which is
already too late for the no-flash guarantee.

**JSON-LD.** The page ships a static `TouristTrip` block whose
`offers.price` is rewritten at runtime with the live Bokun price. This is
SEO-visible: dropping or restructuring the block silently loses rich results.

The engine scans **all** `ld+json` blocks and patches whichever ones carry an
`offers` object, rather than blindly taking the first match — so adding
`BreadcrumbList`, `FAQPage` or `Organization` schema (a routine SEO task
nobody would think of as touching booking) cannot hijack the price patch. If
no block has an `offers` object, it warns that the structured-data price is
stale.

---

## 5. Worker contract

Base: `https://horizon-bokun.ivan-mueller02.workers.dev` (separate origin,
CORS allowlist includes `localhost` and `*.pages.dev`).

| Call | Used for |
|---|---|
| `GET /api/product/:id` | title, duration, `pricingCategories`, `rates` |
| `GET /api/pickup-places/:id` | pickup/dropoff lists |
| `GET /api/availability/:id?start&end` | slots, prices, capacity |
| `POST /api/booking/initiate` | mints `booking_id`, writes the KV cart |

`/api/booking/initiate` payload:

```jsonc
{
  "tour_id":     1162721,        // positive int, required
  "date":        "2026-06-14",   // YYYY-MM-DD, required
  "time":        "08:30",        // slot.startTime
  "activity_id": 5438571,        // slot.startTimeId
  "rate_id":     4471382,        // slot.defaultRateId — Bokun rejects without it
  "adults":      2,              // adult + senior
  "youth":       1,              // youth + child
  "infants":     0,              // infant
  "hotel": null, "ref": null, "funnel": null,
  "currency":    "CAD",
  "tour_image":  "https://gowithhorizon.com/..."  // MUST be apex, else nulled
}
```

**The three-bucket collapse is a hard contract.** Bokun exposes up to five
pricing categories; the Worker, the checkout page, and the dashboard all
assume exactly `adults` / `youth` / `infants`, with seniors billing as adults
and children as youth. Changing it on one side only breaks bookings silently.

Response `{ booking_id }` → the page hard-navigates to
`/checkout/?id=<booking_id>`. That navigation is the **only** seam between
the tour page and checkout. The hard nav is intentional (back button,
analytics, mobile reliability).

`initiate` is a pure KV write with a 15-minute self-expiring TTL. It creates
no Bokun reservation and makes no Stripe call — which is why the test suite
can safely exercise it.

---

## 6. Known quirks — preserved deliberately

These looked like bugs during extraction and were kept anyway. Do not "clean
them up" as part of a redesign; fix them deliberately, with a test, or not at
all.

1. **UTC/local date asymmetry.** Bokun slot timestamps are keyed to a date
   with `toISOString()` (**UTC**), but calendar cells and lazy-fetch ranges
   use **local** date arithmetic. This is benign for a 08:30 Mountain
   departure (15:30 UTC — same calendar day everywhere) and would break for a
   late-evening departure or a differently-timed product. The test suite pins
   the browser to `America/Edmonton` for determinism.

2. **Infants count twice, on purpose.** They are excluded from the money
   total and labelled "complimentary", but included in the participant count
   that validates against `slot.availabilityCount` — because Bokun counts
   them toward capacity.

3. **Per-category price fallback.** When `/availability` has not resolved,
   `categoryPrice()` falls back to the lowest adult price for every category.
   Correct for this product (flat pricing); wrong for a product with real
   per-category pricing.

4. **`window.bokunBooking.date` is write-only.** It is set on date
   selection and never read — everything reads
   `dateBtn.dataset.selectedDate`. Kept for compatibility.

5. **The 350ms skeleton flash** when the expansion updates in place is
   deliberate UX, not a loading state.

6. **`preferredStartTimeId` (5438571)** picks the 08:30 departure when a day
   offers several. Products with multiple real departures need a time picker;
   every slot for a day is already indexed so that picker has data.

Removed during extraction as genuinely dead: a `DOW` weekday array (the
headers are static markup) and an unused `STRIPE_PUBLISHABLE_KEY` on the tour
page (checkout declares its own).

### Page-level traps that are not the engine's

Found while extracting; left as they are, but worth knowing before you
redesign. `tests/page-integrity.spec.js` guards all of them.

- **Nine inline `onclick` attributes** still exist: eight
  `openWydLightbox(0..7)` on the itinerary items, and one
  `toggleDescription()`. Both functions are global only because their scripts
  are classic and un-wrapped — `openWydLightbox` via an explicit
  `window.openWydLightbox = open` assignment, `toggleDescription` purely by
  living at the top level of a classic script. Wrapping either in an IIFE
  during a tidy-up breaks the feature silently and immediately.
- **`#expansionHeader` reads "1 option available" and is entirely static.** No
  JS touches it, despite it looking dynamic. If departures ever vary, that
  text will lie.
- **The pickup pill default lives in two places** — the
  `bp-pickup__pill--active` class in the markup and `var activeLocation =
  'canmore'` in the pickup-map script. Change one and the map opens on the
  wrong town until the visitor clicks a pill.
- **Leaflet is used unguarded.** Both the itinerary lightbox and the pickup
  map call `L.map(...)` with no `typeof L` check, and Leaflet comes from
  cdnjs. On a network that blocks that CDN — hotel wifi, a corporate
  guest network — clicking an itinerary item throws and the lightbox stays
  broken. Pre-existing, not introduced here, and worth fixing on its own.

### Deliberate deviations from the original

Three things do **not** behave exactly as the inline version did. Each was a
considered call, not an accident:

1. **`getBookingData()` no longer throws on a missing date control.** The
   inline version did an unguarded `document.getElementById('dateBtn').dataset`,
   which threw a `TypeError` out of the click handler. It now returns an empty
   date, which routes into the normal "Please pick a date." validation and
   disables checkout — and the panel separately warns that the element is
   missing. Strictly more debuggable, and no worse for a visitor.

2. **`window.BOKUN` is initialised with `||`, not clobbered.** The inline
   version reassigned the whole object; a double-load reset `ready` to false
   and orphaned in-flight state. `initGlobals()` now preserves an existing
   object.

3. **`preferredStartTimeId` defaults to `null`, not to Banff's 08:30 id.**
   The inline code hardcoded `5438571`. As a default in a *shared* module
   that is a trap: a second tour that forgets to set it would silently
   inherit another tour's departure. `null` means "first bookable slot of the
   day"; the canoe page passes `5438571` explicitly.

4. **A missing `tourImage` warns.** The Worker drops any `tour_image` that is
   not on the apex domain, so a forgotten or wrong one leaves the checkout
   page imageless with nothing failing.

5. **Listeners are registered before the fetch starts.** The inline version
   relied on the network always being slower than HTML parsing, which was
   true but unenforced. `mount()` builds the whole UI first, then loads. Same
   observable behaviour, minus the assumption. One visible consequence:
   external `bokun:ready` listeners now fire *after* the engine has updated
   its own UI, rather than interleaved with it. The engine's own components
   are wired by direct call, not by subscription — `bokun:ready` is for
   *external* consumers only. Anything new that listens for it should also
   check `window.BOKUN.ready` on startup, in case it registered late.

---

## 7. How to redesign a page safely

1. **Run the suite first**, on the page as it is: `npm run test:booking`.
   Green baseline, or fix that before touching anything.
2. **Redesign the markup.** Rename ids and classes as freely as you like.
3. **Update the maps in `mount.js`** — or better, pass `selectors` /
   `classes` overrides from the page — so the engine finds the new names.
   Never edit `panel.js` / `expansion.js` / `mobile-cta.js` for a visual
   change.
4. **Honour the four structural rules in §2**, the pre-paint snippet in §4,
   and the JSON-LD block.
5. **Run the suite again.** It must be green before the commit lands.
6. **Before deploying**, run `npm run test:booking:live` from a machine with
   network access to the Worker. Fixtures prove the front end still drives
   the flow; only the live run proves the integration works.

The engine is loud about a broken map rather than silently rendering a page
that looks fine and cannot book:

```
[HorizonBooking] checkout not mounted — no element matched: bookNowBtn (#bookNowBtn). See docs/booking-contract.md §2.
[HorizonBooking] booking panel incomplete — no element matched: dateBtn (#dateBtn), calendar (#calendarDropdown). …
[HorizonBooking] unknown selector key: bookNowBtnn
```

None of these throw — a bad map degrades the page, it never takes it down.
Watch the console while redesigning, and treat any of them as a build break.

**Proof this works:** `tests/redesign.spec.js` runs the whole flow against a
page rebuilt from scratch — no shared id, class, tag structure, or naming
convention with production, reconnected purely through the override map. If
you are wondering whether you are allowed to change something, that harness
(`tests/fixtures/redesigned-tour.js`) is the worked example.

---

## 8. Explicitly NOT protected: partner attribution

`?hotel=<slug>` and `?ref=<CODE>` capture, `/js/referral.js` funnel
hydration, and the `hotel` / `ref` / `funnel` fields in the initiate payload
are **not a release gate**, per the site owner: the hotel-referral programme
is paused.

The plumbing is still in place and still passes through — removing it would
be work and risk for no gain, and the Worker and dashboard still accept the
fields. But no test asserts on it, and a redesign that drops
`/js/referral.js` from a page will not fail CI. If the programme restarts,
add the assertion back before relying on the data.

---

## 9. Explicitly NOT covered: `/checkout/`

`checkout/index.html` is still a 2,100-line inline monolith running a
four-section state machine over Bokun `/checkout/options` → `/checkout/submit`,
a Stripe SetupIntent and `confirmSetup`, a 15-minute KV hold with an expiry
path, and a REDIRECT-vs-TOKEN channel branch.

It is more fragile than the tour page ever was. Restyle it — tokens, type,
spacing, buttons — but do not restructure it without giving it the same
extract-then-redesign treatment first. Note also that it inlines a **live**
Stripe publishable key and the Worker's CORS allowlist accepts `*.pages.dev`,
so a full checkout run on a preview deployment hits live Stripe. Set up a
test lane (`0B_VALIDATION.md`) before testing past the tour page.

---

## 10. The test suite

```
tools/visual-diff.sh             render the page now vs at a git ref, compare pixels
tests/booking.spec.js            20 tests — the safety net on the real page
tests/redesign.spec.js            7 tests — the same flow on rebuilt markup
tests/page-integrity.spec.js      6 tests — the non-booking couplings above
tests/fixtures/bokun.js           recorded Bokun shapes, generated relative to today
tests/fixtures/redesigned-tour.js a from-scratch page wired only via overrides
tests/static-server.mjs           dependency-free static server for the harness
```

33 tests total; 32 run offline, 1 is live-only.

`npm run test:booking` (fixtures, offline, deterministic — safe for CI) ·
`npm run test:booking:live` (real Worker; run before deploying).

```sh
tools/visual-diff.sh              # working tree vs HEAD
tools/visual-diff.sh main         # vs another ref
tools/visual-diff.sh HEAD~3 tours/index.html
```

`visual-diff.sh` renders the page with mocked Bokun data and third-party
assets blocked, so it is deterministic and needs no network. It is how the
extraction's "no visual change" claim was verified: the extracted page and
the pre-extraction commit produce **byte-identical** full-page screenshots
(1280×8436, same SHA256). During the redesign it answers the reverse
question — "this was meant to be a CSS-only refactor; did it move any
pixels?"

Every assertion maps to a section above. The suite has been checked two ways:
it passes unchanged against the **pre-extraction** page (proving the
extraction is behaviour-equivalent), and it has been mutation-tested — break
the category collapse, the JSON-LD patch, the price cache, or the capacity
validation, and the corresponding test fails.

One fixture detail worth keeping: `ADULT_PRICE` is deliberately **not** 269,
because 269 is the value hardcoded in the page's static JSON-LD. If they
matched, the "JSON-LD was patched with the live price" assertion would pass
even with the patch broken. It did, until that was caught.
