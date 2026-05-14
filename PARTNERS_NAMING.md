# Referral Partner Naming Convention

These rules govern how every referral partner is identified across the
`partners.json` registry, the Supabase `hotels` + `hotel_staff` tables,
the upcoming Short.io short-link layer, and any onboarding form we build
later. **Never break them.** Every downstream system assumes this shape.

## Code formats

Three layers of identifier, each serving a distinct purpose:

| Identifier | Format | Example | Visibility |
|---|---|---|---|
| Hotel slug | Lowercase full property name, hyphenated, 2–60 chars | `fairmont-chateau-lake-louise`, `the-rimrock-resort-hotel` | Internal only |
| Hotel tracking prefix | Random 4-char uppercase alphanumeric, immutable | `X7K2`, `B9M4` | Internal only |
| Hotel default tracking code | `{prefix}_H` | `X7K2_H` | Sent in `?ref=` for walk-ins |
| Employee tracking code | `{prefix}_E_{4-digit zero-padded seq}` | `X7K2_E_0042` | Sent in `?ref=` for kickback bookings |

The tracking prefix is **server-generated at hotel creation** with a
UNIQUE constraint, so collisions never happen in practice. Employee
sequence numbers are server-incremented per-hotel. There is no
client-side derivation any more — the worker mints these values and
the admin UI displays them as read-only after creation.

Employees have no separate slug: `hotel_staff.id` (uuid) is the
internal stable reference and `tracking_code` is the canonical
human-readable identifier shown in the admin UI and encoded in
short URLs. See `ADDING_A_PARTNER.md` for the full lifecycle.

## Short paths are derived from tracking codes, never from slugs

The short-URL path component (e.g. `x7k2-h` in
`link.gowithhorizon.com/x7k2-h`) is **always** derived from the
tracking code via `trackingCodeToShortPath()`. Hotel masters get
`{prefix}-h`, staff get `{prefix}-eNNNN`. Both follow the same
format so every short URL on the platform looks consistent
regardless of property name, brand, or hotel slug.

The hotel slug (`hotels.code`, e.g. `fairmont-chateau-lake-louise`)
appears **only** in the long URL path `/partners/<slug>/`. It never
appears in a short URL or QR code. This decoupling means:

- Slugs can be ugly without leaking onto printed material
  (`hotel-test-2` lives at long-URL only; its short URL is
  `link.gowithhorizon.com/x7k2-h`).
- QR payloads stay short and uniformly-sized regardless of how
  long a hotel's name is, so scan reliability doesn't degrade for
  long-named properties.
- Guests inspecting URLs from a screenshot can't tell which hotel
  another guest is staying at — tracking-code paths are opaque.
- Long-URL slug formats can evolve (vanity paths, regional
  variants) without invalidating any printed short URL.

The single exception is **manual campaign-link creation**, where
an admin can supply a custom `short_path` via the create-link
modal. That path is theirs to choose and isn't derived from a
tracking code — it's a deliberate opt-out for marketing surfaces
that want a vanity slug.

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
          "name": "Jane Smith",
          "tracking_code": "X7K2_E_0042",
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
