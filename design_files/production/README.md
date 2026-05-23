# Production drop-in bundle for horizon repo

This folder is a **staging mirror** of files that go directly into the
[`ivanmueller/horizon`](https://github.com/ivanmueller/horizon) repo. The
folder layout under `production/` matches the destination layout in the
horizon repo 1:1 — copy a file from here, paste it at the same path there.

## What's in here

```
production/
├── README.md                                ← you are here
├── css_new/                                 → copy to horizon/css_new/
│   ├── horizon-connect-tokens.css           (v1.3 — Horizon Blue #4F5BFF anchor)
│   ├── horizon-connect-responsive.css       (breakpoints, fluid type)
│   ├── horizon-connect-components.css       (reusable component primitives)
│   ├── horizon-tours-tokens.css             (Tours theme — Sunset #FF8A3D)
│   └── dashboard-hotel.css                  (page styles for the partner dashboard)
└── dashboard-hotel-index.html               → copy to horizon/dashboard/hotel/index.html
```

## What changed in this bundle (Option B — full UI Kit migration)

The previous bundle (Option A) was a token swap on the existing minimal
partner dashboard. This bundle ships the **full v1.3 Connect Dashboard
UI Kit** chrome:

| Surface | Before (legacy) | After (v1.3 UI Kit) |
|---|---|---|
| **Topbar** | None — just a logo header | Sticky hero topbar with search input (480px cap, ⌘K), help/notifications/settings icon row, **Setup-guide pill** (5-checkpoint progress ring), and primary "+ New referral link" CTA |
| **Page header** | Logo + hotel name in the corner | `<h1>` "Overview" + subtitle ("Bookings, payouts, and referral links for &lt;hotel&gt;") + Refresh / Account / Sign out actions aligned right |
| **KPI tiles** | 4 plain number tiles | 4 tiles each with an icon (calendar / receipt / users / dollar), tabular-num values, descriptive sub-line, soft `shadow-e1` |
| **Chart** | None | Commission-earned area chart — pure SVG, no chart lib; groups booking records by calendar day; auto-hides when there's no data |
| **Bookings table** | 9 cols, no status | 10 cols with a new **Status pill** column (Confirmed / Pending / Refunded / Cancelled / Failed mapping); guest cell now shows an avatar + initials; row-hover tints blue; card head has Filter + Export CSV buttons (placeholders for now) |
| **Source funnel** | Same expandable detail rows | Preserved verbatim — same delegated click handler, same `hd-funnel-*` markup |
| **Referral links** | Plain grid of QR cards | Same backend, now uses kit's `.link-card` styling with dashed-border QR plate, blue brand mark, copy + download buttons that fire toast confirmations |
| **Account modal** | Inline-styled, coral focus ring | Uses the kit's `.modal` / `.field` patterns + token-driven focus ring; on save, fires a `flashToast('Password saved.')` and auto-closes |
| **Toast system** | None — text swaps in place | New `flashToast(msg)` helper. Wired to copy URL, save password, download QR, and every placeholder action. Auto-dismisses in 2.2s |
| **Setup pill** | None | 5 checkpoints, computed client-side from session + hotelRecord + localStorage: account exists, hotel linked, password set, has ≥1 referral link, commission_pct configured. Auto-hides at 5/5 |

### Sidebar — intentionally NOT in this build

Per `CLAUDE.md` v1.3 ("Canonical chrome patterns → Sidebar (admin only)"),
the partner dashboard does **not** get a sidebar. The Connect Dashboard
UI Kit demo file shows sidebar+topbar together because it's a comprehensive
kit showcase; the partner-facing route only carries the hero topbar.

### What's still placeholder (frontend-only for now)

- **Search input** — focusable via ⌘K, submits a "Search — coming soon" toast on Enter. No backend yet.
- **Help / Notifications / Settings icons** — each fires a toast. Settings is wired to open the account modal as a sensible default.
- **"+ New referral link" CTA** — toast placeholder. Needs a creation flow + a write endpoint on the Bokun worker.
- **Filter / Export CSV** in the bookings table — toast placeholders. CSV export should be straightforward (client-side from `latestRecords`); filter needs UX work.
- **Setup pill** — clicking it fires a "Setup guide — coming soon" toast. The progress is real; the destination page isn't built yet.

Each placeholder is a `placeholderToast(...)` call in the JS — easy to find and replace when the backend endpoint or destination page exists.

### Behaviour preserved (zero regressions)

- Supabase auth gate (`getSession`, `signOut`, `updateUser`, admin redirect)
- RLS-scoped queries (`horizon_admins`, `hotel_users`, `hotels`)
- `/partners.json` fetch + hotel-record resolution
- Bokun Worker calls (`BOKUN_API_BASE`, `/api/dashboard/bookings`, `/api/dashboard/hotel-links`)
- Cookie storage (`/js/supabase-cookie-storage.js`)
- Hosts helper (`/js/hosts.js`)
- QR library pin (`qr-code-styling@1.5.0`)
- All DOM ids the inline script references (`hdHotelName`, `hdKpiGrid`, `hdBookings`, `hdRevenue`, `hdTravelers`, `hdCommission`, `hdTableBody`, `hdEmpty`, `hdError`, `hdRefresh`, `hdSignout`, `hdAccount`, `hdHeaderActions`, `hdAccountModal` + sub-IDs, `hdLinksSection`, `hdLinksGrid`, range buttons via `[data-range]`, `hdBrandLetter`)
- All class hooks the script adds/removes (`.hd-skeleton`, `.hd-range__btn--active`, `.hd-funnel-*`, `.hd-copy-url`, etc.)
- All `data-*` attrs the script reads (`data-range`, `data-funnel`, `data-copy`, `data-dl-url`, `data-dl-name`)

## How to deploy (one-time, ~5 minutes)

> Do these in order. The HTML file references the v1.3 tokens + the new
> `dashboard-hotel.css` — if you deploy the HTML before syncing `css_new/`,
> you'll get a half-styled page because the existing `css_new/` is still
> on v1.0 and `dashboard-hotel.css` doesn't exist there yet.

**1. Sync `css_new/` first.** In your local clone of the horizon repo:

```sh
# from horizon repo root, with this project at ../horizon-design-system
cp ../horizon-design-system/production/css_new/*.css css_new/
git add css_new/
git diff --cached css_new/
```

You should see:
- `horizon-connect-tokens.css` — violet ramp → blue ramp; primary anchor `#5B2DE8` → `#4F5BFF`
- `horizon-connect-responsive.css`, `horizon-connect-components.css`, `horizon-tours-tokens.css` — token renames
- A **new** file `dashboard-hotel.css` — page styles for the partner dashboard

Commit and push `css_new/` first. Because no existing page references the
new file yet (and the renamed tokens only fire when a page imports them),
this commit has **zero user-facing impact** on production. It's a safe,
reversible first step.

**2. Replace the partner dashboard.** Same clone:

```sh
cp ../horizon-design-system/production/dashboard-hotel-index.html \
   dashboard/hotel/index.html
git add dashboard/hotel/index.html
git diff --cached dashboard/hotel/index.html
```

The diff is large because the chrome is rebuilt (topbar, page header
pattern, chart, status pills). But the inline `<script type="module">`
preserves every backend call.

**3. Push to a preview branch first, validate on Cloudflare Pages.**

```sh
git checkout -b design-system-v1.3-dashboard
git commit -m "design-system: v1.3 full UI Kit on partner dashboard"
git push origin design-system-v1.3-dashboard
```

Open the auto-generated Pages preview URL. Sign in with a test partner
account. Confirm:

- [ ] Topbar renders with brand mark + search + icon row + primary CTA
- [ ] Setup-guide pill shows N/5 progress and matches your account state
- [ ] Page header shows "Overview" + "Bookings, payouts, and referral links for &lt;hotel-name&gt;"
- [ ] Refresh / Account / Sign out buttons all work
- [ ] Range buttons (7/30/90/All) trigger a re-fetch and update the active state
- [ ] KPIs populate; tile icons render
- [ ] Commission chart renders if there are bookings; auto-hides otherwise
- [ ] Bookings table populates with status pills (default "Confirmed")
- [ ] Guest cells show avatar + initials
- [ ] Source cell expands a funnel-detail row on click
- [ ] Referral-link cards render QR codes in Horizon Blue
- [ ] Copy + download buttons fire toast confirmations
- [ ] Account modal opens, saves a password, fires a "Password saved." toast
- [ ] No console errors
- [ ] At 640px viewport, the layout collapses cleanly (controls stack, table scrolls horizontally)

**4. Merge to `main`** when the preview looks right. Tag `pre-v1.3-dashboard` before merging so you have a named rollback point.

## Reverting

Three independent revert paths (any one works):

1. **Before merge:** just don't merge the PR. Zero production impact.
2. **After merge:** `git revert <commit-sha>` on `main`, push. Cloudflare Pages redeploys within ~60s.
3. **Emergency:** Cloudflare Pages dashboard → Deployments → "Rollback to this deployment" on the last green pre-v1.3 deploy. Then back-fill with a git revert.

The `css_new/` sync (step 1) and the dashboard swap (step 2) are
independently revertible because no production page references the new
files until step 2 lands.

## Source-of-truth chain

```
Horizon Connect Design System project (this repo)
  └── horizon-source/*.css         ── canonical tokens
                                    ↓ (copy)
  └── production/css_new/*         ── staging mirror, layout matches horizon repo
                                    ↓ (cp + git push)
  └── horizon/css_new/*            ── production tokens
                                    ↑
  └── production/*.html            ── staging mirror of refactored pages
                                    ↓ (cp + git push)
  └── horizon/<route>/*.html       ── production HTML
```

For every new page migration: build the visual in `ui_kits/` first,
generate the matching `production/<page>.html` preserving the existing
DOM contract, copy across, deploy.

## Pages migrated so far

| UI Kit (source of truth) | Production HTML | Horizon repo destination |
|---|---|---|
| `ui_kits/connect-dashboard/` (full kit) | `production/dashboard-hotel-index.html` + `production/css_new/dashboard-hotel.css` | `dashboard/hotel/index.html` + `css_new/dashboard-hotel.css` |

## Next candidates

| Horizon repo file | Current size | Notes |
|---|---|---|
| `admin/index.html` | 489 KB | Huge single file — recommend splitting `<style>` + `<script>` into sibling `admin.css` / `admin.js` as part of the migration. Maps to `ui_kits/connect-admin/`. |
| `dashboard/login/index.html` | — | Login page; small. Should match admin/dashboard branding. |
| `dashboard/otp/index.html` | — | OTP entry; small. |
| `dashboard/setup/index.html` | — | Post-magic-link password setup; small. |
| `index.html` (root) | 32 KB | Tours marketing home — maps to `ui_kits/tours-marketing/`. |
| `tours/<each-tour>/index.html` | — | Individual tour pages. |
| `about/`, `contact/`, `checkout/`, `blog/`, `booking-confirmed/` | — | Marketing + funnel chrome. |
