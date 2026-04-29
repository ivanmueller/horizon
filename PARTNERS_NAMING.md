# Referral Partner Naming Convention

These rules govern how every referral partner is identified across short.io
codes, Bokun `trackingCode`s, the `partners.json` registry, future database
rows, and any onboarding form we build later. **Never break them.** Every
downstream system assumes this shape.

## Code formats

| Identifier | Format | Example |
|---|---|---|
| Hotel default code | `[hotelcode]` — lowercase, hyphenated, short | `fairmont-ll`, `post-hotel`, `moraine-lodge` |
| Kickback employee code | `[hotelcode]-[employeeinitials]` | `fairmont-ll-js` (Jane Smith at Fairmont Chateau Lake Louise) |
| Bokun `trackingCode` | UPPERCASE version of the code with underscores instead of hyphens | `FAIRMONT_LL`, `FAIRMONT_LL_JS` |

The two formats look different but map deterministically — code can convert
one to the other automatically:

```
hotelcode  ⇄  trackingCode
fairmont-ll  ⇄  FAIRMONT_LL
fairmont-ll-js  ⇄  FAIRMONT_LL_JS
```

Conversion rule: `trackingCode = hotelcode.toUpperCase().replace(/-/g, "_")`
and `hotelcode = trackingCode.toLowerCase().replace(/_/g, "-")`.

## Reuse rule

**Hotel codes never get reused.** If a hotel terminates, the code retires
forever. Same for employee codes when a staff member leaves — the code stays
attached to that historical row and is never reissued to a different person.

## Source of truth

The Supabase `hotels` and `hotel_staff` tables. Admins edit them
through the UI at `/admin/hotels/` (see
[`ADDING_A_PARTNER.md`](./ADDING_A_PARTNER.md) for the workflow).

`partners.json` at the repo root is a build artifact, not source —
it's regenerated from Supabase on every Cloudflare Pages deploy by
`scripts/build/generate-partners-json.mjs` and is `.gitignore`d.
The static site reads it for fast attribution lookups without a
worker round-trip; admins never edit it directly.

### Shape of `partners.json`

```json
{
  "hotels": [
    {
      "code": "fairmont-ll",
      "name": "Fairmont Chateau Lake Louise",
      "type": "kickback",
      "status": "active",
      "effective_date": "2026-05-01",
      "default_tracking_code": "FAIRMONT_LL",
      "commission_pct": 10,
      "kickback_pool_pct": null,
      "employees": [
        {
          "code": "fairmont-ll-js",
          "name": "Jane Smith",
          "tracking_code": "FAIRMONT_LL_JS",
          "kickback_pct": 5,
          "status": "active"
        }
      ],
      "notes": "Concierge desk, 3 active staff as of May 2026"
    }
  ]
}
```

### Field semantics

- `type`: `"kickback"` — individual employees earn a per-booking cut; populate
  `employees`. `"pool"` — property-level pool, no individual kickbacks; leave
  `employees` empty and use `kickback_pool_pct` if applicable.
- `status`: `"active"` or `"terminated"`. Terminated rows stay in the file
  (codes never reuse), just flipped.
- `commission_pct`: percent of booking value paid to the hotel.
- `kickback_pct` (per employee): percent of booking value paid to that
  individual on top of the hotel commission.
- `kickback_pool_pct`: only set for `type: "pool"` deals where the property
  splits a pool internally.

The shape handles both deal types — pool hotels have empty `employees`,
kickback hotels populate it.
