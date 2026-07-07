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
import {
  supabaseRequest, supabaseSelect, supabaseInsert, supabaseUpdate,
  supabaseStorageSignUpload, supabaseStorageSignDownload,
} from "./supabase.js";
import {
  createShortLink,
  updateShortLink,
  isShortIoConfigured,
  trackingCodeToShortPath,
  getLinkStats,
  normalizeLinkStats,
  ShortIoError,
} from "./short-io.js";

const ALLOWED_ORIGIN = "https://gowithhorizon.com";
// Connect (hotel portal) and the internal ops console live on their own
// subdomains; both call this worker, so both origins are allowlisted.
const ALLOWED_ORIGINS = [
  ALLOWED_ORIGIN,
  "https://connect.gowithhorizon.com",
  "https://admin.gowithhorizon.com",
];
const CURRENCY = "CAD";

const TTL_PRODUCT = 3600; // 1h — product config rarely changes
const TTL_PICKUP = 3600; // 1h — pickup places rarely change
const TTL_AVAIL = 300; // 5min — overridable with ?fresh=1
const TTL_BOOKING = 15 * 60; // 15min — checkout spot-hold window
const TTL_ATTR = 30 * 24 * 60 * 60; // 30d — referral funnel, decoupled from the spot-hold
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
        request.method === "POST" &&
        segs[0] === "api" &&
        segs[1] === "admin" &&
        segs[2] === "recompute-attribution"
      ) {
        return await handleAdminRecomputeAttribution(request, env);
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

      // ── Manual payout records ───────────────────────────────────
      // Hand-entered "we paid hotel X $Y on date Z" log. No
      // automation — just the paid/unpaid record.
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "payouts") {
        if (request.method === "GET" && !segs[3]) {
          return await handleAdminPayoutsList(url, env, request);
        }
        if (request.method === "POST" && !segs[3]) {
          return await handleAdminPayoutCreate(request, env);
        }
        if (request.method === "DELETE" && segs[3]) {
          return await handleAdminPayoutDelete(segs[3], request, env);
        }
      }

      // Per-hotel manual payment records. Distinct from payouts:
      // these are amounts the hotel RECEIVED against an invoice,
      // hand-entered from the profile until a real processor is wired.
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "payments") {
        if (request.method === "GET" && !segs[3]) {
          return await handleAdminPaymentsList(url, env, request);
        }
        if (request.method === "POST" && !segs[3]) {
          return await handleAdminPaymentCreate(request, env);
        }
        if (request.method === "DELETE" && segs[3]) {
          return await handleAdminPaymentDelete(segs[3], request, env);
        }
      }

      // Admin-authored notes attached to a hotel. Stored in
      // hotel_notes — shared across browsers/devices, unlike the
      // v1 localStorage backing.
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "hotel-notes") {
        if (request.method === "GET" && !segs[3]) {
          return await handleAdminHotelNotesList(url, env, request);
        }
        if (request.method === "POST" && !segs[3]) {
          return await handleAdminHotelNoteCreate(request, env);
        }
        if (request.method === "DELETE" && segs[3]) {
          return await handleAdminHotelNoteDelete(segs[3], request, env);
        }
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
        // GET /api/admin/hotels/:id/events — aggregator timeline
        if (request.method === "GET" && segs[3] && segs[4] === "events") {
          return await handleAdminHotelEvents(segs[3], request, env);
        }
      }

      // ── Hotel staff CRUD ────────────────────────────────────────
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "hotel-staff") {
        // Stats endpoint: /hotel-staff/:id/stats?period=last30
        if (segs[3] && segs[4] === "stats" && !segs[5] && request.method === "GET") {
          return await handleAdminStaffStats(segs[3], request, env);
        }
        // Activity log: /hotel-staff/:id/events
        if (segs[3] && segs[4] === "events" && !segs[5] && request.method === "GET") {
          return await handleAdminStaffEvents(segs[3], request, env);
        }
        if (request.method === "POST" && !segs[3]) return await handleAdminStaffCreate(request, env);
        if (request.method === "PATCH" && segs[3]) return await handleAdminStaffUpdate(segs[3], request, env);
        if (request.method === "DELETE" && segs[3]) return await handleAdminStaffTerminate(segs[3], request, env);
      }

      // ── Placements CRUD ─────────────────────────────────────────
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "placements") {
        // Assets: /placements/:id/assets[/sign-upload | /:assetId[/url]]
        if (segs[3] && segs[4] === "assets") {
          if (request.method === "POST" && segs[5] === "sign-upload") {
            return await handleAdminPlacementAssetSignUpload(segs[3], request, env);
          }
          if (request.method === "POST" && !segs[5]) {
            return await handleAdminPlacementAssetRecord(segs[3], request, env);
          }
          if (request.method === "GET" && segs[5] && segs[6] === "url") {
            return await handleAdminPlacementAssetUrl(segs[3], segs[5], request, env);
          }
          if (request.method === "PATCH" && segs[5] && !segs[6]) {
            return await handleAdminPlacementAssetUpdate(segs[3], segs[5], request, env);
          }
        }
        // Analytics: /placements/:id/stats?period=last30|last7|last24|total
        if (segs[3] && segs[4] === "stats" && !segs[5] && request.method === "GET") {
          return await handleAdminPlacementStats(segs[3], request, env);
        }
        // Activity log: /placements/:id/events
        if (segs[3] && segs[4] === "events" && !segs[5] && request.method === "GET") {
          return await handleAdminPlacementEvents(segs[3], request, env);
        }
        if (request.method === "POST" && !segs[3]) return await handleAdminPlacementCreate(request, env);
        if (request.method === "PATCH" && segs[3] && !segs[4]) return await handleAdminPlacementUpdate(segs[3], request, env);
        if (request.method === "DELETE" && segs[3] && !segs[4]) return await handleAdminPlacementRetire(segs[3], request, env);
      }

      // ── Short.io short_links CRUD ───────────────────────────────
      if (segs[0] === "api" && segs[1] === "admin" && segs[2] === "short-links") {
        if (request.method === "GET"  && !segs[3]) return await handleAdminGlobalShortLinks(url, env, request);
        if (request.method === "POST" && !segs[3]) return await handleAdminShortLinkCreate(request, env);
        if (request.method === "GET"  && segs[3] && segs[4] === "audit") return await handleAdminShortLinkAuditList(segs[3], request, env);
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
  const url = new URL(request.url);
  const fresh = url.searchParams.get("fresh") === "1";
  const cacheKey = `product:${id}`;
  if (!fresh) {
    const cached = await env.CACHE?.get(cacheKey, "json");
    if (cached) return jsonResponse(cached, 200, request);
  }

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
//
// Phase 1b: the inbound referral funnel (window.HORIZON.funnel) is
// sanitised and stored under a SEPARATE attr:<booking_id> key with a
// 30-day TTL — decoupled from the 15-min spot-hold so the full
// touchpoint history outlives a single checkout attempt.
function sanitizeFunnel(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.touchpoints)) {
    return null;
  }
  const HOTEL_SLUG_RE = /^[a-z0-9-]{2,40}$/;
  const STREAMS = ["hotel-slug", "hotel", "employee", "placement", "unknown"];
  const out = [];
  for (const t of raw.touchpoints) {
    if (!t || typeof t !== "object") continue;
    const stream = STREAMS.includes(t.stream) ? t.stream : null;
    const code = typeof t.code === "string" ? t.code.trim().toLowerCase() : "";
    if (!stream || !code) continue;
    const codeOk =
      stream === "hotel-slug"
        ? HOTEL_SLUG_RE.test(code)
        : TRACKING_CODE_RE.test(code);
    if (!codeOk) continue;
    const ts = Number(t.ts);
    out.push({
      code,
      stream,
      ts: Number.isFinite(ts) ? ts : null,
      page: typeof t.page === "string" ? t.page.slice(0, 256) : null,
      kind: t.kind === "ref" ? "ref" : undefined,
    });
    if (out.length >= 25) break; // §5.2 cap
  }
  if (!out.length) return null;
  const firstTs = Number(raw.first_ts);
  const lastTs = Number(raw.last_ts);
  return {
    touchpoints: out,
    first_ts: Number.isFinite(firstTs) ? firstTs : out[0].ts,
    last_ts: Number.isFinite(lastTs) ? lastTs : out[out.length - 1].ts,
  };
}

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

  // Optional employee-attribution code (htl-7q4k9-e001 form). Same
  // shape as the URL ?ref=<code> param that originates this; matched
  // against hotel_staff.tracking_code at insert time on the checkout
  // page side → /api/dashboard/record. Hotel-default codes
  // (bare htl-7q4k9) ride through too and harmlessly fail to match any
  // staff row, leaving the booking attributed to the hotel pool.
  // Lowercase-normalised defensively so a mistyped capital from a
  // hand-typed URL still attributes.
  const refRaw = typeof body.ref === "string" ? body.ref.trim().toLowerCase() : "";
  const ref = TRACKING_CODE_RE.test(refRaw) ? refRaw : null;

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
    tour_image: typeof body.tour_image === "string" && body.tour_image.startsWith("https://gowithhorizon.com/") ? body.tour_image : null,
    created_at: now,
    expires_at: expiresAt,
  };

  await env.BOOKINGS.put(`booking:${bookingId}`, JSON.stringify(state), {
    expirationTtl: TTL_BOOKING,
  });

  // Referral funnel — separate key, 30-day TTL. Best-effort: a malformed
  // or absent funnel never blocks a booking (attribution still falls back
  // to state.hotel / state.ref exactly as before Phase 1b).
  const funnel = sanitizeFunnel(body.funnel);
  if (funnel) {
    await env.BOOKINGS.put(
      `attr:${bookingId}`,
      JSON.stringify({ booking_id: bookingId, ...funnel, created_at: now }),
      { expirationTtl: TTL_ATTR },
    );
  }

  return jsonResponse({ booking_id: bookingId, expires_at: expiresAt }, 200, request);
}

// ── Credit resolution (pure) ───────────────────────────────────────────────
// §4.1 default policy: employees outrank hotel/placement; among employees
// the LAST wins; otherwise the FIRST hotel-level touch wins. Pure and
// deterministic (no DB, no clock) so it can be replayed to recompute
// historical credit if a hotel switches policy.
//   touchpoints: ordered [{ code, stream, position, staff_id }]
export function resolveCredit(touchpoints, policy) {
  if (!touchpoints.length) return null;
  let chosen;
  if (policy === "first_touch_wins") {
    chosen = touchpoints[0];
  } else if (policy === "last_touch_wins") {
    chosen = touchpoints[touchpoints.length - 1];
  } else {
    // employee_last_then_hotel_first (default — also the fallback for any
    // unrecognised policy string).
    const employees = touchpoints.filter((t) => t.staff_id);
    const hotelRefs = touchpoints.filter(
      (t) => !t.staff_id && (t.stream === "hotel" || t.stream === "hotel-slug"),
    );
    chosen = employees.length
      ? employees[employees.length - 1]
      : hotelRefs.length
        ? hotelRefs[0]
        : touchpoints[0];
  }
  return {
    credited_position: chosen.position,
    staff_id: chosen.staff_id || null,
    policy_used: policy,
    first_touch_code: touchpoints[0].code,
  };
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
    typeof body.tracking_code === "string" ? body.tracking_code.trim().toLowerCase() : "";
  if (!hotel || !/^[a-z0-9-]{2,40}$/.test(hotel)) {
    return jsonResponse({ error: "hotel slug required" }, 400, request);
  }
  if (!code) {
    return jsonResponse({ error: "confirmation_code required" }, 400, request);
  }

  // Parallel lookups — saves a round trip vs. sequential. Staff
  // resolution matches on the partner-controlled slug
  // (hotel_staff.tracking_code, e.g. htl-7q4k9-e001) rather than the
  // hex tracking codes Bokun used to mint.
  const [hotelRows, staffRows] = await Promise.all([
    supabaseSelect(
      env,
      `hotels?code=eq.${encodeURIComponent(hotel)}` +
        `&select=id,type,commission_pct,platform_fee_pct,attribution_policy`,
    ),
    trackingCode
      ? supabaseSelect(
          env,
          `hotel_staff?tracking_code=eq.${encodeURIComponent(trackingCode)}&select=id,hotel_id,kickback_pct`,
        )
      : Promise.resolve([]),
  ]);

  if (!hotelRows.length) {
    return jsonResponse({ error: `unknown hotel slug: ${hotel}` }, 400, request);
  }
  const hotelId = hotelRows[0].id;

  // Only attribute to staff if their hotel matches — defends against a
  // tracking-code collision between hotels. Hotel-level codes (e.g.
  // bare htl-7q4k9) won't match any hotel_staff row and so resolve to
  // staff_id=null, which is the correct "hotel pool" attribution.
  const staffMatch = staffRows[0];
  const legacyStaffId = staffMatch && staffMatch.hotel_id === hotelId ? staffMatch.id : null;

  // ── Full-funnel attribution (Phase 1c) ───────────────────────────────────
  // Read the sanitised funnel stored at initiate (attr:<booking_id>, 30-day
  // TTL). When present it drives the credited staff_id + audit columns and
  // the immutable booking_touchpoints rows. Best-effort: any failure here
  // falls back to the legacy single-code attribution, never blocking the
  // booking insert.
  let staffId = legacyStaffId;
  let auditPolicy = null;
  let auditFirstTouch = null;
  let auditCreditedPos = null;
  let touchpointRows = null;
  try {
    const funnel =
      bookingId && env.BOOKINGS
        ? await env.BOOKINGS.get(`attr:${bookingId}`, "json")
        : null;
    const tps = funnel && Array.isArray(funnel.touchpoints) ? funnel.touchpoints : [];
    if (tps.length) {
      // Resolve every employee-stream code to a staff row in one query;
      // collision-guarded to this booking's hotel (same rule as legacy).
      const empCodes = [
        ...new Set(
          tps.filter((t) => t.stream === "employee" && t.code).map((t) => t.code),
        ),
      ];
      const staffByCode = new Map();
      if (empCodes.length) {
        const inList = empCodes.map((c) => encodeURIComponent(c)).join(",");
        const rows = await supabaseSelect(
          env,
          `hotel_staff?tracking_code=in.(${inList})&select=id,hotel_id,tracking_code`,
        );
        for (const s of rows) {
          if (s.hotel_id === hotelId) staffByCode.set(s.tracking_code, s.id);
        }
      }

      const annotated = tps.map((t, i) => ({
        code: t.code,
        stream: t.stream,
        position: i,
        ts: Number.isFinite(Number(t.ts)) ? Number(t.ts) : null,
        staff_id:
          t.stream === "employee" ? staffByCode.get(t.code) || null : null,
      }));

      const credit = resolveCredit(
        annotated,
        hotelRows[0].attribution_policy || "employee_last_then_hotel_first",
      );
      if (credit) {
        staffId = credit.staff_id;
        auditPolicy = credit.policy_used;
        auditFirstTouch = credit.first_touch_code;
        auditCreditedPos = credit.credited_position;
      }

      touchpointRows = annotated.map((t) => ({
        booking_id:        bookingId || null,
        confirmation_code: code,
        position:          t.position,
        code:              t.code,
        stream_type:       t.stream,
        hotel_id:          hotelId,
        staff_id:          t.staff_id,
        touched_at:        t.ts ? new Date(t.ts).toISOString() : null,
        is_credited:       t.position === auditCreditedPos,
      }));
    }
  } catch (e) {
    // Funnel processing is non-critical — fall back to legacy attribution.
    touchpointRows = null;
  }

  const row = {
    booking_id:        bookingId || null,
    hotel_id:          hotelId,
    staff_id:          staffId,
    attribution_policy_used: auditPolicy,
    first_touch_code:        auditFirstTouch,
    credited_position:       auditCreditedPos,
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

  // Immutable funnel rows. Idempotent on (confirmation_code, position) so
  // the page's fire-and-forget retries don't duplicate. Non-critical: a
  // failure here must not fail the (already inserted) booking.
  if (touchpointRows && touchpointRows.length) {
    try {
      await supabaseRequest(
        env,
        "POST",
        "/booking_touchpoints?on_conflict=confirmation_code,position",
        {
          body: touchpointRows,
          prefer: "resolution=ignore-duplicates,return=minimal",
        },
      );
    } catch (e) {
      /* booking already recorded — funnel rows are best-effort */
    }
  }

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
    "attribution_policy_used,first_touch_code,credited_position," +
    "staff:hotel_staff(id,name,tracking_code,kickback_pct)," +
    "touchpoints:booking_touchpoints(" +
    "position,code,stream_type,touched_at,is_credited," +
    "touch_staff:hotel_staff(name,tracking_code))";
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
    touchpoints: Array.isArray(r.touchpoints)
      ? r.touchpoints.slice().sort((a, b) => a.position - b.position)
      : [],
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

// ── Retroactive attribution recompute ──────────────────────────────────────
// Replays resolveCredit over the stored funnel for every booking at a hotel
// using that hotel's CURRENT attribution_policy, then rewrites the credited
// staff_id + audit columns + is_credited flags where they changed. This is
// what makes a policy switch non-destructive (§3): the immutable
// booking_touchpoints rows are never mutated, only the derived credit.
// Horizon-admin gated; scoped to one hotel per call to stay bounded.
async function handleAdminRecomputeAttribution(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);
  const hotel = typeof body.hotel === "string" ? body.hotel.trim().toLowerCase() : "";
  if (!hotel || !/^[a-z0-9-]{2,40}$/.test(hotel)) {
    return jsonResponse({ error: "hotel slug required" }, 400, request);
  }

  const hotelRows = await supabaseSelect(
    env,
    `hotels?code=eq.${encodeURIComponent(hotel)}&select=id,attribution_policy`,
  );
  if (!hotelRows.length) {
    return jsonResponse({ error: `unknown hotel slug: ${hotel}` }, 404, request);
  }
  const hotelId = hotelRows[0].id;
  const policy = hotelRows[0].attribution_policy || "employee_last_then_hotel_first";

  const bookings = await supabaseSelect(
    env,
    `bookings?hotel_id=eq.${hotelId}` +
      `&select=confirmation_code,staff_id,credited_position,` +
      `touchpoints:booking_touchpoints(position,code,stream_type)` +
      `&limit=2000`,
  );

  // One staff lookup for every employee code across all funnels.
  const empCodes = new Set();
  for (const b of bookings) {
    for (const t of b.touchpoints || []) {
      if (t.stream_type === "employee" && t.code) empCodes.add(t.code);
    }
  }
  const staffByCode = new Map();
  if (empCodes.size) {
    const inList = [...empCodes].map((c) => encodeURIComponent(c)).join(",");
    const rows = await supabaseSelect(
      env,
      `hotel_staff?tracking_code=in.(${inList})&select=id,hotel_id,tracking_code`,
    );
    for (const s of rows) {
      if (s.hotel_id === hotelId) staffByCode.set(s.tracking_code, s.id);
    }
  }

  let scanned = 0;
  let updated = 0;
  for (const b of bookings) {
    const tps = (b.touchpoints || []).slice().sort((a, c) => a.position - c.position);
    if (!tps.length) continue;
    scanned += 1;
    const annotated = tps.map((t) => ({
      code: t.code,
      stream: t.stream_type,
      position: t.position,
      staff_id: t.stream_type === "employee" ? staffByCode.get(t.code) || null : null,
    }));
    const credit = resolveCredit(annotated, policy);
    if (!credit) continue;

    const changed =
      (b.staff_id || null) !== (credit.staff_id || null) ||
      b.credited_position !== credit.credited_position;
    if (!changed) continue;

    await supabaseUpdate(
      env,
      `bookings?confirmation_code=eq.${encodeURIComponent(b.confirmation_code)}`,
      {
        staff_id: credit.staff_id,
        attribution_policy_used: credit.policy_used,
        first_touch_code: credit.first_touch_code,
        credited_position: credit.credited_position,
      },
    );
    // Re-flag the credited touch: clear all, then set the winner.
    const confFilter = `confirmation_code=eq.${encodeURIComponent(b.confirmation_code)}`;
    await supabaseUpdate(env, `booking_touchpoints?${confFilter}`, {
      is_credited: false,
    });
    await supabaseUpdate(
      env,
      `booking_touchpoints?${confFilter}&position=eq.${credit.credited_position}`,
      { is_credited: true },
    );
    updated += 1;
  }

  return jsonResponse({ hotel, policy, scanned, updated }, 200, request);
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
    "staff:hotel_staff(id,name,tracking_code,kickback_pct)";
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
      let s = h._staffMap.get(r.staff.id);
      if (!s) {
        s = {
          staff_id:      r.staff.id,
          staff_name:    r.staff.name,
          kickback_pct:  kPct,
          bookings:      0,
          revenue:       0,
          kickback_owed: 0,
        };
        h._staffMap.set(r.staff.id, s);
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

  logMutation(request, auth.claims, "update", "booking", id, { status });

  return jsonResponse({ ok: true, booking: updated[0] }, 200, request);
}

// ── Manual payout records ──────────────────────────────────────────────────
// A hand-entered log of commission actually paid to a hotel (Interac
// e-Transfer / EFT / other). No accrual, no automation, no Stripe —
// the admin records each payment after sending it so the dashboard
// can show outstanding vs. paid. Correcting a typo = delete + re-add.

const PAYOUT_METHODS = new Set(["etransfer", "eft", "other"]);

async function handleAdminPayoutsList(url, env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const hotelId = (url.searchParams.get("hotel_id") || "").trim();
  let q =
    "payouts?select=id,hotel_id,period,amount,currency,paid_at,method," +
    "reference,note,created_at&order=paid_at.desc,created_at.desc";
  if (hotelId) {
    if (!UUID_RE.test(hotelId)) {
      return jsonResponse({ error: "invalid hotel_id" }, 400, request);
    }
    q += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;
  }
  const rows = await supabaseSelect(env, q);
  const payouts = (Array.isArray(rows) ? rows : []).map((r) => ({
    ...r,
    amount: r.amount != null ? Number(r.amount) : null,
  }));
  return jsonResponse({ payouts }, 200, request);
}

async function handleAdminPayoutCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const hotelId = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
  if (!UUID_RE.test(hotelId)) {
    return jsonResponse({ error: "valid hotel_id required" }, 400, request);
  }
  const amount = typeof body.amount === "number" ? body.amount : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return jsonResponse({ error: "amount must be a positive number" }, 400, request);
  }
  const paidAt = typeof body.paid_at === "string" ? body.paid_at.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
    return jsonResponse({ error: "paid_at must be YYYY-MM-DD" }, 400, request);
  }
  const row = {
    hotel_id: hotelId,
    amount: Math.round(amount * 100) / 100,
    paid_at: paidAt,
  };
  if (typeof body.period === "string" && body.period.trim()) {
    if (!/^\d{4}-\d{2}$/.test(body.period.trim())) {
      return jsonResponse({ error: "period must be YYYY-MM" }, 400, request);
    }
    row.period = body.period.trim();
  }
  if (body.method != null && body.method !== "") {
    if (!PAYOUT_METHODS.has(body.method)) {
      return jsonResponse(
        { error: "method must be etransfer, eft, or other" }, 400, request,
      );
    }
    row.method = body.method;
  }
  if (typeof body.currency === "string" && body.currency.trim()) {
    row.currency = body.currency.trim().toUpperCase().slice(0, 3);
  }
  const ref = typeof body.reference === "string" ? body.reference.trim() : "";
  if (ref) row.reference = ref.slice(0, 200);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note) row.note = note.slice(0, 1000);

  // Confirm the hotel exists so a typo'd id can't orphan a payment.
  const hotelRows = await supabaseSelect(
    env, `hotels?id=eq.${encodeURIComponent(hotelId)}&select=id`,
  );
  if (!hotelRows.length) {
    return jsonResponse({ error: "hotel not found" }, 404, request);
  }

  const inserted = await supabaseInsert(env, "payouts", [row], { returnRow: true });
  const created = Array.isArray(inserted) ? inserted[0] : inserted;
  logMutation(request, auth.claims, "create", "payout", created && created.id, {
    hotel_id: hotelId, amount: row.amount, paid_at: paidAt,
  });
  return jsonResponse({ payout: created }, 201, request);
}

async function handleAdminPayoutDelete(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) {
    return jsonResponse({ error: "invalid payout id" }, 400, request);
  }
  const deleted = await supabaseRequest(
    env, "DELETE", `/payouts?id=eq.${encodeURIComponent(id)}`,
    { prefer: "return=representation" },
  );
  if (!Array.isArray(deleted) || deleted.length === 0) {
    return jsonResponse({ error: "payout not found" }, 404, request);
  }
  logMutation(request, auth.claims, "delete", "payout", id);
  return jsonResponse({ ok: true }, 200, request);
}

// ── Payments (hand-entered) ────────────────────────────────────────
// Pilot phase: the admin records each payment received against an
// invoice. No accrual, no processor sync — just the hand-entered
// receipt. handleAdminPaymentCreate also writes a hotel_events row
// so the profile's Events timeline picks up "Payment was created".
// We intentionally do NOT emit an event for delete: the user asked
// the timeline to track payment generation only, not housekeeping.
const PAYMENT_STATUSES = new Set(["succeeded", "canceled"]);

async function handleAdminPaymentsList(url, env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const hotelId = url.searchParams.get("hotel_id");
  if (!hotelId || !UUID_RE.test(hotelId)) {
    return jsonResponse({ error: "hotel_id required" }, 400, request);
  }
  const rows = await supabaseSelect(
    env,
    `payments?hotel_id=eq.${encodeURIComponent(hotelId)}` +
      `&select=id,hotel_id,amount,currency,description,status,occurred_at,actor_email,created_at` +
      `&order=occurred_at.desc&limit=500`,
  );
  return jsonResponse({ payments: rows || [] }, 200, request);
}

async function handleAdminPaymentCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const hotelId = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
  if (!UUID_RE.test(hotelId)) {
    return jsonResponse({ error: "valid hotel_id required" }, 400, request);
  }
  const amount = typeof body.amount === "number" ? body.amount : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return jsonResponse({ error: "amount must be a positive number" }, 400, request);
  }
  const status = typeof body.status === "string" ? body.status.trim() : "succeeded";
  if (!PAYMENT_STATUSES.has(status)) {
    return jsonResponse({ error: "status must be succeeded or canceled" }, 400, request);
  }

  const row = {
    hotel_id: hotelId,
    amount: Math.round(amount * 100) / 100,
    status,
    actor_email: auth.claims?.email || null,
  };
  if (typeof body.currency === "string" && body.currency.trim()) {
    row.currency = body.currency.trim().toUpperCase().slice(0, 3);
  }
  if (typeof body.description === "string" && body.description.trim()) {
    row.description = body.description.trim().slice(0, 200);
  }
  if (typeof body.occurred_at === "string" && body.occurred_at.trim()) {
    const oa = body.occurred_at.trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(oa)) {
      return jsonResponse({ error: "occurred_at must be ISO date" }, 400, request);
    }
    row.occurred_at = oa;
  }

  // Idempotency: client mints a key per form-open and resends it on
  // retries. (hotel_id, idempotency_key) carries a unique partial
  // index — a duplicate insert raises 23505, which we catch and
  // resolve to the original row. The payment_created event is only
  // written on the first successful insert, never on dedupe.
  const idemKey =
    (request.headers.get("Idempotency-Key") || "").trim() ||
    (typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "");
  if (idemKey) {
    if (idemKey.length > 80) {
      return jsonResponse(
        { error: "Idempotency-Key too long (80 chars max)" }, 400, request,
      );
    }
    row.idempotency_key = idemKey;
  }

  const hotelRows = await supabaseSelect(
    env, `hotels?id=eq.${encodeURIComponent(hotelId)}&select=id`,
  );
  if (!hotelRows.length) {
    return jsonResponse({ error: "hotel not found" }, 404, request);
  }

  let created;
  try {
    const inserted = await supabaseInsert(env, "payments", [row], { returnRow: true });
    created = Array.isArray(inserted) ? inserted[0] : inserted;
  } catch (err) {
    if (idemKey && isUniqueViolation(err, "payments_idempotency_key_uq")) {
      // Retry of an already-processed request — return the original
      // row without writing a second event. Status 200 (not 201)
      // signals "found", not "created", in case a future client
      // wants to distinguish.
      const existing = await supabaseSelect(
        env,
        `payments?hotel_id=eq.${encodeURIComponent(hotelId)}` +
          `&idempotency_key=eq.${encodeURIComponent(idemKey)}` +
          `&select=id,hotel_id,amount,currency,description,status,occurred_at,actor_email,created_at,idempotency_key` +
          `&limit=1`,
      );
      if (Array.isArray(existing) && existing.length) {
        return jsonResponse(
          { payment: existing[0], deduped: true }, 200, request,
        );
      }
    }
    throw err;
  }
  logMutation(request, auth.claims, "create", "payment", created && created.id, {
    hotel_id: hotelId, amount: row.amount, status,
  });
  await writeHotelEvent(env, hotelId, "payment_created", {
    payment_id:  created && created.id,
    amount:      row.amount,
    currency:    row.currency || "CAD",
    status,
    description: row.description || null,
  }, auth.claims?.email);
  return jsonResponse({ payment: created }, 201, request);
}

async function handleAdminPaymentDelete(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) {
    return jsonResponse({ error: "invalid payment id" }, 400, request);
  }
  // Fetch first so the hotel_events row we write afterwards
  // carries the original hotel_id + amount/currency for the
  // timeline label, then DELETE.
  const existing = await supabaseSelect(
    env,
    `payments?id=eq.${encodeURIComponent(id)}` +
      `&select=id,hotel_id,amount,currency,status,description&limit=1`,
  );
  if (!Array.isArray(existing) || !existing.length) {
    return jsonResponse({ error: "payment not found" }, 404, request);
  }
  const row = existing[0];
  const deleted = await supabaseRequest(
    env, "DELETE", `/payments?id=eq.${encodeURIComponent(id)}`,
    { prefer: "return=representation" },
  );
  if (!Array.isArray(deleted) || deleted.length === 0) {
    return jsonResponse({ error: "payment not found" }, 404, request);
  }
  logMutation(request, auth.claims, "delete", "payment", id);
  await writeHotelEvent(env, row.hotel_id, "payment_deleted", {
    payment_id:  id,
    amount:      row.amount,
    currency:    row.currency || "CAD",
    status:      row.status,
    description: row.description || null,
  }, auth.claims?.email);
  return jsonResponse({ ok: true }, 200, request);
}

// ── Hotel notes (admin-authored timeline entries) ──────────────────
// Replaces the v1 localStorage backing so notes survive across
// browsers / devices / cache clears. author_email + author_display
// are denormalised on the row so the byline keeps rendering even
// if the admin account is later renamed.
async function handleAdminHotelNotesList(url, env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const hotelId = url.searchParams.get("hotel_id");
  if (!hotelId || !UUID_RE.test(hotelId)) {
    return jsonResponse({ error: "hotel_id required" }, 400, request);
  }
  const rows = await supabaseSelect(
    env,
    `hotel_notes?hotel_id=eq.${encodeURIComponent(hotelId)}` +
      `&select=id,hotel_id,text,author_email,author_display,created_at` +
      `&order=created_at.desc&limit=500`,
  );
  return jsonResponse({ notes: rows || [] }, 200, request);
}

async function handleAdminHotelNoteCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const hotelId = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
  if (!UUID_RE.test(hotelId)) {
    return jsonResponse({ error: "valid hotel_id required" }, 400, request);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return jsonResponse({ error: "text required" }, 400, request);
  }
  // Cap incoming text so a runaway client can't bloat the row.
  // Long-form operational context still fits comfortably.
  if (text.length > 8000) {
    return jsonResponse({ error: "text too long (8000 chars max)" }, 400, request);
  }

  const hotelRows = await supabaseSelect(
    env, `hotels?id=eq.${encodeURIComponent(hotelId)}&select=id`,
  );
  if (!hotelRows.length) {
    return jsonResponse({ error: "hotel not found" }, 404, request);
  }

  const row = {
    hotel_id:       hotelId,
    text,
    author_email:   auth.claims?.email || null,
    author_display: typeof body.author_display === "string"
      ? body.author_display.trim().slice(0, 120) || null
      : null,
  };
  const inserted = await supabaseInsert(env, "hotel_notes", [row], { returnRow: true });
  const created  = Array.isArray(inserted) ? inserted[0] : inserted;
  logMutation(request, auth.claims, "create", "hotel_note", created && created.id, {
    hotel_id: hotelId,
  });
  return jsonResponse({ note: created }, 201, request);
}

async function handleAdminHotelNoteDelete(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) {
    return jsonResponse({ error: "invalid note id" }, 400, request);
  }
  const deleted = await supabaseRequest(
    env, "DELETE", `/hotel_notes?id=eq.${encodeURIComponent(id)}`,
    { prefer: "return=representation" },
  );
  if (!Array.isArray(deleted) || deleted.length === 0) {
    return jsonResponse({ error: "note not found" }, 404, request);
  }
  logMutation(request, auth.claims, "delete", "hotel_note", id);
  return jsonResponse({ ok: true }, 200, request);
}

// ── Hotels / staff / managers CRUD (/admin/hotels/) ────────────────────────
// All admin-gated. Writes go to Supabase; partners.json (the static
// file the rest of the site reads) is regenerated on the next CF Pages
// build, which the upcoming /api/admin/republish endpoint triggers.

const HOTEL_FIELDS =
  "id,code,name,location,type,status,effective_date,default_tracking_code," +
  "tracking_prefix,commission_pct,kickback_pool_pct,created_at,updated_at," +
  "contract_start_date,property_type,star_rating,country," +
  "platform_fee_pct," +
  "payout_method,payout_account_holder,payout_etransfer_email," +
  "payout_eft_institution,payout_eft_transit,payout_eft_account,payout_updated_at," +
  "address,phone,primary_contact_name,primary_contact_email,website";
const STAFF_FIELDS =
  "id,hotel_id,name,tracking_code,sequence_number,kickback_pct," +
  "status,created_at,updated_at";
const MANAGER_FIELDS =
  "id,email,name,hotel_id,role,status,created_at,updated_at,password_set_at,invited_by_email";
const MANAGER_ROLES = new Set(["owner", "manager", "read_only"]);
const MANAGER_STATUSES = new Set(["active", "suspended", "revoked"]);

const HOTEL_TYPES = new Set(["kickback", "pool"]);
const HOTEL_LOCATIONS = new Set(["Banff", "Canmore"]);
const HOTEL_STATUSES = new Set(["active", "terminated"]);
const STAFF_STATUSES = new Set(["active", "terminated"]);
// MANAGER_STATUSES + MANAGER_ROLES live at the top of the placements
// constants block above so the manager invite handler can validate
// against the same source.
// 60-char ceiling lets us hold full property names like
// "the-rimrock-resort-hotel-banff-springs" instead of forcing
// abbreviation. Slugs stay lowercase + hyphen + digit only.
const SLUG_RE = /^[a-z0-9-]{2,60}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The hotel's human/support-facing ID and tracking prefix, one value:
// "htl-" + 5 chars from an unambiguous lowercase set (no i, l, o, 0, 1)
// so it's safe to read aloud, print, and drop straight into a URL.
// 31^5 ≈ 28M combinations — collision probability is negligible even
// at 100k+ hotels, and the UNIQUE constraint on hotels.tracking_prefix
// backstops any that slip through. The "htl-" tag makes the ID
// self-describing in logs and support tickets (cf. Stripe's cus_).
const PREFIX_TAG = "htl-";
const PREFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const PREFIX_LENGTH = 5;
const TRACKING_PREFIX_RE = /^htl-[a-hjkmnp-z2-9]{5}$/;
// Full tracking code: the bare prefix ("<prefix>") IS the hotel
// default code; staff append "-eNNN" (3-digit zero-padded, room for
// 999 per property — bump to 4 if a property ever needs it);
// placements append "-pNN" (2-digit zero-padded, room for 99 passive
// marketing surfaces per property). A "-pNN" code never matches a
// hotel_staff row, so it resolves to hotel-pool attribution — exactly
// what a passive placement should do (no employee, no kickback).
// Lowercase + hyphen by construction, so the code IS the short-URL
// path verbatim — there is no underscore↔hyphen translation layer
// (see trackingCodeToShortPath). One format everywhere.
const TRACKING_CODE_RE = /^htl-[a-hjkmnp-z2-9]{5}(-e\d{3}|-p\d{2})?$/;

function generateTrackingPrefix() {
  let s = PREFIX_TAG;
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
// returns { link: null, error: <msg> } rather than throwing, so the
// parent hotel/staff creation succeeds even when Short.io is
// unreachable or unconfigured. Callers must surface the error to
// the admin so a silent miss is recoverable.
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
    return { link: null, error: "SHORT_IO_API_KEY not configured" };
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
    return { link: null, error: `Short.io createShortLink failed: ${err.message}` };
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
    return { link: inserted[0], error: null };
  } catch (err) {
    // Short.io created the link but Supabase rejected the row. We
    // surface this either way — silent failure here means a
    // dangling Short.io link with no DB record, which is a
    // reconciliation headache. Worth a loud log.
    console.error(
      `Short.io link ${created.id} created but short_links insert failed: ${err.message}`,
    );
    if (throwOnError) throw err;
    return {
      link: null,
      error: `Short.io link ${created.id} minted but DB row insert failed: ${err.message}`,
    };
  }
}

// Build the long URL a short link should redirect to.
//
// Attribution is captured from the QUERY STRING (js/referral.js reads
// ?hotel= / ?ref=), and the ledger write is gated on the hotel slug
// (checkout recordToLedger returns early without ctx.booking.hotel).
// So every target must carry ?hotel=<slug>, or the booking never
// records. The slug in a PATH segment (the old /partners/<slug>/
// form) is invisible to the capture layer — a path-only link tracks
// nothing. See PARTNERS_NAMING.md / docs/referral-attribution-spec.md.
//
// Hotel master: ?hotel=<slug> alone → hotel-pool attribution.
// Staff/placement: add &ref=<code> so the funnel also records that
// touch. The captured slug persists across the whole visit via the
// localStorage + apex-cookie funnel, so guests can browse from the
// homepage to any tour and still attribute.
function hotelTargetUrl(env, hotelCode) {
  const base = (env.PUBLIC_SITE_BASE || "https://gowithhorizon.com").replace(/\/$/, "");
  return `${base}/?hotel=${encodeURIComponent(hotelCode)}`;
}
function staffTargetUrl(env, hotelCode, trackingCode) {
  // hotelTargetUrl already carries ?hotel=, so ref rides as &ref=.
  return `${hotelTargetUrl(env, hotelCode)}&ref=${encodeURIComponent(trackingCode)}`;
}
// A placement links to the hotel URL with its own code as &ref. The
// code carries a "-pNN" suffix that never matches a hotel_staff row,
// so checkout resolves it to hotel-pool attribution (no employee, no
// kickback) — identical URL shape to staff, distinct attribution
// outcome by construction.
// When tour_slug is set, the link lands on the specific tour page
// (/tours/<slug>/) instead of the homepage — the ?hotel= and &ref=
// params still ride the URL so attribution captures identically.
function placementTargetUrl(env, hotelCode, code, tourSlug) {
  const base = (env.PUBLIC_SITE_BASE || "https://gowithhorizon.com").replace(/\/$/, "");
  if (tourSlug) {
    return `${base}/tours/${encodeURIComponent(tourSlug)}/?hotel=${encodeURIComponent(hotelCode)}&ref=${encodeURIComponent(code)}`;
  }
  return `${hotelTargetUrl(env, hotelCode)}&ref=${encodeURIComponent(code)}`;
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
      // Hotel-level default — the bare prefix itself, used when a
      // guest arrives via the master link with no employee ?ref=.
      // No staff row ever matches it (staff always carry "-eNNN"),
      // so staff_id stays null and the booking attributes to the
      // hotel pool. Equal to tracking_prefix by design — one ID
      // per hotel.
      default_tracking_code: prefix,
    };
    try {
      const inserted = await supabaseInsert(env, "hotels", [candidate], { returnRow: true });
      const hotel = inserted[0];
      // Auto-mint the hotel's master short link. Best-effort: a
      // Short.io failure (network, rate limit, missing API key)
      // does not roll back the hotel row. The error message is
      // bubbled out so the POST handler can surface it to the
      // admin — silent loss would leave a hotel with no QR.
      // The short path is derived from the tracking code, not the
      // hotel slug, so every short URL on the platform follows the
      // same htl-7q4k9 / htl-7q4k9-eNNN format. Slugs live in the
      // long URL only — see PARTNERS_NAMING.md.
      const { error: shortLinkWarning } = await mintShortLinkAndRecord(env, {
        shortPath: trackingCodeToShortPath(hotel.default_tracking_code),
        targetUrl: hotelTargetUrl(env, hotel.code),
        title: `${hotel.name} — master`,
        linkType: "hotel",
        hotelId: hotel.id,
        label: "Master — hotel default",
      });
      return { hotel, shortLinkWarning };
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
// hotel (max + 1) and mints the tracking_code as
// {hotel.tracking_prefix}-e{3-digit padded sequence}. The UNIQUE
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
      tracking_code: `${prefix}-e${String(nextSeq).padStart(3, "0")}`,
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
      let shortLinkWarning = null;
      if (hotel) {
        ({ error: shortLinkWarning } = await mintShortLinkAndRecord(env, {
          shortPath: trackingCodeToShortPath(staff.tracking_code),
          targetUrl: staffTargetUrl(env, hotel.code, staff.tracking_code),
          title: `${hotel.name} — ${staff.name}`,
          linkType: "staff",
          hotelId: row.hotel_id,
          staffId: staff.id,
          label: staff.name,
        }));
      } else {
        shortLinkWarning = "hotel row missing — short link not minted";
      }
      return { staff, shortLinkWarning };
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

// Placement insert wrapper. Mirrors insertStaffWithSequence: computes
// the next per-hotel sequence_number, mints the "htl-<prefix>-pNN"
// code, inserts, then best-effort mints the Short.io link. The
// (hotel_id, sequence_number) unique index catches concurrent
// inserts; on collision we re-read max and retry.
async function insertPlacementWithSequence(env, row, maxAttempts = 5) {
  const hotelRows = await supabaseSelect(
    env,
    `hotels?id=eq.${encodeURIComponent(row.hotel_id)}&select=tracking_prefix,code,name`,
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
  const hotel = hotelRows[0];

  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const maxRows = await supabaseSelect(
      env,
      `placements?hotel_id=eq.${encodeURIComponent(row.hotel_id)}` +
        `&select=sequence_number&order=sequence_number.desc&limit=1`,
    );
    const nextSeq = (maxRows.length && maxRows[0].sequence_number ? maxRows[0].sequence_number : 0) + 1;
    const candidate = {
      ...row,
      sequence_number: nextSeq,
      code: `${prefix}-p${String(nextSeq).padStart(2, "0")}`,
    };
    try {
      const inserted = await supabaseInsert(env, "placements", [candidate], { returnRow: true });
      const placement = inserted[0];
      let shortLinkWarning = null;
      ({ error: shortLinkWarning } = await mintShortLinkAndRecord(env, {
        shortPath: trackingCodeToShortPath(placement.code),
        targetUrl: placementTargetUrl(env, hotel.code, placement.code, placement.tour_slug),
        title: `${hotel.name} — ${placement.name}`,
        linkType: "placement",
        hotelId: row.hotel_id,
        label: placement.name,
      }));
      return { placement, shortLinkWarning };
    } catch (err) {
      lastErr = err;
      if (
        isUniqueViolation(err, "sequence_number") ||
        isUniqueViolation(err, "code")
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
    `,short_links:short_links(${SHORT_LINK_FIELDS})` +
    `,placements:placements(${PLACEMENT_FIELDS},` +
      `assets:placement_assets(${PLACEMENT_ASSET_FIELDS}))`;
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
    const { hotel, shortLinkWarning } = await insertHotelWithPrefix(env, v.row);
    logMutation(request, auth.claims, "create", "hotel", hotel.id, {
      code: hotel.code, name: hotel.name,
    });
    await writeHotelEvent(env, hotel.id, "created", {
      name: hotel.name, code: hotel.code,
    }, auth.claims?.email);
    const payload = { hotel: normaliseHotel(hotel) };
    if (shortLinkWarning) payload.short_link_warning = shortLinkWarning;
    return jsonResponse(payload, 201, request);
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
  logMutation(request, auth.claims, "update", "hotel", id, { fields: Object.keys(v.row) });
  // Persist a hotel_events row so the profile's Events timeline picks
  // up this change. Specialised event types fire when commission or
  // banking fields are touched so the timeline reads meaningfully
  // ("Commission changed to 5%") instead of a generic "updated".
  const fields = Object.keys(v.row);
  const touchedBanking = fields.some((f) => f.startsWith("payout_"));
  const wasBankingSet  = updated[0].payout_method
    && !v.row.payout_method ? false : !!updated[0].payout_method;
  const actor = auth.claims?.email;
  if (v.row.commission_pct != null) {
    await writeHotelEvent(env, id, "commission_changed", {
      to: Number(v.row.commission_pct),
    }, actor);
  } else if (touchedBanking) {
    await writeHotelEvent(env, id,
      wasBankingSet ? "banking_updated" : "banking_set",
      { method: updated[0].payout_method || null }, actor);
  } else {
    await writeHotelEvent(env, id, "updated", { fields }, actor);
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
  logMutation(request, auth.claims, "terminate", "hotel", id);
  await writeHotelEvent(env, id, "terminated", {}, auth.claims?.email);
  return jsonResponse({ hotel: normaliseHotel(updated[0]) }, 200, request);
}

// Activity log writer for the hotel record itself. Fire-and-forget —
// audit data never blocks a user mutation. Mirrors writePlacementEvent
// / writeStaffEvent so the aggregator endpoint can UNION all three
// tables into a single Stripe-style timeline on the hotel profile.
async function writeHotelEvent(env, hotelId, eventType, payload, actorEmail) {
  try {
    await supabaseInsert(env, "hotel_events", [{
      hotel_id:    hotelId,
      event_type:  eventType,
      actor_email: actorEmail || null,
      payload:     payload || {},
    }]);
  } catch (err) {
    console.warn(`hotel_event ${eventType} for ${hotelId} failed: ${err && err.message}`);
  }
}

// Aggregator: pulls the three event sources scoped to one hotel and
// returns them as a single sorted array. Each row carries `source`
// so the frontend can format the description per source type without
// re-querying. Limit 50 per source keeps the round-trip cheap;
// pagination ships as a follow-up if a hotel ever produces enough
// events to need it.
async function handleAdminHotelEvents(hotelId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(hotelId)) {
    return jsonResponse({ error: "invalid hotel id" }, 400, request);
  }

  // Cursor pagination: `before` is the created_at of the oldest row
  // the client already has. lt is exclusive so we never re-emit the
  // boundary row. PAGE is the per-source cap AND the response cap;
  // has_more conservatively flags when any source returned a full
  // page (likely more available) or when the merged set exceeded
  // PAGE before slicing.
  const url = new URL(request.url);
  const beforeRaw = url.searchParams.get("before");
  let beforeFilter = "";
  if (beforeRaw) {
    if (Number.isNaN(Date.parse(beforeRaw))) {
      return jsonResponse({ error: "before must be an ISO timestamp" }, 400, request);
    }
    beforeFilter = `&created_at=lt.${encodeURIComponent(beforeRaw)}`;
  }
  const PAGE = 50;

  // Hotel events live in their own table keyed by hotel_id — direct fetch.
  const hotelRowsP = supabaseSelect(
    env,
    `hotel_events?hotel_id=eq.${encodeURIComponent(hotelId)}` +
      `&select=id,event_type,actor_email,payload,created_at` +
      `&order=created_at.desc&limit=${PAGE}` +
      beforeFilter,
  );

  // Placement and staff events join via their owning entity; fetch
  // the entity ids for this hotel first, then the events by id list.
  // Two-step keeps the queries simple and uses the proper indexes.
  const placementsP = supabaseSelect(
    env,
    `placements?hotel_id=eq.${encodeURIComponent(hotelId)}&select=id,name`,
  );
  const staffP = supabaseSelect(
    env,
    `hotel_staff?hotel_id=eq.${encodeURIComponent(hotelId)}&select=id,name,tracking_code`,
  );

  const [hotelRows, placements, staff] = await Promise.all([
    hotelRowsP, placementsP, staffP,
  ]);

  const placementById = new Map((placements || []).map((p) => [p.id, p]));
  const staffById     = new Map((staff || []).map((s) => [s.id, s]));

  const placementEvents = placementById.size
    ? await supabaseSelect(
        env,
        `placement_events?placement_id=in.(${Array.from(placementById.keys()).join(",")})` +
          `&select=id,placement_id,event_type,actor_email,payload,created_at` +
          `&order=created_at.desc&limit=${PAGE}` +
          beforeFilter,
      )
    : [];
  const staffEvents = staffById.size
    ? await supabaseSelect(
        env,
        `staff_events?staff_id=in.(${Array.from(staffById.keys()).join(",")})` +
          `&select=id,staff_id,event_type,actor_email,payload,created_at` +
          `&order=created_at.desc&limit=${PAGE}` +
          beforeFilter,
      )
    : [];

  // Normalise each source into a common envelope so the frontend has
  // a single shape to render. `subject` carries the entity label
  // (e.g. placement name, staff name) so descriptions can read
  // "Lobby rack card status changed to Active" without an extra join
  // on the client.
  const merged = [];
  for (const r of (hotelRows || [])) {
    merged.push({
      id: r.id, source: "hotel",
      event_type: r.event_type, payload: r.payload || {},
      actor_email: r.actor_email, created_at: r.created_at,
      subject: null,
    });
  }
  for (const r of (placementEvents || [])) {
    const pl = placementById.get(r.placement_id);
    merged.push({
      id: r.id, source: "placement",
      event_type: r.event_type, payload: r.payload || {},
      actor_email: r.actor_email, created_at: r.created_at,
      subject: pl ? { id: pl.id, name: pl.name } : null,
    });
  }
  for (const r of (staffEvents || [])) {
    const s = staffById.get(r.staff_id);
    merged.push({
      id: r.id, source: "staff",
      event_type: r.event_type, payload: r.payload || {},
      actor_email: r.actor_email, created_at: r.created_at,
      subject: s ? { id: s.id, name: s.name, tracking_code: s.tracking_code } : null,
    });
  }
  merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const page = merged.slice(0, PAGE);
  // has_more is a conservative flag: any source that filled its
  // PAGE quota probably has older rows, and a merged set that
  // exceeded PAGE before slicing definitely has more. A false
  // positive just means an empty "Load more" click; a false
  // negative would silently truncate history, which is worse.
  const hasMore =
    merged.length > PAGE ||
    (hotelRows && hotelRows.length === PAGE) ||
    (placementEvents && placementEvents.length === PAGE) ||
    (staffEvents && staffEvents.length === PAGE);
  return jsonResponse({ events: page, has_more: hasMore }, 200, request);
}

// Activity log writer for staff. Same fire-and-forget contract as
// writePlacementEvent — audit data never blocks a user mutation.
async function writeStaffEvent(env, staffId, eventType, payload, actorEmail) {
  try {
    await supabaseInsert(env, "staff_events", [{
      staff_id:    staffId,
      event_type:  eventType,
      actor_email: actorEmail || null,
      payload:     payload || {},
    }]);
  } catch (err) {
    console.warn(`staff_event ${eventType} for ${staffId} failed: ${err && err.message}`);
  }
}

async function handleAdminStaffEvents(staffId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(staffId)) return jsonResponse({ error: "invalid staff id" }, 400, request);
  const rows = await supabaseSelect(
    env,
    `staff_events?staff_id=eq.${encodeURIComponent(staffId)}` +
      `&select=id,event_type,actor_email,payload,created_at` +
      `&order=created_at.desc&limit=50`,
  );
  return jsonResponse({ events: rows || [] }, 200, request);
}

async function handleAdminStaffCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validateStaff(body, { creating: true });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);

  try {
    const { staff, shortLinkWarning } = await insertStaffWithSequence(env, v.row);
    logMutation(request, auth.claims, "create", "staff", staff.id, {
      hotel_id: v.row.hotel_id, tracking_code: staff.tracking_code, name: staff.name,
    });
    await writeStaffEvent(env, staff.id, "onboarded", {
      tracking_code: staff.tracking_code,
      kickback_pct: staff.kickback_pct,
    }, auth.claims && auth.claims.email);
    const payload = { staff: normaliseStaff(staff) };
    if (shortLinkWarning) payload.short_link_warning = shortLinkWarning;
    return jsonResponse(payload, 201, request);
  } catch (err) {
    if (err.status === 404) return jsonResponse({ error: err.message }, 404, request);
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
  delete v.row.hotel_id; // can't reassign staff to a different hotel

  // Snapshot prior rate so a rate_changed event is only written
  // when the kickback actually changes.
  let priorRate = null;
  if (v.row.kickback_pct !== undefined) {
    const before = await supabaseSelect(
      env, `hotel_staff?id=eq.${encodeURIComponent(id)}&select=kickback_pct&limit=1`,
    );
    priorRate = before[0] ? before[0].kickback_pct : null;
  }

  const updated = await supabaseUpdate(
    env, `hotel_staff?id=eq.${encodeURIComponent(id)}`, v.row, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "staff not found" }, 404, request);
  }
  logMutation(request, auth.claims, "update", "staff", id, { fields: Object.keys(v.row) });
  if (v.row.kickback_pct !== undefined &&
      Number(priorRate) !== Number(v.row.kickback_pct)) {
    await writeStaffEvent(env, id, "rate_changed", {
      from: priorRate, to: v.row.kickback_pct,
    }, auth.claims && auth.claims.email);
  }
  return jsonResponse({ staff: normaliseStaff(updated[0]) }, 200, request);
}

async function handleAdminStaffTerminate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid staff id" }, 400, request);

  const before = await supabaseSelect(
    env, `hotel_staff?id=eq.${encodeURIComponent(id)}&select=status&limit=1`,
  );
  const priorStatus = before[0] && before[0].status;
  const updated = await supabaseUpdate(
    env, `hotel_staff?id=eq.${encodeURIComponent(id)}`,
    { status: "terminated" }, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "staff not found" }, 404, request);
  }
  logMutation(request, auth.claims, "terminate", "staff", id);
  await writeStaffEvent(env, id, "terminated", {
    from: priorStatus, to: "terminated",
  }, auth.claims && auth.claims.email);
  return jsonResponse({ staff: normaliseStaff(updated[0]) }, 200, request);
}

// Activity log writer. Fire-and-forget — events are audit data and
// must never break the user-facing mutation if Supabase has a hiccup.
// Caller passes the placement id, an event_type from the enum, an
// optional payload (object that will be JSON-encoded into payload
// jsonb), and the actor's email (auth.claims.email).
async function writePlacementEvent(env, placementId, eventType, payload, actorEmail) {
  try {
    await supabaseInsert(env, "placement_events", [{
      placement_id: placementId,
      event_type:   eventType,
      actor_email:  actorEmail || null,
      payload:      payload || {},
    }]);
  } catch (err) {
    console.warn(
      `placement_event ${eventType} for ${placementId} failed: ${err && err.message}`,
    );
  }
}

async function handleAdminPlacementEvents(placementId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const guard = await placementOr404(env, placementId, request);
  if (guard.error) return guard.error;
  const rows = await supabaseSelect(
    env,
    `placement_events?placement_id=eq.${encodeURIComponent(placementId)}` +
      `&select=id,event_type,actor_email,payload,created_at` +
      `&order=created_at.desc&limit=50`,
  );
  return jsonResponse({ events: rows || [] }, 200, request);
}

async function handleAdminPlacementCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validatePlacement(body, { creating: true });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);

  try {
    const { placement, shortLinkWarning } = await insertPlacementWithSequence(env, v.row);
    logMutation(request, auth.claims, "create", "placement", placement.id, {
      hotel_id: v.row.hotel_id, code: placement.code, name: placement.name,
    });
    await writePlacementEvent(env, placement.id, "created", {
      name: placement.name,
      placement_type: placement.placement_type,
      status: placement.status,
    }, auth.claims && auth.claims.email);
    const payload = { placement };
    if (shortLinkWarning) payload.short_link_warning = shortLinkWarning;
    return jsonResponse(payload, 201, request);
  } catch (err) {
    if (err.status === 404) return jsonResponse({ error: err.message }, 404, request);
    throw err;
  }
}

async function handleAdminPlacementUpdate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid placement id" }, 400, request);
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validatePlacement(body, { creating: false });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);
  delete v.row.hotel_id; // can't reassign a placement to a different hotel

  // Snapshot the prior status so we can write a status_changed
  // event only when it actually changes.
  let priorStatus = null;
  if (v.row.status) {
    const before = await supabaseSelect(
      env, `placements?id=eq.${encodeURIComponent(id)}&select=status&limit=1`,
    );
    priorStatus = (before[0] && before[0].status) || null;
  }

  const updated = await supabaseUpdate(
    env, `placements?id=eq.${encodeURIComponent(id)}`, v.row, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "placement not found" }, 404, request);
  }
  logMutation(request, auth.claims, "update", "placement", id, { fields: Object.keys(v.row) });
  if (v.row.status && priorStatus !== v.row.status) {
    await writePlacementEvent(env, id, "status_changed", {
      from: priorStatus, to: v.row.status,
    }, auth.claims && auth.claims.email);
  }

  // When tour_slug changes, retarget the placement's short link so the
  // QR continues to resolve to the correct destination without reprinting.
  if ("tour_slug" in v.row) {
    const placement = updated[0];
    const code = (placement.code || "").toLowerCase();
    if (code) {
      const links = await supabaseSelect(
        env,
        `short_links?short_path=eq.${encodeURIComponent(code)}&select=id,short_io_id&limit=1`,
      );
      if (links.length && links[0].short_io_id) {
        const hotelRows = await supabaseSelect(
          env, `hotels?id=eq.${encodeURIComponent(placement.hotel_id)}&select=code`,
        );
        if (hotelRows.length) {
          const newTarget = placementTargetUrl(env, hotelRows[0].code, code, placement.tour_slug);
          try {
            await updateShortLink(env, links[0].short_io_id, { originalURL: newTarget });
            await supabaseUpdate(
              env, `short_links?id=eq.${encodeURIComponent(links[0].id)}`,
              { target_url: newTarget },
            );
          } catch (err) {
            console.warn(`retarget short link for placement ${id} failed: ${err && err.message}`);
          }
        }
      }
    }
  }

  return jsonResponse({ placement: updated[0] }, 200, request);
}

async function handleAdminPlacementRetire(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid placement id" }, 400, request);

  // Soft-delete: status flips to 'retired'. The Short.io redirect and
  // short_links row stay alive so any printed QR keeps resolving and
  // historical click data is preserved — same contract as staff.
  const before = await supabaseSelect(
    env, `placements?id=eq.${encodeURIComponent(id)}&select=status&limit=1`,
  );
  const priorStatus = (before[0] && before[0].status) || null;
  const updated = await supabaseUpdate(
    env, `placements?id=eq.${encodeURIComponent(id)}`,
    { status: "retired" }, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "placement not found" }, 404, request);
  }
  logMutation(request, auth.claims, "retire", "placement", id);
  if (priorStatus !== "retired") {
    await writePlacementEvent(env, id, "status_changed", {
      from: priorStatus, to: "retired",
    }, auth.claims && auth.claims.email);
  }
  return jsonResponse({ placement: updated[0] }, 200, request);
}

// Sanitise an uploaded filename for use inside a storage object key:
// keep it readable but strip anything that isn't safe in a path.
function safeAssetFilename(name) {
  const base = String(name || "file").split(/[\\/]/).pop().trim();
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 120) || "file";
}

async function placementOr404(env, id, request) {
  if (!UUID_RE.test(id)) {
    return { error: jsonResponse({ error: "invalid placement id" }, 400, request) };
  }
  const rows = await supabaseSelect(
    env, `placements?id=eq.${encodeURIComponent(id)}&select=id`,
  );
  if (!rows.length) {
    return { error: jsonResponse({ error: "placement not found" }, 404, request) };
  }
  return { placement: rows[0] };
}

// Step 1 of an upload: mint a one-shot signed URL the browser PUTs
// the file to directly. No DB row yet — the row is recorded in step 2
// only after the upload succeeds, so a failed upload leaves no
// dangling asset record.
async function handleAdminPlacementAssetSignUpload(placementId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const guard = await placementOr404(env, placementId, request);
  if (guard.error) return guard.error;

  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!PLACEMENT_ASSET_KINDS.has(kind)) {
    return jsonResponse({ error: "invalid kind" }, 400, request);
  }
  const filename = safeAssetFilename(body.filename);
  // Object key: <placement>/<kind>/<ts>-<filename>. The timestamp
  // keeps versions side by side instead of overwriting.
  const objectPath = `${placementId}/${kind}/${Date.now()}-${filename}`;

  try {
    const signed = await supabaseStorageSignUpload(env, PLACEMENT_ASSETS_BUCKET, objectPath);
    return jsonResponse({
      upload_url: signed.url,
      token: signed.token,
      storage_path: objectPath,
      filename,
    }, 200, request);
  } catch (err) {
    console.error("placement asset sign-upload failed:", err.message, err.body);
    // Surface the underlying Supabase Storage error so a missing
    // bucket / disabled storage / auth issue is diagnosable instead
    // of a blanket "could not create upload URL".
    const detail = err && err.body
      ? (typeof err.body === "string" ? err.body : (err.body.message || err.body.error || JSON.stringify(err.body)))
      : (err && err.message);
    return jsonResponse({
      error: "could not create upload URL",
      detail: detail || null,
      status: (err && err.status) || null,
    }, 502, request);
  }
}

// Step 2: record the uploaded object. Computes the next per-(placement,
// kind) version so re-uploads keep history instead of clobbering.
async function handleAdminPlacementAssetRecord(placementId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const guard = await placementOr404(env, placementId, request);
  if (guard.error) return guard.error;

  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!PLACEMENT_ASSET_KINDS.has(kind)) {
    return jsonResponse({ error: "invalid kind" }, 400, request);
  }
  const storage_path = typeof body.storage_path === "string" ? body.storage_path.trim() : "";
  if (!storage_path || !storage_path.startsWith(`${placementId}/`)) {
    return jsonResponse({ error: "invalid storage_path" }, 400, request);
  }
  const filename = safeAssetFilename(body.filename);
  const content_type = typeof body.content_type === "string" ? body.content_type.slice(0, 160) : null;
  const byte_size = Number.isInteger(body.byte_size) && body.byte_size >= 0 ? body.byte_size : null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const maxRows = await supabaseSelect(
      env,
      `placement_assets?placement_id=eq.${encodeURIComponent(placementId)}` +
        `&kind=eq.${encodeURIComponent(kind)}` +
        `&select=version&order=version.desc&limit=1`,
    );
    const nextVer = (maxRows.length && maxRows[0].version ? maxRows[0].version : 0) + 1;
    try {
      const inserted = await supabaseInsert(env, "placement_assets", [{
        placement_id: placementId,
        kind,
        filename,
        storage_path,
        content_type,
        byte_size,
        version: nextVer,
      }], { returnRow: true });
      await writePlacementEvent(env, placementId,
        nextVer > 1 ? "asset_replaced" : "asset_uploaded",
        { kind, version: nextVer, filename },
        auth.claims && auth.claims.email,
      );
      logMutation(request, auth.claims, "create", "placement_asset", inserted[0].id, {
        placement_id: placementId, kind, version: nextVer,
      });
      return jsonResponse({ asset: inserted[0] }, 201, request);
    } catch (err) {
      if (isUniqueViolation(err, "version")) continue;
      if (isUniqueViolation(err, "storage_path")) {
        return jsonResponse({ error: "asset already recorded" }, 409, request);
      }
      throw err;
    }
  }
  return jsonResponse({ error: "could not allocate asset version" }, 409, request);
}

// Mint a short-lived signed GET URL for previewing/downloading a
// recorded asset. The bucket is private; this is the only way a
// browser ever reads it.
async function handleAdminPlacementAssetUrl(placementId, assetId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(placementId) || !UUID_RE.test(assetId)) {
    return jsonResponse({ error: "invalid id" }, 400, request);
  }
  const rows = await supabaseSelect(
    env,
    `placement_assets?id=eq.${encodeURIComponent(assetId)}` +
      `&placement_id=eq.${encodeURIComponent(placementId)}` +
      `&select=id,storage_path,filename`,
  );
  if (!rows.length) {
    return jsonResponse({ error: "asset not found" }, 404, request);
  }
  try {
    const url = await supabaseStorageSignDownload(
      env, PLACEMENT_ASSETS_BUCKET, rows[0].storage_path, 3600,
    );
    if (!url) return jsonResponse({ error: "could not sign asset URL" }, 502, request);
    return jsonResponse({ url, filename: rows[0].filename }, 200, request);
  } catch (err) {
    console.error("placement asset sign-download failed:", err.message);
    return jsonResponse({ error: "could not sign asset URL" }, 502, request);
  }
}

const PLACEMENT_ASSET_STATUSES = new Set(["designed", "printed", "deployed", "retired"]);

// Advance an asset version through its lifecycle (designed → printed →
// deployed, or retired). Status is the only mutable field — the file
// itself is immutable; a new file is a new version row.
async function handleAdminPlacementAssetUpdate(placementId, assetId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(placementId) || !UUID_RE.test(assetId)) {
    return jsonResponse({ error: "invalid id" }, 400, request);
  }
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);
  const status = typeof body.status === "string" ? body.status : "";
  if (!PLACEMENT_ASSET_STATUSES.has(status)) {
    return jsonResponse({ error: "invalid status" }, 400, request);
  }
  const updated = await supabaseUpdate(
    env,
    `placement_assets?id=eq.${encodeURIComponent(assetId)}` +
      `&placement_id=eq.${encodeURIComponent(placementId)}`,
    { status },
    { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "asset not found" }, 404, request);
  }
  logMutation(request, auth.claims, "update", "placement_asset", assetId, { status });
  return jsonResponse({ asset: updated[0] }, 200, request);
}

// Click analytics for a placement's short link — a read-through to
// Short.io for one period (no local time-series store). Returns
// { configured, short_url, period, total_clicks, human_clicks,
//   series: [{ x: ISO, y: number }] }. Short.io picks the bucket
// granularity per period (daily for last30/last7, hourly for
// total/last24); the client labels the axis accordingly.
const PLACEMENT_STAT_PERIODS = new Set(["last24", "last7", "last30", "total"]);

// Period → cutoff timestamp in ISO. 'total' returns null to mean
// "no lower bound." Used for bookings/revenue windowing.
function periodCutoffIso(period) {
  const day = 86400 * 1000;
  const now = Date.now();
  if (period === "last24") return new Date(now - day).toISOString();
  if (period === "last7")  return new Date(now - 7 * day).toISOString();
  if (period === "last30") return new Date(now - 30 * day).toISOString();
  return null;
}

// Bookings + revenue attributed to a placement in a time window.
// Placements are funnel-only — they never "win" credit — but we count
// bookings their tracking code appeared in as the honest measure of
// the placement's contribution. Revenue is the sum of commission_amount
// for those bookings.
async function bookingsForPlacement(env, code, period) {
  if (!code) return { bookings: 0, revenue: 0, currency: "CAD" };
  const touches = await supabaseSelect(
    env,
    `booking_touchpoints?code=ilike.${encodeURIComponent(code)}` +
      `&select=confirmation_code`,
  );
  const codes = Array.from(new Set(
    (touches || []).map((t) => t.confirmation_code).filter(Boolean),
  ));
  if (!codes.length) return { bookings: 0, revenue: 0, currency: "CAD" };
  const cutoff = periodCutoffIso(period);
  const inList = codes.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
  const filter = `confirmation_code=in.(${inList})` +
    (cutoff ? `&created_at=gte.${encodeURIComponent(cutoff)}` : "");
  const rows = await supabaseSelect(
    env,
    `bookings?${filter}&select=id,confirmation_code,amount,currency,hotel:hotels(commission_pct)`,
  );
  let revenue = 0;
  let currency = "CAD";
  for (const b of rows) {
    const amount = Number(b.amount) || 0;
    const pct = b.hotel && b.hotel.commission_pct != null
      ? Number(b.hotel.commission_pct) : 0;
    revenue += (amount * pct) / 100;
    if (b.currency) currency = b.currency;
  }
  return { bookings: rows.length, revenue: round2(revenue), currency };
}

async function handleAdminPlacementStats(placementId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const guard = await placementOr404(env, placementId, request);
  if (guard.error) return guard.error;

  const url = new URL(request.url);
  let period = url.searchParams.get("period") || "last30";
  if (!PLACEMENT_STAT_PERIODS.has(period)) period = "last30";

  const pRows = await supabaseSelect(
    env, `placements?id=eq.${encodeURIComponent(placementId)}&select=code`,
  );
  const code = (pRows[0] && pRows[0].code ? pRows[0].code : "").toLowerCase();
  // Bookings + revenue are independent of Short.io so we compute them
  // unconditionally and merge into the response below.
  const attribution = await bookingsForPlacement(env, code, period).catch((e) => {
    console.warn("bookingsForPlacement failed:", e && e.message);
    return { bookings: 0, revenue: 0, currency: "CAD" };
  });
  const links = code
    ? await supabaseSelect(
        env,
        `short_links?short_path=eq.${encodeURIComponent(code)}` +
          `&select=short_io_id,short_url,click_count_cached,last_clicked_at&limit=1`,
      )
    : [];
  const link = links[0] || null;
  if (!link) {
    return jsonResponse({
      configured: false,
      bookings: attribution.bookings,
      revenue: attribution.revenue,
      currency: attribution.currency,
    }, 200, request);
  }
  if (!isShortIoConfigured(env)) {
    return jsonResponse({
      configured: false,
      short_url: link.short_url,
      period,
      total_clicks: link.click_count_cached || 0,
      human_clicks: null,
      series: [],
      bookings: attribution.bookings,
      revenue: attribution.revenue,
      currency: attribution.currency,
    }, 200, request);
  }

  try {
    const raw = await getLinkStats(env, link.short_io_id, period);
    const norm = normalizeLinkStats(raw);
    const human = raw && raw.humanClicks != null && Number.isFinite(Number(raw.humanClicks))
      ? Number(raw.humanClicks)
      : null;
    const ds = raw && raw.clickStatistics && Array.isArray(raw.clickStatistics.datasets)
      ? raw.clickStatistics.datasets : [];
    const points = ds.length && Array.isArray(ds[0].data) ? ds[0].data : [];
    const series = points
      .filter((p) => p && p.x)
      .map((p) => ({
        x: p.x,
        y: p.y != null && Number.isFinite(Number(p.y)) ? Number(p.y) : 0,
      }));
    // Breakdown bar lists. Short.io returns raw.browser / raw.os as
    // [{ browser|os, score }]; normalise to { name, score } and keep
    // the top entries.
    const breakdown = (arr, key) =>
      (Array.isArray(arr) ? arr : [])
        .map((e) => ({
          name: e && e[key] ? String(e[key]) : "Unknown",
          score: e && Number.isFinite(Number(e.score)) ? Number(e.score) : 0,
        }))
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
    return jsonResponse({
      configured: true,
      short_url: link.short_url,
      period,
      total_clicks: norm.totalClicks != null ? norm.totalClicks : (link.click_count_cached || 0),
      human_clicks: human,
      series,
      browsers: breakdown(raw && raw.browser, "browser"),
      os: breakdown(raw && raw.os, "os"),
      bookings: attribution.bookings,
      revenue: attribution.revenue,
      currency: attribution.currency,
    }, 200, request);
  } catch (err) {
    console.error("placement stats failed:", err && err.message);
    // Degrade to the cached total rather than erroring the modal.
    return jsonResponse({
      configured: true,
      short_url: link.short_url,
      period,
      total_clicks: link.click_count_cached || 0,
      human_clicks: null,
      series: [],
      browsers: [],
      os: [],
      bookings: attribution.bookings,
      revenue: attribution.revenue,
      currency: attribution.currency,
      error: "Short.io stats unavailable",
    }, 200, request);
  }
}

// Per-staff stats: bookings (total + this month + period), last
// booking, clicks + conversion %, lifetime commission, recent
// bookings (last 5 with their commission). Powers the Employees
// table lazy-load + the Employee lightbox scoreboard.
async function handleAdminStaffStats(staffId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(staffId)) return jsonResponse({ error: "invalid staff id" }, 400, request);

  const staffRows = await supabaseSelect(
    env,
    `hotel_staff?id=eq.${encodeURIComponent(staffId)}&select=kickback_pct&limit=1`,
  );
  const staffKickbackPct = staffRows[0] && staffRows[0].kickback_pct != null
    ? Number(staffRows[0].kickback_pct) : 0;

  const url = new URL(request.url);
  let period = url.searchParams.get("period") || "last30";
  if (!PLACEMENT_STAT_PERIODS.has(period)) period = "last30";
  const periodCutoff = periodCutoffIso(period);
  const monthStart = (() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  })();

  // Pull a flat list of this staff's confirmed bookings (recent first
  // so we can slice the top 5 for the lightbox without a second
  // round-trip). At realistic per-employee volumes this is small.
  // Kickback is computed on the fly from amount × staff.kickback_pct.
  // The cross-hotel summary at line ~1051 follows the same pattern.
  const rows = await supabaseSelect(
    env,
    `bookings?staff_id=eq.${encodeURIComponent(staffId)}` +
      `&status=eq.confirmed` +
      `&select=id,created_at,date,tour_title,amount,currency,lead_name,status,confirmation_code` +
      `&order=created_at.desc&limit=500`,
  );
  const bookings = Array.isArray(rows) ? rows : [];
  const bookings_total = bookings.length;
  const bookings_30d = periodCutoff
    ? bookings.filter((b) => b.created_at && b.created_at >= periodCutoff).length
    : bookings_total;
  const bookings_month = bookings.filter((b) => b.created_at && b.created_at >= monthStart).length;
  const last_booking_at = bookings.length ? bookings[0].created_at : null;
  const kickbackFor = (b) => {
    const amount = Number(b.amount) || 0;
    return (amount * staffKickbackPct) / 100;
  };
  let lifetime_commission = 0;
  let currency = "CAD";
  for (const b of bookings) {
    lifetime_commission += kickbackFor(b);
    if (b.currency) currency = b.currency;
  }
  lifetime_commission = round2(lifetime_commission);

  // Per-staff click count comes from the personal short link
  // (short_links.staff_id = this id). One row at most.
  const links = await supabaseSelect(
    env,
    `short_links?staff_id=eq.${encodeURIComponent(staffId)}` +
      `&link_type=eq.staff&status=eq.active` +
      `&select=short_url,short_path,click_count_cached,last_clicked_at&limit=1`,
  );
  const link = (links && links[0]) || null;
  const clicks_total = link && Number.isFinite(Number(link.click_count_cached))
    ? Number(link.click_count_cached) : 0;
  const conversion_pct = clicks_total > 0
    ? Number(((bookings_total / clicks_total) * 100).toFixed(1))
    : null;

  // Recent 5 — already sorted from the bookings fetch.
  const recent = bookings.slice(0, 5).map((b) => ({
    id: b.id,
    confirmation_code: b.confirmation_code,
    created_at: b.created_at,
    date: b.date,
    tour_title: b.tour_title,
    amount: b.amount,
    currency: b.currency,
    lead_name: b.lead_name,
    status: b.status,
    commission_amount: round2(kickbackFor(b)),
  }));

  return jsonResponse({
    period,
    bookings_total,
    bookings_30d,
    bookings_month,
    last_booking_at,
    clicks_total,
    clicks_last_at: link && link.last_clicked_at || null,
    conversion_pct,
    lifetime_commission,
    currency,
    short_url: link && link.short_url || null,
    recent_bookings: recent,
  }, 200, request);
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
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonResponse({ error: "name required" }, 400, request);
  const role = MANAGER_ROLES.has(body.role) ? body.role : "manager";
  const invited_by_email = (auth.claims && auth.claims.email) || null;

  try {
    const inserted = await supabaseInsert(
      env, "hotel_users",
      [{ email, name, hotel_id, role, status: "active", invited_by_email }],
      { returnRow: true },
    );
    const invite_sent = await sendManagerInvite(env, email);
    logMutation(request, auth.claims, "create", "hotel_user", inserted[0].id, {
      hotel_id, email, role,
    });
    return jsonResponse({ manager: inserted[0], invite_sent }, 201, request);
  } catch (err) {
    if (err.body && /duplicate key|unique/i.test(JSON.stringify(err.body))) {
      return jsonResponse({ error: `${email} is already an active manager for this hotel` }, 409, request);
    }
    throw err;
  }
}

// Sends a Supabase Auth invite email to a newly-added hotel manager.
// The invite link redirects to connect.gowithhorizon.com/setup/ where they set a
// password on first sign-in. Returns true if the email was sent,
// false if the user already has a confirmed Supabase Auth account
// (they can just sign in normally) or if the invite call fails for
// any other reason (the hotel_users row is already saved either way).
async function sendManagerInvite(env, email) {
  const redirectTo = "https://connect.gowithhorizon.com/setup/";
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
    if (!MANAGER_ROLES.has(body.role)) {
      return jsonResponse({ error: "role must be owner, manager, or read_only" }, 400, request);
    }
    patch.role = body.role;
  }
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) return jsonResponse({ error: "name cannot be empty" }, 400, request);
    patch.name = trimmed;
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
  logMutation(request, auth.claims, "update", "hotel_user", id, { fields: Object.keys(patch) });
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
const PLACEMENT_ASSET_FIELDS =
  "id,placement_id,kind,filename,storage_path,content_type,byte_size," +
  "version,status,uploaded_at,created_at,updated_at";
const PLACEMENT_FIELDS =
  "id,hotel_id,sequence_number,code,placement_type,name,status," +
  "tour_slug,location_in_hotel,deployed_at,created_at,updated_at";
const PLACEMENT_ASSETS_BUCKET = "placement-assets";
const PLACEMENT_ASSET_KINDS = new Set(["design", "print_ready", "qr"]);
const SHORT_LINK_TYPES = new Set(["hotel", "staff", "campaign", "placement"]);
const SHORT_LINK_STATUSES = new Set(["active", "retired"]);

const PLACEMENT_TYPES = new Set([
  "rack_card", "table_tent", "welcome_packet",
  "website_widget", "lobby_qr", "custom",
]);
const PLACEMENT_STATUSES = new Set(["designed", "printed", "active", "paused", "retired"]);
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
  // Both hotel and staff short paths come from the tracking code so
  // every short URL on the platform follows the same htl-7q4k9 /
  // htl-7q4k9-eNNN format. Slugs live in the long URL only — see
  // PARTNERS_NAMING.md.
  let shortPath = typeof body.short_path === "string" ? body.short_path.trim() : "";
  if (!shortPath) {
    if (linkType === "staff" && staffRow) {
      shortPath = trackingCodeToShortPath(staffRow.tracking_code) || "";
    } else if (linkType === "hotel" && hotelRow) {
      shortPath = trackingCodeToShortPath(hotelRow.default_tracking_code) || "";
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
    const { link } = await mintShortLinkAndRecord(
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
    logMutation(request, auth.claims, "create", "short_link", link?.id, {
      link_type: linkType, hotel_id: hotelId, staff_id: staffId, short_path: shortPath,
    });
    return jsonResponse({ short_link: normaliseShortLink(link) }, 201, request);
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
  logMutation(request, auth.claims, "update", "short_link", id, { fields: Object.keys(patch) });
  await recordShortLinkAudit(env, auth.claims, id, existing, patch);
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

  // Load the existing row so the audit log can capture the prior
  // status. Skip if already retired so we don't churn idempotent
  // double-clicks into noise audit rows.
  const existing = await supabaseSelect(
    env,
    `short_links?id=eq.${encodeURIComponent(id)}&select=id,status`,
  );
  if (!existing.length) return jsonResponse({ error: "short_link not found" }, 404, request);

  const updated = await supabaseUpdate(
    env,
    `short_links?id=eq.${encodeURIComponent(id)}`,
    { status: "retired" },
    { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "short_link not found" }, 404, request);
  }
  logMutation(request, auth.claims, "retire", "short_link", id);
  await recordShortLinkAudit(env, auth.claims, id, existing[0], { status: "retired" });
  return jsonResponse({ short_link: normaliseShortLink(updated[0]) }, 200, request);
}

// GET /api/admin/short-links/:id/audit
// Returns the change history for a single short_link, newest first.
// Used by the Edit modal to surface a "what changed and when" log.
async function handleAdminShortLinkAuditList(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid short_link id" }, 400, request);

  const rows = await supabaseSelect(
    env,
    `short_link_audit?short_link_id=eq.${encodeURIComponent(id)}` +
      `&select=id,field,old_value,new_value,actor_email,created_at` +
      `&order=created_at.desc&limit=200`,
  );
  return jsonResponse({ entries: rows || [] }, 200, request);
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

  // Fetch all active links. short_path is included so we can auto-
  // transition the placement that owns this link from 'printed' to
  // 'active' on the first scan (see below).
  let links;
  try {
    links = await supabaseSelect(
      env,
      "short_links?status=eq.active&select=id,short_io_id,short_path&order=created_at.asc",
    );
  } catch (err) {
    console.error("syncClickCounts: failed to fetch short_links:", err.message);
    return { synced: 0, errors: 1, error: err.message };
  }

  let synced = 0;
  let errors = 0;
  let unparsed = 0;
  let firstError = null;
  let sampleKeys = null;

  for (const link of links) {
    try {
      const stats = await getLinkStats(env, link.short_io_id, "total");
      const { totalClicks, lastClickDate } = normalizeLinkStats(stats);

      // Could not find a click count in the payload. Do NOT write 0 —
      // that silently clobbers the real cached value and looks like
      // "sync stuck at 0". Skip the write, count it, and capture the
      // payload shape once so the cause is diagnosable from the
      // sync result instead of the logs alone.
      if (totalClicks == null) {
        unparsed++;
        if (!sampleKeys && stats && typeof stats === "object") {
          sampleKeys = Object.keys(stats).slice(0, 20);
        }
        console.warn(
          `syncClickCounts: link ${link.id} — no click count in Short.io payload; keys=${
            stats && typeof stats === "object" ? Object.keys(stats).join(",") : typeof stats
          }`,
        );
        continue;
      }

      await supabaseUpdate(
        env,
        `short_links?id=eq.${encodeURIComponent(link.id)}`,
        {
          click_count_cached: totalClicks,
          ...(lastClickDate ? { last_clicked_at: lastClickDate } : {}),
          updated_at: new Date().toISOString(),
        },
      );
      synced++;

      // Auto-transition: a placement currently in 'printed' state
      // flips to 'active' on its first recorded scan. The short
      // link's short_path equals the placement's lowercased code, so
      // one indexed lookup per link is enough. Failures here are
      // logged but don't abort the sync run. We also write two
      // activity events (first_scan + status_auto_active) when the
      // transition actually fires.
      if (totalClicks > 0 && link.short_path) {
        try {
          const flipped = await supabaseUpdate(
            env,
            `placements?code=ilike.${encodeURIComponent(link.short_path)}` +
              `&status=eq.printed`,
            { status: "active" },
            { returnRow: true },
          );
          if (Array.isArray(flipped) && flipped.length) {
            const pid = flipped[0].id;
            await writePlacementEvent(env, pid, "first_scan",
              { total_clicks: totalClicks, last_clicked_at: lastClickDate || null }, null);
            await writePlacementEvent(env, pid, "status_auto_active",
              { from: "printed", to: "active" }, null);
          }
        } catch (err) {
          console.warn(
            `syncClickCounts: placement auto-transition failed for ${link.short_path}: ${err.message}`,
          );
        }
      }
    } catch (err) {
      console.error(`syncClickCounts: link ${link.id} failed:`, err.message);
      if (!firstError) firstError = err.message;
      errors++;
    }
  }

  return {
    synced,
    errors,
    unparsed,
    total: links.length,
    ...(firstError ? { first_error: firstError } : {}),
    ...(sampleKeys ? { sample_keys: sampleKeys } : {}),
  };
}

// GET /api/admin/short-links
// Global paginated list of all short_links with optional filters.
// Query params:
//   status    — 'active' | 'retired'  (omit for all)
//   type      — 'hotel' | 'staff' | 'campaign'
//   hotel_id  — UUID
//   q         — full-text search across short_path, label, notes
//   after     — opaque cursor (base64 of "created_at|id") for next page
//   limit     — max rows per page (default 50, max 100)
// Returns { links: [...], next_cursor: string|null }
async function handleAdminGlobalShortLinks(url, env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  try {
    const params  = url.searchParams;
    const status  = params.get("status");
    const type    = params.get("type");
    const hotelId = params.get("hotel_id");
    const q       = (params.get("q") || "").trim();
    const after   = params.get("after");
    const limit   = Math.min(Math.max(1, parseInt(params.get("limit") || "50", 10)), 100);

    // Match the rest of the codebase: do separate queries and merge in
    // JS rather than using PostgREST resource embeds. Keeps the SQL
    // surface predictable and matches handleAdminHotelShortLinksList.
    const fields = [
      "id", "short_url", "short_path", "target_url", "label", "notes",
      "link_type", "status", "click_count_cached", "last_clicked_at",
      "created_at", "hotel_id", "staff_id",
    ].join(",");

    let qs = `short_links?select=${fields}&order=created_at.desc,id.desc&limit=${limit + 1}`;

    if (status === "active" || status === "retired") {
      qs += `&status=eq.${status}`;
    }
    if (type === "hotel" || type === "staff" || type === "campaign") {
      qs += `&link_type=eq.${type}`;
    }
    if (hotelId) {
      qs += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;
    }
    if (q) {
      const safe = q.replace(/[%_]/g, "\\$&");
      qs +=
        `&or=(short_path.ilike.*${encodeURIComponent(safe)}*` +
        `,label.ilike.*${encodeURIComponent(safe)}*` +
        `,notes.ilike.*${encodeURIComponent(safe)}*)`;
    }
    if (after) {
      try {
        const decoded  = atob(after);
        const pipe     = decoded.lastIndexOf("|");
        const cursorTs = decoded.slice(0, pipe);
        const cursorId = decoded.slice(pipe + 1);
        if (cursorTs && cursorId) {
          qs +=
            `&or=(created_at.lt.${encodeURIComponent(cursorTs)}` +
            `,and(created_at.eq.${encodeURIComponent(cursorTs)},id.lt.${encodeURIComponent(cursorId)}))`;
        }
      } catch { /* ignore malformed cursor */ }
    }

    const rows    = await supabaseSelect(env, qs);
    const hasMore = rows.length > limit;
    const baseLinks = hasMore ? rows.slice(0, limit) : rows;

    // Hydrate hotel + staff names in two batched queries.
    const hotelIds = [...new Set(baseLinks.map((r) => r.hotel_id).filter(Boolean))];
    const staffIds = [...new Set(baseLinks.map((r) => r.staff_id).filter(Boolean))];
    const [hotels, staff] = await Promise.all([
      hotelIds.length
        ? supabaseSelect(env, `hotels?id=in.(${hotelIds.join(",")})&select=id,name`)
        : Promise.resolve([]),
      staffIds.length
        ? supabaseSelect(env, `hotel_staff?id=in.(${staffIds.join(",")})&select=id,name`)
        : Promise.resolve([]),
    ]);
    const hotelById = new Map(hotels.map((h) => [h.id, h]));
    const staffById = new Map(staff.map((s) => [s.id, s]));
    const links = baseLinks.map((r) => ({
      ...r,
      hotel:         r.hotel_id ? hotelById.get(r.hotel_id) || null : null,
      staff_member:  r.staff_id ? staffById.get(r.staff_id) || null : null,
    }));

    let nextCursor = null;
    if (hasMore && links.length > 0) {
      const last = links[links.length - 1];
      nextCursor = btoa(`${last.created_at}|${last.id}`);
    }

    return jsonResponse({ links, next_cursor: nextCursor }, 200, request);
  } catch (err) {
    console.error("handleAdminGlobalShortLinks error:", err.stack || err);
    return jsonResponse({ error: "Failed to load links" }, 500, request);
  }
}

// POST /api/admin/sync-clicks
// Manually triggers the same click-count sync the cron runs hourly.
// Returns { synced, errors, total } so the admin can see progress.
async function handleAdminSyncClicks(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const result = await syncClickCounts(env);
  logMutation(request, auth.claims, "sync_clicks", "short_link", null, {
    synced: result?.synced, errors: result?.errors, total: result?.total,
  });
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
  logMutation(request, auth.claims, "republish", "partners_json", null);
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
  logMutation(request, auth.claims, "review", "access_request", id, { decision: status });
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
  if (body.platform_fee_pct === null) row.platform_fee_pct = null;
  else if (typeof body.platform_fee_pct === "number") {
    if (body.platform_fee_pct < 0 || body.platform_fee_pct > 100) {
      return { error: "platform_fee_pct must be between 0 and 100" };
    }
    row.platform_fee_pct = body.platform_fee_pct;
  }
  // Onboarding metadata — all nullable, all admin-editable. The
  // database CHECK on star_rating enforces 1..5, so we let invalid
  // values bubble up as a 5xx rather than silently sanitise.
  if (body.contract_start_date === null) row.contract_start_date = null;
  else if (typeof body.contract_start_date === "string" &&
           /^\d{4}-\d{2}-\d{2}$/.test(body.contract_start_date)) {
    row.contract_start_date = body.contract_start_date;
  }
  if (body.property_type === null) row.property_type = null;
  else if (typeof body.property_type === "string") {
    const t = body.property_type.trim();
    row.property_type = t || null;
  }
  if (body.star_rating === null) row.star_rating = null;
  else if (typeof body.star_rating === "number") {
    if (!Number.isInteger(body.star_rating) || body.star_rating < 1 || body.star_rating > 5) {
      return { error: "star_rating must be an integer between 1 and 5" };
    }
    row.star_rating = body.star_rating;
  }
  if (body.country === null) row.country = null;
  else if (typeof body.country === "string") {
    const c = body.country.trim();
    row.country = c || null;
  }
  // Pure admin metadata — no attribution or commission impact.
  // Stored verbatim after trim; the UI handles display formatting.
  const textField = (key) => {
    if (body[key] === null) row[key] = null;
    else if (typeof body[key] === "string") {
      const t = body[key].trim();
      row[key] = t || null;
    }
  };
  textField("address");
  textField("phone");
  textField("primary_contact_name");
  textField("primary_contact_email");
  textField("website");

  // ── Manual payout banking (pilot phase — migration 0016) ──────────
  // Admin-entered. Each field is independently nullable so a partial
  // PATCH (e.g. just switching method) is valid; the UI enforces the
  // method↔fields pairing. Any banking field touched stamps
  // payout_updated_at so "last updated" is honest.
  let bankingTouched = false;
  const bankText = (key, re, errMsg) => {
    if (!(key in body)) return null;
    bankingTouched = true;
    if (body[key] === null || body[key] === "") {
      row[key] = null;
      return null;
    }
    if (typeof body[key] !== "string") return errMsg;
    const t = body[key].trim();
    if (re && !re.test(t)) return errMsg;
    row[key] = t;
    return null;
  };

  if ("payout_method" in body) {
    bankingTouched = true;
    if (body.payout_method === null || body.payout_method === "") {
      row.payout_method = null;
    } else if (body.payout_method === "etransfer" || body.payout_method === "eft") {
      row.payout_method = body.payout_method;
    } else {
      return { error: "payout_method must be 'etransfer', 'eft', or null" };
    }
  }
  const bankErr =
    bankText("payout_account_holder", null, "invalid account holder") ||
    bankText("payout_etransfer_email", EMAIL_RE, "payout_etransfer_email must be a valid email") ||
    bankText("payout_eft_institution", /^\d{3}$/, "institution number must be 3 digits") ||
    bankText("payout_eft_transit", /^\d{5}$/, "transit number must be 5 digits") ||
    bankText("payout_eft_account", /^\d{4,17}$/, "account number must be 4–17 digits");
  if (bankErr) return { error: bankErr };
  if (bankingTouched) row.payout_updated_at = new Date().toISOString();

  return { row };
}

function validateStaff(body, { creating }) {
  const row = {};
  if (creating) {
    const hotel_id = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
    if (!UUID_RE.test(hotel_id)) return { error: "valid hotel_id required" };
    row.hotel_id = hotel_id;
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

function validatePlacement(body, { creating }) {
  const row = {};
  if (creating) {
    const hotel_id = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
    if (!UUID_RE.test(hotel_id)) return { error: "valid hotel_id required" };
    row.hotel_id = hotel_id;
  }
  if (typeof body.name === "string" && body.name.trim()) {
    row.name = body.name.trim();
  } else if (creating) {
    return { error: "name required" };
  }
  if (typeof body.placement_type === "string") {
    if (!PLACEMENT_TYPES.has(body.placement_type)) {
      return { error: "invalid placement_type" };
    }
    row.placement_type = body.placement_type;
  } else if (creating) {
    return { error: "placement_type required" };
  }
  if (body.tour_slug === null) {
    row.tour_slug = null;
  } else if (typeof body.tour_slug === "string") {
    const slug = body.tour_slug.trim().toLowerCase();
    if (slug && !/^[a-z0-9-]{2,80}$/.test(slug)) {
      return { error: "tour_slug must be a lowercase URL path (letters, digits, hyphens)" };
    }
    row.tour_slug = slug || null;
  }
  if (typeof body.location_in_hotel === "string") {
    const loc = body.location_in_hotel.trim();
    row.location_in_hotel = loc || null;
  }
  if (body.deployed_at === null) {
    row.deployed_at = null;
  } else if (typeof body.deployed_at === "string" && body.deployed_at.trim()) {
    const t = Date.parse(body.deployed_at);
    if (Number.isNaN(t)) return { error: "deployed_at must be a valid date" };
    row.deployed_at = new Date(t).toISOString();
  }
  if (typeof body.status === "string") {
    if (!PLACEMENT_STATUSES.has(body.status)) {
      return { error: "status must be designed, printed, active, paused, or retired" };
    }
    row.status = body.status;
  } else if (creating) {
    // New placements start "designed" — the artwork exists but no
    // physical material has been deployed and no scan has happened
    // yet. The worker (syncClickCounts) auto-advances printed → active
    // on the first cached click; admins can advance manually in Edit.
    // Must be a member of PLACEMENT_STATUSES / the DB check constraint
    // (migration 0026 renamed the old 'pending' state to 'designed');
    // sending 'pending' here fails the check constraint and the create
    // returns an error.
    row.status = "designed";
  }
  // code and sequence_number are auto-managed by
  // insertPlacementWithSequence and locked thereafter — never accept
  // them from the client.
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
    placements:  Array.isArray(h.placements)  ? h.placements              : [],
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
  console.error("Bokun upstream error:", JSON.stringify({
    status: r.status,
    statusText: r.statusText,
    body: r.data,
    path: new URL(request.url).pathname,
  }));
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

// One-line structured log of every admin mutation. Captured by
// Cloudflare's tail logs (retained ~3 days on the paid plan, longer
// with Logpush). Cheap pre-launch substitute for a real audit_log
// table — enough to answer "who changed X" if a dispute lands.
// Replace with the audit_log table from Phase 8 once it exists.
// Append-only audit log for short_link mutations. Writes one row per
// field that actually changed so the Edit modal can render a clean
// timeline. Fire-and-forget — the mutation itself has already
// succeeded by the time we get here, so an audit-insert failure must
// not roll the change back.
async function recordShortLinkAudit(env, claims, shortLinkId, oldRow, newPatch) {
  if (!shortLinkId || !oldRow || !newPatch) return;
  const FIELDS = ["target_url", "label", "notes", "status"];
  const rows = [];
  for (const field of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(newPatch, field)) continue;
    const before = oldRow[field] ?? null;
    const after  = newPatch[field] ?? null;
    if (before === after) continue;
    rows.push({
      short_link_id: shortLinkId,
      actor_email:   claims?.email || null,
      actor_sub:     claims?.sub   || null,
      field,
      old_value:     before === null ? null : String(before),
      new_value:     after  === null ? null : String(after),
    });
  }
  if (!rows.length) return;
  try {
    await supabaseInsert(env, "short_link_audit", rows);
  } catch (err) {
    console.error("AUDIT_INSERT_FAILED", JSON.stringify({
      short_link_id: shortLinkId,
      error: err && err.message,
    }));
  }
}

function logMutation(request, claims, action, entityType, entityId, extra) {
  const entry = {
    audit:       true,
    at:          new Date().toISOString(),
    request_id:  request?.headers?.get("cf-ray") || null,
    actor_email: claims?.email || null,
    actor_sub:   claims?.sub   || null,
    action,
    entity_type: entityType,
    entity_id:   entityId || null,
  };
  if (extra && typeof extra === "object") Object.assign(entry, extra);
  console.log("MUTATION", JSON.stringify(entry));
}

function corsHeaders(request) {
  const origin = request?.headers?.get("Origin") || "";
  const allowed =
    ALLOWED_ORIGINS.includes(origin) ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.endsWith(".pages.dev");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
    Vary: "Origin",
  };
}
