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
//                                      bookings in a date window.
//
// Secrets (Worker secret storage, never on disk):
//   BOKUN_ACCESS_KEY, BOKUN_SECRET_KEY  — HMAC signing for Bokun
//   STRIPE_SECRET_KEY                   — sk_test_... or sk_live_...

import { bokunFetch } from "./bokun-auth.js";

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
// Records persist forever (no TTL) because a hotel manager will want
// historical data. Keyed by `ledger:<hotel>:<created_at>:<booking_id>` so
// `kv.list({ prefix: 'ledger:fairmont-ll:' })` returns that hotel's
// bookings in chronological order. Date filtering happens in-memory after
// the list — KV doesn't support range queries on values.
async function handleDashboardRecord(request, env) {
  if (!env.BOOKINGS_LEDGER) {
    return jsonResponse(
      { error: "BOOKINGS_LEDGER KV namespace not configured on worker" },
      500,
      request,
    );
  }
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const hotel = typeof body.hotel === "string" ? body.hotel.trim().toLowerCase() : "";
  const code = typeof body.confirmation_code === "string" ? body.confirmation_code.trim() : "";
  const bookingId = typeof body.booking_id === "string" ? body.booking_id.trim() : "";
  if (!hotel || !/^[a-z0-9-]{2,40}$/.test(hotel)) {
    return jsonResponse({ error: "hotel slug required" }, 400, request);
  }
  if (!code) {
    return jsonResponse({ error: "confirmation_code required" }, 400, request);
  }

  const now = Date.now();
  const record = {
    booking_id:        bookingId || null,
    hotel:             hotel,
    confirmation_code: code,
    tour_id:           body.tour_id ?? null,
    tour_title:        typeof body.tour_title === "string" ? body.tour_title : null,
    date:              typeof body.date === "string" ? body.date : null,
    time:              typeof body.time === "string" ? body.time : null,
    adults:            Number.parseInt(body.adults, 10) || 0,
    youth:             Number.parseInt(body.youth, 10) || 0,
    infants:           Number.parseInt(body.infants, 10) || 0,
    amount:            typeof body.amount === "number" ? body.amount : null,
    currency:          typeof body.currency === "string" ? body.currency : CURRENCY,
    lead_name:         typeof body.lead_name === "string" ? body.lead_name : null,
    lead_email:        typeof body.lead_email === "string" ? body.lead_email : null,
    bokun_tracking_code: typeof body.bokun_tracking_code === "string" ? body.bokun_tracking_code : null,
    created_at:        now,
  };

  // Pad created_at so lexicographic sort matches chronological sort.
  const sortKey = String(now).padStart(15, "0");
  const key = `ledger:${hotel}:${sortKey}:${bookingId || code}`;
  await env.BOOKINGS_LEDGER.put(key, JSON.stringify(record));

  return jsonResponse({ ok: true, key }, 200, request);
}

async function handleDashboardBookings(url, env, request) {
  if (!env.BOOKINGS_LEDGER) {
    return jsonResponse(
      { error: "BOOKINGS_LEDGER KV namespace not configured on worker" },
      500,
      request,
    );
  }
  const hotel = (url.searchParams.get("hotel") || "").trim().toLowerCase();
  if (!hotel || !/^[a-z0-9-]{2,40}$/.test(hotel)) {
    return jsonResponse({ error: "hotel slug required" }, 400, request);
  }
  const from = url.searchParams.get("from"); // YYYY-MM-DD inclusive
  const to = url.searchParams.get("to"); // YYYY-MM-DD inclusive
  const fromMs = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(from + "T00:00:00Z") : null;
  const toMs = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(to + "T23:59:59Z") : null;

  // KV list pagination — for v1 we cap at 1000 records (covers months of
  // bookings per hotel). If a partner outgrows this, paginate via cursor.
  const list = await env.BOOKINGS_LEDGER.list({ prefix: `ledger:${hotel}:`, limit: 1000 });
  const records = [];
  for (const k of list.keys) {
    const r = await env.BOOKINGS_LEDGER.get(k.name, "json");
    if (!r) continue;
    if (fromMs != null && r.created_at < fromMs) continue;
    if (toMs != null && r.created_at > toMs) continue;
    records.push(r);
  }
  // Most-recent first for the table view.
  records.sort((a, b) => b.created_at - a.created_at);

  // Aggregate KPIs server-side so the dashboard page stays dumb.
  const kpis = records.reduce(
    (acc, r) => {
      acc.bookings += 1;
      acc.travelers += (r.adults || 0) + (r.youth || 0) + (r.infants || 0);
      acc.revenue += r.amount || 0;
      return acc;
    },
    { bookings: 0, travelers: 0, revenue: 0 },
  );

  return jsonResponse(
    { hotel, from: from || null, to: to || null, kpis, records },
    200,
    request,
  );
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}
