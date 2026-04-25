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

That's the whole loop. The three places that have to agree on a code
are:

1. The short.io link — `?ref=FAIRMONT_LL_JS`
2. `partners.json` — `tracking_code: "FAIRMONT_LL_JS"`
3. Bokun → Settings → Referral tracking → *Identification number* —
   `FAIRMONT_LL_JS`

If any one of those three drifts (case, underscore vs hyphen, extra
space), the attribution silently breaks. The naming convention in
[`PARTNERS_NAMING.md`](./PARTNERS_NAMING.md) exists so the conversion
is mechanical: the lowercase hyphenated `code` in `partners.json`
deterministically becomes the UPPERCASE underscored `tracking_code`.

## Workflow — pool hotel (no per-employee kickbacks)

This is the simpler of the two. One `partners.json` row, one Bokun
referral entry.

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
  The sync script will reject anything else.
- `commission_pct`: the property's percentage on each booking.
- `employees`: empty array.
- `kickback_pool_pct`: only fill this in if the property splits the
  pool internally and you've agreed on a number. Otherwise leave
  `null`.

Open a PR, get review, merge.

### Step 2 — print the canonical entry to copy into Bokun

After merge, run:

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

### Step 4 — confirm

Re-run the script. The output should now list `MORAINE_LODGE` under
"already registered." (Note: on this Bokun account tier the API
doesn't expose referral data, so the script can't actually verify
through the API — visual confirmation in the extranet is the proof.)

That's it. The hotel is live the moment Bokun saves the referral.

## Workflow — kickback hotel (with per-employee commissions)

Same shape, just more rows. One `partners.json` entry per hotel + one
per employee, and one Bokun referral per code.

### Step 1 — add the row to `partners.json`

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

### Step 4 — confirm

Re-run the script. All three new identification numbers should appear
in the extranet's Referral tracking list.

## Adding employees to an existing kickback hotel

When new staff join a hotel that already has a kickback deal:

1. Append a new object to that hotel's `employees` array in
   `partners.json`. Don't touch the hotel-level fields.
2. PR, merge, run the sync script — it'll print just the new
   employee row.
3. Create one new Referral tracking entry in Bokun for that employee.

## When a partner or employee leaves

Don't delete rows from `partners.json` — codes never get reused (see
`PARTNERS_NAMING.md`). Instead:

1. Flip `status` from `"active"` to `"terminated"` in `partners.json`.
   PR, merge.
2. In Bokun, you can either delete the Referral tracking entry or
   leave it (deleting prevents accidental future attribution; leaving
   preserves historical reporting). Either is fine — pick one and be
   consistent.

The sync script ignores terminated rows, so they won't appear in the
"missing" list and won't generate copy-paste rows.

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
