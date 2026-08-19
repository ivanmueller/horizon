/* ─────────────────────────────────────────────────────────────────────────
   Horizon booking engine · mount
   ─────────────────────────────────────────────────────────────────────────
   THE FILE A REDESIGN TOUCHES. Everything else in /js/booking/ can be left
   alone.

   A tour page wires up its whole booking flow with one call:

       HorizonBooking.mount({ productId: 1162721 });

   To restyle or restructure the markup, pass overrides instead of editing
   logic:

       HorizonBooking.mount({
         productId: 1162721,
         selectors: { bookNowBtn: '#checkout-cta', dateBtn: '[data-date-picker]' },
         classes:   { calDay: 'c-calendar__day' },
       });

   Anything not overridden falls back to the defaults below, which are the
   ids and class names the page shipped with. See docs/booking-contract.md.
   ───────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  /* Dependencies are resolved lazily, not captured at eval time. The six
     booking files must load in order (client → state → panel → expansion →
     mobile-cta → mount); if that order is broken — or someone adds `defer`
     or `async` to some tags but not the inline mount() call — this says so
     instead of throwing "cannot read property of undefined". */
  function need(name) {
    var mod = global[name];
    if (!mod) {
      throw new Error('[HorizonBooking] ' + name + ' is not loaded. The booking files must ' +
        'load in order: bokun-client, booking-state, panel, expansion, mobile-cta, mount — ' +
        'as classic scripts, with no defer/async. See docs/booking-contract.md §1.');
    }
    return mod;
  }
  function C() { return need('HorizonBokunClient'); }
  function S() { return need('HorizonBookingState'); }


  /* ── Default selector map ──────────────────────────────────────────────
     Every DOM lookup in the booking engine resolves through here. */
  var DEFAULT_SELECTORS = {
    // Panel shell + price header
    panel:              '.booking-panel',
    bookAnchor:         '#book',
    price:              '.booking-panel__price',
    priceAmount:        '.booking-panel__price-amount',
    priceUnit:          '.booking-panel__price-unit',

    // Travellers
    travellersBtn:      '#travellersBtn',
    travellersLabel:    '#travellersLabel',
    travellersDropdown: '#travellersDropdown',
    travellersRows:     '#bp-travellers-rows',
    travellersContinue: '#travellersContinue',

    // Calendar
    dateBtn:            '#dateBtn',
    dateLabel:          '#dateLabel',
    calendar:           '#calendarDropdown',
    calPrev:            '#calPrev',
    calNext:            '#calNext',
    calMonth1:          '#calMonth1',
    calMonth2:          '#calMonth2',
    calGrid1:           '#calGrid1',
    calGrid2:           '#calGrid2',

    // Expansion / confirm card
    checkAvailBtn:      '#checkAvailBtn',
    expansion:          '#bpExpansion',
    expansionCard:      '.bp-expansion__card',
    expansionBadge:     '#expansionBadge',
    expansionTitle:     '#expansionTitle',
    expansionDuration:  '#expansionDuration',
    expansionDate:      '#expansionDate',
    expansionStartTime: '#expansionStartTime',
    expansionCancelDate:'#expansionCancelDate',
    expansionCancelTime:'#expansionCancelTime',
    expansionValidation:'#expansionValidation',
    expansionTotal:     '#expansionTotal',
    expansionBreakdown: '#expansionBreakdown',
    bookNowBtn:         '#bookNowBtn',

    // Mobile sticky bar + sheet
    mobileCta:          '#mobileCta',
    mobileCtaPrice:     '#mobileCtaPrice',
    mobileCtaBtn:       '#mobileCtaBtn',
    mobileSheetBackdrop:'#mobileSheetBackdrop',
    mobileSheetClose:   '#mobileSheetClose',

    // SEO
    jsonLd:             'script[type="application/ld+json"]',
  };

  /* ── Default class map ─────────────────────────────────────────────────
     Class names the engine ADDS, REMOVES, or writes into generated markup.
     (Classes that only appear in static HTML are not listed — those are
     free to rename without telling the engine.) */
  var DEFAULT_CLASSES = {
    priceLoading:          'booking-panel__price--loading',
    selectRowOpen:         'booking-panel__select-row--open',

    travellersRow:         'bp-travellers__row',
    travellersInfo:        'bp-travellers__info',
    travellersName:        'bp-travellers__name',
    travellersAge:         'bp-travellers__age',
    stepper:               'bp-stepper',
    stepperBtn:            'bp-stepper__btn',
    stepperCount:          'bp-stepper__count',

    calDay:                'cal-day',
    calDayNum:             'cal-day__num',
    calDayPrice:           'cal-day__price',
    calDayPast:            'cal-day--past',
    calDayUnavailable:     'cal-day--unavailable',
    calDayAvailable:       'cal-day--available',
    calDaySelected:        'cal-day--selected',

    expansionCardSkeleton: 'bp-expansion__card--skeleton',
    validationError:       'bp-expansion__validation--error',

    mobileCtaUnit:         'mobile-cta-bar__unit',
    sheetOpen:             'mobile-sheet-open',
  };

  /* Ids for the per-category stepper controls, which are generated at
     runtime and so cannot be plain selectors. {cat} is the lowercased
     Bokun category title. */
  var DEFAULT_STEPPER_IDS = {
    plus:  'btn-plus-{cat}',
    minus: 'btn-minus-{cat}',
    count: 'count-{cat}',
  };

  var DEFAULTS = {
    apiBase:              null,   // resolved in mount(); see below
    productId:            null,
    /* null = "use the first bookable slot of the day". Deliberately NOT a
       real start-time id: this is a shared module, and defaulting to one
       tour's magic number means a second tour that forgets to set it
       silently inherits Banff's 08:30 departure. Set it per page. */
    preferredStartTimeId: null,
    availabilityWindowDays: 60,
    checkoutUrl:          '/checkout/',
    tourImage:            null,
    mobileBreakpoint:     960,
    continuingLabel:      'Continuing…',
    initiateErrorMessage: 'Sorry — we couldn’t hold your spot. Please try again.',
    travellersErrorHtml:  '<div class="bp-travellers__row" style="border-bottom:none;justify-content:center;color:#B91C1C;">Couldn\'t load tour info. Please refresh.</div>',
    patchJsonLd:          true,
    debug:                true,
  };

  function assign(target, source) {
    if (!source) return target;
    Object.keys(source).forEach(function (k) { target[k] = source[k]; });
    return target;
  }

  /* ── Pre-paint price ───────────────────────────────────────────────────
     Exposed separately because it must run BEFORE first paint to stop the
     price shimmering on a repeat visit — which means it is called from a
     tiny inline <script> in the page, not from mount(). See
     docs/booking-contract.md §4. */
  function paintCachedPrice(productId, selectors) {
    var sels = assign(assign({}, DEFAULT_SELECTORS), selectors);
    var entry = C().readCachedPrice(productId);
    if (!entry) return false;
    var amtEl    = document.querySelector(sels.priceAmount);
    var unitEl   = document.querySelector(sels.priceUnit);
    var priceDiv = document.querySelector(sels.price);
    if (amtEl)    amtEl.textContent = '$' + entry.price;
    if (unitEl)   unitEl.textContent = ' CAD per person';
    if (priceDiv) priceDiv.classList.remove(DEFAULT_CLASSES.priceLoading);
    return true;
  }

  /* ── Query-param capture ───────────────────────────────────────────────
     ?hotel=<slug> and ?ref=<CODE> drive partner attribution. The programme
     is paused, so this is best-effort and never blocks a booking; the
     durable funnel in /js/referral.js re-hydrates window.HORIZON anyway. */
  function readPartnerParams() {
    global.HORIZON = global.HORIZON || {};
    try {
      var params = new URLSearchParams(global.location.search);
      var hotel = params.get('hotel');
      if (hotel && /^[a-z0-9-]{2,40}$/i.test(hotel)) global.HORIZON.hotel = hotel.trim().toLowerCase();
      var ref = params.get('ref');
      if (ref && /^[a-z0-9_]{2,40}$/i.test(ref)) global.HORIZON.ref = ref.trim().toUpperCase();
    } catch (e) { /* no URL API or malformed query — skip */ }
  }

  function mount(options) {
    var opts = assign(assign({}, DEFAULTS), options);
    if (!opts.apiBase) opts.apiBase = C().DEFAULT_API_BASE;
    if (!opts.productId) throw new Error('HorizonBooking.mount: productId is required');
    /* Per-tour, and easy to forget when copying this page for a second tour.
       The Worker nulls any tour_image not on the apex domain, so a missing or
       wrong one silently leaves the checkout page without an image. */
    if (!opts.tourImage) {
      console.warn('[HorizonBooking] no tourImage configured — /checkout/ will show no image ' +
        'for this booking. It must be an https://gowithhorizon.com/ URL or the Worker drops it.');
    }

    var selectors   = assign(assign({}, DEFAULT_SELECTORS), options && options.selectors);
    var classes     = assign(assign({}, DEFAULT_CLASSES),   options && options.classes);
    var stepperIds  = assign(assign({}, DEFAULT_STEPPER_IDS), options && options.stepperIds);

    S().initGlobals();
    readPartnerParams();

    var ctx = {
      opts:       opts,
      productId:  opts.productId,
      client:     new (C().Client)({ apiBase: opts.apiBase, productId: opts.productId }),
      preferredStartTimeId: opts.preferredStartTimeId,
      sel:        function (key) {
        var s = selectors[key];
        if (!s) { console.warn('[HorizonBooking] unknown selector key:', key); return null; }
        return document.querySelector(s);
      },
      rawSelector: function (key) { return selectors[key]; },
      cls:        function (key) {
        var c = classes[key];
        if (!c) { console.warn('[HorizonBooking] unknown class key:', key); return ''; }
        return c;
      },
      stepperId:  function (kind, cat) { return stepperIds[kind].replace('{cat}', cat); },
    };

    /* Order matters: build the UI and register every bokun:ready listener
       BEFORE kicking off the fetch, so a fast cache hit can never resolve
       into an empty listener list. The inline version relied on the network
       always being slower than parsing; this is the same behaviour without
       the assumption. */
    var panel     = global.HorizonBookingPanel.init(ctx);
    var expansion = global.HorizonBookingExpansion.init(ctx);
    var mobileCta = global.HorizonBookingMobileCta.init(ctx);

    if (expansion) {
      ctx.showExpansion = expansion.show;
      // Back-compat: the inline version published this global and something
      // outside the engine may still call it.
      global.__horizonShowExpansion = expansion.show;
    }

    function applyHeaderPrice() {
      var amt = global.BOKUN.lowestAdultPrice;
      if (amt == null) return;
      var amtEl    = ctx.sel('priceAmount');
      var unitEl   = ctx.sel('priceUnit');
      var priceDiv = ctx.sel('price');
      if (amtEl)    amtEl.textContent = '$' + amt;
      if (unitEl)   unitEl.textContent = ' ' + global.BOKUN.currency + ' per person';
      if (priceDiv) priceDiv.classList.remove(ctx.cls('priceLoading'));
      C().writeCachedPrice(opts.productId, amt);
    }

    /* Rewrites the static offer price in the JSON-LD with the live one.
       SEO-visible: a redesign that drops the JSON-LD block silently loses
       rich results. */
    function applyJsonLd() {
      if (!opts.patchJsonLd) return;
      var amt = global.BOKUN.lowestAdultPrice;
      if (amt == null) return;

      /* Patch the block that actually carries the offer, not simply the first
         ld+json on the page. Adding BreadcrumbList / FAQPage / Organization
         schema above the TouristTrip block is a routine SEO task that nobody
         would think of as touching booking — and with a blind first-match it
         would silently send the live price into the wrong document. */
      var blocks = document.querySelectorAll(ctx.rawSelector('jsonLd'));
      var patched = 0;
      for (var i = 0; i < blocks.length; i++) {
        try {
          var data = JSON.parse(blocks[i].textContent);
          if (!data || !data.offers) continue;
          data.offers.price = String(amt);
          data.offers.priceCurrency = global.BOKUN.currency;
          blocks[i].textContent = JSON.stringify(data);
          patched++;
        } catch (e) {
          console.warn('[BOKUN] could not parse a JSON-LD block', e);
        }
      }
      if (!patched) {
        console.warn('[HorizonBooking] no JSON-LD block with an "offers" object — ' +
          'the structured-data price is stale. Search engines will show ' +
          'whatever is hardcoded in the markup.');
      }
    }

    /* If window.BOKUN is already populated when mount() runs — a double
       mount, or a page that pre-seeds it — catch the UI up immediately
       rather than waiting for a fetch that will not happen again. The
       inline version had the same guard at each listener registration. */
    if (global.BOKUN.ready) {
      if (panel)     panel.onBokunReady();
      if (mobileCta) mobileCta.onBokunReady();
    }

    function load() {
      var today = new Date();
      var start = C().ymdUtc(today);
      var end   = C().ymdUtc(new Date(today.getTime() + opts.availabilityWindowDays * 86400 * 1000));

      return Promise.all([
        ctx.client.fetchProduct(),
        ctx.client.fetchPickupPlaces(),
        ctx.client.fetchAvailability(start, end),
      ]).then(function (results) {
        var product = results[0];
        var places  = results[1] || {};
        var avail   = Array.isArray(results[2]) ? results[2] : [];

        global.BOKUN.product       = product;
        global.BOKUN.pickupPlaces  = places.pickupPlaces  || [];
        global.BOKUN.dropoffPlaces = places.dropoffPlaces || [];
        global.BOKUN.availability  = avail;

        var pricing = S().derivePricing(product, avail);
        if (pricing.pricePerCategory) {
          global.BOKUN.pricePerCategory = pricing.pricePerCategory;
          global.BOKUN.currency         = pricing.currency || 'CAD';
          global.BOKUN.lowestAdultPrice = pricing.lowestAdultPrice;
        }

        global.BOKUN.ready = true;

        if (opts.debug) {
          console.log('[BOKUN] loaded', {
            title: product && product.title,
            rateId: product && product.rates && product.rates[0] && product.rates[0].id,
            pricingCategories: ((product && product.pricingCategories) || []).map(function (c) {
              return c.id + ' ' + c.title;
            }),
            pickupCount: global.BOKUN.pickupPlaces.length,
            dropoffCount: global.BOKUN.dropoffPlaces.length,
            slots: avail.length,
            lowestAdultPrice: global.BOKUN.lowestAdultPrice,
            currency: global.BOKUN.currency,
          });
        }

        applyHeaderPrice();
        applyJsonLd();

        // Panel first, then the mobile bar — same order as the inline version.
        if (panel)     panel.onBokunReady();
        if (mobileCta) mobileCta.onBokunReady();

        // Public event. Kept because it is part of the documented contract
        // and is the supported way for page-local code to react.
        document.dispatchEvent(new CustomEvent('bokun:ready', { detail: global.BOKUN }));
      }).catch(function (err) {
        global.BOKUN.error = err;
        console.error('[BOKUN] load failed', err);
        if (panel) panel.onBokunError();
        document.dispatchEvent(new CustomEvent('bokun:error', { detail: err }));
      });
    }

    var api = {
      ctx: ctx,
      panel: panel,
      expansion: expansion,
      mobileCta: mobileCta,
      reload: load,
      selectors: selectors,
      classes: classes,
    };
    global.HorizonBooking.instance = api;

    load();
    return api;
  }

  global.HorizonBooking = {
    mount: mount,
    paintCachedPrice: paintCachedPrice,
    DEFAULT_SELECTORS: DEFAULT_SELECTORS,
    DEFAULT_CLASSES: DEFAULT_CLASSES,
    DEFAULTS: DEFAULTS,
    instance: null,
  };
})(window);
