# Adding a new partner

Onboarding a hotel and its staff is now done from the admin
dashboard at **`/admin/hotels/`** — no SQL, no JSON edits, no PRs.
This doc walks the UI flow end-to-end and explains what's
happening underneath.

Two deal types are supported:

- **Pool** — property-level commission, no individual staff cuts.
  The hotel itself gets a single percentage on every booking
  attributed to it. (Example: The Post Hotel, 12%.)
- **Kickback** — property-level commission *plus* a per-employee
  cut on top, so individual concierge staff get paid for sending
  guests our way. (Example: Fairmont Chateau Lake Louise — 10% to
  the property, plus 5% to Jane Smith on her own bookings.)

The mechanical work is the same for both. The only difference is
whether you add staff under the hotel.

## How attribution actually works

A guest clicks a link the hotel gave them — say
`gowithhorizon.com/?ref=FAIRMONT_LL_JS`. The page captures that
`ref` through the booking flow and forwards it to the worker as
`tracking_code` when the booking confirms. The worker matches
that slug against `hotel_staff.tracking_code`, populates `staff_id`
on the booking row, and Supabase becomes the source of truth for
who gets credited.

For walk-ins (`?hotel=fairmont-ll`, no employee in the URL), the
hotel-level slug (`hotels.default_tracking_code`, e.g.
`FAIRMONT_LL`) gets sent. It doesn't match any `hotel_staff` row,
so `staff_id` stays null — the booking is attributed to the hotel
pool.

The slugs are all you need to keep aligned. The naming convention
in [`PARTNERS_NAMING.md`](./PARTNERS_NAMING.md) keeps that
mechanical: the lowercase hyphenated `slug` deterministically
becomes the UPPERCASE underscored `tracking_code`.

## Workflow — pool hotel (no per-employee kickbacks)

1. Sign in at `/admin/` (Google OAuth or magic link). You need to
   be in the `horizon_admins` allowlist.
2. Click **Hotels** in the sidebar → **+ Add hotel** in the
   top-right.
3. Fill out the form:

   | Field             | Value                                       |
   |-------------------|---------------------------------------------|
   | Name              | `Moraine Lake Lodge`                        |
   | Slug              | `moraine-lodge` (locks in once saved)       |
   | Location          | `Banff` or `Canmore`                        |
   | Type              | **`pool`**                                  |
   | Commission %      | `12`                                        |
   | Kickback pool %   | (leave blank unless they split a pool)      |
   | Tracking code     | auto-fills `MORAINE_LODGE` from the slug    |
   | Effective date    | the date their deal starts                  |
   | Notes             | internal-only ("Pool deal, signed via X")   |

4. Hit **Create hotel**. The drawer closes and the row appears in
   the list. A green notice says *"Hotel created. Republishing
   partners.json (~30s)…"* — that's CF Pages rebuilding so the new
   `default_tracking_code` is recognised across the site.

That's it. The hotel is live: walk-in bookings via
`?hotel=moraine-lodge` will record under the hotel pool, and the
`/dashboard/hotel/?hotel=moraine-lodge` partner dashboard plus the
internal `/admin/` dashboard will show their bookings as they come
in.

## Workflow — kickback hotel (with per-employee commissions)

Same as pool, but pick **`kickback`** for Type. Then add staff:

1. Click the hotel's row in the list to open its detail drawer.
2. Scroll to **Staff (n)** → **+ Add**.
3. Fill out:

   | Field          | Value                                         |
   |----------------|-----------------------------------------------|
   | Name           | `Jane Smith`                                  |
   | Slug           | `fairmont-ll-js` (`[hotelslug]-[initials]`)   |
   | Tracking code  | auto-fills `FAIRMONT_LL_JS` from the slug     |
   | Kickback %     | `5`                                           |

4. Hit **Add staff**. Repeat for each concierge on the program.

Each `Add staff` triggers another republish so their tracking code
becomes live within ~60s. End-to-end: a booking tagged
`FAIRMONT_LL_JS` (via the URL flow) lands in the `bookings` table
with `staff_id` resolved to Jane's row, and the in-dashboard
invoice for the hotel breaks out her kickback under the kickback
breakdown table.

## Adding employees to an existing kickback hotel

Click the hotel's row → **Staff (n)** → **+ Add** → fill in the
form. Same flow as above. No need to touch the hotel's
configuration.

## Editing an existing partner

Click any hotel row to open its drawer. Every Overview field is
live-editable except **Slug** (it's locked because it's the URL
identity for `/partners/<slug>/` and the `?hotel=<slug>` query
parameter — changing it would break old QR codes / printed
materials).

For staff, click **Edit** on any row — same restriction on slug.

Saves trigger a republish automatically. The list refreshes
immediately so you can see the new values; partners.json catches
up within a build cycle (~60s).

## When a partner or employee leaves

Don't reuse a slug. Codes never get reissued (see
[`PARTNERS_NAMING.md`](./PARTNERS_NAMING.md)).

**Hotel:** open the drawer → scroll to **Danger zone** at the
bottom → **Terminate**. Confirm the dialog. Status flips to
*Terminated*; new bookings stop attributing; existing bookings and
invoices are preserved.

**Staff member:** open the hotel drawer → click **Revoke** on
their row in the Staff table. Confirm. Same soft-delete behaviour.

Either action is reversible — terminated hotels expose a
**Reinstate** button in the same Danger zone, and revoked staff
can be re-added with the same slug (the worker enforces the unique
constraint only on `status='active'`).

## Inviting a manager (hotel-side dashboard access)

Managers are people the hotel chooses to give access to their
own dashboard at `/dashboard/hotel/?hotel=<slug>` — typically the
GM or whoever runs the front desk. They see *only* their hotel's
bookings + invoices, never anyone else's.

1. Open the hotel's drawer → **Managers (n)** → **+ Invite**.
2. Enter the manager's email + pick a role:
   - **manager** — read-only access to bookings + invoices.
   - **admin** — same plus permission to edit staff at this hotel
     (hotel-scoped only; never platform-wide).
3. Hit **Send invite**.

There's no automatic email yet (custom SMTP is on the roadmap).
For now, just tell them to go to `/dashboard/login/` and sign in
with that email — magic link or Google OAuth both work.

Manager changes do *not* trigger a republish — they're an auth
concern, not partners.json content. The invite is live the second
the API call succeeds.

## Common mistakes

- **Tracking-code mismatch.** The form auto-derives the tracking
  code from the slug (`fairmont-ll` → `FAIRMONT_LL`). Don't override
  it unless you have a specific reason — the convention in
  `PARTNERS_NAMING.md` exists so attribution stays mechanical.
- **Reusing a slug.** Don't. If a hotel terminates and re-signs
  later under different terms, give it a new slug
  (e.g. `fairmont-ll-2`). The old row stays as `terminated`.
- **Editing the slug.** You can't — the form disables it after
  creation. If you really need to (typo at create time, etc.), do
  it directly in the Supabase dashboard and rename the
  `default_tracking_code` to match. Then run `npm run build:partners`
  locally to regenerate, or just push any change to main to trigger
  a CF Pages rebuild.

## Under the hood (for debugging)

The UI talks to the `horizon-bokun` worker at
`/api/admin/hotels`, `/api/admin/staff`, and
`/api/admin/hotel-users`. Each successful write triggers
`POST /api/admin/republish`, which calls a Cloudflare Pages deploy
hook that re-runs the build. The build runs
`scripts/build/generate-partners-json.mjs`, which reads `hotels` +
`hotel_staff` from Supabase via the service-role key and writes a
fresh `partners.json` at the repo root. The static site (tour
page, checkout, partner dashboards) fetches that file directly —
no worker round-trip on the read path.

`partners.json` is `.gitignore`d. The deployed copy at
`gowithhorizon.com/partners.json` is always the live source of
truth; the working tree never holds a useful copy. Run
`node --env-file=scripts/supabase/.env scripts/build/generate-partners-json.mjs`
locally if you ever need a copy for offline tooling.
