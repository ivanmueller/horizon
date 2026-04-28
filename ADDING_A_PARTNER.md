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
many rows you add to `partners.json` and how many entries you create
in Bokun.

## How attribution actually works

A guest clicks a link the hotel gave them — say
`gowithhorizon.com/?ref=FAIRMONT_LL_JS`. Our short.io redirect carries
that `ref` into the booking flow as a Bokun `trackingCode`. When the
booking is created, Bokun looks up the tracking code against its
**Settings → Referral tracking** registry; if the *Identification
number* on a referral matches, the booking is attributed to that
referral and the configured commission applies.

That's the Bokun side. There's also a Supabase side: every confirmed
booking is also written to the `bookings` table so the hotel-manager
dashboard can show it. The worker resolves the booking's `staff_id`
by looking up the inbound `bokun_tracking_code` (the auto-generated
hex string Bokun creates per referral) against `hotel_staff`. So
there are now **four** places that have to agree, in two pairs:

**Pair 1 — the human-readable identification number** (the URL ref
and the Bokun extranet entry):

1. The short.io link — `?ref=FAIRMONT_LL_JS`
2. `partners.json` — `tracking_code: "FAIRMONT_LL_JS"`
3. Bokun → Settings → Referral tracking → *Identification number* —
   `FAIRMONT_LL_JS`

**Pair 2 — the auto-generated tracking hex** (what links a Bokun
referral to a Supabase row):

4. `partners.json` — `bokun_tracking_code: "132fcbf72c934946..."`
5. Bokun → Settings → Referral tracking → *Tracking code* column —
   `132fcbf72c934946...`

The hex isn't something you choose — Bokun generates it when you save
the referral. You copy it back into `partners.json` after creating the
referral (see Step 4 in each workflow below). If it drifts, bookings
still land in Supabase but get attributed to the hotel only, not the
specific employee — silent under-payment of kickbacks.

The naming convention in [`PARTNERS_NAMING.md`](./PARTNERS_NAMING.md)
keeps Pair 1 mechanical: the lowercase hyphenated `code` in
`partners.json` deterministically becomes the UPPERCASE underscored
`tracking_code`.

## Workflow — pool hotel (no per-employee kickbacks)

This is the simpler of the two. One `partners.json` row, one Bokun
referral entry.

### Step 1 — add the row to `partners.json`

Work on a branch — you'll come back to edit one more field once Bokun
gives you the auto-generated hex.

```json
{
  "code": "moraine-lodge",
  "name": "Moraine Lake Lodge",
  "type": "pool",
  "status": "active",
  "effective_date": "2026-06-01",
  "default_tracking_code": "MORAINE_LODGE",
  "bokun_tracking_code": null,
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
  The sync script will reject anything else.
- `bokun_tracking_code`: leave as `null` for now — you'll fill it in
  at Step 4 once Bokun has assigned one.
- `commission_pct`: the property's percentage on each booking.
- `employees`: empty array.
- `kickback_pool_pct`: only fill this in if the property splits the
  pool internally and you've agreed on a number. Otherwise leave
  `null`.

Don't merge yet.

### Step 2 — print the canonical entry to copy into Bokun

```sh
node --env-file=scripts/bokun/.env scripts/bokun/sync-partners.mjs
```

The script will print exactly one new "missing" row for the new hotel,
ready to copy into the extranet form:

```
Identification number    Commission   Title
• MORAINE_LODGE          12           Moraine Lake Lodge
```

### Step 3 — create the referral in Bokun

In the extranet:

1. Settings → Referral tracking → **Create a Referral tracking**
2. Fill in:
   - Title: `Moraine Lake Lodge`
   - Identification number: `MORAINE_LODGE`
   - Commission: `12`
3. Leave Email, Tax, Flags, and Send weekly reports at defaults unless
   you have a reason.
4. Save.

### Step 4 — copy the auto-generated hex back into `partners.json`

After saving, the new referral row appears in the Referral tracking
list with a *Tracking code* column showing a 32-character hex string
(e.g. `4f0c8a91c5b94d6f...`). That's what Bokun forwards to us on every
booking and what links the booking to the hotel in Supabase.

Copy it into the `bokun_tracking_code` field on your `partners.json`
branch:

```json
"bokun_tracking_code": "4f0c8a91c5b94d6f...",
```

Now PR, review, merge.

### Step 5 — push the new partner into Supabase

```sh
node --env-file=scripts/supabase/.env scripts/supabase/seed-partners.mjs
```

The seed is idempotent — it upserts the new row and leaves existing
hotels untouched. Verify in the Supabase Table Editor that the new
hotel appears in `hotels` with the right `bokun_tracking_code`.

### Step 6 — confirm

Re-run the Bokun sync. The output should now list `MORAINE_LODGE`
under "already registered." (Note: on this Bokun account tier the API
doesn't expose referral data, so the script can't actually verify
through the API — visual confirmation in the extranet is the proof.)

That's it. The hotel is live the moment Steps 4–5 are done: Bokun
will attribute commission, and the dashboard at
`/dashboard/hotel/?hotel=moraine-lodge` will show bookings as they
come in.

## Workflow — kickback hotel (with per-employee commissions)

Same shape, just more rows. One `partners.json` entry per hotel + one
per employee, and one Bokun referral per code.

### Step 1 — add the rows to `partners.json`

Work on a branch — you'll come back to edit `bokun_tracking_code` on
the hotel and on every employee once Bokun has assigned them.

```json
{
  "code": "deer-lodge",
  "name": "Deer Lodge",
  "type": "kickback",
  "status": "active",
  "effective_date": "2026-06-15",
  "default_tracking_code": "DEER_LODGE",
  "bokun_tracking_code": null,
  "commission_pct": 10,
  "kickback_pool_pct": null,
  "employees": [
    {
      "code": "deer-lodge-mt",
      "name": "Mary Taylor",
      "tracking_code": "DEER_LODGE_MT",
      "bokun_tracking_code": null,
      "kickback_pct": 5,
      "status": "active"
    },
    {
      "code": "deer-lodge-bp",
      "name": "Bob Park",
      "tracking_code": "DEER_LODGE_BP",
      "bokun_tracking_code": null,
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
- Each employee has their own `bokun_tracking_code` field, also left
  as `null` until Step 4. The Supabase staff_id resolution depends on
  this — without it, bookings land but stay attributed to the hotel
  only.

Don't merge yet.

### Step 2 — print the canonical entries

```sh
node --env-file=scripts/bokun/.env scripts/bokun/sync-partners.mjs
```

This time the script prints three new "missing" rows — one for the
hotel default and one for each employee:

```
Identification number    Commission   Title
• DEER_LODGE             10           Deer Lodge
• DEER_LODGE_MT          5            Mary Taylor (Deer Lodge)
• DEER_LODGE_BP          5            Bob Park (Deer Lodge)
```

### Step 3 — create three referrals in Bokun

Same form, three times. The hotel default uses the property's
commission; each employee uses their kickback rate. So for Deer Lodge:

| Title | Identification number | Commission |
|---|---|---|
| Deer Lodge | `DEER_LODGE` | 10 |
| Mary Taylor (Deer Lodge) | `DEER_LODGE_MT` | 5 |
| Bob Park (Deer Lodge) | `DEER_LODGE_BP` | 5 |

The hotel default catches bookings tagged with the property code
(walk-ins, undirected referrals). The employee codes catch bookings
tagged to that specific staff member, who gets their kickback on top of
the hotel's commission.

### Step 4 — copy the auto-generated hexes back into `partners.json`

After saving each referral, the Bokun extranet shows a 32-character
hex in the *Tracking code* column. Copy each one into the matching
slot in your `partners.json` branch:

- `DEER_LODGE` row's hex → hotel's `bokun_tracking_code`
- `DEER_LODGE_MT` row's hex → Mary Taylor's `bokun_tracking_code`
- `DEER_LODGE_BP` row's hex → Bob Park's `bokun_tracking_code`

Easiest pattern: open the Referral tracking list with the new entries
visible, the partners.json branch open in your editor, and copy them
across one at a time. No identifier shortcuts — there's no way to
cross-check that the hex matches the right person other than reading
the title.

PR, review, merge.

### Step 5 — push the new partner into Supabase

```sh
node --env-file=scripts/supabase/.env scripts/supabase/seed-partners.mjs
```

The seed will upsert the new hotel (with all three hex values) plus
both employees. Verify in the Supabase Table Editor:

- `hotels` shows the new row with `bokun_tracking_code` populated.
- `hotel_staff` shows both employees, each with their own
  `bokun_tracking_code` and `hotel_id` matching the new hotel.

### Step 6 — confirm

Re-run the Bokun sync. All three new identification numbers should
appear in the extranet's Referral tracking list under "already
registered."

End-to-end: a booking tagged `DEER_LODGE_MT` should now land in the
`bookings` table with `staff_id` resolved to Mary Taylor's row.

## Adding employees to an existing kickback hotel

When new staff join a hotel that already has a kickback deal:

1. On a branch, append a new object to that hotel's `employees` array
   in `partners.json` with `bokun_tracking_code: null`. Don't touch
   the hotel-level fields.
2. Run the sync script — it'll print just the new employee row.
3. Create one new Referral tracking entry in Bokun for that employee.
4. Copy the auto-generated hex from Bokun back into the new
   employee's `bokun_tracking_code` field.
5. PR, merge.
6. Run the Supabase seed:
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
2. Run the Supabase seed:
   ```sh
   node --env-file=scripts/supabase/.env scripts/supabase/seed-partners.mjs
   ```
   The status update propagates via upsert. Existing bookings stay
   attached — Supabase doesn't cascade-delete rows just because a
   hotel or staff status changes — so historical reporting survives.
3. In Bokun, you can either delete the Referral tracking entry or
   leave it (deleting prevents accidental future attribution; leaving
   preserves historical reporting). Either is fine — pick one and be
   consistent.

The Bokun sync script ignores terminated rows, so they won't appear
in the "missing" list and won't generate copy-paste rows.

## Common mistakes

- **Identification number mismatch.** The single most likely failure
  mode. Bokun matches the field byte-for-byte. `Fairmont_LL` won't
  match `FAIRMONT_LL`. The sync script's job is to print the exact
  string so there's no transcription guesswork — copy from its output,
  don't retype.
- **Forgetting the hotel-default referral on a kickback property.** If
  you only register the employees, walk-in guests who use a generic
  "Fairmont" link get no attribution. Always create the hotel's own
  Referral tracking entry too.
- **Reusing a `code`.** Don't. If a hotel terminates and re-signs
  later under different terms, give it a new `code` (e.g.
  `fairmont-ll-2`). The old row stays as `terminated`.
- **Editing `default_tracking_code` to something other than the
  derived form.** The sync script will throw and refuse to run until
  it matches. This is on purpose.
- **Forgetting to copy `bokun_tracking_code` back from Bokun.** The
  hotel still works for commission attribution in Bokun, but bookings
  in Supabase will have `staff_id = null`. Symptom: the dashboard
  shows the booking but doesn't credit the right employee. Fix: paste
  the hex into `partners.json` and re-run the Supabase seed.
- **Forgetting to run the Supabase seed after merging.** Symptom:
  Bokun records the booking and the worker tries to insert it, but
  the hotel slug doesn't exist in `hotels` so the insert returns
  `unknown hotel slug`. The booking is fine in Bokun (commission
  still tracked) but missing from the dashboard until you seed.
- **Pasting the wrong employee's hex into `partners.json`.** Bokun's
  Tracking code column doesn't sort or label by name beyond the
  Title — if you copy hex N from a list of three, double-check the
  title before saving. Misattribution shows up as Mary's bookings
  paying Bob.
