/* ─────────────────────────────────────────────────────────────────────────
   Horizon booking engine · expansion card + checkout handoff
   ─────────────────────────────────────────────────────────────────────────
   The second half of the UI, and the one that touches money. It renders the
   confirm-your-departure card, validates the cart against the live slot, and
   on "Continue to checkout" mints a booking_id in the Worker's KV pouch and
   hard-navigates to /checkout/?id=<booking_id>.

   That navigation is the ONLY seam between this page and the checkout page.
   If you change the initiate payload, change workers/bokun/index.js and
   checkout/index.html in the same commit — see docs/booking-contract.md §5.
   ───────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var S = global.HorizonBookingState;

  function init(ctx) {
    var sel = ctx.sel, cls = ctx.cls;

    var checkBtn  = sel('checkAvailBtn');
    var bookBtn   = sel('bookNowBtn');
    var expansion = sel('expansion');
    if (!checkBtn || !bookBtn || !expansion) return null;

    function bokunCounts() {
      return (global.bokunBooking && global.bokunBooking.counts) || {};
    }

    /* ── Count-bucket collapse ─────────────────────────────────────────
       CONTRACT: the Worker's /api/booking/initiate takes exactly three
       count buckets — adults / youth / infants — while Bokun exposes up to
       five pricing categories. Seniors bill as adults and children as youth.
       The checkout page and the dashboard both assume this mapping. Do not
       change it on one side only. */
    function getBookingData() {
      var c = bokunCounts();
      var db = sel('dateBtn');
      return {
        date:    (db && db.dataset.selectedDate) || '',
        adults:  (c.adult || 0) + (c.senior || 0),
        youth:   (c.youth || 0) + (c.child  || 0),
        infants: (c.infant || 0),
      };
    }

    function populateExpansion() {
      var db = sel('dateBtn');
      var dateIso = (db && db.dataset.selectedDate) || '';
      var setText = function (key, value) { var el = sel(key); if (el) el.textContent = value; };

      setText('expansionDate',       dateIso ? S.formatLongDate(dateIso)   : '');
      setText('expansionCancelDate', dateIso ? S.formatCancelDate(dateIso) : '');

      var counts   = bokunCounts();
      var product  = global.BOKUN && global.BOKUN.product;
      var slot     = (global.bokunBooking && global.bokunBooking.slot) || null;
      var currency = (global.BOKUN && global.BOKUN.currency) || 'CAD';
      var currencyPrefix = S.currencyPrefixFor(currency, 'ca');

      // Title + duration come from the live product, not the markup.
      if (product) {
        if (product.title) setText('expansionTitle', product.title);
        setText('expansionDuration', product.durationText || product.duration || '');
      }

      // Start time from the picked slot.
      var startStr = slot && slot.startTime ? S.formatBokunTime(slot.startTime) : '';
      if (startStr) {
        setText('expansionStartTime',  startStr);
        setText('expansionCancelTime', startStr);
      }

      /* Scarcity badge — only when scarcity is real. Hidden for unlimited
         slots and whenever more than 10 spots remain, so the nudge stays
         honest. */
      var badge = sel('expansionBadge');
      if (badge) {
        if (slot && !slot.unlimitedAvailability && slot.availabilityCount != null && slot.availabilityCount <= 10) {
          if (slot.availabilityCount <= 0)      badge.textContent = 'Sold out';
          else if (slot.availabilityCount === 1) badge.textContent = 'Only 1 spot left';
          else                                   badge.textContent = 'Only ' + slot.availabilityCount + ' spots left';
          badge.hidden = false;
        } else {
          badge.hidden = true;
        }
      }

      var totals = S.computeTotals(product, counts, currencyPrefix);
      setText('expansionTotal',     currencyPrefix + totals.total.toFixed(2));
      setText('expansionBreakdown', totals.parts.join(' · '));

      // Validation gates the checkout button.
      var result = S.validate(dateIso, counts, slot);
      var validation = sel('expansionValidation');
      if (validation) {
        if (result.message) {
          validation.textContent = result.message;
          validation.hidden = false;
          validation.classList.toggle(cls('validationError'), result.isError);
        } else {
          validation.hidden = true;
        }
      }
      bookBtn.disabled = !!result.message;
    }

    function showExpansion() {
      var alreadyOpen = !expansion.hidden;
      var card = expansion.querySelector(ctx.rawSelector('expansionCard'));

      if (alreadyOpen && card) {
        // Deliberate skeleton flash so a changed party size reads as a
        // recalculation rather than a silent number swap.
        card.classList.add(cls('expansionCardSkeleton'));
        setTimeout(function () {
          populateExpansion();
          card.classList.remove(cls('expansionCardSkeleton'));
        }, 350);
        return;
      }

      populateExpansion();
      expansion.hidden = false;
      // Scroll only on first open; later updates happen in place.
      if (!alreadyOpen) {
        setTimeout(function () {
          // getBoundingClientRect().top + pageYOffset = true document-relative
          // top; getComputedStyle(panel).top = the CSS sticky offset, which is
          // independent of scroll position.
          var bookingPanel = sel('panel');
          var stickyTop = bookingPanel ? parseFloat(getComputedStyle(bookingPanel).top) || 68 : 68;
          var expansionDocTop = expansion.getBoundingClientRect().top + global.pageYOffset;
          global.scrollTo({ top: expansionDocTop - stickyTop, behavior: 'smooth' });
        }, 50);
      }
    }

    function hideExpansion() { expansion.hidden = true; }

    /* "Check availability" — with no date, bounce the user into the
       calendar instead of showing an empty card. */
    checkBtn.addEventListener('click', function () {
      var data = getBookingData();
      if (!data.date) {
        hideExpansion();
        setTimeout(function () { var db = sel('dateBtn'); if (db) db.click(); }, 100);
        return;
      }
      if (!expansion.hidden) { hideExpansion(); return; }
      showExpansion();
    });

    /* "Continue to checkout" — mint a booking_id, persist the cart in the
       Worker's KV pouch (15-min TTL), then HARD-navigate to /checkout/.
       The hard nav is intentional: it gives the back button, analytics, and
       mobile browsers a real page boundary to anchor on. */
    bookBtn.addEventListener('click', function () {
      if (bookBtn.disabled) return;
      var data = getBookingData();
      var slot = (global.bokunBooking && global.bokunBooking.slot) || null;

      var payload = {
        tour_id:     ctx.productId,
        date:        data.date,
        time:        slot && slot.startTime ? slot.startTime : null,
        activity_id: global.bokunBooking && global.bokunBooking.startTimeId,
        rate_id:     global.bokunBooking && global.bokunBooking.rateId,
        adults:      data.adults,
        youth:       data.youth,
        infants:     data.infants,
        /* Partner attribution. Set by /js/referral.js + the ?hotel=/?ref=
           query capture. The hotel-referral programme is paused, so these
           are expected to be null on most traffic and are NOT a release
           gate — but the Worker and the dashboard still accept and store
           them, so keep passing them through. */
        hotel:       (global.HORIZON && global.HORIZON.hotel)  || null,
        ref:         (global.HORIZON && global.HORIZON.ref)    || null,
        funnel:      (global.HORIZON && global.HORIZON.funnel) || null,
        currency:    (global.BOKUN && global.BOKUN.currency) || 'CAD',
        tour_image:  ctx.opts.tourImage,
      };

      var originalLabel = bookBtn.textContent;
      bookBtn.disabled = true;
      bookBtn.textContent = ctx.opts.continuingLabel;

      ctx.client.initiateBooking(payload)
        .then(function (body) {
          // Analytics for the dashboard funnel, fired before we navigate away.
          try {
            document.dispatchEvent(new CustomEvent('horizon:checkout_started', {
              detail: { booking_id: body.booking_id, tour_id: ctx.productId, hotel: payload.hotel },
            }));
          } catch (e) { /* no-op */ }
          global.location.href = ctx.opts.checkoutUrl + '?id=' + encodeURIComponent(body.booking_id);
        })
        .catch(function (err) {
          console.error('Booking initiate failed:', err);
          bookBtn.disabled = false;
          bookBtn.textContent = originalLabel;
          var validation = sel('expansionValidation');
          if (validation) {
            validation.textContent = ctx.opts.initiateErrorMessage;
            validation.hidden = false;
            validation.classList.add(cls('validationError'));
          }
        });
    });

    return {
      show: showExpansion,
      hide: hideExpansion,
      populate: populateExpansion,
      getBookingData: getBookingData,
    };
  }

  global.HorizonBookingExpansion = { init: init };
})(window);
