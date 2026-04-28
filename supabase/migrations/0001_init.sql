-- Horizon Tours — initial booking ledger schema.
--
-- Tables:
--   hotels       — partner hotels, seeded from partners.json
--   hotel_staff  — per-hotel concierge / employees with optional kickback
--   bookings    — confirmed Bokun bookings, one row per /checkout/submit success
--
-- Schema is auth-ready: when Supabase Auth lands, RLS policies will gate
-- bookings.hotel_id = (jwt -> hotel_id). No policies are created here on
-- purpose — the worker uses the service_role key, which bypasses RLS.

-- pgcrypto powers gen_random_uuid(). Supabase enables it by default; the
-- IF NOT EXISTS keeps the migration idempotent across fresh projects.
create extension if not exists pgcrypto;

-- Shared trigger function for updated_at maintenance. One function, three
-- triggers — saves duplicating the body on every table.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── hotels ─────────────────────────────────────────────────────────────────
create table hotels (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  name                   text not null,
  location               text not null check (location in ('Banff', 'Canmore')),
  type                   text not null check (type in ('kickback', 'pool')),
  commission_pct         numeric(5,2) not null default 0,
  kickback_pool_pct      numeric(5,2),
  default_tracking_code  text,
  bokun_tracking_code    text,
  status                 text not null default 'active' check (status in ('active', 'terminated')),
  effective_date         date,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- A bokun_tracking_code uniquely identifies a hotel's referral channel — two
-- hotels sharing one would make attribution ambiguous. Partial unique index
-- so nulls don't collide while we're seeding partners that lack one.
create unique index hotels_bokun_tracking_code_uniq
  on hotels (bokun_tracking_code)
  where bokun_tracking_code is not null;

create trigger hotels_set_updated_at
  before update on hotels
  for each row execute function set_updated_at();

-- ── hotel_staff ────────────────────────────────────────────────────────────
create table hotel_staff (
  id                     uuid primary key default gen_random_uuid(),
  hotel_id               uuid not null references hotels(id) on delete cascade,
  code                   text not null unique,
  name                   text not null,
  tracking_code          text,
  bokun_tracking_code    text,
  kickback_pct           numeric(5,2) not null default 0,
  status                 text not null default 'active' check (status in ('active', 'terminated')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index hotel_staff_hotel_id_idx on hotel_staff (hotel_id);

-- Same uniqueness rationale as hotels: a Bokun tracking hex maps to exactly
-- one revenue recipient. The worker uses this index at insert time to
-- resolve staff_id from the inbound bokun_tracking_code.
create unique index hotel_staff_bokun_tracking_code_uniq
  on hotel_staff (bokun_tracking_code)
  where bokun_tracking_code is not null;

create trigger hotel_staff_set_updated_at
  before update on hotel_staff
  for each row execute function set_updated_at();

-- ── bookings ───────────────────────────────────────────────────────────────
create table bookings (
  id                     uuid primary key default gen_random_uuid(),
  booking_id             text,
  hotel_id               uuid not null references hotels(id),
  staff_id               uuid references hotel_staff(id),
  confirmation_code      text not null unique,
  tour_id                bigint,
  tour_title             text,
  date                   date,
  time                   text,
  adults                 integer not null default 0,
  youth                  integer not null default 0,
  infants                integer not null default 0,
  amount                 numeric(10,2),
  currency               text not null default 'CAD',
  lead_name              text,
  lead_email             text,
  bokun_tracking_code    text,
  status                 text not null default 'confirmed'
                         check (status in ('confirmed', 'cancelled', 'refunded', 'pending_refund')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index bookings_hotel_id_idx     on bookings (hotel_id);
create index bookings_staff_id_idx     on bookings (staff_id);
create index bookings_created_at_idx   on bookings (created_at desc);
create index bookings_status_idx       on bookings (status);

create trigger bookings_set_updated_at
  before update on bookings
  for each row execute function set_updated_at();
