# Horizon Connect — Admin kit

The **internal** admin console — what Horizon staff (not hotels) use to manage the partner network. Matches the chrome of `admin.gowithhorizon.com` in the upstream repo.

## Components

| File | What |
|---|---|
| `App.jsx` | Top-level routing · `home` / `hotels` / `hotel-detail` |
| `Sidebar.jsx` | Workspace switcher (button → dropdown) + nav with Main / Finance sections + Access-requests badge |
| `Chrome.jsx` | `Topbar` (breadcrumb + title + actions) + `KPI` tile |
| `OverviewPage.jsx` | Home: cross-portfolio KPIs + top-hotels leaderboard + activity feed |
| `HotelsPage.jsx` | Hotels list · filter chips (status, location) + clickable rows |
| `HotelDetailPage.jsx` | **Full-page** hotel detail (not a drawer) — header, hero metric strip, two-column body |
| `HotelSections.jsx` | The 9 main-column sections — Placements, Managers, Employees, Bookings, Invoices, Payments, Recent activity, Sent emails, Events |
| `HotelSidebar.jsx` | The 5 sidebar cards — Notes, Setup guide, Details, Banking, Commission structure |
| `Icons.jsx` | Inlined Lucide subset · 1.75 stroke · `currentColor` |
| `admin.css` | Surface CSS — composes with `colors_and_type.css` |

## Hotel detail page

Click any row on the Hotels list → full-page navigation to the hotel's detail surface (replaces the earlier slide-in drawer). Layout matches the production admin one-for-one:

**Header** — back link · hotel name + status pill · master referral URL with copy dropdown · `Send email` / `+ Add employee` / `⋯` actions.

**4-up hero metric strip** — Total commission · Bookings · Conversion rate · Pending payout. The four metrics the user named directly.

**Main column** (9 sections, top-to-bottom):
1. **Placements** — lobby kiosk, in-room QR, concierge cards, campaign codes
2. **Managers** — owners + invited admins, with role and last-sign-in
3. **Employees** — staff table with kickback %, bookings, commission
4. **Bookings** — recent bookings for this hotel
5. **Invoices** — generated invoices with PDF download
6. **Payments** — payments received via Stripe
7. **Recent activity** — combined feed of notes + system events
8. **Sent emails** — outbound transactional email log
9. **Events** — raw audit log (events + actor + payload)

**Sidebar** (sticky right column, 5 cards):
- **Notes** — yellow sticky-note panel
- **Setup guide** — checklist with progress bar (3 / 5 done)
- **Details** — Hotel ID / Address / Phone / Primary contact / Website / Onboarded · "Show more" reveals slug / property type / star rating / rooms / country
- **Banking** — accordion · Stripe Connect account, bank, currency
- **Commission structure** — segmented bar (Tour operator / Hotel / Platform) with percentages

## Real data used

Hotel names, locations, and room counts pull from `partners/hotel-data.js` in the repo. Bookings, commission, status, and detail-page numbers are demo values; the detail-page chrome (sections, sidebar cards) mirrors `renderHotelDetail()` at line 4941 of `horizon-source/admin-index.html`.

## Patterns the kit demonstrates

- **Workspace switcher** as a dropdown anchored to the sidebar's top button.
- **Full-page detail navigation** — clicking a hotel row navigates rather than drawer-popping. Breadcrumb in the topbar reflects `Horizon admin / Hotels / <hotel>`.
- **Sub-page layout** — 4-up hero strip + two-column body (sections + sidebar). The sidebar is sticky and scrolls with the page.
- **Filter chips** styled with `chip__k` (key) + `chip__v` (value) — the Stripe-style filter rail.
- **Status pill set** for `active / pending / paused / suspended / invited`.

## Caveats

- The other admin routes (Bookings, Short links, Access requests, Tour catalog, Payments, Billing, Invoices) currently render a placeholder card pointing back at the canonical pattern. Each of the detail-page sections (Placements, Employees, etc.) generalises into a standalone page when needed.
- The master referral URL dropdown collapses to a single `▾` button — the upstream version expands to a menu with QR preview and download options. Lift from `hd-refurl__menu` in the source when needed.
- "Add" buttons (`+` on Placements / Managers / etc., `+ Add employee` in the header) are visible but don't open modals — the upstream `staffModal`, `mgrModal`, `plCreateModal`, `slCreateModal` patterns are documented in `horizon-source/admin-index.html` and can be lifted.
