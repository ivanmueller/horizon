// Host-aware routing for the Connect/admin subdomain split.
//
// One Pages project serves three custom domains:
//   gowithhorizon.com          → Horizon Tours (consumer site)
//   connect.gowithhorizon.com  → hotel partner portal + shared login
//   admin.gowithhorizon.com    → internal ops console (served at root)
//
// The deployment is identical on all three; this middleware is what
// makes each host show the right surface and bounces stragglers to the
// correct host. It runs before static assets.
//
// Admin host detail: the ops-console SPA file physically lives at
// /admin/index.html, but on admin.gowithhorizon.com we want clean
// root URLs (/short-links/, /hotels/<slug>/, …). So for any non-asset
// path on that host we hand back /admin/index.html and let the SPA
// route from window.location.pathname (it strips its own base). Real
// static assets (/js, /css, …, anything with a file extension) fall
// through to the CDN. Legacy /admin/* URLs 301 to their clean form.
//
// Safe to deploy before the apex cutover: the subdomain branches only
// fire for requests whose Host actually is that subdomain, and the
// apex→subdomain permanent redirects stay gated behind SUBDOMAINS_LIVE.

import { SUBDOMAINS_LIVE, CONNECT_ORIGIN, ADMIN_ORIGIN } from '../js/hosts.js';

const isAdminPath = (p) => p === '/admin' || p.startsWith('/admin/');
const isDashboardPath = (p) => p.startsWith('/dashboard/');

// /admin            → /
// /admin/           → /
// /admin/short-links/ → /short-links/
// /administrator    → /administrator   (not a prefix match — left alone)
function stripAdminPrefix(pathname) {
  const stripped = pathname.replace(/^\/admin(?=\/|$)/, '');
  return stripped === '' ? '/' : stripped;
}

const ASSET_PREFIXES = ['/legacy_css/', '/css_new/', '/js/', '/scripts/', '/images/'];
const isAsset = (p) =>
  ASSET_PREFIXES.some((a) => p.startsWith(a)) || /\.[a-z0-9]+$/i.test(p);

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const host = url.hostname;
  const tail = url.pathname + url.search;

  // ── Internal ops console host (served at root) ─────────────────────
  if (host === 'admin.gowithhorizon.com') {
    // Legacy prefixed URLs → clean rooted equivalents.
    if (isAdminPath(url.pathname)) {
      return Response.redirect(
        ADMIN_ORIGIN + stripAdminPrefix(url.pathname) + url.search,
        301,
      );
    }
    // Portal/login surfaces don't belong here — send them to Connect.
    if (isDashboardPath(url.pathname)) {
      return Response.redirect(CONNECT_ORIGIN + tail, 302);
    }
    // Real static assets serve normally.
    if (isAsset(url.pathname)) {
      return next();
    }
    // Everything else is an SPA route — hand back the console shell.
    return env.ASSETS.fetch(new URL('/admin/index.html', url.origin));
  }

  // ── Hotel partner portal host (served at root) ─────────────────────
  if (host === 'connect.gowithhorizon.com') {
    // The ops console doesn't belong here — send it to the admin host,
    // dropping the legacy /admin prefix so the user lands on the clean
    // rooted URL directly.
    if (isAdminPath(url.pathname)) {
      return Response.redirect(
        ADMIN_ORIGIN + stripAdminPrefix(url.pathname) + url.search,
        301,
      );
    }
    // Legacy /dashboard/<x>/ → clean rooted path. Query is preserved;
    // URL #fragments (magic-link #access_token=…) survive 3xx in the
    // browser automatically, so already-sent invite emails still work.
    const legacy = {
      '/dashboard/hotel': '/',      '/dashboard/hotel/': '/',
      '/dashboard/login': '/login/', '/dashboard/login/': '/login/',
      '/dashboard/setup': '/setup/', '/dashboard/setup/': '/setup/',
      '/dashboard/otp':   '/otp/',   '/dashboard/otp/':   '/otp/',
    };
    if (legacy[url.pathname]) {
      return Response.redirect(CONNECT_ORIGIN + legacy[url.pathname] + url.search, 301);
    }
    // Each clean path serves a single static shell. The portal (/) and
    // each auth page self-gate in their own JS (no session → /login/,
    // admins → the ops host), so no auth logic is needed here.
    const shell = {
      '/': '/dashboard/hotel/index.html',
      '/login': '/dashboard/login/index.html', '/login/': '/dashboard/login/index.html',
      '/setup': '/dashboard/setup/index.html', '/setup/': '/dashboard/setup/index.html',
      '/otp':   '/dashboard/otp/index.html',   '/otp/':   '/dashboard/otp/index.html',
    };
    if (shell[url.pathname]) {
      return env.ASSETS.fetch(new URL(shell[url.pathname], url.origin));
    }
    return next();
  }

  // ── Normalize tour URLs to lowercase ────────────────────────────────
  // QR codes, manual links, or search engines may use mixed-case tour
  // slugs; Cloudflare Pages is case-sensitive, so redirect to lowercase.
  if (url.pathname.startsWith('/tours/')) {
    const lower = url.pathname.toLowerCase();
    if (lower !== url.pathname) {
      return Response.redirect(url.origin + lower + url.search, 301);
    }
  }

  // ── Normalize rental URLs to lowercase ──────────────────────────────
  if (url.pathname.startsWith('/rentals/')) {
    const lower = url.pathname.toLowerCase();
    if (lower !== url.pathname) {
      return Response.redirect(url.origin + lower + url.search, 301);
    }
  }

  // ── Apex (Tours) — relocate Connect surfaces once subdomains live ──
  if (host === 'gowithhorizon.com' && SUBDOMAINS_LIVE) {
    if (isAdminPath(url.pathname)) {
      return Response.redirect(
        ADMIN_ORIGIN + stripAdminPrefix(url.pathname) + url.search,
        301,
      );
    }
    if (isDashboardPath(url.pathname)) {
      return Response.redirect(CONNECT_ORIGIN + tail, 301);
    }
  }

  return next();
}
