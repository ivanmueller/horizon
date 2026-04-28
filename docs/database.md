# Database (Supabase)

The booking ledger lives in a Supabase Postgres database
(project: **horizon-database**). It replaces the Cloudflare KV
`BOOKINGS_LEDGER` namespace that powered v1 of the partner dashboard.

KV is still used for the 45-minute checkout cart pouch (`BOOKINGS`
namespace). That one stays — it's the right tool for ephemeral state.

## Schema (v1)

Three tables, defined in `supabase/migrations/0001_init.sql`:

| Table         | What it is                                                      |
|---------------|-----------------------------------------------------------------|
| `hotels`      | Partner hotels. One row per `code` slug (e.g. `fairmont-ll`).   |
| `hotel_staff` | Concierge / employees with optional per-employee kickback.      |
| `bookings`    | Confirmed Bokun bookings. One row per successful checkout.      |

Each booking links to a hotel (required) and optionally to a staff
member (the person who'll get the kickback). The link to staff is
resolved at insert time by matching the inbound `bokun_tracking_code`
against `hotel_staff.bokun_tracking_code` — if there's no match, the
booking is attributed to the hotel only.

`partners.json` at the repo root remains the source of truth for the
partner directory. Supabase is seeded from it.

## Timestamps — UTC at storage, local at the edge

All timestamp columns (`created_at`, `updated_at`) are Postgres
`timestamptz`, which Postgres normalizes to **UTC** at write time.
You won't see UTC on the dashboards or in invoices — display is
always converted to the viewer's local time.

The pattern, from outside in:

| Layer                      | Format                              |
|----------------------------|-------------------------------------|
| Postgres `bookings`        | UTC (timestamptz)                   |
| Worker API request/response| ISO 8601 instant (`...T...Z`)       |
| Page display               | Local time via `new Date(iso)`      |
| Static query strings       | ISO 8601 instants, URL-encoded      |

Why not store local time:

- DST creates a non-existent hour (every March) and a doubled hour
  (every November) in local time. UTC has neither.
- Bokun, Stripe, and Cloudflare all hand us UTC; storing local
  would mean converting on every read and write.
- Hotels in different timezones (Quebec → EDT, Vancouver → PDT,
  Saskatchewan → no DST) make a single "local timezone" undefined
  the moment you sign one outside Mountain time.

Why ISO instants on the API and not bare `YYYY-MM-DD`:

- `2026-04-27` is ambiguous — midnight UTC? Midnight Mountain time?
  Midnight Tokyo? An ISO instant like `2026-04-27T06:00:00.000Z`
  is unambiguous globally.
- A booking made at 11pm local lands in UTC at ~5am the next day.
  Sending the bare date `2026-04-27` would clip that booking out
  of "this month" until the next day. The page-side code computes
  bounds at start-of-local-day, then `.toISOString()` so the
  instant carries the user's intent unambiguously.

`/api/dashboard/bookings` and `/api/admin/summary` accept either
ISO instants (preferred) or `YYYY-MM-DD` (interpreted as start/end
of UTC day, kept for the custom-range picker and curl tests).

## Setup (one-time, per environment)

### 1. Apply the schema

In the Supabase dashboard:

1. Open the **horizon-database** project.
2. Sidebar → **SQL Editor**.
3. Open `supabase/migrations/0001_init.sql` from this repo, paste the
   contents into a new query, and click **Run**.
4. Sidebar → **Table Editor** — confirm `hotels`, `hotel_staff`, and
   `bookings` exist.

### 2. Grab credentials

Sidebar → **Settings** (gear icon) → **API**:

- **Project URL** → goes into `SUPABASE_URL`
- **Project API keys → service_role** → goes into `SUPABASE_SERVICE_KEY`

Save both into your password manager.  The service_role key bypasses
Row-Level Security; treat it like a database password and never put it
in any frontend bundle or commit.

### 3. Seed partners

```bash
cp scripts/supabase/.env.example scripts/supabase/.env
# paste SUPABASE_URL + SUPABASE_SERVICE_KEY into the .env
node --env-file=scripts/supabase/.env scripts/supabase/seed-partners.mjs
```

The script is idempotent — re-running it is safe and is also how you
push partner edits.

### 4. Configure the worker

The worker needs to read/write the same database. From inside
`workers/bokun/`:

```bash
wrangler secret put SUPABASE_SERVICE_KEY   # paste the same service_role key
```

`SUPABASE_URL` is non-secret and lives as a `[vars]` entry in
`workers/bokun/wrangler.toml`.

## Adding a new partner

1. Edit `partners.json` — add the hotel block (and any employees).
2. Run the seed script (above).
3. Done. No SQL, no manual inserts.

## Adding a new table later

1. Create `supabase/migrations/000N_name.sql`, numbered sequentially.
2. Paste into the Supabase SQL Editor and run.
3. Document the new table in this file.

When we move to managed migrations (Supabase CLI or similar), the file
layout already matches the convention — nothing to refactor.

## Auth / RLS (planned, not yet built)

Hotel managers will sign in via Supabase magic-link. The JWT will carry
their `hotel_id`, and an RLS policy on `bookings` will gate
`hotel_id = auth.jwt() ->> 'hotel_id'`. Schema is auth-ready today; the
worker uses the service_role key (which bypasses RLS) until that lands.
