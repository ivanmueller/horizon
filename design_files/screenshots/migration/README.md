# Migration screenshots

Visual reference for the design system v1.2 patch. Each PNG captures
the surface as it appears in the kit so engineers can match what they
build against an authoritative target.

## Surfaces

| File | Surface | Use during migration |
|---|---|---|
| `tokens-brand-anchors.png` | Five immutable brand colours | Confirm violet anchor swap landed (Horizon Violet should read brighter) |
| `tokens-violet-ramp.png` | Full 9-stop violet ramp with `500` flagged as the new anchor | Verify CTAs read at `violet-500`, hover at `-600`, pressed at `-700` |
| `components-buttons.png` | Primary / Secondary / Destructive / Ghost / Small button row | Sanity-check every interactive state pulls the new violet |
| `admin-home.png` | Admin Home — KPIs + top hotels + activity feed | Confirm hero topbar (search + icon row + primary `+`), no breadcrumb, no page title in topbar |
| `admin-hotels-list.png` | Hotels list — filter chips + table | Same chrome rules + confirm hotel-row avatars use `--bg-muted` grey |
| `admin-hotel-detail.png` | Full-page hotel detail | Header + 4-up hero strip + 9 main-column sections + 5 sidebar cards; right rail scrolls with main column |
| `admin-bookings.png` | Bookings page with expanded funnel row | No Customer column; status pill sits inline with Amount; statcards above filter chips |
| `partner-dashboard.png` | Connect partner (hotel-facing) dashboard | Setup-guide pill sits in the topbar between settings and primary CTA |

## How to use during migration

After each migration branch lands, open the corresponding surface in
your dev environment and compare side-by-side with the PNG. The
canonical points to verify are listed in the table above.

If the surface drifts more than a token-difference from the PNG, the
migration is incomplete — check the patch's verification checklist
for that branch before flipping to the next.

*Captured against the design system on May 21, 2026 at 1440 × ~1100.*
