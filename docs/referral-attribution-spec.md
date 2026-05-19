# Referral Attribution & Funnel Tracking — Design Spec

Status: **Draft for review** · Target branch: `claude/referral-code-minting-flow-IJBWG`
Last updated: 2026-05-19

---

## 1. Problem statement

Referral codes drive every hotel commission and employee kickback in Horizon.
The current implementation has three defects that put attribution revenue at
risk during a hotel rollout:

1. **No cross-page persistence.** Codes live only in `window.HORIZON` (in-memory).
   A page refresh, or navigating to another tour without the param re-appended,
   silently drops attribution. (`tours/*/index.html:2024-2036`)
2. **No multi-touch funnel.** Only the final `(hotel_id, staff_id)` tuple is
   stored on `bookings`. A guest who scans a lobby card and is *later* referred
   by an employee leaves no trace of the first touch — we cannot see the funnel
   or audit competing sources. (`supabase/migrations/0001_init.sql:82-113`)
3. **15-minute ceiling.** Even once a code reaches Cloudflare KV at checkout
   initiate, it dies with the spot-hold (`TTL_BOOKING = 15*60`,
   `workers/bokun/index.js:119`). Attribution should outlive a single
   checkout attempt.

## 2. Current flow (as-built reference)

| Step | Where | Behaviour |
|---|---|---|
| Capture | `tours/*/index.html:2024-2036` | `?hotel=` → `window.HORIZON.hotel`; `?ref=` → `window.HORIZON.ref`. Memory only. |
| Initiate | `workers/bokun/index.js:460-491` | `ref` normalized + written to KV booking state, **15 min TTL**. |
| Resolve | `checkout/index.html:1932-1934` | One `tracking_code` chosen: staff → hotel default → null. |
| Write | `workers/bokun/index.js:521-572` | Resolves `hotel_id`+`staff_id`; one `bookings` row. `staff_id` only set when `staff.hotel_id == hotel_id`. |

Code grammar (`TRACKING_CODE_RE`): `htl-XXXXX` (hotel/pool), `htl-XXXXX-eNNN`
(employee), `htl-XXXXX-pNN` (placement). Hotel `type` is `kickback` or `pool`
(`hotels` table).

## 3. Design principles

The robust, durable model — and the recommendation here — is:

> **Capture everything immutably. Decide credit at write time with a pure,
> replayable policy function. Never let the credit decision destroy the
> underlying data.**

This is the key architectural move. Crediting becomes a deterministic function
of `(touchpoint_array, hotel_policy)`. Because the raw funnel is never lost, a
policy change can be **recomputed retroactively** over historical bookings —
you are never trapped by a crediting decision made today. It also gives the
admin dashboard true multi-touch funnel analytics for free.

## 4. Recommended attribution policy

The user raised the real tension: employees should be tracked whenever
relevant, but for **pool** hotels the *order* of touches matters for fairness.
The recommendation handles both with one default plus a per-hotel override.

### 4.1 Default policy: `employee_last_then_hotel_first`

Evaluation over the ordered touchpoint array for a booking:

1. **Employee touches always outrank hotel/pool/placement touches.** If any
   touchpoint is an employee code (`-eNNN` resolving to an active
   `hotel_staff` row), the booking is credited to an employee. Rationale:
   an employee referral is the active sales motion Horizon most wants to
   incentivize, regardless of whether a lobby card was scanned first.
2. **Among employee touches, the *last* employee wins.** The most recent
   human who actively referred did the closing work.
3. **If there are no employee touches, hotel/pool attribution applies, and
   the *first* hotel touch wins.** For `pool` hotels the kickback is shared,
   so first-touch protects the placement/property that originated the guest
   and is the fair tie-breaker. For `kickback` hotels with no employee touch
   the hotel-level code is credited the same way.
4. **Placement codes (`-pNN`)** are treated as hotel-level touches (they
   never match a staff row) and follow rule 3, but their `stream_type` is
   recorded distinctly so marketing attribution stays visible in the funnel.

### 4.2 Per-hotel override

Add `attribution_policy` to `hotels` (enum, default
`employee_last_then_hotel_first`). Phase 1 ships only the default value;
the column exists so a property can later choose:

- `first_touch_wins` — whoever was scanned/clicked first owns it; everything
  else is funnel-only.
- `last_touch_wins` — most recent touch of any kind.
- `employee_last_then_hotel_first` — **default** (§4.1).

Because credit is recomputable (§3), adding policies later is non-destructive.

### 4.3 Worked example

Guest scans lobby card `htl-7q4k9` → browses → days later clicks employee
link `htl-7q4k9-e042` → books.

- Touchpoints stored: `[{hotel-card, htl-7q4k9, t0}, {employee, htl-7q4k9-e042, t1}]`
- Credited (default policy): employee `e042` (rule 1+2).
- Funnel view: "Lobby card → Employee e042 → Booked", first-touch = hotel card,
  conversion lag = t1−t0. Nothing is lost; if the hotel later switches to
  `first_touch_wins`, the same row recredits to the hotel pool on recompute.

## 5. Client-side persistence

### 5.1 Storage

New module `js/referral.js`, loaded on every page (tours, checkout,
booking-confirmed, index, about, blog, partners landing).

- Primary store: `localStorage` key **`hzn_ref`** — JSON:
  ```json
  {
    "v": 1,
    "touchpoints": [
      { "code": "htl-7q4k9",      "stream": "hotel",    "ts": 1747600000000, "page": "/tours/..." },
      { "code": "htl-7q4k9-e042", "stream": "employee", "ts": 1747700000000, "page": "/tours/..." }
    ],
    "first_ts": 1747600000000,
    "last_ts": 1747700000000
  }
  ```
- Mirror to a first-party cookie **`hzn_ref`** (scoped to the apex domain so
  it survives `www`/bare and subdomain hops) for resilience when
  `localStorage` is unavailable (Safari ITP/private mode). Cookie holds the
  same JSON, capped to the last N touchpoints to stay under size limits.
- `sessionStorage` is **not** used — it would not survive the multi-day
  hotel-stay window.

### 5.2 Capture rules

On every page load, `js/referral.js`:

1. Reads `?hotel=` and `?ref=` (reuse existing regexes; keep `hotel`
   lowercased, `ref` lowercased to match worker normalization).
2. **Append-only.** A new code is pushed as a new touchpoint **only if it
   differs from the most recent touchpoint of the same stream** (dedupe
   refresh/echo). Existing touchpoints are never mutated or removed.
3. Caps the array at **25 touchpoints** (drop oldest beyond that; `first_ts`
   is preserved separately so first-touch is never lost).
4. Re-hydrates `window.HORIZON.{hotel,ref}` from the **credited** touchpoint
   (computed by the same policy function, §6.3) so all existing downstream
   code keeps working with zero changes.

### 5.3 TTL recommendation

**30-day sliding window**, refreshed on every new touchpoint.

Rationale for hotels generally: a guest may pick up a card at check-in and
book during a multi-day stay, or research before arrival and convert after.
7 days misses pre-trip research and longer stays; session-only reintroduces
defect #1. 30 days is the industry-standard referral window, and the
recomputable-credit design (§3) means we can tighten it retroactively without
data loss if a hotel disputes stale attribution. Expiry = `now > last_ts +
30d` → clear store and start fresh.

## 6. Server-side changes

### 6.1 Initiate payload

`tours/*/index.html` booking-initiate call sends the **full touchpoint
array** (`touchpoints`, `first_ts`, `last_ts`) in addition to the existing
`hotel`/`ref` (kept for backward compatibility).

`workers/bokun/index.js` `/api/booking/initiate`: validate each touchpoint
code against `TRACKING_CODE_RE`, drop invalid entries, store the sanitized
array in the KV booking state. **Decouple from `TTL_BOOKING`:** persist the
touchpoint array under a separate KV key `attr:<booking_id>` with a
**30-day** TTL so funnel data outlives the 15-min spot-hold (the 15-min hold
on the cart itself is unchanged).

### 6.2 Schema migration `0023_referral_touchpoints.sql`

```sql
-- per-hotel policy (Phase 1 ships only the default value)
alter table hotels
  add column attribution_policy text not null
    default 'employee_last_then_hotel_first'
    check (attribution_policy in
      ('employee_last_then_hotel_first','first_touch_wins','last_touch_wins'));

-- immutable funnel, one row per touch
create table booking_touchpoints (
  id            uuid primary key default gen_random_uuid(),
  booking_id    text,
  confirmation_code text,            -- linked once the booking confirms
  code          text not null,       -- raw tracking code as captured
  stream_type   text not null check (stream_type in
                  ('hotel','employee','placement','unknown')),
  hotel_id      uuid references hotels(id),
  staff_id      uuid references hotel_staff(id),
  touched_at    timestamptz not null,
  position      int not null,        -- 0-based order within the funnel
  is_credited   boolean not null default false,
  created_at    timestamptz not null default now()
);
create index booking_touchpoints_conf_idx on booking_touchpoints (confirmation_code);
create index booking_touchpoints_booking_idx on booking_touchpoints (booking_id);

-- audit the credit decision on the booking itself
alter table bookings
  add column attribution_policy_used text,
  add column first_touch_code text,
  add column credited_position int;   -- see §6.2a
```

> **§6.2a — implemented deviation.** Shipped as `credited_position int`
> (not `credited_touchpoint_id uuid`). The winning touch is identified by
> `(confirmation_code, position)`; an int avoids an extra FK round-trip on
> the fire-and-forget insert path and stays idempotent on retry.
> `booking_touchpoints` carries `unique (confirmation_code, position)` so
> retried records dedupe instead of duplicating.

`bookings.hotel_id` / `staff_id` semantics are unchanged — they continue to
hold the **credited** result, so every existing dashboard query, ledger
calculation, and payout keeps working untouched.

### 6.3 Credit resolution (pure function)

Add `resolveCredit(touchpoints, hotelPolicy, lookups)` in
`workers/bokun/index.js`, used both at booking write time and by a future
backfill/recompute job:

- Input: sanitized ordered touchpoints + the resolved hotel's
  `attribution_policy` + staff/hotel lookup maps.
- Output: `{ hotel_id, staff_id, credited_index, policy_used, first_touch_code }`.
- Pure and deterministic — no DB writes, no clock reads. This is what makes
  retroactive recompute safe.

At `/api/dashboard/record`: insert all `booking_touchpoints` rows, run
`resolveCredit`, set `bookings.(hotel_id, staff_id, attribution_policy_used,
first_touch_code, credited_touchpoint_id)`, flag the winning touchpoint
`is_credited = true`. Existing collision guard (`staff.hotel_id == hotel_id`)
is applied inside `resolveCredit`.

## 7. Dashboard + recompute (Phase 2 — IMPLEMENTED)

- **Funnel view** (`dashboard/hotel/index.html`): bookings table gains a
  **Source** column showing the credited stream/employee with an expandable
  per-booking touchpoint timeline (ordered steps, credited badge, first
  touch, time-to-book, policy used). Driven by the embedded
  `touchpoints` + audit columns now returned by `/api/dashboard/bookings`.
- **Retroactive recompute** (`POST /api/admin/recompute-attribution`,
  horizon-admin gated, body `{ hotel }`): replays `resolveCredit` over the
  immutable `booking_touchpoints` using the hotel's *current*
  `attribution_policy`, rewrites `bookings.staff_id` + audit columns +
  `is_credited` flags only where they changed. Makes a policy switch
  non-destructive (§3). Scoped per-hotel per call to stay bounded.

> **§6.2b — added.** `booking_touchpoints` gains
> `constraint booking_touchpoints_conf_fk foreign key (confirmation_code)
> references bookings (confirmation_code) on delete cascade`. The booking
> row is always inserted before its touchpoints and
> `bookings.confirmation_code` is unique, so the FK enforces integrity and
> lets PostgREST embed the funnel directly into the bookings query.

## 8. Rollout plan

| Phase | Scope | Risk |
|---|---|---|
| 1a | `js/referral.js` persistence + cookie mirror; re-hydrate `window.HORIZON`. **Fixes defect #1 alone.** | Low — additive, no schema/worker change. |
| 1b | Initiate sends touchpoint array; worker sanitizes + stores under `attr:` key, 30-day TTL. | Low — backward-compatible payload. |
| 1c | Migration `0023`; `resolveCredit`; record handler writes touchpoints + audit cols. | Medium — write-path change; `bookings` credited columns unchanged. |
| 2 | Dashboard funnel UI + retroactive recompute job. | Low — read-side. |

Phase 1a is independently shippable and removes the highest-impact revenue
risk first.

## 9. Sign-off — LOCKED 2026-05-19

1. ✅ Default policy §4.1 (employee-priority, last-employee, else first-hotel).
2. ✅ 30-day sliding TTL (§5.3).
3. ✅ Cookie scope: apex domain incl. all subdomains.
4. ✅ Touchpoint cap = 25 (§5.2); first-touch preserved separately past cap.
5. ✅ Placement (`-pNN`) is **funnel-only / non-crediting** in Phase 1.

## 10. Hardening — done now vs. deliberately deferred

Right-sized for current stage (low volume, few hotels). The bar applied:
*does it break the scan → book → attributed → visible flow now?*

**Done now (on the money path, cheap):**
- ✅ **Tests for `resolveCredit`** — `workers/bokun/resolveCredit.test.mjs`,
  10 cases incl. the override scenario, policy variants, terminated-staff
  fallback. `npm test`.
- ✅ **Dual-capture-path verification (#6)** —
  `workers/bokun/referralCapture.test.mjs`. Proven safe: the legacy Banff
  inline block's regex *rejects* hyphenated `htl-` codes and so never set
  them (latent pre-existing bug); `referral.js` now captures them. Where
  the inline block *does* set a (legacy underscore) code, `referral.js`
  does not override it and still records the funnel. No attribution is
  dropped. Consolidating the two paths is cosmetic — deferred.

**Deliberately deferred (real, but not blocking core flow at this stage):**
- ⏳ **Recompute scalability** — current endpoint does serial Supabase
  writes; only bites on a high-volume hotel recompute. **Hard rule: the
  admin recompute button does NOT ship until this is batched + a dry-run
  preview + an audit row exist.** The endpoint sitting unused is safe.
- ⏳ **Cross-device stitching** — phone-scan → laptop-book loses
  attribution. Same failure mode as today (not a regression). Revisit via
  `lead_email` server-side stitching as a fast-follow.
- ⏳ **Attribution-fraud controls** (employee self-append gaming
  last-touch) — needs incentivised employees + volume first.
- ⏳ **Safari ITP 7-day cap on script-set cookies** — primary store is
  localStorage (unaffected); cookie is fallback only. Spec wording note,
  no code change.
- ⏳ **Observability** (capture/restore/override/recompute events) —
  matters at first payout dispute, not first booking.
