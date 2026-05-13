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
  const res = await fetch(SHORT_IO_BASE, {
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
  const res = await fetch(`${SHORT_IO_BASE}/${encodeURIComponent(shortIoId)}`, {
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
  const res = await fetch(`${SHORT_IO_BASE}/${encodeURIComponent(shortIoId)}`, {
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
  const res = await fetch(
    `${SHORT_IO_STATS}/${encodeURIComponent(shortIoId)}?period=${encodeURIComponent(period)}`,
    { method: "GET", headers: headers(env) },
  );
  return parseResponse(res, `GET ${SHORT_IO_STATS}/${shortIoId}`);
}

// Lower-case + hyphen-normalise a tracking code into a short URL
// path. e.g. "X7K2_E_0042" → "x7k2-e0042". Drops the separator
// underscore between {prefix}_{type}_{seq} because the result reads
// better as a short URL: "x7k2-e0042" vs "x7k2-e-0042".
export function trackingCodeToShortPath(trackingCode) {
  if (typeof trackingCode !== "string") return null;
  const parts = trackingCode.toLowerCase().split("_");
  if (parts.length < 2) return null;
  // Hotel format:  prefix_h         → prefix-h
  // Staff format:  prefix_e_NNNN    → prefix-eNNNN
  if (parts.length === 2) return `${parts[0]}-${parts[1]}`;
  return `${parts[0]}-${parts[1]}${parts[2]}`;
}

export { ShortIoError };
