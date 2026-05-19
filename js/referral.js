/* ============================================================
   HORIZON — Referral attribution persistence (Phase 1a)
   ------------------------------------------------------------
   Captures ?hotel= / ?ref= touchpoints into a durable, append-only
   funnel store (localStorage + apex-domain cookie mirror) and
   re-hydrates window.HORIZON on every page so attribution survives
   refreshes, tour-to-tour navigation, and multi-day hotel stays.

   Spec: docs/referral-attribution-spec.md  (decisions LOCKED 2026-05-19)
   ------------------------------------------------------------ */
(function () {
  'use strict';

  var STORE_KEY   = 'hzn_ref';
  var COOKIE_NAME = 'hzn_ref';
  var SCHEMA_V    = 1;
  var TTL_MS      = 30 * 24 * 60 * 60 * 1000; // §5.3 30-day sliding
  var MAX_TOUCH   = 25;                       // §5.2 cap; first-touch kept separately
  var COOKIE_TOUCH_CAP = 8;                   // keep cookie mirror small

  // Same grammars as the existing inline capture block.
  var HOTEL_RE = /^[a-z0-9-]{2,40}$/i;
  var REF_RE   = /^[a-z0-9_-]{2,40}$/i;

  // ── stream classification (code grammar, no DB needed client-side) ──
  // htl-XXXXX-eNNN → employee · htl-XXXXX-pNN → placement · else hotel
  function classifyRef(code) {
    if (/-e\d{3}$/i.test(code)) return 'employee';
    if (/-p\d{2}$/i.test(code)) return 'placement';
    return 'hotel';
  }

  // ── cookie helpers (apex domain incl. subdomains — §5.1 / decision #3) ──
  function apexDomain() {
    var h = location.hostname;
    if (/^(localhost|127\.)/.test(h) || /^[\d.]+$/.test(h)) return null;
    var parts = h.split('.');
    if (parts.length <= 2) return '.' + h;
    return '.' + parts.slice(-2).join('.');
  }

  function writeCookie(value) {
    try {
      var dom = apexDomain();
      var attrs =
        '; path=/; max-age=' + Math.floor(TTL_MS / 1000) +
        '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '') +
        (dom ? '; domain=' + dom : '');
      document.cookie = COOKIE_NAME + '=' + encodeURIComponent(value) + attrs;
    } catch (e) { /* cookies blocked — localStorage still covers us */ }
  }

  function readCookie() {
    try {
      var m = document.cookie.match(
        new RegExp('(?:^|; )' + COOKIE_NAME + '=([^;]*)')
      );
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  // ── store load/save (localStorage primary, cookie fallback) ──
  function emptyStore() {
    return { v: SCHEMA_V, touchpoints: [], first_ts: null, last_ts: null };
  }

  function parse(raw) {
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (!s || s.v !== SCHEMA_V || !Array.isArray(s.touchpoints)) return null;
      return s;
    } catch (e) { return null; }
  }

  function loadStore() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { /* ITP/private */ }
    var s = parse(raw) || parse(readCookie());
    if (!s) return emptyStore();
    // §5.3 sliding-window expiry
    if (s.last_ts && Date.now() > s.last_ts + TTL_MS) return emptyStore();
    return s;
  }

  function saveStore(s) {
    var json = JSON.stringify(s);
    try { localStorage.setItem(STORE_KEY, json); } catch (e) { /* ignore */ }
    // Cookie mirror carries only the tail to stay well under 4KB.
    var mirror = {
      v: s.v,
      touchpoints: s.touchpoints.slice(-COOKIE_TOUCH_CAP),
      first_ts: s.first_ts,
      last_ts: s.last_ts,
    };
    writeCookie(JSON.stringify(mirror));
  }

  // ── append-only capture (dedupe vs last touch of same stream — §5.2) ──
  function appendTouch(s, code, stream, now) {
    var last = null;
    for (var i = s.touchpoints.length - 1; i >= 0; i--) {
      if (s.touchpoints[i].stream === stream) { last = s.touchpoints[i]; break; }
    }
    if (last && last.code === code) { s.last_ts = now; return false; }

    s.touchpoints.push({
      code: code,
      stream: stream,
      ts: now,
      page: location.pathname,
    });
    if (s.touchpoints.length > MAX_TOUCH) {
      // Drop oldest beyond cap; first_ts below preserves true first-touch.
      s.touchpoints = s.touchpoints.slice(-MAX_TOUCH);
    }
    if (!s.first_ts) s.first_ts = now;
    s.last_ts = now;
    return true;
  }

  // ── credit resolution (§4.1 default policy, client mirror) ──
  // Employees outrank hotel/placement; among employees the LAST wins;
  // otherwise the FIRST hotel-level touch wins. Placement = funnel-only.
  function creditedRef(s) {
    var employees = [], hotels = [];
    for (var i = 0; i < s.touchpoints.length; i++) {
      var t = s.touchpoints[i];
      if (t.stream === 'employee') employees.push(t);
      else if (t.stream === 'hotel' && t.kind === 'ref') hotels.push(t);
    }
    if (employees.length) return employees[employees.length - 1].code;
    if (hotels.length) return hotels[0].code;
    return null;
  }

  function lastHotelSlug(s) {
    for (var i = s.touchpoints.length - 1; i >= 0; i--) {
      if (s.touchpoints[i].stream === 'hotel-slug') return s.touchpoints[i].code;
    }
    return null;
  }

  // ── run ──
  window.HORIZON = window.HORIZON || {};
  var store = loadStore();
  var now = Date.now();
  var changed = false;

  try {
    var params = new URLSearchParams(window.location.search);

    var hotel = params.get('hotel');
    if (hotel && HOTEL_RE.test(hotel)) {
      hotel = hotel.trim().toLowerCase();
      if (appendTouch(store, hotel, 'hotel-slug', now)) changed = true;
      else changed = true; // last_ts bumped — still persist the slide
    }

    var ref = params.get('ref');
    if (ref && REF_RE.test(ref)) {
      ref = ref.trim().toLowerCase();
      var stream = classifyRef(ref);
      var added = appendTouch(store, ref, stream, now);
      // tag ref-origin touches so creditedRef can pick hotel-level refs
      if (added) store.touchpoints[store.touchpoints.length - 1].kind = 'ref';
      changed = true;
    }
  } catch (e) { /* no URL API — fall through to restore-only */ }

  if (changed) saveStore(store);

  // Re-hydrate window.HORIZON from the durable funnel so a refresh or a
  // hop to another tour (no params in URL) keeps attribution. Inline
  // page capture (if any) has already run; only fill what's missing so
  // an explicit in-URL param on THIS page always takes precedence.
  var hSlug = lastHotelSlug(store);
  if (!window.HORIZON.hotel && hSlug) window.HORIZON.hotel = hSlug;

  var cRef = creditedRef(store);
  if (!window.HORIZON.ref && cRef) window.HORIZON.ref = cRef.toUpperCase();

  // Expose the full funnel for the booking-initiate payload (Phase 1b).
  window.HORIZON.funnel = {
    touchpoints: store.touchpoints,
    first_ts: store.first_ts,
    last_ts: store.last_ts,
  };
})();
