# Adding a new partner

Walkthrough for onboarding a new hotel referral partner end to end.
Covers both cases:

- **Pool** — property-level commission, no individual staff cuts. The
  hotel itself gets a single percentage on every booking attributed to
  it. (Example: The Post Hotel, 12%.)
- **Kickback** — property-level commission *plus* a per-employee cut on
  top, so individual concierge staff get paid for sending guests our
  way. (Example: Fairmont Chateau Lake Louise — 10% to the property,
  plus 5% to Jane Smith on her own bookings.)

The mechanical work is the same for both. The only difference is how
many rows you add to `partners.json`.

## How attribution actually works

A guest clicks a link the hotel gave them — say
`gowithhorizon.com/?ref=FAIRMONT_LL_JS`. The page captures that `ref`
through the booking flow and forwards it to the worker as
`tracking_code` when the booking confirms. The worker matches that
slug against `hotel_staff.tracking_code`, populates `staff_id` on the
booking row, and Supabase becomes the source of truth for who gets
credited.

For walk-ins (`?hotel=fairmont-ll`, no employee in the URL), the
hotel-level slug (`hotels.default_tracking_code`, e.g. `FAIRMONT_LL`)
gets sent. It doesn't match any `hotel_staff` row, so `staff_id`
stays null — the booking is attributed to the hotel pool.

The slugs are all you need to keep aligned, in two places:

1. The link the hotel hands out — `?ref=FAIRMONT_LL_JS` (or
   `?hotel=fairmont-ll` for walk-ins).
2. `partners.json` — the matching `tracking_code` on a hotel_staff
   entry, or `default_tracking_code` on the hotel.

The naming convention in [`PARTNERS_NAMING.md`](./PARTNERS_NAMING.md)
keeps that mechanical: the lowercase hyphenated `code` deterministically
becomes the UPPERCASE underscored `tracking_code`.

> Bokun's own referral-tracking system isn't in the loop. We used to
> create Bokun referral entries and forward the resulting hex tracking
> code on every booking, but Bokun's matching wasn't reliable on our
> account tier and we now run commission tracking entirely off
> Supabase. The `scripts/bokun/sync-partners.mjs` script still works
> if you want to keep Bokun's records in sync for non-attribution
> reasons, but it's no longer required for onboarding.

## Workflow — pool hotel (no per-employee kickbacks)

### Step 1 — add the row to `partners.json`

```json
{
  "code": "moraine-lodge",
  "name": "Moraine Lake Lodge",
  "type": "pool",
  "status": "active",
  "effective_date": "2026-06-01",
  "default_tracking_code": "MORAINE_LODGE",
  "commission_pct": 12,
  "kickback_pool_pct": null,
  "employees": [],
  "notes": "Property-level pool, no individual kickbacks"
}
```

Key fields:

- `code`: lowercase, hyphenated, short. Never reused.
- `type`: `"pool"`.
- `default_tracking_code`: must be `code.toUpperCase().replace(/-/g, "_")`.
  The existing tooling will reject anything else.
- `commission_pct`: the property's percentage on each booking.
- `employees`: empty array.
- `kickback_pool_pct`: only fill this in if the property splits the
  pool internally and you've agreed on a number. Otherwise leave
  `null`.

PR, review, merge.

### Step 2 — push the new partner into Supabase

```sh
node --env-file=scripts/supabase/.env scripts/supabase/seed-partners.mjs
```

The seed is idempotent — it upserts the new row and leaves existing
hotels untouched. Verify in the Supabase Table Editor that the new
hotel appears in `hotels` with the right `default_tracking_code`.

That's it. The hotel is live: walk-in bookings via
`?hotel=moraine-lodge` will record under the hotel pool, and the
`/dashboard/hotel/?hotel=moraine-lodge` partner dashboard plus the
internal `/dashboard/horizon/` admin will show their bookings as they
come in.

## Workflow — kickback hotel (with per-employee commissions)

### Step 1 — add the rows to `partners.json`

```json
{
  "code": "deer-lodge",
  "name": "Deer Lodge",
  "type": "kickback",
  "status": "active",
  "effective_date": "2026-06-15",
  "default_tracking_code": "DEER_LODGE",
  "commission_pct": 10,
  "kickback_pool_pct": null,
  "employees": [
    {
      "code": "deer-lodge-mt",
      "name": "Mary Taylor",
      "tracking_code": "DEER_LODGE_MT",
      "kickback_pct": 5,
      "status": "active"
    },
    {
      "code": "deer-lodge-bp",
      "name": "Bob Park",
      "tracking_code": "DEER_LODGE_BP",
      "kickback_pct": 5,
      "status": "active"
    }
  ],
  "notes": "Concierge desk, 2 active staff at signing"
}
```

Differences from pool:

- `type`: `"kickback"`.
- `employees`: one object per individual on the kickback program. Each
  needs its own `code`, `name`, `tracking_code`, and `kickback_pct`.
- Employee codes follow the format `[hotelcode]-[initials]` and the
  tracking code derives from the code the same way as the hotel:
  `deer-lodge-mt` → `DEER_LODGE_MT`.

PR, review, merge.

### Step 2 — push the new partner into Supabase

```sh
node --env-file=scripts/supabase/.env scripts/supabase/seed-partners.mjs
```

The seed will upsert the new hotel plus both employees. Verify in the
Supabase Table Editor:

- `hotels` shows the new row.
- `hotel_staff` shows both employees, each with their own
  `tracking_code` and `hotel_id` matching the new hotel.

End-to-end: a booking tagged `DEER_LODGE_MT` (via the URL flow) will
land in the `bookings` table with `staff_id` resolved to Mary Taylor's
row, and the in-dashboard invoice for Deer Lodge will break out her
kickback under the kickback breakdown table.

## Adding employees to an existing kickback hotel

When new staff join a hotel that already has a kickback deal:

1. Append a new object to that hotel's `employees` array in
   `partners.json`. Don't touch the hotel-level fields. PR, merge.
2. Run the Supabase seed:
   ```sh
   node --env-file=scripts/supabase/.env scripts/supabase/seed-partners.mjs
   ```
   The new staff row appears in `hotel_staff` linked to the existing
   hotel's `id`.

## When a partner or employee leaves

Don't delete rows from `partners.json` — codes never get reused (see
`PARTNERS_NAMING.md`). Instead:

1. Flip `status` from `"active"` to `"terminated"` in `partners.json`.
   PR, merge.
2. Run the Supabase seed. The status update propagates via upsert.
   Existing bookings stay attached — Supabase doesn't cascade-delete
   rows just because a hotel or staff status changes — so historical
   reporting and back-dated invoices survive.

## Common mistakes

- **Tracking-code mismatch.** Make sure `default_tracking_code` on a
  hotel and `tracking_code` on each employee follow the
  uppercase-with-underscores derivation from the lowercase-with-hyphens
  `code`. The worker's slug-based attribution depends on this exact
  match — a typo in `partners.json` means bookings silently go to the
  hotel pool instead of the right employee.
- **Reusing a `code`.** Don't. If a hotel terminates and re-signs
  later under different terms, give it a new `code` (e.g.
  `fairmont-ll-2`). The old row stays as `terminated`.
- **Forgetting to run the Supabase seed after merging.** Symptom:
  Bokun records the booking and the worker tries to insert it, but
  the hotel slug doesn't exist in `hotels` so the insert returns
  `unknown hotel slug`. The booking is fine in Bokun but missing from
  the dashboard until you seed.
