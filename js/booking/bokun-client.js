/* ─────────────────────────────────────────────────────────────────────────
   Horizon booking engine · Bokun API client
   ─────────────────────────────────────────────────────────────────────────
   The network + cache layer. ZERO DOM ACCESS lives in this file — that is
   deliberate and worth keeping: it is what lets the site be redesigned
   without anyone needing to read this code.

   Extracted verbatim (behaviour-identical) from the inline scripts of
   tours/banff-hidden-gem-canoe-tour/index.html. See docs/booking-contract.md
   for the contract this file is one half of.

   Loaded as a CLASSIC script (not an ES module) so it keeps working from
   inline handlers and so load order stays explicit.
   ───────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var DEFAULT_API_BASE = 'https://horizon-bokun.ivan-mueller02.workers.dev';

  /* The listing page (/tours/) writes this same key so the price does not
     shimmer when a visitor navigates into a tour. Key format and payload
     shape are a CROSS-PAGE CONTRACT — see docs/booking-contract.md §4.
     Changing either here means changing tours/index.html in the same commit. */
  var PRICE_CACHE_PREFIX = 'hzn_price_';
  var PRICE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /* ── Date helpers ──────────────────────────────────────────────────────
     Three of these exist and they are NOT interchangeable. The original
     page used UTC-based conversion for Bokun slot timestamps and the
     initial fetch window, but LOCAL date arithmetic for calendar cells and
     lazy-fetch ranges. That asymmetry is preserved exactly. It is benign in
     Mountain Time for a morning-departure product (08:30 MT = 15:30 UTC,
     same calendar day) but it is NOT generally safe — a late-evening
     departure or a UTC+ timezone would index a slot under the wrong day.
     Flagged in docs/booking-contract.md §6 as a known quirk. Do not
     "clean this up" as part of a redesign; fix it deliberately, with a
     test, or not at all. */

  // UTC. Used for the initial availability window only.
  function ymdUtc(d) { return d.toISOString().slice(0, 10); }

  // UTC. Used to key Bokun slot epoch-millis into the availability index.
  function ymdFromMillis(ms) { return new Date(ms).toISOString().slice(0, 10); }

  // LOCAL. Used for calendar cells and lazy-fetch query ranges.
  function ymdFromLocal(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  /* ── Price cache ───────────────────────────────────────────────────── */

  function readCachedPrice(productId) {
    try {
      var raw = global.localStorage.getItem(PRICE_CACHE_PREFIX + productId);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || Date.now() >= entry.exp) return null;
      return entry;
    } catch (e) { return null; }
  }

  function writeCachedPrice(productId, price) {
    try {
      global.localStorage.setItem(
        PRICE_CACHE_PREFIX + productId,
        JSON.stringify({ price: price, exp: Date.now() + PRICE_CACHE_TTL_MS })
      );
    } catch (e) { /* private mode / quota — cache is an optimisation only */ }
  }

  /* ── HTTP ──────────────────────────────────────────────────────────────
     Every backend touch the tour page makes goes through these four
     functions. The Worker is a separate origin behind a CORS allowlist;
     nothing here needs the Worker redeployed to change. */

  function Client(opts) {
    opts = opts || {};
    this.apiBase   = opts.apiBase || DEFAULT_API_BASE;
    this.productId = opts.productId;
  }

  Client.prototype._get = function (path, label) {
    return fetch(this.apiBase + path).then(function (r) {
      if (!r.ok) throw new Error(label + ' fetch ' + r.status);
      return r.json();
    });
  };

  Client.prototype.fetchProduct = function () {
    return this._get('/api/product/' + this.productId, 'product');
  };

  Client.prototype.fetchPickupPlaces = function () {
    return this._get('/api/pickup-places/' + this.productId, 'pickup-places');
  };

  // start/end are YYYY-MM-DD strings. Caller decides UTC vs local — see above.
  Client.prototype.fetchAvailability = function (start, end) {
    return this._get(
      '/api/availability/' + this.productId + '?start=' + start + '&end=' + end,
      'availability'
    );
  };

  /* Mints a booking_id and persists the cart in the Worker's KV pouch
     (15-min spot hold). Resolves to the parsed body; rejects with the
     Worker's own error string when it can. The caller redirects to
     /checkout/?id=<booking_id> — that handoff is the single seam between
     the tour page and the checkout page. */
  Client.prototype.initiateBooking = function (payload) {
    return fetch(this.apiBase + '/api/booking/initiate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (body) { return { ok: r.ok, body: body }; });
      })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.booking_id) {
          throw new Error((res.body && res.body.error) || 'initiate_failed');
        }
        return res.body;
      });
  };

  global.HorizonBokunClient = {
    Client:           Client,
    DEFAULT_API_BASE: DEFAULT_API_BASE,
    PRICE_CACHE_PREFIX: PRICE_CACHE_PREFIX,
    PRICE_CACHE_TTL_MS: PRICE_CACHE_TTL_MS,
    readCachedPrice:  readCachedPrice,
    writeCachedPrice: writeCachedPrice,
    ymdUtc:           ymdUtc,
    ymdFromMillis:    ymdFromMillis,
    ymdFromLocal:     ymdFromLocal,
    startOfDay:       startOfDay,
  };
})(window);
