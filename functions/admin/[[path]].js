// Pages Function — SPA shell for /admin/*.
//
// The admin dashboard is a single-page app: one HTML file at
// /admin/index.html, JS routes between views by reading
// window.location.pathname. We need every /admin/<route>/ URL
// to serve that file so refreshes don't 404.
//
// The obvious _redirects rule — `/admin/*  /admin/index.html  200`
// — gets dropped by Cloudflare's loop detector ("destination
// /admin/index.html canonicalises to /admin/, which matches the
// source /admin/*"). Worse, the trailing-slash workaround
// (`/admin/hotels/  /admin/index.html  200`) is also rejected.
// See the build log warnings under "Found invalid redirect lines"
// — CF accepts the no-trailing-slash variants but the SPA only
// ever pushes trailing-slash paths, so the accepted rules don't
// help in practice.
//
// A Pages Function bypasses the redirect engine entirely. The
// catch-all route `[[path]].js` matches /admin/, /admin/hotels/,
// /admin/bookings/, etc.; we just hand back the static admin
// shell for any of them. The shell's own JS reads pathname and
// renders the right view.
//
// Static assets take priority over functions inside the same
// path only when the file actually exists — admin/index.html
// continues to be served straight from the CDN, no function
// invocation, since that file is on disk. The function only
// runs for paths that don't have a file.

export async function onRequest(context) {
  const url = new URL(context.request.url);
  return context.env.ASSETS.fetch(new URL('/admin/index.html', url.origin));
}
