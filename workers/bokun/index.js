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
// Horizon admin (internal, shared-password gated via HORIZON_ADMIN_PASSWORD):
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
//
// Secrets (Worker secret storage, never on disk):
//   BOKUN_ACCESS_KEY, BOKUN_SECRET_KEY  — HMAC signing for Bokun
//   STRIPE_SECRET_KEY                   — sk_test_... or sk_live_...
//   SUPABASE_SERVICE_KEY                — Supabase service_role; bypasses RLS
//   HORIZON_ADMIN_PASSWORD              — gates /api/admin/* + /admin/
//
// Partner-dashboard JWTs are verified against $SUPABASE_URL/auth/v1/
// .well-known/jwks.json (public asymmetric keys, ES256/RS256). No
// shared HS256 secret needed.

import { bokunFetch } from "./bokun-auth.js";
import { supabaseRequest, supabaseSelect, supabaseUpdate } from "./supabase.js";

const ALLOWED_ORIGIN = "https://gowithhorizon.com";
const CURRENCY = "CAD";

const TTL_PRODUCT = 3600; // 1h — product config rarely changes
const TTL_PICKUP = 3600; // 1h — pickup places rarely change
const TTL_AVAIL = 300; // 5min — overridable with ?fresh=1
const TTL_BOOKING = 45 * 60; // 45min — checkout spot-hold window
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default {
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
// state back. KV TTL is 45min — when it expires the entry is gone and the
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

  // 2) Authorize: caller must have an active hotel_users row matching
  //    this hotel. ilike with no wildcards = case-insensitive equals,
  //    which lines up with how lower(email) is indexed on hotel_users
  //    and how RLS compares the email claim.
  const assignmentRows = await supabaseSelect(
    env,
    `hotel_users?email=ilike.${encodeURIComponent(userEmail)}` +
      `&hotel_id=eq.${h.id}&status=eq.active&select=id`,
  );
  if (!assignmentRows.length) {
    return jsonResponse({ error: "forbidden" }, 403, request);
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
// Cross-hotel summary for the internal commission dashboard. Shared-password
// gated via HORIZON_ADMIN_PASSWORD (worker secret). Excludes cancelled and
// refunded bookings from all totals — those are tracked but never owed.
async function handleAdminSummary(url, env, request) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

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
  const authError = requireAdmin(request, env);
  if (authError) return authError;

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

// Bearer-token auth for the internal admin surface. Single shared password
// stored in HORIZON_ADMIN_PASSWORD (worker secret). Constant-time compare
// avoids leaking length info via timing on a typo'd password.
function requireAdmin(request, env) {
  if (!env.HORIZON_ADMIN_PASSWORD) {
    return jsonResponse({ error: "admin password not configured" }, 500, request);
  }
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m || !constantTimeEqual(m[1], env.HORIZON_ADMIN_PASSWORD)) {
    return jsonResponse({ error: "unauthorized" }, 401, request);
  }
  return null;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
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
// requireAdmin so route handlers stay symmetric.
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
