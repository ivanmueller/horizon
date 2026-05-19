-- 0023_referral_touchpoints.sql
-- Phase 1c — full-funnel referral attribution.
-- Spec: docs/referral-attribution-spec.md (decisions LOCKED 2026-05-19).
--
-- bookings.(hotel_id, staff_id) keep their existing meaning: the CREDITED
-- result. This migration only adds the immutable funnel + an audit trail,
-- so every existing dashboard/ledger/payout query keeps working untouched.

-- ── per-hotel crediting policy ─────────────────────────────────────────────
-- Phase 1 ships only the default value as active behaviour; the other
-- values exist so a property can switch later and historical bookings can
-- be recomputed (credit is a pure function of touchpoints + policy).
alter table hotels
  add column attribution_policy text not null
    default 'employee_last_then_hotel_first'
    check (attribution_policy in
      ('employee_last_then_hotel_first', 'first_touch_wins', 'last_touch_wins'));

-- ── immutable funnel — one row per captured touch ──────────────────────────
create table booking_touchpoints (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         text,
  confirmation_code  text not null,
  position           int  not null,            -- 0-based order within the funnel
  code               text not null,            -- raw tracking code / hotel slug as captured
  stream_type        text not null check (stream_type in
                       ('hotel-slug', 'hotel', 'employee', 'placement', 'unknown')),
  hotel_id           uuid references hotels(id),
  staff_id           uuid references hotel_staff(id),
  touched_at         timestamptz,
  is_credited        boolean not null default false,
  created_at         timestamptz not null default now(),
  -- Idempotency for the page's fire-and-forget retries: the same funnel
  -- replayed produces the same (confirmation_code, position) pairs.
  unique (confirmation_code, position),
  -- The booking row is always inserted before its touchpoints, and
  -- bookings.confirmation_code is unique — so a real FK both enforces
  -- integrity and lets PostgREST embed the funnel into the bookings query.
  constraint booking_touchpoints_conf_fk
    foreign key (confirmation_code)
    references bookings (confirmation_code) on delete cascade
);

create index booking_touchpoints_conf_idx    on booking_touchpoints (confirmation_code);
create index booking_touchpoints_booking_idx on booking_touchpoints (booking_id);
create index booking_touchpoints_staff_idx   on booking_touchpoints (staff_id);

-- ── audit the credit decision on the booking itself ────────────────────────
-- credited_position points at the winning booking_touchpoints row
-- (confirmation_code + position). An int avoids a FK round-trip on the
-- fire-and-forget insert path and stays idempotent on retry.
alter table bookings
  add column attribution_policy_used text,
  add column first_touch_code        text,
  add column credited_position       int;
