/* ─────────────────────────────────────────────────────────────────────────
   Horizon booking engine · state + pure derivations
   ─────────────────────────────────────────────────────────────────────────
   Owns the two globals the rest of the site reads (window.BOKUN and
   window.bokunBooking) and every pure function that turns Bokun's payloads
   into numbers the UI renders. ZERO DOM ACCESS — same rule as the client.

   Keeping the globals is deliberate. They are part of the documented
   contract (docs/booking-contract.md §3): /checkout/ and any future tour
   page may read them, and the console-debuggability of `window.BOKUN` is
   genuinely useful when a live booking misbehaves.
   ───────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  function slug(s) { return String(s || '').toLowerCase().trim(); }

  /* ── Global state shape ────────────────────────────────────────────── */

  function initGlobals() {
    global.BOKUN = global.BOKUN || {
      product: null, pickupPlaces: null, dropoffPlaces: null, availability: null,
      pricePerCategory: null, lowestAdultPrice: null, currency: 'CAD',
      ready: false, error: null,
    };
    global.bokunBooking = global.bokunBooking || { counts: { adult: 1 }, mins: { adult: 1 } };
    return { bokun: global.BOKUN, booking: global.bokunBooking };
  }

  /* ── Price derivation ──────────────────────────────────────────────────
     Bokun returns identical prices for every slot of a product unless
     seasonal pricing is configured, so we sample the first slot that has
     any — then scan the whole window for the lowest adult price, which is
     what the "from $X" header and the JSON-LD offer both show. */

  function derivePricing(product, availability) {
    var out = { pricePerCategory: null, currency: null, lowestAdultPrice: null };

    var sample = (availability || []).find(function (s) {
      return s && s.pricesByRate && s.pricesByRate[0] && s.pricesByRate[0].pricePerCategoryUnit;
    });
    if (!sample) return out;

    var entries = sample.pricesByRate[0].pricePerCategoryUnit;
    var byCategoryId = {};
    entries.forEach(function (p) {
      byCategoryId[p.id] = { amount: p.amount.amount, currency: p.amount.currency };
    });
    out.pricePerCategory = byCategoryId;
    out.currency = (entries[0] && entries[0].amount.currency) || 'CAD';

    var adultCat = ((product && product.pricingCategories) || []).find(function (c) {
      return /adult/i.test(c.title);
    });
    if (adultCat) {
      var minAdult = Infinity;
      (availability || []).forEach(function (s) {
        if (!s.pricesByRate || !s.pricesByRate[0]) return;
        var p = s.pricesByRate[0].pricePerCategoryUnit.find(function (x) {
          return x.id === adultCat.id;
        });
        if (p && p.amount.amount < minAdult) minAdult = p.amount.amount;
      });
      if (minAdult !== Infinity) out.lowestAdultPrice = minAdult;
    }
    return out;
  }

  /* ── Availability index ────────────────────────────────────────────────
     YYYY-MM-DD → array of slot rows, plus the furthest date we hold data
     for (so the calendar knows when to lazy-fetch another window). */

  function indexAvailability(slots, ymdFromMillis, startOfDay) {
    var byDate = {};
    var maxDate = null;
    (slots || []).forEach(function (s) {
      if (!s || s.date == null) return;
      var ymd = ymdFromMillis(s.date);
      if (!byDate[ymd]) byDate[ymd] = [];
      byDate[ymd].push(s);
      var d = new Date(s.date);
      if (!maxDate || d > maxDate) maxDate = d;
    });
    return { byDate: byDate, fetchedThrough: maxDate ? startOfDay(maxDate) : null };
  }

  /* A slot is bookable only with a rate attached, not sold out, and with
     room (or explicitly unlimited). All three conditions matter — dropping
     any one of them puts unbookable dates on the calendar. */
  function bookableSlots(byDate, ymd) {
    var slots = byDate[ymd];
    if (!slots || slots.length === 0) return [];
    return slots.filter(function (s) {
      return s.defaultRateId && !s.soldOut && (s.unlimitedAvailability || (s.availabilityCount || 0) > 0);
    });
  }

  function preferredSlot(byDate, ymd, preferredStartTimeId) {
    var available = bookableSlots(byDate, ymd);
    if (available.length === 0) return null;
    var preferred = available.find(function (s) {
      return Number(s.startTimeId) === Number(preferredStartTimeId);
    });
    return preferred || available[0];
  }

  function isBookable(byDate, ymd) { return bookableSlots(byDate, ymd).length > 0; }

  function adultCategory(product) {
    return ((product && product.pricingCategories) || []).find(function (c) {
      return /adult/i.test(c.title);
    });
  }

  function adultPriceFor(byDate, ymd, product, preferredStartTimeId) {
    var slot = preferredSlot(byDate, ymd, preferredStartTimeId);
    if (!slot) return null;
    var adult = adultCategory(product);
    if (!adult) return null;
    if (!slot.pricesByRate || !slot.pricesByRate[0]) return null;
    var p = slot.pricesByRate[0].pricePerCategoryUnit.find(function (x) { return x.id === adult.id; });
    return p ? p.amount.amount : null;
  }

  /* Per-category price with a fallback to the lowest adult price. The
     fallback is correct for this product (everyone is priced the same);
     a product with real per-category pricing that has not loaded
     /availability yet would show adult pricing for children here. */
  function categoryPrice(category) {
    var pricing = global.BOKUN && global.BOKUN.pricePerCategory;
    if (pricing && pricing[category.id]) return pricing[category.id].amount;
    return (global.BOKUN && global.BOKUN.lowestAdultPrice) || 0;
  }

  function totalParticipants(counts) {
    return Object.keys(counts).reduce(function (sum, k) { return sum + (counts[k] || 0); }, 0);
  }

  /* Breakdown + total. Infants are counted toward Bokun availability but
     shown as complimentary and excluded from the money total — that split
     is intentional, not a bug. */
  function computeTotals(product, counts, currencyPrefix) {
    var total = 0;
    var parts = [];
    if (product && product.pricingCategories) {
      product.pricingCategories.forEach(function (c) {
        var n = counts[slug(c.title)] || 0;
        if (n === 0) return;
        var price = categoryPrice(c);
        if (/infant/i.test(c.title)) {
          parts.push(n + ' ' + c.title + (n > 1 ? 's' : '') + ' (complimentary)');
        } else {
          parts.push(n + ' ' + c.title + (n > 1 ? 's' : '') + ' × ' + currencyPrefix + price);
          total += n * price;
        }
      });
    }
    return { total: total, parts: parts };
  }

  /* ── Validation ────────────────────────────────────────────────────────
     Pure: returns what to say and whether it is an error, never touches the
     DOM. A non-empty message disables "Continue to checkout". Order of the
     branches is the priority order and is load-bearing. */
  function validate(dateIso, counts, slot) {
    var totalP = totalParticipants(counts);
    if (!dateIso)   return { message: 'Please pick a date.', isError: false };
    if (totalP === 0) return { message: 'Please add at least one traveller.', isError: false };
    if (slot && !slot.unlimitedAvailability && slot.availabilityCount != null && totalP > slot.availabilityCount) {
      return {
        message: 'Only ' + slot.availabilityCount + ' spots remaining for this departure. Reduce the number of travellers or pick another date.',
        isError: true,
      };
    }
    if (slot && slot.minParticipantsToBookNow != null && totalP < slot.minParticipantsToBookNow) {
      return {
        message: 'Minimum ' + slot.minParticipantsToBookNow + ' participant' +
                 (slot.minParticipantsToBookNow > 1 ? 's' : '') + ' required to book this departure.',
        isError: true,
      };
    }
    return { message: '', isError: false };
  }

  /* ── Formatting ────────────────────────────────────────────────────── */

  var MONTHS       = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DAYS         = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function formatLongDate(iso) {
    var p = iso.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + p[0];
  }

  // Free cancellation cutoff: the day before departure, at the departure time.
  function formatCancelDate(iso) {
    var p = iso.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() - 1);
    return MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  // Bokun startTime is 24-hour "HH:MM"; the UI wants "8:00 AM".
  function formatBokunTime(hhmm) {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return hhmm || '';
    var parts = hhmm.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1];
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + m + ' ' + suffix;
  }

  function currencyPrefixFor(currency, style) {
    if (style === 'ca') return currency === 'CAD' ? 'CA$' : currency + ' ';
    return currency === 'CAD' ? '$' : currency + ' ';
  }

  global.HorizonBookingState = {
    slug: slug,
    initGlobals: initGlobals,
    derivePricing: derivePricing,
    indexAvailability: indexAvailability,
    bookableSlots: bookableSlots,
    preferredSlot: preferredSlot,
    isBookable: isBookable,
    adultCategory: adultCategory,
    adultPriceFor: adultPriceFor,
    categoryPrice: categoryPrice,
    totalParticipants: totalParticipants,
    computeTotals: computeTotals,
    validate: validate,
    formatLongDate: formatLongDate,
    formatCancelDate: formatCancelDate,
    formatBokunTime: formatBokunTime,
    currencyPrefixFor: currencyPrefixFor,
    MONTHS: MONTHS,
    DAYS: DAYS,
  };
})(window);
