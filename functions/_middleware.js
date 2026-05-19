// Host-aware routing for the Connect/admin subdomain split.
//
// One Pages project serves three custom domains:
//   gowithhorizon.com          → Horizon Tours (consumer site)
//   connect.gowithhorizon.com  → hotel partner portal + shared login
//   admin.gowithhorizon.com    → internal ops console
//
// The deployment is identical on all three; this middleware is what
// makes each host show the right surface and bounces stragglers to the
// correct host. It runs before static assets and before
// functions/admin/[[path]].js.
//
// Safe to deploy before DNS exists: the subdomain branches only fire
// for requests whose Host actually is that subdomain (impossible until
// the custom domain resolves), and the apex→subdomain permanent
// redirects are gated behind SUBDOMAINS_LIVE. Until cutover this is
// effectively a pass-through.

import { SUBDOMAINS_LIVE, CONNECT_ORIGIN, ADMIN_ORIGIN } from '../js/hosts.js';

const isAdminPath = (p) => p === '/admin' || p.startsWith('/admin/');
const isDashboardPath = (p) => p.startsWith('/dashboard/');

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const host = url.hostname;
  const tail = url.pathname + url.search;

  // ── Internal ops console host ──────────────────────────────────────
  if (host === 'admin.gowithhorizon.com') {
    if (url.pathname === '/') {
      return Response.redirect(ADMIN_ORIGIN + '/admin/', 302);
    }
    // Portal/login surfaces don't belong here — send them to Connect.
    if (isDashboardPath(url.pathname)) {
      return Response.redirect(CONNECT_ORIGIN + tail, 302);
    }
    // /admin/* falls through to the static shell / SPA-shell function.
    return next();
  }

  // ── Hotel partner portal host ──────────────────────────────────────
  if (host === 'connect.gowithhorizon.com') {
    if (url.pathname === '/') {
      return Response.redirect(CONNECT_ORIGIN + '/dashboard/login/', 302);
    }
    // The ops console doesn't belong here — send it to the admin host.
    if (isAdminPath(url.pathname)) {
      return Response.redirect(ADMIN_ORIGIN + tail, 301);
    }
    return next();
  }

  // ── Apex (Tours) — relocate Connect surfaces once subdomains live ──
  if (host === 'gowithhorizon.com' && SUBDOMAINS_LIVE) {
    if (isAdminPath(url.pathname)) {
      return Response.redirect(ADMIN_ORIGIN + tail, 301);
    }
    if (isDashboardPath(url.pathname)) {
      return Response.redirect(CONNECT_ORIGIN + tail, 301);
    }
  }

  return next();
}
