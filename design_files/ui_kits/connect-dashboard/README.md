# Horizon Connect — Partner dashboard kit

The B2B product surface. Recreates the hotel-partner dashboard you'll see at `connect.gowithhorizon.com` after sign-in.

## Components

| File | What |
|---|---|
| `App.jsx` | Top-level wiring · demo data lifted from `partners.json` and the live dashboard |
| `Sidebar.jsx` | Left rail · brand mark, nav, hotel name, signed-in user |
| `Chrome.jsx` | Topbar (search + actions), `RangePicker`, `KPI` tile |
| `ChartPanel.jsx` | Commission-over-time area chart (pure SVG, violet ramp) |
| `BookingsTable.jsx` | Bookings table · tabular numerics + status pills + funnel hover |
| `ReferralLinks.jsx` | Referral-link card grid with a static QR analogue |
| `AccountModal.jsx` | Set-password modal (mirrors the live dashboard's flow) |
| `Icons.jsx` | Inlined Lucide subset · 1.75 stroke · `currentColor` |
| `dashboard.css` | Surface CSS — composes with `colors_and_type.css` |

## Source of truth

Built by reading `dashboard/hotel/index.html` and the `css_new/` tokens in the [horizon repo](https://github.com/ivanmueller/horizon). The QR component is a static visual analogue of the runtime `qr-code-styling` lib so the kit renders without a network dependency.

## Caveats

- Live dashboard auth is Supabase + magic-link. The kit shows the post-auth surface only — login / OTP / setup flows are not yet recreated.
- The chart is a single-series stub. Production may want multi-series (gross vs commission) or a stacked area for source breakdown.
- The bookings funnel expansion (per-row attribution detail) is hinted at by the row-click toast; the actual collapsing row isn't wired up here.
