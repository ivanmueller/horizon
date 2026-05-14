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

import { syncClickCounts, corsHeaders, jsonResponse } from "./shared.js";
import {
  handleProduct,
  handlePickupPlaces,
  handleAvailability,
  handleCheckoutOptions,
  handleCheckoutSubmit,
  handleBookingInitiate,
  handleBookingState,
  handleStripeSetupIntent,
} from "./handlers-public.js";
import {
  handleDashboardRecord,
  handleDashboardBookings,
  handleDashboardHotelLinks,
  handleAuthPreflight,
  handleAuthMarkPasswordSet,
  handleAuthAccessRequest,
} from "./handlers-dashboard.js";
import {
  handleAdminSummary,
  handleAdminBookingPatch,
  handleAdminHotelsList,
  handleAdminHotelCreate,
  handleAdminHotelUpdate,
  handleAdminHotelTerminate,
  handleAdminStaffCreate,
  handleAdminStaffUpdate,
  handleAdminStaffTerminate,
  handleAdminHotelUserCreate,
  handleAdminHotelUserUpdate,
  handleAdminHotelShortLinksList,
  handleAdminShortLinkCreate,
  handleAdminShortLinkUpdate,
  handleAdminShortLinkRetire,
  handleAdminGlobalShortLinks,
  handleAdminSyncClicks,
  handleAdminRepublish,
  handleAdminAccessRequestsList,
  handleAdminAccessRequestReview,
} from "./handlers-admin.js";

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
        if (request.method === "GET"  && !segs[3]) return await handleAdminGlobalShortLinks(url, env, request);
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
