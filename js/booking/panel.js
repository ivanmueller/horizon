/* ─────────────────────────────────────────────────────────────────────────
   Horizon booking engine · booking panel (travellers + calendar)
   ─────────────────────────────────────────────────────────────────────────
   The first half of the UI: who is coming, and on what date. Every DOM
   lookup goes through ctx.sel()/ctx.cls() so a redesign can rename ids and
   classes in ONE place (the selector map in mount.js) instead of hunting
   through logic.

   Behaviour is byte-identical to the inline version it replaces. Where the
   original had a quirk, the quirk is preserved and commented rather than
   fixed — see docs/booking-contract.md §6.
   ───────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var S = global.HorizonBookingState;
  var C = global.HorizonBokunClient;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  var escapeAttr = escapeHtml;

  var REQUIRED = [
    'travellersBtn', 'travellersDropdown', 'travellersRows',
    'dateBtn', 'calendar', 'calGrid1', 'calGrid2',
  ];

  function init(ctx) {
    var sel = ctx.sel, cls = ctx.cls;
    var booking = global.bokunBooking;

    /* Individual pieces degrade gracefully below, but a missing element is
       almost always a redesign that renamed something without updating the
       selector map — so name it rather than quietly rendering a dead panel. */
    var missing = REQUIRED.filter(function (k) { return !sel(k); });
    if (missing.length) {
      console.warn('[HorizonBooking] booking panel incomplete — no element matched: ' +
        missing.map(function (k) { return k + ' (' + ctx.rawSelector(k) + ')'; }).join(', ') +
        '. See docs/booking-contract.md §2.');
    }

    /* ── Travellers ────────────────────────────────────────────────────
       Rows are rendered from Bokun's pricingCategories, keyed by the
       lowercased category title ("adult", "youth", "child", "infant",
       "senior"). That slug is the join key between Bokun's data and the
       count buckets the checkout handoff sends. */

    function ageBand(c) {
      if (c.minAge != null && c.maxAge != null) return 'Age ' + c.minAge + '–' + c.maxAge;
      if (c.minAge != null) return 'Age ' + c.minAge + '+';
      return c.fullTitle && c.fullTitle !== c.title ? c.fullTitle : '';
    }

    function renderRows(categories) {
      var container = sel('travellersRows');
      if (!container) return;
      container.innerHTML = categories.map(function (c, i) {
        var s = S.slug(c.title);
        var initial = booking.counts[s] || 0;
        var min = booking.mins[s] || 0;
        var last = (i === categories.length - 1);
        return (
          '<div class="' + cls('travellersRow') + '"' + (last ? ' style="border-bottom:none;"' : '') + '>' +
            '<div class="' + cls('travellersInfo') + '">' +
              '<div class="' + cls('travellersName') + '">' + escapeHtml(c.title) + '</div>' +
              '<div class="' + cls('travellersAge') + '">' + escapeHtml(ageBand(c)) + '</div>' +
            '</div>' +
            '<div class="' + cls('stepper') + '">' +
              '<button class="' + cls('stepperBtn') + '" id="' + ctx.stepperId('minus', s) + '" aria-label="Remove ' + escapeAttr(c.title) + '"' + (initial <= min ? ' disabled' : '') + '>−</button>' +
              '<span class="' + cls('stepperCount') + '" id="' + ctx.stepperId('count', s) + '">' + initial + '</span>' +
              '<button class="' + cls('stepperBtn') + '" id="' + ctx.stepperId('plus', s) + '" aria-label="Add ' + escapeAttr(c.title) + '">+</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      categories.forEach(function (c) {
        var s = S.slug(c.title);
        var plus  = document.getElementById(ctx.stepperId('plus', s));
        var minus = document.getElementById(ctx.stepperId('minus', s));
        if (plus)  plus.addEventListener('click',  function () { changeCount(s, 1); });
        if (minus) minus.addEventListener('click', function () { changeCount(s, -1); });
      });
      updateTravellersLabel();
    }

    function updateTravellersLabel() {
      var parts = [];
      var counts = booking.counts || {};
      var product = global.BOKUN && global.BOKUN.product;
      if (product && product.pricingCategories) {
        product.pricingCategories.forEach(function (c) {
          var n = counts[S.slug(c.title)] || 0;
          if (n > 0) parts.push(c.title + ' x ' + n);
        });
      } else {
        Object.keys(counts).forEach(function (k) {
          if (counts[k] > 0) parts.push(k.charAt(0).toUpperCase() + k.slice(1) + ' x ' + counts[k]);
        });
      }
      var lbl = sel('travellersLabel');
      if (lbl) lbl.textContent = parts.join(', ') || 'Select travellers';
    }

    function changeCount(s, delta) {
      var counts = booking.counts;
      var mins = booking.mins;
      counts[s] = Math.max(mins[s] || 0, (counts[s] || 0) + delta);
      var countEl = document.getElementById(ctx.stepperId('count', s));
      var minusEl = document.getElementById(ctx.stepperId('minus', s));
      if (countEl) countEl.textContent = counts[s];
      if (minusEl) minusEl.disabled = counts[s] <= (mins[s] || 0);
      updateTravellersLabel();
      // Live-update the expansion if it is already open, so the total never
      // goes stale behind a changed party size.
      var exp = sel('expansion');
      if (exp && !exp.hidden && typeof ctx.showExpansion === 'function') ctx.showExpansion();
    }

    /* Adult is required (min 1) and seeded at 1; every other category
       starts at 0 with no minimum. Existing counts are preserved so a
       re-render (e.g. bokun:ready arriving twice) never resets the cart. */
    function applyFromBokun() {
      var product = global.BOKUN && global.BOKUN.product;
      if (!product || !product.pricingCategories) return;
      product.pricingCategories.forEach(function (c) {
        var s = S.slug(c.title);
        if (s === 'adult') {
          booking.mins[s] = 1;
          if (!booking.counts[s]) booking.counts[s] = 1;
        } else {
          booking.mins[s] = 0;
          if (booking.counts[s] == null) booking.counts[s] = 0;
        }
      });
      renderRows(product.pricingCategories);
    }

    var travellersBtn      = sel('travellersBtn');
    var travellersDropdown = sel('travellersDropdown');
    var travellersContinue = sel('travellersContinue');

    function openTravellers() {
      travellersDropdown.hidden = false;
      travellersBtn.classList.add(cls('selectRowOpen'));
      travellersBtn.setAttribute('aria-expanded', 'true');
      closeCalendar();
    }
    function closeTravellers() {
      travellersDropdown.hidden = true;
      travellersBtn.classList.remove(cls('selectRowOpen'));
      travellersBtn.setAttribute('aria-expanded', 'false');
    }

    if (travellersBtn && travellersDropdown) {
      travellersBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        travellersDropdown.hidden ? openTravellers() : closeTravellers();
      });
    }
    if (travellersContinue) travellersContinue.addEventListener('click', closeTravellers);

    /* ── Calendar ──────────────────────────────────────────────────────
       Two months visible at a time, Monday-start, driven entirely by
       window.BOKUN.availability. Paging forward past what we hold triggers
       a lazy fetch of the next window. */

    var TODAY = C.startOfDay(new Date());
    var calStart = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    var selectedDate = null;

    var availabilityByDate = {};
    var fetchedThrough = null;   // furthest date we hold availability for
    var fetchInFlight = null;    // dedupes rapid next-month clicks

    function reindex(slots) {
      var idx = S.indexAvailability(slots, C.ymdFromMillis, C.startOfDay);
      availabilityByDate = idx.byDate;
      if (idx.fetchedThrough) fetchedThrough = idx.fetchedThrough;
    }

    function ensureAvailabilityThrough(targetDate) {
      if (fetchedThrough && fetchedThrough >= targetDate) return Promise.resolve();
      if (fetchInFlight) return fetchInFlight;
      var startDate = fetchedThrough
        ? new Date(fetchedThrough.getTime() + 86400 * 1000)
        : TODAY;
      var endDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 30);
      fetchInFlight = ctx.client
        .fetchAvailability(C.ymdFromLocal(startDate), C.ymdFromLocal(endDate))
        .then(function (slots) {
          if (!Array.isArray(slots)) return;
          global.BOKUN.availability = (global.BOKUN.availability || []).concat(slots);
          reindex(global.BOKUN.availability);
          renderCalendar();
        })
        .catch(function (e) { console.error('[BOKUN] extra availability fetch failed', e); })
        .then(function () { fetchInFlight = null; });
      return fetchInFlight;
    }

    function onBokunReadyForCalendar() {
      if (global.BOKUN && global.BOKUN.availability) reindex(global.BOKUN.availability);
      // Refresh if the dropdown was already open against placeholder data.
      var cal = sel('calendar');
      if (cal && !cal.hidden) renderCalendar();
    }

    function renderCalendar() {
      var m1 = new Date(calStart.getFullYear(), calStart.getMonth(), 1);
      var m2 = new Date(calStart.getFullYear(), calStart.getMonth() + 1, 1);
      var t1 = sel('calMonth1'), t2 = sel('calMonth2');
      if (t1) t1.textContent = S.MONTHS[m1.getMonth()] + ' ' + m1.getFullYear();
      if (t2) t2.textContent = S.MONTHS[m2.getMonth()] + ' ' + m2.getFullYear();
      renderMonth(sel('calGrid1'), m1);
      renderMonth(sel('calGrid2'), m2);
      var prevBtn = sel('calPrev');
      // Never page back before the current month.
      if (prevBtn) prevBtn.disabled = (m1.getFullYear() === TODAY.getFullYear() && m1.getMonth() === TODAY.getMonth());
    }

    function renderMonth(grid, monthDate) {
      if (!grid) return;
      grid.innerHTML = '';
      var y = monthDate.getFullYear(), m = monthDate.getMonth();
      var firstDow = new Date(y, m, 1).getDay();
      var offset = (firstDow === 0) ? 6 : firstDow - 1; // Monday-start
      var daysInMonth = new Date(y, m + 1, 0).getDate();
      var currency = (global.BOKUN && global.BOKUN.currency) || 'CAD';
      var currencyPrefix = S.currencyPrefixFor(currency);

      for (var i = 0; i < offset; i++) grid.appendChild(document.createElement('span'));

      for (var d = 1; d <= daysInMonth; d++) {
        (function (day) {
          var btn = document.createElement('button');
          btn.className = cls('calDay');
          var thisDate = new Date(y, m, day);
          var ymd = C.ymdFromLocal(thisDate);
          var isPast = thisDate < TODAY;
          var bookable = !isPast && S.isBookable(availabilityByDate, ymd);
          var isSelected = selectedDate && C.ymdFromLocal(selectedDate) === ymd;

          var numEl = document.createElement('span');
          numEl.className = cls('calDayNum');
          numEl.textContent = day;
          btn.appendChild(numEl);

          if (isPast) {
            btn.classList.add(cls('calDayPast'));
            btn.disabled = true;
          } else if (!bookable) {
            btn.classList.add(cls('calDayUnavailable'));
            btn.disabled = true;
          } else {
            btn.classList.add(cls('calDayAvailable'));
            var price = S.adultPriceFor(availabilityByDate, ymd, global.BOKUN && global.BOKUN.product, ctx.preferredStartTimeId);
            if (price != null) {
              var priceEl = document.createElement('span');
              priceEl.className = cls('calDayPrice');
              priceEl.textContent = currencyPrefix + price;
              btn.appendChild(priceEl);
            }
          }
          if (isSelected) btn.classList.add(cls('calDaySelected'));

          if (bookable) {
            btn.addEventListener('click', function () {
              selectedDate = thisDate;
              /* One start time per day on this product. A product with
                 several would need a time picker here — every slot for the
                 day is already indexed so that picker has data to show. */
              var slot = S.preferredSlot(availabilityByDate, ymd, ctx.preferredStartTimeId);
              booking.date = ymd;               // write-only today; kept for compat
              booking.slot = slot;
              booking.startTimeId = slot && slot.startTimeId;
              booking.rateId = slot && slot.defaultRateId;
              var lbl = sel('dateLabel');
              if (lbl) lbl.textContent = S.MONTHS[m] + ' ' + day + ', ' + y;
              // The selected date lives on the DOM node — the expansion and
              // the checkout handoff both read it from here.
              var db = sel('dateBtn');
              if (db) db.dataset.selectedDate = ymd;
              closeCalendar();
              renderCalendar();
              setTimeout(function () {
                if (typeof ctx.showExpansion === 'function') ctx.showExpansion();
              }, 150);
            });
          }
          grid.appendChild(btn);
        })(d);
      }
    }

    var dateBtn = sel('dateBtn');
    var calendarDropdown = sel('calendar');

    function openCalendar() {
      calendarDropdown.hidden = false;
      dateBtn.classList.add(cls('selectRowOpen'));
      dateBtn.setAttribute('aria-expanded', 'true');
      renderCalendar();
      closeTravellers();
    }
    function closeCalendar() {
      if (!calendarDropdown || !dateBtn) return;
      calendarDropdown.hidden = true;
      dateBtn.classList.remove(cls('selectRowOpen'));
      dateBtn.setAttribute('aria-expanded', 'false');
    }

    if (dateBtn && calendarDropdown) {
      dateBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        calendarDropdown.hidden ? openCalendar() : closeCalendar();
      });
    }

    var calPrev = sel('calPrev'), calNext = sel('calNext');
    if (calPrev) calPrev.addEventListener('click', function (e) {
      e.stopPropagation();
      calStart = new Date(calStart.getFullYear(), calStart.getMonth() - 1, 1);
      renderCalendar();
    });
    if (calNext) calNext.addEventListener('click', function (e) {
      e.stopPropagation();
      calStart = new Date(calStart.getFullYear(), calStart.getMonth() + 1, 1);
      // Two months are visible; make sure we hold data through the end of
      // the second one. ensureAvailabilityThrough re-renders on success.
      var rangeEnd = new Date(calStart.getFullYear(), calStart.getMonth() + 2, 0);
      ensureAvailabilityThrough(rangeEnd);
      renderCalendar();
    });

    // Outside click / Escape close both dropdowns. The dropdowns themselves
    // stopPropagation so clicking inside one does not close it.
    document.addEventListener('click', function () { closeTravellers(); closeCalendar(); });
    if (travellersDropdown) travellersDropdown.addEventListener('click', function (e) { e.stopPropagation(); });
    if (calendarDropdown)   calendarDropdown.addEventListener('click',   function (e) { e.stopPropagation(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeTravellers(); closeCalendar(); }
    });

    function onError() {
      var c = sel('travellersRows');
      if (c) c.innerHTML = ctx.opts.travellersErrorHtml;
    }

    /* Public: scroll the date control into view and open the calendar.
       Exists so page-local code (e.g. a "check availability" button inside
       the photo viewer) never has to hardcode #dateBtn — that hardcoding is
       exactly what a selector-map rename would silently break. */
    function revealCalendar(delayMs) {
      var db = sel('dateBtn');
      if (!db) return;
      db.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(openCalendar, delayMs == null ? 400 : delayMs);
    }

    return {
      revealCalendar: revealCalendar,
      applyFromBokun: applyFromBokun,
      onBokunReady: function () { applyFromBokun(); onBokunReadyForCalendar(); },
      onBokunError: onError,
      openCalendar: openCalendar,
      closeCalendar: closeCalendar,
      renderCalendar: renderCalendar,
    };
  }

  global.HorizonBookingPanel = { init: init };
})(window);
