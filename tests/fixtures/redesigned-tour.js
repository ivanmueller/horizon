/* ─────────────────────────────────────────────────────────────────────────
   A deliberately, aggressively redesigned tour page.
   ─────────────────────────────────────────────────────────────────────────
   This is the proof that the extraction did its job. Nothing here shares a
   single id or class name with the production page: different tags,
   different structure, different naming convention (utility-ish `bk-*`
   classes and data attributes instead of BEM), no `booking-panel`, no `bp-`
   anything, steppers named differently.

   The ONLY thing connecting it to the booking engine is the selectors /
   classes / stepperIds override passed to mount(). If the full booking flow
   works against this page, a real redesign cannot break the integration by
   renaming things — which is exactly the guarantee the redesign needs.

   Served to the browser via Playwright route interception rather than a file
   on disk, so no decoy tour page ends up deployed on the live domain.
   ───────────────────────────────────────────────────────────────────────── */

export const REDESIGN_SELECTORS = {
  panel:               '[data-booking-widget]',
  bookAnchor:          '#reserve',
  price:               '[data-price]',
  priceAmount:         '[data-price-value]',
  priceUnit:           '[data-price-unit]',

  travellersBtn:       '#guests-toggle',
  travellersLabel:     '#guests-summary',
  travellersDropdown:  '#guests-popover',
  travellersRows:      '#guests-list',
  travellersContinue:  '#guests-done',

  dateBtn:             '#when-toggle',
  dateLabel:           '#when-summary',
  calendar:            '#when-popover',
  calPrev:             '#when-back',
  calNext:             '#when-fwd',
  calMonth1:           '#when-m1-label',
  calMonth2:           '#when-m2-label',
  calGrid1:            '#when-m1-grid',
  calGrid2:            '#when-m2-grid',

  checkAvailBtn:       '#find-departures',
  expansion:           '#confirm',
  expansionCard:       '.confirm-inner',
  expansionBadge:      '#confirm-scarcity',
  expansionTitle:      '#confirm-name',
  expansionDuration:   '#confirm-length',
  expansionDate:       '#confirm-when',
  expansionStartTime:  '#confirm-depart',
  expansionCancelDate: '#confirm-refund-by',
  expansionCancelTime: '#confirm-refund-at',
  expansionValidation: '#confirm-warning',
  expansionTotal:      '#confirm-sum',
  expansionBreakdown:  '#confirm-lines',
  bookNowBtn:          '#go-to-payment',

  mobileCta:           '#dock',
  mobileCtaPrice:      '#dock-price',
  mobileCtaBtn:        '#dock-action',
  mobileSheetBackdrop: '#dock-scrim',
  mobileSheetClose:    '#dock-dismiss',

  jsonLd:              'script[type="application/ld+json"]',
};

export const REDESIGN_CLASSES = {
  priceLoading:          'is-pending',
  selectRowOpen:         'is-open',
  travellersRow:         'guest-line',
  travellersInfo:        'guest-line-text',
  travellersName:        'guest-line-title',
  travellersAge:         'guest-line-sub',
  stepper:               'counter',
  stepperBtn:            'counter-key',
  stepperCount:          'counter-value',
  calDay:                'day',
  calDayNum:             'day-n',
  calDayPrice:           'day-cost',
  calDayPast:            'day--gone',
  calDayUnavailable:     'day--closed',
  calDayAvailable:       'day--open',
  calDaySelected:        'day--picked',
  expansionCardSkeleton: 'confirm-inner--busy',
  validationError:       'confirm-warning--bad',
  mobileCtaUnit:         'dock-price-unit',
  sheetOpen:             'dock-expanded',
};

export const REDESIGN_STEPPER_IDS = {
  plus:  'add-{cat}',
  minus: 'sub-{cat}',
  count: 'qty-{cat}',
};

export function redesignedPageHtml({ productId = 1162721 } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redesigned tour page — booking engine harness</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; }
  [data-booking-widget] { position: sticky; top: 24px; }
  [hidden] { display: none !important; }
  .day--gone, .day--closed { opacity: .35; }
  .counter-key { min-width: 32px; }
  #when-m1-grid, #when-m2-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
</style>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"TouristTrip","name":"Redesigned Canoe Tour","offers":{"@type":"Offer","price":"269","priceCurrency":"CAD"}}
</script>
</head>
<body>

<article>
  <h1>Redesigned Canoe Tour</h1>
  <div id="tour-copy"><p>A completely different page structure.</p></div>
</article>

<!-- Confirm card. Structurally required: .confirm-inner must be a
     descendant of #confirm, and #confirm is toggled via [hidden]. -->
<section id="confirm" hidden>
  <div class="confirm-inner">
    <span id="confirm-scarcity" hidden></span>
    <h2 id="confirm-name"></h2>
    <span id="confirm-length"></span>
    <p><span id="confirm-when"></span> · departs <span id="confirm-depart"></span></p>
    <p>Free cancellation until <strong id="confirm-refund-by"></strong> at <span id="confirm-refund-at"></span></p>
    <p id="confirm-warning" hidden></p>
    <p><strong id="confirm-sum"></strong> <small id="confirm-lines"></small></p>
    <button type="button" id="go-to-payment">Continue to checkout</button>
  </div>
</section>

<aside id="reserve" data-booking-widget>
  <div data-price class="is-pending">
    <span data-price-value></span><span data-price-unit></span>
  </div>

  <button type="button" id="guests-toggle" aria-expanded="false">
    <span id="guests-summary">Adult x 1</span>
  </button>
  <div id="guests-popover" hidden>
    <div id="guests-list"></div>
    <button type="button" id="guests-done">Done</button>
  </div>

  <button type="button" id="when-toggle" aria-expanded="false">
    <span id="when-summary">Select date</span>
  </button>
  <div id="when-popover" hidden>
    <button type="button" id="when-back">‹</button>
    <span id="when-m1-label"></span>
    <span id="when-m2-label"></span>
    <button type="button" id="when-fwd">›</button>
    <div id="when-m1-grid"></div>
    <div id="when-m2-grid"></div>
  </div>

  <button type="button" id="find-departures">Check availability</button>
</aside>

<div id="dock-scrim"></div>
<div id="dock">
  <span id="dock-price"></span>
  <button type="button" id="dock-dismiss">×</button>
  <button type="button" id="dock-action">Check availability</button>
</div>

<script src="/js/booking/bokun-client.js"></script>
<script src="/js/booking/booking-state.js"></script>
<script src="/js/booking/panel.js"></script>
<script src="/js/booking/expansion.js"></script>
<script src="/js/booking/mobile-cta.js"></script>
<script src="/js/booking/mount.js"></script>
<script>
  HorizonBooking.mount({
    productId: ${productId},
    tourImage: 'https://gowithhorizon.com/tours/banff-hidden-gem-canoe-tour/images/hero.jpg',
    preferredStartTimeId: 5438571,
    selectors:  ${JSON.stringify(REDESIGN_SELECTORS)},
    classes:    ${JSON.stringify(REDESIGN_CLASSES)},
    stepperIds: ${JSON.stringify(REDESIGN_STEPPER_IDS)},
  });
</script>
</body>
</html>`;
}

export const REDESIGN_URL = 'http://localhost:8788/__redesign-harness';

/* Serves the harness from memory, so nothing lands in the deployed tree. */
export async function installRedesignedPage(page, opts = {}) {
  await page.route(REDESIGN_URL, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: redesignedPageHtml(opts),
  }));
}
