// Short.io API client.
//
// Thin wrapper over Short.io's REST API. All calls are best-effort
// from the caller's perspective: this module surfaces real errors so
// the caller can decide whether to fail the parent operation or just
// log and continue.
//
// Configuration (env vars + secrets on the worker):
//   SHORT_IO_API_KEY   — secret, set via `wrangler secret put`
//   SHORT_IO_DOMAIN    — public var, defaults to 'link.gowithhorizon.com'
//
// API reference: https://developers.short.io
//
// IMPORTANT: Short.io's auth header is the raw API key with NO
// "Bearer " prefix. Don't be tempted to "fix" that — the request
// will 401 if you do.

const SHORT_IO_BASE = "https://api.short.io/links";
const SHORT_IO_STATS = "https://statistics.short.io/statistics/link";
const SHORT_IO_TIMEOUT_MS = 5000;

// Returns true when the worker has the secret configured. Callers
// use this to decide whether to attempt API calls at all — until the
// secret is set in production, we no-op gracefully instead of
// failing hotel/staff creation.
export function isShortIoConfigured(env) {
  return Boolean(env && env.SHORT_IO_API_KEY);
}

function shortIoDomain(env) {
  return (env && env.SHORT_IO_DOMAIN) || "link.gowithhorizon.com";
}

function headers(env) {
  return {
    "Content-Type": "application/json",
    accept: "application/json",
    // Short.io expects the raw key; no Bearer prefix.
    Authorization: env.SHORT_IO_API_KEY,
  };
}

// Wraps fetch with a hard 5-second timeout via AbortController.
// Without this, a Short.io latency spike would hold the worker request
// open until Cloudflare's 30-second wall-clock limit kills it, which
// manifests as a hanging admin UI with no error feedback.
async function shortIoFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHORT_IO_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new ShortIoError(
        408,
        null,
        `Short.io request timed out after ${SHORT_IO_TIMEOUT_MS}ms (${url})`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Throws ShortIoError on non-2xx. Caller decides whether to surface
// it (PATCH endpoint — admin needs to know) or swallow it (auto-create
// on hotel/staff insert — link creation is non-blocking).
class ShortIoError extends Error {
  constructor(status, body, message) {
    super(message);
    this.name = "ShortIoError";
    this.status = status;
    this.body = body;
  }
}

async function parseResponse(res, label) {
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
    const message =
      (data && typeof data === "object" && (data.error || data.message)) ||
      `Short.io ${label} → ${res.status}`;
    throw new ShortIoError(res.status, data, message);
  }
  return data;
}

// Create a Short.io link. Returns the full Short.io record.
//   {
//     id:            "lnk_abc123",          // Short.io's internal id
//     shortURL:      "https://link.gowithhorizon.com/x7k2-e0042",
//     originalURL:   "https://gowithhorizon.com/partners/...",
//     path:          "x7k2-e0042",
//     ...
//   }
//
// `path` is optional — omit it and Short.io auto-generates one. We
// always pass it so the short URL matches our convention.
export async function createShortLink(env, { path, originalURL, title }) {
  if (!isShortIoConfigured(env)) {
    throw new ShortIoError(500, null, "SHORT_IO_API_KEY not configured");
  }
  const body = {
    domain: shortIoDomain(env),
    originalURL,
    path,
  };
  if (title) body.title = title;
  const res = await shortIoFetch(SHORT_IO_BASE, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify(body),
  });
  return parseResponse(res, `POST ${SHORT_IO_BASE}`);
}

// Update an existing link's destination URL or title. Short.io uses
// POST (not PATCH) for updates — yes, it's unusual but that's their
// API. Pass only the fields you want to change.
export async function updateShortLink(env, shortIoId, patch) {
  if (!isShortIoConfigured(env)) {
    throw new ShortIoError(500, null, "SHORT_IO_API_KEY not configured");
  }
  const res = await shortIoFetch(`${SHORT_IO_BASE}/${encodeURIComponent(shortIoId)}`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify(patch),
  });
  return parseResponse(res, `POST ${SHORT_IO_BASE}/${shortIoId}`);
}

// Delete a link entirely from Short.io. WE DO NOT CALL THIS in the
// admin flows — retiring is soft (short_links.status = 'retired')
// so existing QR codes keep redirecting. This helper exists for the
// destructive "permanently remove" case which currently has no UI.
export async function deleteShortLink(env, shortIoId) {
  if (!isShortIoConfigured(env)) {
    throw new ShortIoError(500, null, "SHORT_IO_API_KEY not configured");
  }
  const res = await shortIoFetch(`${SHORT_IO_BASE}/${encodeURIComponent(shortIoId)}`, {
    method: "DELETE",
    headers: headers(env),
  });
  return parseResponse(res, `DELETE ${SHORT_IO_BASE}/${shortIoId}`);
}

// Click statistics for a single link. Used by the Phase 5 cron sync.
// `period` is one of: 'total', 'last24', 'last7', 'last30'.
export async function getLinkStats(env, shortIoId, period = "total") {
  if (!isShortIoConfigured(env)) {
    throw new ShortIoError(500, null, "SHORT_IO_API_KEY not configured");
  }
  const res = await shortIoFetch(
    `${SHORT_IO_STATS}/${encodeURIComponent(shortIoId)}?period=${encodeURIComponent(period)}`,
    { method: "GET", headers: headers(env) },
  );
  return parseResponse(res, `GET ${SHORT_IO_STATS}/${shortIoId}`);
}

// The tracking code IS the short-URL path: lowercase, hyphenated and
// URL-safe by construction (htl-7q4k9, htl-7q4k9-e001 — see
// PARTNERS_NAMING.md). There is no underscore↔hyphen translation
// any more; this returns the code verbatim (lowercased defensively)
// and exists only so call sites read intently and we keep a single
// normalisation choke point.
export function trackingCodeToShortPath(trackingCode) {
  if (typeof trackingCode !== "string" || !trackingCode) return null;
  return trackingCode.toLowerCase();
}

export { ShortIoError };
