import { supabaseRequest, supabaseSelect, supabaseInsert, supabaseUpdate } from "./supabase.js";
import {
  createShortLink,
  getLinkStats,
  isShortIoConfigured,
  trackingCodeToShortPath,
  ShortIoError,
} from "./short-io.js";

export { supabaseRequest, supabaseSelect, supabaseInsert, supabaseUpdate };
export { createShortLink, getLinkStats, isShortIoConfigured, trackingCodeToShortPath, ShortIoError };

export const ALLOWED_ORIGIN = "https://gowithhorizon.com";
export const CURRENCY = "CAD";

export const TTL_PRODUCT = 3600; // 1h — product config rarely changes
export const TTL_PICKUP = 3600; // 1h — pickup places rarely change
export const TTL_AVAIL = 300; // 5min — overridable with ?fresh=1
export const TTL_BOOKING = 15 * 60; // 15min — checkout spot-hold window
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Manual cancellation/refund tracking — replaces the Bokun webhook we
// can't have on this account tier. PATCH /api/admin/bookings/<uuid>
// with body { status }. Status must be one of the four enum values
// the schema accepts.
export const ALLOWED_STATUSES = new Set(["confirmed", "cancelled", "refunded", "pending_refund"]);

export const HOTEL_FIELDS =
  "id,code,name,location,type,status,effective_date,default_tracking_code," +
  "tracking_prefix,commission_pct,kickback_pool_pct,notes,created_at,updated_at";
export const STAFF_FIELDS =
  "id,hotel_id,code,name,tracking_code,sequence_number,kickback_pct," +
  "status,created_at,updated_at";
export const MANAGER_FIELDS = "id,email,hotel_id,role,status,created_at,updated_at";

export const HOTEL_TYPES = new Set(["kickback", "pool"]);
export const HOTEL_LOCATIONS = new Set(["Banff", "Canmore"]);
export const HOTEL_STATUSES = new Set(["active", "terminated"]);
export const STAFF_STATUSES = new Set(["active", "terminated"]);
export const MANAGER_STATUSES = new Set(["active", "revoked"]);
// 60-char ceiling lets us hold full property names like
// "the-rimrock-resort-hotel-banff-springs" instead of forcing
// abbreviation. Slugs stay lowercase + hyphen + digit only.
export const SLUG_RE = /^[a-z0-9-]{2,60}$/;
export const TRACKING_CODE_RE = /^[A-Z0-9_]{2,40}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 4-char random alphanumeric, e.g. "X7K2". Omits I, O, 0, 1 so the
// printed prefix is never ambiguous on paper or read aloud. 32^4 ≈
// 1M combinations — collision probability stays negligible even at
// 10k+ hotels, and the UNIQUE constraint catches any that slip through.
export const PREFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PREFIX_LENGTH = 4;
export const TRACKING_PREFIX_RE = /^[A-HJ-NP-Z2-9]{4}$/;

export function generateTrackingPrefix() {
  let s = "";
  for (let i = 0; i < PREFIX_LENGTH; i++) {
    s += PREFIX_ALPHABET[Math.floor(Math.random() * PREFIX_ALPHABET.length)];
  }
  return s;
}

// Detect Postgres unique_violation (SQLSTATE 23505) in a PostgREST error
// body. PostgREST surfaces the code in err.body.code; older versions
// returned only a message, so we also pattern-match the text.
export function isUniqueViolation(err, columnHint) {
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
export async function mintShortLinkAndRecord(env, params, { throwOnError = false } = {}) {
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

// Build the long URL a short link should redirect to. Hotel master:
// /partners/<slug>/. Staff: append ?ref=<tracking_code> so the
// checkout flow attributes the booking to the employee.
export function hotelTargetUrl(env, hotelCode) {
  const base = (env.PUBLIC_SITE_BASE || "https://gowithhorizon.com").replace(/\/$/, "");
  return `${base}/partners/${encodeURIComponent(hotelCode)}/`;
}
export function staffTargetUrl(env, hotelCode, trackingCode) {
  return `${hotelTargetUrl(env, hotelCode)}?ref=${encodeURIComponent(trackingCode)}`;
}

// Hotel insert wrapper. Generates a unique tracking_prefix and seeds
// default_tracking_code from it. Retries on the (unlikely) prefix
// collision rather than surfacing a confusing duplicate-key error to
// the admin UI.
export async function insertHotelWithPrefix(env, row, maxAttempts = 8) {
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
      // does not roll back the hotel row. The error message is
      // bubbled out so the POST handler can surface it to the
      // admin — silent loss would leave a hotel with no QR.
      const { error: shortLinkWarning } = await mintShortLinkAndRecord(env, {
        shortPath: hotel.code,
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
// hotel (max + 1) and mints the tracking_code from
// {hotel.tracking_prefix}_E_{padded sequence}. The UNIQUE
// (hotel_id, sequence_number) index catches concurrent inserts;
// on collision we re-read max and try again.
export async function insertStaffWithSequence(env, row, maxAttempts = 5) {
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

export const SHORT_LINK_FIELDS =
  "id,short_io_id,domain,short_path,short_url,target_url,link_type," +
  "hotel_id,staff_id,label,notes,status,click_count_cached," +
  "last_clicked_at,created_at,updated_at";
export const SHORT_LINK_TYPES = new Set(["hotel", "staff", "campaign"]);
export const SHORT_LINK_STATUSES = new Set(["active", "retired"]);
// Short.io path constraints — alphanumeric plus the common
// separators. Conservative; tighten if you find Short.io rejecting
// edge cases.
export const SHORT_PATH_RE = /^[a-zA-Z0-9._-]{1,80}$/;

export function normaliseShortLink(s) {
  return s;
}

// ── Short.io click-count sync ──────────────────────────────────────────────
// Fetches total click counts from Short.io for every active short_link and
// writes them back to short_links.click_count_cached + last_clicked_at.
// Called by the scheduled cron (hourly) and by POST /api/admin/sync-clicks.
// Short.io rate limit: ~100 req/min — we process sequentially with no sleep
// since even 500 links takes well under 60s at Short.io's typical latency.
export async function syncClickCounts(env) {
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

// ── CRUD validators / normalisers ──────────────────────────────────────

export function validateHotel(body, { creating }) {
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

export function validateStaff(body, { creating }) {
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

export function normaliseHotel(h) {
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

export function normaliseStaff(s) {
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
export async function requireHorizonAdmin(request, env) {
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

export function round2(n) {
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

export async function fetchJwks(env) {
  const now = Date.now();
  if (jwksCache && now < jwksCacheExpiry) return jwksCache;
  if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL not configured");
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`jwks fetch ${res.status}`);
  jwksCache = await res.json();
  jwksCacheExpiry = now + JWKS_TTL_MS;
  return jwksCache;
}

export async function verifyJwt(token, env) {
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

export function base64UrlToBytes(s) {
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
export async function requireAuthenticated(request, env) {
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
export function parseTimeBound(s, mode) {
  if (typeof s !== "string" || !s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s))) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return mode === "start" ? `${s}T00:00:00.000Z` : `${s}T23:59:59.999Z`;
  }
  return null;
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return { __error: "Invalid JSON body" };
  }
}

export function passThroughError(r, request) {
  // Surface Bokun's status + body so the page can show useful errors.
  // The page is the only consumer and same-origin via this proxy, so
  // it's safe to expose Bokun's error shape during the build phase.
  return jsonResponse(
    { error: "upstream", status: r.status, statusText: r.statusText, body: r.data },
    502,
    request,
  );
}

export function jsonResponse(data, status, request) {
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
export function logMutation(request, claims, action, entityType, entityId, extra) {
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

export function corsHeaders(request) {
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

