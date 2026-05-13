// Horizon Tours — Bokun proxy + Stripe orchestration Worker.
//
// Bokun proxy (HMAC-SHA1 signed):
//   GET  /api/product/:id              cache 1h
//   GET  /api/pickup-places/:id        cache 1h
//   GET  /api/availability/:id         cache 5min, ?fresh=1 to bypass
//        ?start=YYYY-MM-DD&end=YYYY-MM-DD
//   POST /api/checkout/options         no cache, validates BookingRequest
//   POST /api/checkout/submit          no cache, creates the reservation
//
// Stripe orchestration (TOKEN-mode SetupIntent flow — see 0B_VALIDATION.md):
//   POST /api/stripe/setup-intent      create Customer + off_session SetupIntent
//
// Auth helpers (login page ↔ worker; no Supabase JWT required):
//   POST /api/auth/preflight        { email } → { status: password_required |
//                                    first_time_setup | not_approved }
//   PATCH /api/auth/mark-password-set  JWT required; stamps password_set_at
//                                    on hotel_users or horizon_admins after
//                                    the user saves a password in setup/modal.
//   POST /api/auth/access-request   No auth. Inserts a pending row in
//                                    access_requests for admin review.
//                                    Body: { email, name, property_requested?,
//                                    reason? }.
//
// Horizon admin — access requests:
//   GET  /api/admin/access-requests  list all requests (most-recent first).
//                                    ?status=pending|approved|denied to filter.
//                                    Returns pending_count in response.
//   PATCH /api/admin/access-requests/:id  body { status: approved|denied }.
//                                    Stamps reviewed_by + reviewed_at.
//
// Booking state handoff (tour page → checkout page; KV-backed, 45min TTL):
//   POST /api/booking/initiate         mint booking_id, persist cart + hotel
//   GET  /api/booking/state/:id        read cart back on the checkout page
//
// Hotel-manager dashboard ledger (writes once on confirmed booking, no TTL):
//   POST /api/dashboard/record         page calls this AFTER /checkout/submit
//                                      succeeds; persists the booking under
//                                      the hotel slug for /dashboard/hotel/.
//   GET  /api/dashboard/bookings       ?hotel=<slug>&from=YYYY-MM-DD
//                                      &to=YYYY-MM-DD — list a hotel's
//                                      bookings in a date window. Requires
//                                      a Supabase Auth JWT in the
//                                      Authorization header; caller must
//                                      have an active hotel_users row for
//                                      the requested hotel slug.
//
// Horizon admin (internal, Supabase JWT + horizon_admins table):
//   GET   /api/admin/summary           ?from=YYYY-MM-DD&to=YYYY-MM-DD —
//                                      cross-hotel totals + per-hotel
//                                      commission + per-staff kickback rollup
//                                      for the period. Excludes cancelled
//                                      and refunded bookings.
//   PATCH /api/admin/bookings/:id      body { status } — manual status
//                                      change (cancelled / refunded /
//                                      pending_refund / confirmed). Replaces
//                                      the Bokun webhook on tiers that don't
//                                      expose them.
//   GET    /api/admin/hotels           list of hotels with embedded staff +
//                                      managers, for the Hotels admin UI.
//   POST   /api/admin/hotels           create a new hotel (body: code, name,
//                                      location, type, …).
//   PATCH  /api/admin/hotels/:id       update hotel fields (slug is immutable).
//   DELETE /api/admin/hotels/:id       soft-delete: status flips to
//                                      'terminated'; bookings stay attached.
//   POST   /api/admin/hotel-staff      create a staff row (body: hotel_id,
//                                      code, name, …).
//   PATCH  /api/admin/hotel-staff/:id  update staff (slug + hotel_id immutable).
//   DELETE /api/admin/hotel-staff/:id  status flips to 'terminated'.
//   POST   /api/admin/hotel-users      invite a manager (body: email, hotel_id).
//   PATCH  /api/admin/hotel-users/:id  status flip (active ↔ revoked) or role.
//   POST   /api/admin/republish        triggers a Cloudflare Pages rebuild
//                                      via CF_PAGES_DEPLOY_HOOK so the
//                                      static partners.json regenerates.
//
// Secrets (Worker secret storage, never on disk):
//   BOKUN_ACCESS_KEY, BOKUN_SECRET_KEY  — HMAC signing for Bokun
//   STRIPE_SECRET_KEY                   — sk_test_... or sk_live_...
//   SUPABASE_SERVICE_KEY                — Supabase service_role; bypasses RLS
//   CF_PAGES_DEPLOY_HOOK                — webhook URL that triggers a
//                                          Cloudflare Pages rebuild (used by
//                                          /api/admin/republish after
//                                          partners.json-affecting edits).
//
// Both auth gates (partner + admin) verify Supabase user JWTs against
// $SUPABASE_URL/auth/v1/.well-known/jwks.json (public asymmetric keys,
// ES256/RS256). The admin surface additionally checks for an active
// horizon_admins row matching the JWT email. No shared HS256 secret
// needed for either path.

import { bokunFetch } from "./bokun-auth.js";
import { supabaseRequest, supabaseSelect, supabaseInsert, supabaseUpdate } from "./supabase.js";
import {
  createShortLink,
  updateShortLink,
  isShortIoConfigured,
  trackingCodeToShortPath,
  ShortIoError,
} from "./short-io.js";

const ALLOWED_ORIGIN = "https://gowithhorizon.com";
const CURRENCY = "CAD";

const TTL_PRODUCT = 3600; // 1h — product config rarely changes
const TTL_PICKUP = 3600; // 1h — pickup places rarely change
const TTL_AVAIL = 300; // 5min — overridable with ?fresh=1
const TTL_BOOKING = 15 * 60; // 15min — checkout spot-hold window
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default {
  // Cron trigger — runs hourly (configured in wrangler.toml under
  // [triggers].crons). Syncs Short.io click counts into short_links.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(syncClickCounts(env));
  },

  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);

    try {
      if (request.method === "GET" && segs[0] === "api" && segs[1] === "product" && segs[2]) {
        return await handleProduct(segs[2], env, request);
      }
      if (request.method === "GET" && segs[0] === "api" && segs[1] === "pickup-places" && segs[2]) {
        return await handlePickupPlaces(segs[2], env, request);
      }
      if (request.method === "GET" && segs[0] === "api" && segs[1] === "availability" && segs[2]) {
        return await handleAvailability(segs[2], url, env, request);
      }
      if (
        request.method === "POST" &&
        segs[0] === "api" &&
        segs[1] === "checkout" &&
        segs[2] === "options"
      ) {
        return await handleCheckoutOptions(request, env);
      }
      if (
        request.method === "POST" &&
        segs[0] === "api" &&
        segs[1] === "checkout" &&
        segs[2] === "submit"
      ) {
        return await handleCheckoutSubmit(request, env);
      }
      if (
        request.method === "POST" &&
        segs[0] === "api" &&
        segs[1] === "stripe" &&
        segs[2] === "setup-intent"
      ) {
        return await handleStripeSetupIntent(request, env);
      }
      if (
        request.method === "POST" &&
        segs[0] === "api" &&
        segs[1] === "booking" &&
        segs[2] === "initiate"
      ) {
        return await handleBookingInitiate(request, env);
      }
      if (
        request.method === "GET" &&
        segs[0] === "api" &&
        segs[1] === "booking" &&
        segs[2] === "state" &&
        segs[3]
      ) {
        return await handleBookingState(segs[3], env, request);
      }
      if (
        request.method === "POST" &&
        segs[0] === "api" &&
        segs[1] === "dashboard" &&
        segs[2] === "record"
      ) {
        return await handleDashboardRecord(request, env);
      }
      if (
        request.method === "GET" &&
        segs[0] === "api" &&
        segs[1] === "dashboard" &&
        segs[2] === "bookings"
      ) {
        return await handleDashboardBookings(url, env, request);
      }
      if (
        request.method === "GET" &&
        segs[0] === "api" &&
        segs[1] === "dashboard" &&
        segs[2] === "hotel-links"
      ) {
        return await handleDashboardHotelLinks(url, env, request);
      }
      if (
        request.method === "GET" &&
        segs[0] === "api" &&
        segs[1] === "admin" &&
        segs[2] === "summary"
      ) {
        return await handleAdminSummary(url, env, request);
      }
      if (
        request.method === "PATCH" &&
        segs[0] === "api" &&
        segs[1] === "admin" &&
        segs[2] === "bookings" &&
        segs[3]
      ) {
        return await handleAdminBookingPatch(segs[3], request, env);
      }

      // ── Hotels CRUD ─────────────────────────────────────────────
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "hotels") {
        if (request.method === "GET" && !segs[3])  return await handleAdminHotelsList(env, request);
        if (request.method === "POST" && !segs[3]) return await handleAdminHotelCreate(request, env);
        if (request.method === "PATCH" && segs[3] && !segs[4]) return await handleAdminHotelUpdate(segs[3], request, env);
        if (request.method === "DELETE" && segs[3] && !segs[4]) return await handleAdminHotelTerminate(segs[3], request, env);
        // GET /api/admin/hotels/:id/short-links
        if (request.method === "GET" && segs[3] && segs[4] === "short-links") {
          return await handleAdminHotelShortLinksList(segs[3], request, env);
        }
      }

      // ── Hotel staff CRUD ────────────────────────────────────────
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "hotel-staff") {
        if (request.method === "POST" && !segs[3]) return await handleAdminStaffCreate(request, env);
        if (request.method === "PATCH" && segs[3]) return await handleAdminStaffUpdate(segs[3], request, env);
        if (request.method === "DELETE" && segs[3]) return await handleAdminStaffTerminate(segs[3], request, env);
      }

      // ── Short.io short_links CRUD ───────────────────────────────
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "short-links") {
        if (request.method === "POST" && !segs[3]) return await handleAdminShortLinkCreate(request, env);
        if (request.method === "PATCH" && segs[3]) return await handleAdminShortLinkUpdate(segs[3], request, env);
        if (request.method === "DELETE" && segs[3]) return await handleAdminShortLinkRetire(segs[3], request, env);
      }

      // ── Hotel managers (hotel_users) — invite + revoke ──────────
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "hotel-users") {
        if (request.method === "POST" && !segs[3]) return await handleAdminHotelUserCreate(request, env);
        if (request.method === "PATCH" && segs[3]) return await handleAdminHotelUserUpdate(segs[3], request, env);
      }

      // ── Republish hook (triggers a CF Pages rebuild) ────────────
      if (
        request.method === "POST" &&
        segs[0] === "api" &&
        segs[1] === "admin" &&
        segs[2] === "republish"
      ) {
        return await handleAdminRepublish(request, env);
      }

      // ── Click-count sync (manual trigger) ───────────────────────
      if (
        request.method === "POST" &&
        segs[0] === "api" &&
        segs[1] === "admin" &&
        segs[2] === "sync-clicks"
      ) {
        return await handleAdminSyncClicks(request, env);
      }

      // ── Auth helpers (login page ↔ worker) ──────────────────────
      if (segs[0] === "api" && segs[1] === "auth") {
        if (request.method === "POST" && segs[2] === "preflight")
          return await handleAuthPreflight(request, env);
        if (request.method === "PATCH" && segs[2] === "mark-password-set")
          return await handleAuthMarkPasswordSet(request, env);
        if (request.method === "POST" && segs[2] === "access-request")
          return await handleAuthAccessRequest(request, env);
      }

      // ── Access requests (admin inbox) ───────────────────────────
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "access-requests") {
        if (request.method === "GET" && !segs[3])
          return await handleAdminAccessRequestsList(url, env, request);
        if (request.method === "PATCH" && segs[3])
          return await handleAdminAccessRequestReview(segs[3], request, env);
      }

      return jsonResponse({ error: "Not found" }, 404, request);
    } catch (err) {
      console.error("Worker error:", err.stack || err);
      return jsonResponse({ error: "Internal server error" }, 500, request);
    }
  },
};

async function handleProduct(id, env, request) {
  const cacheKey = `product:${id}`;
  const cached = await env.CACHE?.get(cacheKey, "json");
  if (cached) return jsonResponse(cached, 200, request);

  const r = await bokunFetch("GET", `/activity.json/${id}`, undefined, env);
  if (!r.ok) return passThroughError(r, request);

  await env.CACHE?.put(cacheKey, JSON.stringify(r.data), { expirationTtl: TTL_PRODUCT });
  return jsonResponse(r.data, 200, request);
}

async function handlePickupPlaces(id, env, request) {
  const cacheKey = `pickups:${id}`;
  const cached = await env.CACHE?.get(cacheKey, "json");
  if (cached) return jsonResponse(cached, 200, request);

  const r = await bokunFetch("GET", `/activity.json/${id}/pickup-places`, undefined, env);
  if (!r.ok) return passThroughError(r, request);

  await env.CACHE?.put(cacheKey, JSON.stringify(r.data), { expirationTtl: TTL_PICKUP });
  return jsonResponse(r.data, 200, request);
}

async function handleAvailability(id, url, env, request) {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const fresh = url.searchParams.get("fresh") === "1";

  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return jsonResponse({ error: "start and end (YYYY-MM-DD) required" }, 400, request);
  }

  const cacheKey = `avail:${id}:${start}:${end}`;
  if (!fresh) {
    const cached = await env.CACHE?.get(cacheKey, "json");
    if (cached) return jsonResponse(cached, 200, request);
  }

  // Path-to-sign must include the query string exactly as sent.
  const path = `/activity.json/${id}/availabilities?start=${start}&end=${end}&currency=${CURRENCY}`;
  const r = await bokunFetch("GET", path, undefined, env);
  if (!r.ok) return passThroughError(r, request);

  await env.CACHE?.put(cacheKey, JSON.stringify(r.data), { expirationTtl: TTL_AVAIL });
  return jsonResponse(r.data, 200, request);
}

async function handleCheckoutOptions(request, env) {
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const r = await bokunFetch(
    "POST",
    `/checkout.json/options/booking-request?currency=${CURRENCY}`,
    body,
    env,
  );
  if (!r.ok) return passThroughError(r, request);
  return jsonResponse(r.data, 200, request);
}

async function handleCheckoutSubmit(request, env) {
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const r = await bokunFetch("POST", `/checkout.json/submit?currency=${CURRENCY}`, body, env);
  if (!r.ok) return passThroughError(r, request);
  return jsonResponse(r.data, 200, request);
}

// ── Booking state handoff ──────────────────────────────────────────────────
// The tour page POSTs the cart here, gets a booking_id, and redirects the
// browser to /checkout/?id=<booking_id>. The checkout page then GETs the
// state back. KV TTL is 15min — when it expires the entry is gone and the
// checkout page treats it as a stale link.
//
// This is purely a state pouch for the surface handoff. The real Bokun hold
// still happens at /api/checkout/options time, exactly as before.
async function handleBookingInitiate(request, env) {
  if (!env.BOOKINGS) {
    return jsonResponse(
      { error: "BOOKINGS KV namespace not configured on worker" },
      500,
      request,
    );
  }

  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const tourId = Number.parseInt(body.tour_id, 10);
  if (!Number.isFinite(tourId) || tourId <= 0) {
    return jsonResponse({ error: "tour_id (positive integer) required" }, 400, request);
  }
  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return jsonResponse({ error: "date (YYYY-MM-DD) required" }, 400, request);
  }
  const adults = Number.parseInt(body.adults, 10) || 0;
  const youth = Number.parseInt(body.youth, 10) || 0;
  const infants = Number.parseInt(body.infants, 10) || 0;
  if (adults + youth + infants < 1) {
    return jsonResponse({ error: "at least one traveller required" }, 400, request);
  }

  const now = Date.now();
  const expiresAt = now + TTL_BOOKING * 1000;
  const bookingId = crypto.randomUUID();

  // Optional employee-attribution slug (FAIRMONT_LL_JS form). Same shape
  // as the URL ?ref=<code> param that originates this; matched against
  // hotel_staff.tracking_code at insert time on the checkout page side
  // → /api/dashboard/record. Hotel-default codes (FAIRMONT_LL) ride
  // through too and harmlessly fail to match any staff row, leaving the
  // booking attributed to the hotel pool.
  const refRaw = typeof body.ref === "string" ? body.ref.trim() : "";
  const ref = /^[A-Z0-9_]{2,40}$/.test(refRaw) ? refRaw : null;

  const state = {
    booking_id: bookingId,
    tour_id: tourId,
    date: body.date,
    time: typeof body.time === "string" ? body.time : null,
    activity_id: body.activity_id ?? null, // Bokun availability slot id, if known
    rate_id: body.rate_id ?? null,
    adults,
    youth,
    infants,
    hotel: typeof body.hotel === "string" ? body.hotel.trim().toLowerCase() : null,
    ref,
    price_total: typeof body.price_total === "number" ? body.price_total : null,
    currency: typeof body.currency === "string" ? body.currency : CURRENCY,
    created_at: now,
    expires_at: expiresAt,
  };

  await env.BOOKINGS.put(`booking:${bookingId}`, JSON.stringify(state), {
    expirationTtl: TTL_BOOKING,
  });

  return jsonResponse({ booking_id: bookingId, expires_at: expiresAt }, 200, request);
}

// ── Hotel-manager dashboard ledger ─────────────────────────────────────────
// Inserts a row into Supabase `bookings` after a confirmed Bokun booking.
// Resolves hotel_id from the slug and (if a tracking code matches) staff_id
// from hotel_staff in parallel, then INSERT … ON CONFLICT DO NOTHING on
// confirmation_code so the page's fire-and-forget retries are idempotent.
async function handleDashboardRecord(request, env) {
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const hotel = typeof body.hotel === "string" ? body.hotel.trim().toLowerCase() : "";
  const code = typeof body.confirmation_code === "string" ? body.confirmation_code.trim() : "";
  const bookingId = typeof body.booking_id === "string" ? body.booking_id.trim() : "";
  const trackingCode =
    typeof body.tracking_code === "string" ? body.tracking_code.trim() : "";
  if (!hotel || !/^[a-z0-9-]{2,40}$/.test(hotel)) {
    return jsonResponse({ error: "hotel slug required" }, 400, request);
  }
  if (!code) {
    return jsonResponse({ error: "confirmation_code required" }, 400, request);
  }

  // Parallel lookups — saves a round trip vs. sequential. Staff
  // resolution matches on the partner-controlled slug
  // (hotel_staff.tracking_code, e.g. FAIRMONT_LL_JS) rather than the
  // hex tracking codes Bokun used to mint.
  const [hotelRows, staffRows] = await Promise.all([
    supabaseSelect(env, `hotels?code=eq.${encodeURIComponent(hotel)}&select=id`),
    trackingCode
      ? supabaseSelect(
          env,
          `hotel_staff?tracking_code=eq.${encodeURIComponent(trackingCode)}&select=id,hotel_id`,
        )
      : Promise.resolve([]),
  ]);

  if (!hotelRows.length) {
    return jsonResponse({ error: `unknown hotel slug: ${hotel}` }, 400, request);
  }
  const hotelId = hotelRows[0].id;

  // Only attribute to staff if their hotel matches — defends against a
  // tracking-code collision between hotels. Hotel-level codes (e.g.
  // FAIRMONT_LL) won't match any hotel_staff row and so resolve to
  // staff_id=null, which is the correct "hotel pool" attribution.
  const staffMatch = staffRows[0];
  const staffId = staffMatch && staffMatch.hotel_id === hotelId ? staffMatch.id : null;

  const row = {
    booking_id:        bookingId || null,
    hotel_id:          hotelId,
    staff_id:          staffId,
    confirmation_code: code,
    tour_id:           body.tour_id ?? null,
    tour_title:        typeof body.tour_title === "string" ? body.tour_title : null,
    date:              typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
                       ? body.date
                       : null,
    time:              typeof body.time === "string" ? body.time : null,
    adults:            Number.parseInt(body.adults, 10) || 0,
    youth:             Number.parseInt(body.youth, 10) || 0,
    infants:           Number.parseInt(body.infants, 10) || 0,
    amount:            typeof body.amount === "number" ? body.amount : null,
    currency:          typeof body.currency === "string" ? body.currency : CURRENCY,
    lead_name:         typeof body.lead_name === "string" ? body.lead_name : null,
    lead_email:        typeof body.lead_email === "string" ? body.lead_email : null,
  };

  // ignore-duplicates → INSERT … ON CONFLICT (confirmation_code) DO NOTHING.
  // Keeps the first record if the page retries with the same code.
  await supabaseRequest(env, "POST", "/bookings?on_conflict=confirmation_code", {
    body: [row],
    prefer: "resolution=ignore-duplicates,return=minimal",
  });

  return jsonResponse({ ok: true }, 200, request);
}

async function handleDashboardBookings(url, env, request) {
  // Auth gate: caller must present a Supabase JWT and be assigned to
  // the requested hotel via hotel_users. Service-role bypasses RLS on
  // the actual data fetch, so the authorization decision lives here
  // rather than relying on PostgREST policies.
  const auth = await requireAuthenticated(request, env);
  if (auth.error) return auth.error;
  const userEmail = String(auth.claims.email || "").trim();
  if (!userEmail) {
    return jsonResponse({ error: "jwt missing email claim" }, 401, request);
  }

  const hotel = (url.searchParams.get("hotel") || "").trim().toLowerCase();
  if (!hotel || !/^[a-z0-9-]{2,40}$/.test(hotel)) {
    return jsonResponse({ error: "hotel slug required" }, 400, request);
  }
  const from = url.searchParams.get("from"); // YYYY-MM-DD or ISO datetime, optional
  const to = url.searchParams.get("to");
  const fromTs = parseTimeBound(from, "start");
  const toTs = parseTimeBound(to, "end");
  const fromOk = !!fromTs;
  const toOk = !!toTs;

  // 1) Resolve the hotel — also gives us the partner block for the
  //    response so the dashboard doesn't need a separate lookup.
  const hotelRows = await supabaseSelect(
    env,
    `hotels?code=eq.${encodeURIComponent(hotel)}` +
      `&select=id,code,name,location,type,commission_pct,kickback_pool_pct`,
  );
  if (!hotelRows.length) {
    return jsonResponse({ error: `unknown hotel slug: ${hotel}` }, 404, request);
  }
  const h = hotelRows[0];

  // 2) Authorize. Two paths:
  //    a) horizon_admins → can read any hotel's bookings (the /admin/
  //       dashboard expands every hotel row + generates invoices for
  //       all of them).
  //    b) hotel_users    → restricted to their assigned hotel(s) —
  //       this is the partner-side dashboard at /dashboard/hotel/.
  //    ilike with no wildcards = case-insensitive equals, lines up
  //    with how lower(email) is indexed on both tables.
  const adminRows = await supabaseSelect(
    env,
    `horizon_admins?email=ilike.${encodeURIComponent(userEmail)}` +
      `&status=eq.active&select=id`,
  );
  const isHorizonAdmin = adminRows.length > 0;
  if (!isHorizonAdmin) {
    const assignmentRows = await supabaseSelect(
      env,
      `hotel_users?email=ilike.${encodeURIComponent(userEmail)}` +
        `&hotel_id=eq.${h.id}&status=eq.active&select=id`,
    );
    if (!assignmentRows.length) {
      return jsonResponse({ error: "forbidden" }, 403, request);
    }
  }

  // 3) Pull the bookings, embedding the linked staff row when present.
  //    Limit 1000 covers months per hotel; paginate via cursor when a
  //    partner outgrows it.
  const fields =
    "id,booking_id,confirmation_code,tour_id,tour_title,date,time," +
    "adults,youth,infants,amount,currency,lead_name,lead_email," +
    "status,created_at,updated_at," +
    "staff:hotel_staff(id,code,name,tracking_code,kickback_pct)";
  let q =
    `bookings?hotel_id=eq.${h.id}` +
    `&select=${fields}` +
    `&order=created_at.desc&limit=1000`;
  if (fromOk) q += `&created_at=gte.${encodeURIComponent(fromTs)}`;
  if (toOk) q += `&created_at=lte.${encodeURIComponent(toTs)}`;

  const rows = await supabaseSelect(env, q);

  // PostgREST returns `numeric` columns as JSON strings to preserve
  // precision; coerce to Number for clean arithmetic on the page.
  const records = rows.map((r) => ({
    ...r,
    amount: r.amount != null ? Number(r.amount) : null,
  }));

  // KPIs only count confirmed — cancelled and refunded bookings show in
  // the records list (so the partner sees what was reversed) but are
  // never owed.
  const kpis = records.reduce(
    (acc, r) => {
      if (r.status !== "confirmed") return acc;
      acc.bookings += 1;
      acc.travelers += (r.adults || 0) + (r.youth || 0) + (r.infants || 0);
      acc.revenue += r.amount != null ? r.amount : 0;
      return acc;
    },
    { bookings: 0, travelers: 0, revenue: 0 },
  );

  return jsonResponse(
    {
      hotel: {
        code:              h.code,
        name:              h.name,
        location:          h.location,
        type:              h.type,
        commission_pct:    h.commission_pct != null ? Number(h.commission_pct) : 0,
        kickback_pool_pct: h.kickback_pool_pct != null ? Number(h.kickback_pool_pct) : null,
      },
      from: fromOk ? from : null,
      to: toOk ? to : null,
      kpis,
      records,
    },
    200,
    request,
  );
}

// ── Horizon admin (internal) ───────────────────────────────────────────────
// Cross-hotel summary for the internal commission dashboard. Gated by a
// Supabase Auth JWT plus an active row in the horizon_admins table —
// signing in by itself isn't enough; the email has to be on the
// allowlist. Excludes cancelled and refunded bookings from all totals.
async function handleAdminSummary(url, env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fromTs = parseTimeBound(from, "start");
  const toTs = parseTimeBound(to, "end");
  if (!fromTs || !toTs) {
    return jsonResponse(
      { error: "from and to (YYYY-MM-DD or ISO 8601) required" },
      400,
      request,
    );
  }

  const fields =
    "id,confirmation_code,date,time,adults,youth,infants,amount,currency," +
    "tour_title,tour_id,lead_name,created_at,status," +
    "hotel:hotels(id,code,name,location,type,commission_pct,kickback_pool_pct)," +
    "staff:hotel_staff(id,code,name,tracking_code,kickback_pct)";
  const q =
    `bookings?status=eq.confirmed` +
    `&created_at=gte.${encodeURIComponent(fromTs)}` +
    `&created_at=lte.${encodeURIComponent(toTs)}` +
    `&select=${fields}` +
    `&order=created_at.desc&limit=10000`;
  const rows = await supabaseSelect(env, q);

  const hotelMap = new Map();
  const totals = { bookings: 0, travelers: 0, revenue: 0, commission_owed: 0 };

  for (const r of rows) {
    if (!r.hotel) continue; // hotel_id is NOT NULL but defend defensively
    const amount = r.amount != null ? Number(r.amount) : 0;
    const travelers = (r.adults || 0) + (r.youth || 0) + (r.infants || 0);
    const commissionPct =
      r.hotel.commission_pct != null ? Number(r.hotel.commission_pct) : 0;
    const commission = (amount * commissionPct) / 100;

    let h = hotelMap.get(r.hotel.code);
    if (!h) {
      h = {
        code:            r.hotel.code,
        name:            r.hotel.name,
        location:        r.hotel.location,
        type:            r.hotel.type,
        commission_pct:  commissionPct,
        bookings:        0,
        travelers:       0,
        revenue:         0,
        commission_owed: 0,
        kickbacks_total: 0,
        _staffMap:       new Map(),
      };
      hotelMap.set(r.hotel.code, h);
    }

    h.bookings += 1;
    h.travelers += travelers;
    h.revenue += amount;
    h.commission_owed += commission;

    if (r.staff) {
      const kPct = r.staff.kickback_pct != null ? Number(r.staff.kickback_pct) : 0;
      const kAmt = (amount * kPct) / 100;
      let s = h._staffMap.get(r.staff.code);
      if (!s) {
        s = {
          staff_code:    r.staff.code,
          staff_name:    r.staff.name,
          kickback_pct:  kPct,
          bookings:      0,
          revenue:       0,
          kickback_owed: 0,
        };
        h._staffMap.set(r.staff.code, s);
      }
      s.bookings += 1;
      s.revenue += amount;
      s.kickback_owed += kAmt;
      h.kickbacks_total += kAmt;
    }

    totals.bookings += 1;
    totals.travelers += travelers;
    totals.revenue += amount;
    totals.commission_owed += commission;
  }

  const hotels = Array.from(hotelMap.values()).map((h) => ({
    code:            h.code,
    name:            h.name,
    location:        h.location,
    type:            h.type,
    commission_pct:  h.commission_pct,
    bookings:        h.bookings,
    travelers:       h.travelers,
    revenue:         round2(h.revenue),
    commission_owed: round2(h.commission_owed),
    kickbacks: Array.from(h._staffMap.values()).map((s) => ({
      staff_code:    s.staff_code,
      staff_name:    s.staff_name,
      kickback_pct:  s.kickback_pct,
      bookings:      s.bookings,
      revenue:       round2(s.revenue),
      kickback_owed: round2(s.kickback_owed),
    })),
    kickbacks_total: round2(h.kickbacks_total),
  }));
  hotels.sort((a, b) => b.revenue - a.revenue);

  const kickbacksOwed = hotels.reduce((acc, h) => acc + h.kickbacks_total, 0);

  return jsonResponse(
    {
      from,
      to,
      totals: {
        bookings:        totals.bookings,
        travelers:       totals.travelers,
        revenue:         round2(totals.revenue),
        commission_owed: round2(totals.commission_owed),
        kickbacks_owed:  round2(kickbacksOwed),
        net_to_horizon:  round2(totals.revenue - totals.commission_owed - kickbacksOwed),
      },
      hotels,
    },
    200,
    request,
  );
}

// Manual cancellation/refund tracking — replaces the Bokun webhook we
// can't have on this account tier. PATCH /api/admin/bookings/<uuid>
// with body { status }. Status must be one of the four enum values
// the schema accepts.
const ALLOWED_STATUSES = new Set(["confirmed", "cancelled", "refunded", "pending_refund"]);

async function handleAdminBookingPatch(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  if (!UUID_RE.test(id)) {
    return jsonResponse({ error: "invalid booking id" }, 400, request);
  }

  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (!ALLOWED_STATUSES.has(status)) {
    return jsonResponse(
      {
        error: "status must be one of: " + Array.from(ALLOWED_STATUSES).join(", "),
      },
      400,
      request,
    );
  }

  // return=representation so we can confirm the row actually existed —
  // PostgREST returns [] for a no-match update, which we surface as 404.
  const updated = await supabaseUpdate(
    env,
    `bookings?id=eq.${encodeURIComponent(id)}`,
    { status },
    { returnRow: true },
  );

  if (!Array.isArray(updated) || updated.length === 0) {
    return jsonResponse({ error: "booking not found" }, 404, request);
  }

  return jsonResponse({ ok: true, booking: updated[0] }, 200, request);
}

// ── Hotels / staff / managers CRUD (/admin/hotels/) ────────────────────────
// All admin-gated. Writes go to Supabase; partners.json (the static
// file the rest of the site reads) is regenerated on the next CF Pages
// build, which the upcoming /api/admin/republish endpoint triggers.

const HOTEL_FIELDS =
  "id,code,name,location,type,status,effective_date,default_tracking_code," +
  "tracking_prefix,commission_pct,kickback_pool_pct,notes,created_at,updated_at";
const STAFF_FIELDS =
  "id,hotel_id,code,name,tracking_code,sequence_number,kickback_pct," +
  "status,created_at,updated_at";
const MANAGER_FIELDS = "id,email,hotel_id,role,status,created_at,updated_at";

const HOTEL_TYPES = new Set(["kickback", "pool"]);
const HOTEL_LOCATIONS = new Set(["Banff", "Canmore"]);
const HOTEL_STATUSES = new Set(["active", "terminated"]);
const STAFF_STATUSES = new Set(["active", "terminated"]);
const MANAGER_STATUSES = new Set(["active", "revoked"]);
// 60-char ceiling lets us hold full property names like
// "the-rimrock-resort-hotel-banff-springs" instead of forcing
// abbreviation. Slugs stay lowercase + hyphen + digit only.
const SLUG_RE = /^[a-z0-9-]{2,60}$/;
const TRACKING_CODE_RE = /^[A-Z0-9_]{2,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 4-char random alphanumeric, e.g. "X7K2". Omits I, O, 0, 1 so the
// printed prefix is never ambiguous on paper or read aloud. 32^4 ≈
// 1M combinations — collision probability stays negligible even at
// 10k+ hotels, and the UNIQUE constraint catches any that slip through.
const PREFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PREFIX_LENGTH = 4;
const TRACKING_PREFIX_RE = /^[A-HJ-NP-Z2-9]{4}$/;

function generateTrackingPrefix() {
  let s = "";
  for (let i = 0; i < PREFIX_LENGTH; i++) {
    s += PREFIX_ALPHABET[Math.floor(Math.random() * PREFIX_ALPHABET.length)];
  }
  return s;
}

// Detect Postgres unique_violation (SQLSTATE 23505) in a PostgREST error
// body. PostgREST surfaces the code in err.body.code; older versions
// returned only a message, so we also pattern-match the text.
function isUniqueViolation(err, columnHint) {
  const body = err && err.body;
  if (!body) return false;
  if (body.code === "23505") {
    return columnHint ? String(body.details || body.message || "").includes(columnHint) : true;
  }
  const text = typeof body === "string" ? body : JSON.stringify(body);
  if (!/duplicate key|already exists|unique/i.test(text)) return false;
  return columnHint ? text.includes(columnHint) : true;
}

// Mint a Short.io short link and persist the mirror row in
// short_links. Best-effort by default: a Short.io failure logs and
// returns null rather than throwing, so the parent hotel/staff
// creation succeeds even when Short.io is unreachable or unconfigured.
// Set `throwOnError: true` for the admin POST endpoint where the
// caller explicitly asked to create a short link and a failure is
// the actionable outcome.
async function mintShortLinkAndRecord(env, params, { throwOnError = false } = {}) {
  const {
    shortPath,
    targetUrl,
    title,
    linkType,
    hotelId = null,
    staffId = null,
    label = null,
    notes = null,
  } = params;

  if (!isShortIoConfigured(env)) {
    if (throwOnError) {
      throw new ShortIoError(500, null, "SHORT_IO_API_KEY not configured on the worker");
    }
    return null;
  }

  let created;
  try {
    created = await createShortLink(env, {
      path: shortPath,
      originalURL: targetUrl,
      title: title || label || null,
    });
  } catch (err) {
    if (throwOnError) throw err;
    console.warn(
      `Short.io createShortLink failed for ${linkType} ${hotelId || staffId}: ${err.message}`,
    );
    return null;
  }

  // Short.io returns { id, shortURL, path, originalURL, ... }. Persist
  // those alongside our metadata so we can call update/delete later
  // without re-querying Short.io.
  try {
    const inserted = await supabaseInsert(
      env,
      "short_links",
      [
        {
          short_io_id: created.id,
          domain: env.SHORT_IO_DOMAIN || "link.gowithhorizon.com",
          short_path: created.path || shortPath,
          target_url: created.originalURL || targetUrl,
          link_type: linkType,
          hotel_id: hotelId,
          staff_id: staffId,
          label,
          notes,
        },
      ],
      { returnRow: true },
    );
    return inserted[0];
  } catch (err) {
    // Short.io created the link but Supabase rejected the row. We
    // surface this either way — silent failure here means a
    // dangling Short.io link with no DB record, which is a
    // reconciliation headache. Worth a loud log.
    console.error(
      `Short.io link ${created.id} created but short_links insert failed: ${err.message}`,
    );
    if (throwOnError) throw err;
    return null;
  }
}

// Build the long URL a short link should redirect to. Hotel master:
// /partners/<slug>/. Staff: append ?ref=<tracking_code> so the
// checkout flow attributes the booking to the employee.
function hotelTargetUrl(env, hotelCode) {
  const base = (env.PUBLIC_SITE_BASE || "https://gowithhorizon.com").replace(/\/$/, "");
  return `${base}/partners/${encodeURIComponent(hotelCode)}/`;
}
function staffTargetUrl(env, hotelCode, trackingCode) {
  return `${hotelTargetUrl(env, hotelCode)}?ref=${encodeURIComponent(trackingCode)}`;
}

// Hotel insert wrapper. Generates a unique tracking_prefix and seeds
// default_tracking_code from it. Retries on the (unlikely) prefix
// collision rather than surfacing a confusing duplicate-key error to
// the admin UI.
async function insertHotelWithPrefix(env, row, maxAttempts = 8) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const prefix = generateTrackingPrefix();
    const candidate = {
      ...row,
      tracking_prefix: prefix,
      // Hotel-level default — sent as tracking_code when a guest
      // arrives via the master link with no employee ?ref=. Worker
      // fails the staff lookup against it (no staff row matches
      // X7K2_H), so staff_id stays null and the booking attributes
      // to the hotel pool. Format is consistent with X7K2_E_0042
      // for staff so the admin UI can render both uniformly.
      default_tracking_code: `${prefix}_H`,
    };
    try {
      const inserted = await supabaseInsert(env, "hotels", [candidate], { returnRow: true });
      const hotel = inserted[0];
      // Auto-mint the hotel's master short link. Best-effort: a
      // Short.io failure (network, rate limit, missing API key)
      // does not roll back the hotel row. Admins can create the
      // short link retroactively via the /api/admin/short-links
      // POST endpoint once Short.io is wired up.
      await mintShortLinkAndRecord(env, {
        shortPath: hotel.code,
        targetUrl: hotelTargetUrl(env, hotel.code),
        title: `${hotel.name} — master`,
        linkType: "hotel",
        hotelId: hotel.id,
        label: "Master — hotel default",
      });
      return hotel;
    } catch (err) {
      lastErr = err;
      if (isUniqueViolation(err, "tracking_prefix")) continue;
      throw err;
    }
  }
  const e = new Error(`could not allocate unique tracking_prefix after ${maxAttempts} attempts`);
  e.cause = lastErr;
  throw e;
}

// Staff insert wrapper. Computes the next sequence_number for the
// hotel (max + 1) and mints the tracking_code from
// {hotel.tracking_prefix}_E_{padded sequence}. The UNIQUE
// (hotel_id, sequence_number) index catches concurrent inserts;
// on collision we re-read max and try again.
async function insertStaffWithSequence(env, row, maxAttempts = 5) {
  const hotelRows = await supabaseSelect(
    env,
    `hotels?id=eq.${encodeURIComponent(row.hotel_id)}&select=tracking_prefix`,
  );
  if (!hotelRows.length) {
    const e = new Error("hotel not found");
    e.status = 404;
    throw e;
  }
  const prefix = hotelRows[0].tracking_prefix;
  if (!prefix || !TRACKING_PREFIX_RE.test(prefix)) {
    throw new Error(`hotel ${row.hotel_id} has no valid tracking_prefix`);
  }

  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const maxRows = await supabaseSelect(
      env,
      `hotel_staff?hotel_id=eq.${encodeURIComponent(row.hotel_id)}` +
        `&select=sequence_number&order=sequence_number.desc&limit=1`,
    );
    const nextSeq = (maxRows.length && maxRows[0].sequence_number ? maxRows[0].sequence_number : 0) + 1;
    const candidate = {
      ...row,
      sequence_number: nextSeq,
      tracking_code: `${prefix}_E_${String(nextSeq).padStart(4, "0")}`,
    };
    try {
      const inserted = await supabaseInsert(env, "hotel_staff", [candidate], { returnRow: true });
      const staff = inserted[0];
      // Look up the hotel's code to construct the long URL (the
      // tracking_prefix is on the hotel row, but the URL needs the
      // slug). One extra round-trip per create — acceptable cost
      // for the operational simplicity of not bubbling the code
      // through the parent calls.
      const hotelRows = await supabaseSelect(
        env,
        `hotels?id=eq.${encodeURIComponent(row.hotel_id)}&select=code,name`,
      );
      const hotel = hotelRows[0];
      if (hotel) {
        await mintShortLinkAndRecord(env, {
          shortPath: trackingCodeToShortPath(staff.tracking_code),
          targetUrl: staffTargetUrl(env, hotel.code, staff.tracking_code),
          title: `${hotel.name} — ${staff.name}`,
          linkType: "staff",
          hotelId: row.hotel_id,
          staffId: staff.id,
          label: staff.name,
        });
      }
      return staff;
    } catch (err) {
      lastErr = err;
      if (
        isUniqueViolation(err, "sequence_number") ||
        isUniqueViolation(err, "tracking_code")
      ) {
        continue;
      }
      throw err;
    }
  }
  const e = new Error(`could not allocate sequence_number for hotel ${row.hotel_id} after ${maxAttempts} attempts`);
  e.cause = lastErr;
  throw e;
}

async function handleAdminHotelsList(env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  const select =
    HOTEL_FIELDS +
    `,staff:hotel_staff(${STAFF_FIELDS})` +
    `,managers:hotel_users(${MANAGER_FIELDS})` +
    `,short_links:short_links(${SHORT_LINK_FIELDS})`;
  const rows = await supabaseSelect(env, `hotels?select=${select}&order=code.asc`);
  return jsonResponse({ hotels: rows.map(normaliseHotel) }, 200, request);
}

async function handleAdminHotelCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validateHotel(body, { creating: true });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);

  try {
    const inserted = await insertHotelWithPrefix(env, v.row);
    return jsonResponse({ hotel: normaliseHotel(inserted) }, 201, request);
  } catch (err) {
    if (isUniqueViolation(err, "code") || isUniqueViolation(err, "hotels_code_key")) {
      return jsonResponse({ error: `hotel with code "${v.row.code}" already exists` }, 409, request);
    }
    throw err;
  }
}

async function handleAdminHotelUpdate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid hotel id" }, 400, request);
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validateHotel(body, { creating: false });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);
  // Don't allow code changes — slug is the URL identity, would break QR codes.
  delete v.row.code;

  const updated = await supabaseUpdate(
    env, `hotels?id=eq.${encodeURIComponent(id)}`, v.row, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "hotel not found" }, 404, request);
  }
  return jsonResponse({ hotel: normaliseHotel(updated[0]) }, 200, request);
}

async function handleAdminHotelTerminate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid hotel id" }, 400, request);

  const updated = await supabaseUpdate(
    env, `hotels?id=eq.${encodeURIComponent(id)}`,
    { status: "terminated" }, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "hotel not found" }, 404, request);
  }
  return jsonResponse({ hotel: normaliseHotel(updated[0]) }, 200, request);
}

async function handleAdminStaffCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validateStaff(body, { creating: true });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);

  try {
    const inserted = await insertStaffWithSequence(env, v.row);
    return jsonResponse({ staff: normaliseStaff(inserted) }, 201, request);
  } catch (err) {
    if (err.status === 404) return jsonResponse({ error: err.message }, 404, request);
    if (isUniqueViolation(err, "code")) {
      return jsonResponse({ error: `staff with code "${v.row.code}" already exists` }, 409, request);
    }
    throw err;
  }
}

async function handleAdminStaffUpdate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid staff id" }, 400, request);
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validateStaff(body, { creating: false });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);
  delete v.row.code;     // slug is identity
  delete v.row.hotel_id; // can't reassign staff to a different hotel

  const updated = await supabaseUpdate(
    env, `hotel_staff?id=eq.${encodeURIComponent(id)}`, v.row, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "staff not found" }, 404, request);
  }
  return jsonResponse({ staff: normaliseStaff(updated[0]) }, 200, request);
}

async function handleAdminStaffTerminate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid staff id" }, 400, request);

  const updated = await supabaseUpdate(
    env, `hotel_staff?id=eq.${encodeURIComponent(id)}`,
    { status: "terminated" }, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "staff not found" }, 404, request);
  }
  return jsonResponse({ staff: normaliseStaff(updated[0]) }, 200, request);
}

async function handleAdminHotelUserCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: "valid email required" }, 400, request);
  const hotel_id = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
  if (!UUID_RE.test(hotel_id)) return jsonResponse({ error: "valid hotel_id required" }, 400, request);
  const role = body.role === "admin" ? "admin" : "manager";

  try {
    const inserted = await supabaseInsert(
      env, "hotel_users",
      [{ email, hotel_id, role, status: "active" }],
      { returnRow: true },
    );
    const invite_sent = await sendManagerInvite(env, email);
    return jsonResponse({ manager: inserted[0], invite_sent }, 201, request);
  } catch (err) {
    if (err.body && /duplicate key|unique/i.test(JSON.stringify(err.body))) {
      return jsonResponse({ error: `${email} is already an active manager for this hotel` }, 409, request);
    }
    throw err;
  }
}

// Sends a Supabase Auth invite email to a newly-added hotel manager.
// The invite link redirects to /dashboard/setup/ where they set a
// password on first sign-in. Returns true if the email was sent,
// false if the user already has a confirmed Supabase Auth account
// (they can just sign in normally) or if the invite call fails for
// any other reason (the hotel_users row is already saved either way).
async function sendManagerInvite(env, email) {
  const redirectTo = "https://gowithhorizon.com/dashboard/setup/";
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, invite: true, email_redirect_to: redirectTo }),
    });
    if (res.ok) return true;
    const text = await res.text().catch(() => "");
    // 422 = user already exists and is confirmed — no invite needed.
    if (res.status === 422 || /already (exists|registered)/i.test(text)) return false;
    console.error(`sendManagerInvite ${res.status}:`, text);
    return false;
  } catch (err) {
    console.error("sendManagerInvite failed:", err.message);
    return false;
  }
}

async function handleAdminHotelUserUpdate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid hotel-user id" }, 400, request);
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const patch = {};
  if (typeof body.status === "string") {
    if (!MANAGER_STATUSES.has(body.status)) {
      return jsonResponse({ error: "status must be active or revoked" }, 400, request);
    }
    patch.status = body.status;
  }
  if (typeof body.role === "string") {
    if (!["manager", "admin"].includes(body.role)) {
      return jsonResponse({ error: "role must be manager or admin" }, 400, request);
    }
    patch.role = body.role;
  }
  if (Object.keys(patch).length === 0) {
    return jsonResponse({ error: "no editable fields in body" }, 400, request);
  }

  const updated = await supabaseUpdate(
    env, `hotel_users?id=eq.${encodeURIComponent(id)}`, patch, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "hotel-user not found" }, 404, request);
  }
  return jsonResponse({ manager: updated[0] }, 200, request);
}

// ── Short.io short_links — admin CRUD ─────────────────────────────────────
// Auto-created rows arrive via insertHotelWithPrefix /
// insertStaffWithSequence. These endpoints let admins:
//   • list every short link for a hotel (including staff links)
//   • create additional short links (extra QRs for the same hotel,
//     campaign-specific destinations, retroactive creation when
//     Short.io was offline at hotel/staff create time)
//   • re-target a link's destination (the operation that protects
//     every printed QR — change where it goes without changing what
//     it encodes)
//   • soft-retire a link (status='retired', Short.io redirect stays
//     alive so any QR codes already in circulation keep resolving)

const SHORT_LINK_FIELDS =
  "id,short_io_id,domain,short_path,short_url,target_url,link_type," +
  "hotel_id,staff_id,label,notes,status,click_count_cached," +
  "last_clicked_at,created_at,updated_at";
const SHORT_LINK_TYPES = new Set(["hotel", "staff", "campaign"]);
const SHORT_LINK_STATUSES = new Set(["active", "retired"]);
// Short.io path constraints — alphanumeric plus the common
// separators. Conservative; tighten if you find Short.io rejecting
// edge cases.
const SHORT_PATH_RE = /^[a-zA-Z0-9._-]{1,80}$/;

function normaliseShortLink(s) {
  return s;
}

// GET /api/admin/hotels/:id/short-links
//
// Returns every short_link attributable to this hotel — including
// staff-level links for any employee of the hotel. PostgREST doesn't
// support subqueries inside `or=()`, so we do two reads and merge in
// JS rather than building a database view.
async function handleAdminHotelShortLinksList(hotelId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(hotelId)) return jsonResponse({ error: "invalid hotel id" }, 400, request);

  const [byHotel, staffRows] = await Promise.all([
    supabaseSelect(env, `short_links?hotel_id=eq.${hotelId}&select=${SHORT_LINK_FIELDS}&order=created_at.asc`),
    supabaseSelect(env, `hotel_staff?hotel_id=eq.${hotelId}&select=id`),
  ]);
  let byStaff = [];
  if (staffRows.length) {
    const staffIds = staffRows.map((s) => s.id).join(",");
    byStaff = await supabaseSelect(
      env,
      `short_links?staff_id=in.(${staffIds})&select=${SHORT_LINK_FIELDS}&order=created_at.asc`,
    );
  }
  // De-dupe — a staff link also has hotel_id set, so the two
  // queries can return overlapping rows.
  const seen = new Set();
  const out = [];
  for (const r of [...byHotel, ...byStaff]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(normaliseShortLink(r));
  }
  return jsonResponse({ short_links: out }, 200, request);
}

// POST /api/admin/short-links
// Body: { link_type, hotel_id?, staff_id?, short_path?, target_url?,
//         label?, notes? }
// If short_path is omitted we derive one (slug for hotel, opaque code
// for staff). If target_url is omitted we derive one too. Either way
// the admin can override — useful for campaign links.
async function handleAdminShortLinkCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const linkType = typeof body.link_type === "string" ? body.link_type : "";
  if (!SHORT_LINK_TYPES.has(linkType)) {
    return jsonResponse({ error: "link_type must be hotel, staff, or campaign" }, 400, request);
  }
  const hotelId = typeof body.hotel_id === "string" ? body.hotel_id.trim() : null;
  const staffId = typeof body.staff_id === "string" ? body.staff_id.trim() : null;
  if (hotelId && !UUID_RE.test(hotelId)) {
    return jsonResponse({ error: "hotel_id must be a uuid" }, 400, request);
  }
  if (staffId && !UUID_RE.test(staffId)) {
    return jsonResponse({ error: "staff_id must be a uuid" }, 400, request);
  }
  if (linkType === "hotel" && !hotelId) {
    return jsonResponse({ error: "hotel link_type requires hotel_id" }, 400, request);
  }
  if (linkType === "staff" && (!staffId || !hotelId)) {
    return jsonResponse({ error: "staff link_type requires both staff_id and hotel_id" }, 400, request);
  }

  // Resolve hotel + staff rows when present so we can build a
  // sensible default short_path + target_url and reject IDs that
  // don't belong to each other.
  let hotelRow = null;
  let staffRow = null;
  if (hotelId) {
    const rows = await supabaseSelect(
      env,
      `hotels?id=eq.${hotelId}&select=id,code,name,tracking_prefix,default_tracking_code`,
    );
    if (!rows.length) return jsonResponse({ error: "hotel not found" }, 404, request);
    hotelRow = rows[0];
  }
  if (staffId) {
    const rows = await supabaseSelect(
      env,
      `hotel_staff?id=eq.${staffId}&select=id,hotel_id,name,tracking_code`,
    );
    if (!rows.length) return jsonResponse({ error: "staff not found" }, 404, request);
    staffRow = rows[0];
    if (hotelId && staffRow.hotel_id !== hotelId) {
      return jsonResponse({ error: "staff_id does not belong to hotel_id" }, 400, request);
    }
  }

  // Derive defaults — overridable by request body.
  let shortPath = typeof body.short_path === "string" ? body.short_path.trim() : "";
  if (!shortPath) {
    if (linkType === "staff" && staffRow) {
      shortPath = trackingCodeToShortPath(staffRow.tracking_code) || "";
    } else if (linkType === "hotel" && hotelRow) {
      shortPath = hotelRow.code;
    }
  }
  if (!shortPath || !SHORT_PATH_RE.test(shortPath)) {
    return jsonResponse(
      { error: "short_path missing or invalid (1–80 chars, [a-zA-Z0-9._-])" },
      400,
      request,
    );
  }

  let targetUrl = typeof body.target_url === "string" ? body.target_url.trim() : "";
  if (!targetUrl) {
    if (linkType === "staff" && hotelRow && staffRow) {
      targetUrl = staffTargetUrl(env, hotelRow.code, staffRow.tracking_code);
    } else if (linkType === "hotel" && hotelRow) {
      targetUrl = hotelTargetUrl(env, hotelRow.code);
    }
  }
  if (!targetUrl || !/^https?:\/\//.test(targetUrl)) {
    return jsonResponse({ error: "target_url missing or not http(s)" }, 400, request);
  }

  const label = typeof body.label === "string" ? body.label.trim() : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() : null;

  try {
    const inserted = await mintShortLinkAndRecord(
      env,
      {
        shortPath,
        targetUrl,
        title: label,
        linkType,
        hotelId,
        staffId,
        label,
        notes,
      },
      { throwOnError: true },
    );
    return jsonResponse({ short_link: normaliseShortLink(inserted) }, 201, request);
  } catch (err) {
    if (err instanceof ShortIoError) {
      const status = err.status === 401 ? 502 : err.status >= 400 && err.status < 600 ? err.status : 502;
      return jsonResponse({ error: `Short.io: ${err.message}` }, status, request);
    }
    if (isUniqueViolation(err, "short_path") || isUniqueViolation(err, "short_io_id")) {
      return jsonResponse({ error: "short_path already in use" }, 409, request);
    }
    throw err;
  }
}

// PATCH /api/admin/short-links/:id
// Body: { target_url?, label?, notes? }
// short_path is intentionally NOT editable here — once a QR encodes
// a short URL, the path is immutable forever. Only the destination
// and admin-facing metadata can change.
async function handleAdminShortLinkUpdate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid short_link id" }, 400, request);
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  // Load the row so we know its short_io_id for the Short.io call.
  const rows = await supabaseSelect(
    env,
    `short_links?id=eq.${encodeURIComponent(id)}&select=${SHORT_LINK_FIELDS}`,
  );
  if (!rows.length) return jsonResponse({ error: "short_link not found" }, 404, request);
  const existing = rows[0];

  const patch = {};
  const shortIoPatch = {};
  if (typeof body.target_url === "string") {
    const t = body.target_url.trim();
    if (!t || !/^https?:\/\//.test(t)) {
      return jsonResponse({ error: "target_url must be http(s)" }, 400, request);
    }
    patch.target_url = t;
    shortIoPatch.originalURL = t;
  }
  if (body.label === null) patch.label = null;
  else if (typeof body.label === "string") {
    patch.label = body.label.trim();
    shortIoPatch.title = patch.label || null;
  }
  if (body.notes === null) patch.notes = null;
  else if (typeof body.notes === "string") patch.notes = body.notes.trim();
  if (typeof body.status === "string") {
    if (!SHORT_LINK_STATUSES.has(body.status)) {
      return jsonResponse({ error: "status must be active or retired" }, 400, request);
    }
    patch.status = body.status;
  }
  if (!Object.keys(patch).length) {
    return jsonResponse({ error: "no editable fields in body" }, 400, request);
  }

  // Push the destination/title change to Short.io BEFORE we update
  // Supabase. If Short.io fails we don't want a Supabase row that
  // claims a different destination than the live redirect.
  if (Object.keys(shortIoPatch).length) {
    try {
      await updateShortLink(env, existing.short_io_id, shortIoPatch);
    } catch (err) {
      const status = err instanceof ShortIoError && err.status >= 400 && err.status < 600
        ? err.status
        : 502;
      return jsonResponse({ error: `Short.io: ${err.message}` }, status, request);
    }
  }

  const updated = await supabaseUpdate(
    env,
    `short_links?id=eq.${encodeURIComponent(id)}`,
    patch,
    { returnRow: true },
  );
  return jsonResponse({ short_link: normaliseShortLink(updated[0]) }, 200, request);
}

// DELETE /api/admin/short-links/:id
// Soft-retire only. The Short.io redirect stays alive forever so any
// printed QR codes keep resolving — they just point to whatever
// target_url the row currently has. Use the PATCH endpoint to
// re-target before retiring if you want a different destination.
async function handleAdminShortLinkRetire(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid short_link id" }, 400, request);

  const updated = await supabaseUpdate(
    env,
    `short_links?id=eq.${encodeURIComponent(id)}`,
    { status: "retired" },
    { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "short_link not found" }, 404, request);
  }
  return jsonResponse({ short_link: normaliseShortLink(updated[0]) }, 200, request);
}

// ── Short.io click-count sync ──────────────────────────────────────────────
// Fetches total click counts from Short.io for every active short_link and
// writes them back to short_links.click_count_cached + last_clicked_at.
// Called by the scheduled cron (hourly) and by POST /api/admin/sync-clicks.
// Short.io rate limit: ~100 req/min — we process sequentially with no sleep
// since even 500 links takes well under 60s at Short.io's typical latency.
async function syncClickCounts(env) {
  if (!isShortIoConfigured(env)) {
    return { skipped: true, reason: "SHORT_IO_API_KEY not configured" };
  }

  // Fetch all active links (id + short_io_id only — we don't need full rows).
  let links;
  try {
    links = await supabaseSelect(
      env,
      "short_links?status=eq.active&select=id,short_io_id&order=created_at.asc",
    );
  } catch (err) {
    console.error("syncClickCounts: failed to fetch short_links:", err.message);
    return { synced: 0, errors: 1, error: err.message };
  }

  let synced = 0;
  let errors = 0;

  for (const link of links) {
    try {
      const stats = await getLinkStats(env, link.short_io_id, "total");
      const clickCount = (stats && typeof stats.totalClicks === "number")
        ? stats.totalClicks
        : 0;
      const lastClicked = (stats && stats.lastClickDate) ? stats.lastClickDate : null;
      await supabaseUpdate(
        env,
        `short_links?id=eq.${encodeURIComponent(link.id)}`,
        {
          click_count_cached: clickCount,
          ...(lastClicked ? { last_clicked_at: lastClicked } : {}),
          updated_at: new Date().toISOString(),
        },
      );
      synced++;
    } catch (err) {
      console.error(`syncClickCounts: link ${link.id} failed:`, err.message);
      errors++;
    }
  }

  return { synced, errors, total: links.length };
}

// POST /api/admin/sync-clicks
// Manually triggers the same click-count sync the cron runs hourly.
// Returns { synced, errors, total } so the admin can see progress.
async function handleAdminSyncClicks(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const result = await syncClickCounts(env);
  return jsonResponse(result, 200, request);
}

// GET /api/dashboard/hotel-links?hotel=<slug>
// Returns active short_links for a hotel so the partner dashboard can
// display referral links + click counts. Auth: same hotel-manager
// guard as /api/dashboard/bookings (horizon admin OR hotel_users member).
async function handleDashboardHotelLinks(url, env, request) {
  const auth = await requireAuthenticated(request, env);
  if (auth.error) return auth.error;
  const userEmail = String(auth.claims.email || "").trim();
  if (!userEmail) {
    return jsonResponse({ error: "jwt missing email claim" }, 401, request);
  }

  const hotel = (url.searchParams.get("hotel") || "").trim().toLowerCase();
  if (!hotel || !/^[a-z0-9-]{2,60}$/.test(hotel)) {
    return jsonResponse({ error: "hotel slug required" }, 400, request);
  }

  const hotelRows = await supabaseSelect(
    env,
    `hotels?code=eq.${encodeURIComponent(hotel)}&select=id,code,name`,
  );
  if (!hotelRows.length) {
    return jsonResponse({ error: `unknown hotel: ${hotel}` }, 404, request);
  }
  const h = hotelRows[0];

  // Auth: admin or assigned hotel_user
  const adminRows = await supabaseSelect(
    env,
    `horizon_admins?email=ilike.${encodeURIComponent(userEmail)}&status=eq.active&select=id`,
  );
  if (!adminRows.length) {
    const assignRows = await supabaseSelect(
      env,
      `hotel_users?email=ilike.${encodeURIComponent(userEmail)}&hotel_id=eq.${h.id}&status=eq.active&select=id`,
    );
    if (!assignRows.length) {
      return jsonResponse({ error: "forbidden" }, 403, request);
    }
  }

  const fields =
    "id,short_url,short_path,target_url,label,link_type," +
    "staff_id,click_count_cached,last_clicked_at," +
    "staff_member:hotel_staff(name)";
  const links = await supabaseSelect(
    env,
    `short_links?hotel_id=eq.${h.id}&status=eq.active&select=${fields}&order=created_at.asc`,
  );
  return jsonResponse({ short_links: links }, 200, request);
}

// Triggers a Cloudflare Pages rebuild via the deploy hook URL stored
// as CF_PAGES_DEPLOY_HOOK on the worker. The build runs the
// `npm run build:partners` script which regenerates partners.json
// from Supabase. Propagation: ~60–120s end-to-end.
async function handleAdminRepublish(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!env.CF_PAGES_DEPLOY_HOOK) {
    return jsonResponse(
      { error: "CF_PAGES_DEPLOY_HOOK not configured on worker" },
      500, request,
    );
  }
  let res;
  try {
    res = await fetch(env.CF_PAGES_DEPLOY_HOOK, { method: "POST" });
  } catch (err) {
    return jsonResponse({ error: "deploy hook fetch failed: " + err.message }, 502, request);
  }
  if (!res.ok) {
    return jsonResponse(
      { error: "deploy hook returned " + res.status },
      502, request,
    );
  }
  return jsonResponse({ ok: true, triggered_at: new Date().toISOString() }, 200, request);
}

// ── Auth helpers ──────────────────────────────────────────────────────
//
// POST /api/auth/preflight  { email }
//   No auth required. Checks hotel_users and horizon_admins in parallel
//   and returns one of three states the login page branches on:
//     password_required  — active row exists and password_set_at is set
//     first_time_setup   — active row exists but password never set
//     not_approved       — no active row for this email
//   Both DB queries always run regardless of result so response timing
//   is consistent across all three outcomes (mitigates email enumeration).
//
// PATCH /api/auth/mark-password-set
//   Requires a valid Supabase JWT. Called by /dashboard/setup/ and the
//   Account modal after a successful supabase.auth.updateUser({ password }).
//   Stamps password_set_at = now() on whichever table the caller's email
//   belongs to — hotel_users or horizon_admins. Both updates run in
//   parallel; the one with no matching row is a silent no-op.

async function handleAuthPreflight(request, env) {
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: "valid email required" }, 400, request);

  const enc = encodeURIComponent(email);
  const [adminRows, managerRows] = await Promise.all([
    supabaseSelect(env, `horizon_admins?email=ilike.${enc}&status=eq.active&select=id,password_set_at`),
    supabaseSelect(env, `hotel_users?email=ilike.${enc}&status=eq.active&select=id,password_set_at`),
  ]);

  const row = adminRows[0] ?? managerRows[0];
  if (!row) return jsonResponse({ status: "not_approved" }, 200, request);

  return jsonResponse(
    { status: row.password_set_at ? "password_required" : "first_time_setup" },
    200,
    request,
  );
}

async function handleAuthMarkPasswordSet(request, env) {
  const auth = await requireAuthenticated(request, env);
  if (auth.error) return auth.error;

  const userEmail = String(auth.claims.email || "").trim();
  if (!userEmail) return jsonResponse({ error: "jwt missing email claim" }, 401, request);

  const enc = encodeURIComponent(userEmail);
  const now = new Date().toISOString();

  await Promise.all([
    supabaseUpdate(env, `hotel_users?email=ilike.${enc}&status=eq.active`, { password_set_at: now }),
    supabaseUpdate(env, `horizon_admins?email=ilike.${enc}&status=eq.active`, { password_set_at: now }),
  ]);

  return jsonResponse({ ok: true }, 200, request);
}

// POST /api/auth/access-request — no auth required.
// Records a request-access submission from the login page's not-approved
// state. Inserts a pending row into access_requests so the admin inbox
// can surface it for review. Duplicate submissions are fine — the admin
// sees all of them.
async function handleAuthAccessRequest(request, env) {
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name  = typeof body.name  === "string" ? body.name.trim()  : "";
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: "valid email required" }, 400, request);
  if (!name) return jsonResponse({ error: "name required" }, 400, request);

  const row = {
    email,
    name,
    property_requested: typeof body.property_requested === "string"
      ? body.property_requested.trim() || null : null,
    reason: typeof body.reason === "string"
      ? body.reason.trim() || null : null,
  };

  await supabaseInsert(env, "access_requests", [row]);
  return jsonResponse({ ok: true }, 201, request);
}

// GET /api/admin/access-requests — admin auth required.
// Returns all access requests newest-first. Optional ?status= filter.
// pending_count is returned at the top level so the nav badge can be
// populated without a separate call.
async function handleAdminAccessRequestsList(url, env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  const statusFilter = url.searchParams.get("status");
  const validStatuses = new Set(["pending", "approved", "denied"]);

  let q =
    "access_requests?select=id,email,name,property_requested,reason,status,reviewed_at,created_at" +
    "&order=created_at.desc&limit=500";
  if (statusFilter && validStatuses.has(statusFilter)) {
    q += `&status=eq.${encodeURIComponent(statusFilter)}`;
  }

  const rows = await supabaseSelect(env, q);
  const pendingCount = statusFilter
    ? null
    : rows.filter((r) => r.status === "pending").length;

  return jsonResponse({ requests: rows, pending_count: pendingCount }, 200, request);
}

// PATCH /api/admin/access-requests/:id — admin auth required.
// Sets status to approved or denied, stamps reviewed_by + reviewed_at.
async function handleAdminAccessRequestReview(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  if (!UUID_RE.test(id)) {
    return jsonResponse({ error: "invalid access-request id" }, 400, request);
  }

  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (status !== "approved" && status !== "denied") {
    return jsonResponse({ error: "status must be approved or denied" }, 400, request);
  }

  const userEmail = String(auth.claims.email || "").trim();
  const adminRows = await supabaseSelect(
    env,
    `horizon_admins?email=ilike.${encodeURIComponent(userEmail)}&status=eq.active&select=id`,
  );
  const reviewedBy = adminRows[0]?.id ?? null;

  const updated = await supabaseUpdate(
    env,
    `access_requests?id=eq.${encodeURIComponent(id)}`,
    { status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() },
    { returnRow: true },
  );

  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "access request not found" }, 404, request);
  }
  return jsonResponse({ ok: true, request: updated[0] }, 200, request);
}

// ── CRUD validators / normalisers ──────────────────────────────────────

function validateHotel(body, { creating }) {
  const row = {};
  if (creating) {
    const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
    if (!SLUG_RE.test(code)) return { error: "code (lowercase slug, 2–60 chars [a-z0-9-]) required" };
    row.code = code;
  }
  if (typeof body.name === "string" && body.name.trim()) {
    row.name = body.name.trim();
  } else if (creating) {
    return { error: "name required" };
  }
  if (typeof body.location === "string") {
    if (!HOTEL_LOCATIONS.has(body.location)) return { error: "location must be Banff or Canmore" };
    row.location = body.location;
  } else if (creating) {
    return { error: "location required" };
  }
  if (typeof body.type === "string") {
    if (!HOTEL_TYPES.has(body.type)) return { error: "type must be kickback or pool" };
    row.type = body.type;
  } else if (creating) {
    return { error: "type required" };
  }
  if (typeof body.status === "string") {
    if (!HOTEL_STATUSES.has(body.status)) return { error: "status must be active or terminated" };
    row.status = body.status;
  }
  if (body.effective_date === null) {
    row.effective_date = null;
  } else if (typeof body.effective_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.effective_date)) {
    row.effective_date = body.effective_date;
  }
  // tracking_prefix and default_tracking_code are auto-managed at creation
  // and locked thereafter — see insertHotelWithPrefix. Silently drop any
  // client-supplied values so a stale admin UI can't corrupt them.
  if (typeof body.commission_pct === "number") row.commission_pct = body.commission_pct;
  else if (creating) row.commission_pct = 0;
  if (body.kickback_pool_pct === null) row.kickback_pool_pct = null;
  else if (typeof body.kickback_pool_pct === "number") row.kickback_pool_pct = body.kickback_pool_pct;
  if (body.notes === null) row.notes = null;
  else if (typeof body.notes === "string") row.notes = body.notes;

  return { row };
}

function validateStaff(body, { creating }) {
  const row = {};
  if (creating) {
    const hotel_id = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
    if (!UUID_RE.test(hotel_id)) return { error: "valid hotel_id required" };
    row.hotel_id = hotel_id;
    const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
    if (!SLUG_RE.test(code)) return { error: "code (lowercase slug, 2–60 chars) required" };
    row.code = code;
  }
  if (typeof body.name === "string" && body.name.trim()) {
    row.name = body.name.trim();
  } else if (creating) {
    return { error: "name required" };
  }
  // tracking_code and sequence_number are auto-managed by
  // insertStaffWithSequence and locked thereafter. Drop any
  // client-provided values silently.
  if (typeof body.kickback_pct === "number") row.kickback_pct = body.kickback_pct;
  else if (creating) row.kickback_pct = 0;
  if (typeof body.status === "string") {
    if (!STAFF_STATUSES.has(body.status)) return { error: "status must be active or terminated" };
    row.status = body.status;
  }
  return { row };
}

function normaliseHotel(h) {
  // PostgREST returns numeric as strings; coerce so the UI can do math.
  return {
    ...h,
    commission_pct:    h.commission_pct    != null ? Number(h.commission_pct)    : null,
    kickback_pool_pct: h.kickback_pool_pct != null ? Number(h.kickback_pool_pct) : null,
    staff:    Array.isArray(h.staff)    ? h.staff.map(normaliseStaff)    : [],
    managers: Array.isArray(h.managers) ? h.managers                     : [],
    short_links: Array.isArray(h.short_links) ? h.short_links             : [],
  };
}

function normaliseStaff(s) {
  return {
    ...s,
    kickback_pct: s.kickback_pct != null ? Number(s.kickback_pct) : null,
  };
}

// Authorization gate for the internal admin surface (/admin/ + the
// /api/admin/* routes). Wraps requireAuthenticated so the JWT shape +
// signature checks are reused, then verifies the caller has an active
// horizon_admins row matching the JWT's email claim. Returns the same
// { claims } | { error } shape as the other auth helpers so route
// handlers stay symmetric.
async function requireHorizonAdmin(request, env) {
  const auth = await requireAuthenticated(request, env);
  if (auth.error) return auth;
  const userEmail = String(auth.claims.email || "").trim();
  if (!userEmail) {
    return { error: jsonResponse({ error: "jwt missing email claim" }, 401, request) };
  }
  const adminRows = await supabaseSelect(
    env,
    `horizon_admins?email=ilike.${encodeURIComponent(userEmail)}` +
      `&status=eq.active&select=id`,
  );
  if (!adminRows.length) {
    return { error: jsonResponse({ error: "forbidden" }, 403, request) };
  }
  return { claims: auth.claims };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Verifies a Supabase-issued user JWT against the project's JWKS
// endpoint. Supabase migrated from shared-secret HS256 to asymmetric
// signing keys (ES256 / RS256) in 2025; the public verification keys
// are exposed at /auth/v1/.well-known/jwks.json. We fetch them on
// demand, cache for an hour at module scope, and verify with
// crypto.subtle. No worker secret is needed — the JWKS is public.
//
// Throws on any failure (bad shape, unknown kid, bad signature,
// expired). Re-validating client-side is what the SDK does for UX,
// but the worker is the security boundary — a forged token must
// never reach the service-role-backed query path.
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h
let jwksCache = null;
let jwksCacheExpiry = 0;

async function fetchJwks(env) {
  const now = Date.now();
  if (jwksCache && now < jwksCacheExpiry) return jwksCache;
  if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL not configured");
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`jwks fetch ${res.status}`);
  jwksCache = await res.json();
  jwksCacheExpiry = now + JWKS_TTL_MS;
  return jwksCache;
}

async function verifyJwt(token, env) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed jwt");
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
  if (!header.kid || !header.alg) throw new Error("jwt header missing kid/alg");

  const jwks = await fetchJwks(env);
  let jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) {
    // Force refresh once — keys can rotate; cached set may be stale.
    jwksCacheExpiry = 0;
    const fresh = await fetchJwks(env);
    jwk = (fresh.keys || []).find((k) => k.kid === header.kid);
    if (!jwk) throw new Error("jwt kid not in jwks");
  }

  let importParams, verifyParams;
  if (header.alg === "ES256") {
    importParams = { name: "ECDSA", namedCurve: "P-256" };
    verifyParams = { name: "ECDSA", hash: "SHA-256" };
  } else if (header.alg === "RS256") {
    importParams = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    verifyParams = { name: "RSASSA-PKCS1-v1_5" };
  } else {
    throw new Error(`unsupported jwt alg: ${header.alg}`);
  }

  const key = await crypto.subtle.importKey("jwk", jwk, importParams, false, ["verify"]);
  const sig = base64UrlToBytes(sigB64);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const ok = await crypto.subtle.verify(verifyParams, key, sig, data);
  if (!ok) throw new Error("invalid jwt signature");

  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error("jwt expired");
  }
  return payload;
}

function base64UrlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Bearer-token auth for partner-dashboard endpoints. Returns
// `{ claims }` on success (the resolved user object) or `{ error }`
// (a ready-to-send Response) on failure. Caller pattern matches
// requireHorizonAdmin so route handlers stay symmetric.
async function requireAuthenticated(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) {
    return { error: jsonResponse({ error: "unauthorized" }, 401, request) };
  }
  try {
    const claims = await verifyJwt(m[1], env);
    if (claims.aud !== "authenticated") {
      return { error: jsonResponse({ error: "unauthorized" }, 401, request) };
    }
    return { claims };
  } catch (err) {
    console.error("jwt verify failed:", err.message || err);
    return { error: jsonResponse({ error: "unauthorized" }, 401, request) };
  }
}

// Accepts either an ISO 8601 datetime (used as-is) or a YYYY-MM-DD date
// (interpreted as start/end of day in UTC). Pages send ISO datetimes
// computed from local-time period bounds so a booking made at 11pm
// local properly falls in "this month" / "last 30 days" instead of
// being stranded on the next-day UTC boundary. The YYYY-MM-DD form
// stays supported for the admin custom-range picker and curl tests.
function parseTimeBound(s, mode) {
  if (typeof s !== "string" || !s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s))) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return mode === "start" ? `${s}T00:00:00.000Z` : `${s}T23:59:59.999Z`;
  }
  return null;
}

async function handleBookingState(id, env, request) {
  if (!env.BOOKINGS) {
    return jsonResponse(
      { error: "BOOKINGS KV namespace not configured on worker" },
      500,
      request,
    );
  }
  if (!UUID_RE.test(id)) {
    return jsonResponse({ error: "invalid booking_id" }, 400, request);
  }
  const state = await env.BOOKINGS.get(`booking:${id}`, "json");
  if (!state) {
    // KV TTL has elapsed (or the id is bogus). The checkout page treats
    // this as "your spot-hold expired, start over."
    return jsonResponse({ error: "expired_or_unknown" }, 404, request);
  }
  return jsonResponse(state, 200, request);
}

// ── Stripe ──────────────────────────────────────────────────────────────────
// Creates a per-booking Customer + off_session SetupIntent. The SetupIntent's
// off_session usage flag is what later lets Bokun charge the card server-side
// as a merchant-initiated transaction without a second SCA challenge.
//
// Returns { clientSecret, customerId, setupIntentId } — the page uses
// clientSecret to mount Stripe Elements, then submits the resulting pm_xxx
// to /api/checkout/submit as paymentToken.token.
async function handleStripeSetupIntent(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "STRIPE_SECRET_KEY not configured" }, 500, request);
  }

  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Valid email is required" }, 400, request);
  }

  try {
    const customer = await stripeRequest("POST", "/v1/customers", { email, name }, env);
    const setupIntent = await stripeRequest(
      "POST",
      "/v1/setup_intents",
      {
        customer: customer.id,
        "payment_method_types[]": "card",
        usage: "off_session", // Critical: registers MIT agreement so Bokun's later charge skips re-auth.
      },
      env,
    );

    return jsonResponse(
      {
        clientSecret: setupIntent.client_secret,
        customerId: customer.id,
        setupIntentId: setupIntent.id,
      },
      200,
      request,
    );
  } catch (err) {
    console.error("Stripe SetupIntent error:", err.stack || err);
    return jsonResponse(
      { error: "stripe", message: err.message || "Could not create SetupIntent" },
      502,
      request,
    );
  }
}

async function stripeRequest(method, path, body, env) {
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
  };

  let bodyStr;
  if (body) {
    bodyStr = new URLSearchParams(body).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const res = await fetch(`https://api.stripe.com${path}`, { method, headers, body: bodyStr });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      (data && data.error && (data.error.message || data.error.code)) ||
      `Stripe ${method} ${path} -> ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return { __error: "Invalid JSON body" };
  }
}

function passThroughError(r, request) {
  // Surface Bokun's status + body so the page can show useful errors.
  // The page is the only consumer and same-origin via this proxy, so
  // it's safe to expose Bokun's error shape during the build phase.
  return jsonResponse(
    { error: "upstream", status: r.status, statusText: r.statusText, body: r.data },
    502,
    request,
  );
}

function jsonResponse(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
    },
  });
}

function corsHeaders(request) {
  const origin = request?.headers?.get("Origin") || "";
  const allowed =
    origin === ALLOWED_ORIGIN ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.endsWith(".pages.dev");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}
