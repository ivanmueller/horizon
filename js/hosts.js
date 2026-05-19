// Single source of truth for where each Horizon surface lives.
//
// Imported by both the browser (auth pages, to build cross-host
// redirect targets) and the Pages middleware (functions/_middleware.js,
// to route by hostname). Contains no browser-only globals so it is safe
// to import in a Cloudflare Pages Function.
//
// ── Cutover switch ──────────────────────────────────────────────────
// SUBDOMAINS_LIVE stays `false` until BOTH are true:
//   1. connect.gowithhorizon.com + admin.gowithhorizon.com are added as
//      custom domains on the Pages project and resolve.
//   2. Those origins are in the Supabase Auth Site URL / Redirect URLs.
// Flipped true at cutover (2026-05-19): connect./admin. are live Pages
// custom domains and in Supabase's allowlist. The apex now permanently
// 301s /admin/* and /dashboard/* to the subdomains and client redirects
// emit absolute cross-host URLs. Rollback = set back to `false`.
export const SUBDOMAINS_LIVE = true;

export const APEX_ORIGIN    = 'https://gowithhorizon.com';
export const CONNECT_ORIGIN = 'https://connect.gowithhorizon.com';
export const ADMIN_ORIGIN   = 'https://admin.gowithhorizon.com';

// Hotel partner portal + the shared login/setup/otp surfaces.
export function connectUrl(path) {
  return (SUBDOMAINS_LIVE ? CONNECT_ORIGIN : '') + path;
}

// Internal Horizon ops console.
export function adminUrl(path) {
  return (SUBDOMAINS_LIVE ? ADMIN_ORIGIN : '') + path;
}
