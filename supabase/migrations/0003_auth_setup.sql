-- Auth + Row-Level Security setup.
--
-- Adds the `hotel_users` mapping table that connects a Supabase Auth
-- email → a hotel they manage, then defines RLS policies on hotels /
-- hotel_staff / bookings / hotel_users so an authenticated user only
-- sees data for hotels they're explicitly assigned to.
--
-- The worker continues to use the service-role key, which bypasses
-- RLS — so the admin endpoints + the checkout-time INSERT path are
-- unchanged. RLS only kicks in for `authenticated` JWTs (the partner
-- dashboard flow) and `anon` keys (which we don't currently use, but
-- are now safely sandboxed).
--
-- Idempotent: every CREATE has a guard (IF NOT EXISTS or DROP IF
-- EXISTS) so re-running this in the SQL Editor doesn't error.

-- ── hotel_users ──────────────────────────────────────────────────────
-- Keyed on email rather than auth.users.id because we want to grant
-- access BEFORE the manager has signed up: admin enters their email,
-- a magic link goes out, when they sign in the JWT's email claim
-- matches the row and they get scoped to their hotel.
--
-- One email can have multiple rows (same person managing two
-- hotels); one (email, hotel_id) pair can only be active once. The
-- partial unique index on the lowercased email makes the comparison
-- case-insensitive so jane@hotel.com and Jane@Hotel.com don't both
-- need rows.
create table if not exists hotel_users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  hotel_id    uuid not null references hotels(id) on delete cascade,
  role        text not null default 'manager' check (role in ('manager', 'admin')),
  status      text not null default 'active'   check (status in ('active', 'revoked')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists hotel_users_email_idx     on hotel_users (lower(email));
create index if not exists hotel_users_hotel_id_idx  on hotel_users (hotel_id);
create unique index if not exists hotel_users_email_hotel_active_uniq
  on hotel_users (lower(email), hotel_id)
  where status = 'active';

drop trigger if exists hotel_users_set_updated_at on hotel_users;
create trigger hotel_users_set_updated_at
  before update on hotel_users
  for each row execute function set_updated_at();

-- ── RLS policies ─────────────────────────────────────────────────────
-- Idempotent. `enable row level security` doesn't error on a table
-- where it's already enabled, and the drop-then-create policy
-- pattern works on PG 15/16 (which don't have CREATE POLICY IF NOT
-- EXISTS — that landed in PG 17).
--
-- All policies are SELECT-only. Inserts / updates / deletes against
-- these tables happen via the service-role key on the worker side,
-- which bypasses RLS entirely. There's no path from the partner
-- dashboard to mutate anything.
alter table hotels       enable row level security;
alter table hotel_staff  enable row level security;
alter table bookings     enable row level security;
alter table hotel_users  enable row level security;

-- Authenticated users can read their own hotel_users rows. Useful for
-- the page introspecting "which hotel(s) am I assigned to" without a
-- worker round-trip.
drop policy if exists hotel_users_self_read on hotel_users;
create policy hotel_users_self_read on hotel_users
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- Authenticated users can read hotels they have an active hotel_users
-- row for. Subquery rather than a join because RLS USING expressions
-- have to be boolean.
drop policy if exists hotels_authenticated_self on hotels;
create policy hotels_authenticated_self on hotels
  for select to authenticated
  using (id in (
    select hotel_id from hotel_users
     where lower(email) = lower(auth.jwt() ->> 'email')
       and status = 'active'
  ));

drop policy if exists hotel_staff_authenticated_self on hotel_staff;
create policy hotel_staff_authenticated_self on hotel_staff
  for select to authenticated
  using (hotel_id in (
    select hotel_id from hotel_users
     where lower(email) = lower(auth.jwt() ->> 'email')
       and status = 'active'
  ));

drop policy if exists bookings_authenticated_self on bookings;
create policy bookings_authenticated_self on bookings
  for select to authenticated
  using (hotel_id in (
    select hotel_id from hotel_users
     where lower(email) = lower(auth.jwt() ->> 'email')
       and status = 'active'
  ));
