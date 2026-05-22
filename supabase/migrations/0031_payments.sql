-- Per-hotel manual payment records. Distinct from `payouts` (which
-- tracks commission payments going OUT to the hotel) — `payments`
-- captures money the hotel has received against an invoice. Pilot
-- phase is manual entry from the admin profile; sync to a real
-- payment processor is a follow-up.
--
-- Status mirrors the two states the admin needs to model today:
-- 'succeeded' (money landed) and 'canceled' (entry voided without
-- a refund flow). Pending / refunded states ship when a processor
-- is wired.
create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  amount       numeric(12,2) not null check (amount > 0),
  currency     text not null default 'CAD',
  description  text,
  status       text not null default 'succeeded'
                 check (status in ('succeeded', 'canceled')),
  occurred_at  timestamptz not null default now(),
  actor_email  text,
  created_at   timestamptz not null default now()
);

create index if not exists payments_hotel_idx
  on payments (hotel_id, occurred_at desc);

-- Extend the hotel_events check constraint so writeHotelEvent can
-- record payment_created rows. We drop + recreate because Postgres
-- doesn't support ALTER CHECK in place.
alter table hotel_events
  drop constraint if exists hotel_events_event_type_check;
alter table hotel_events
  add  constraint hotel_events_event_type_check
  check (event_type in (
    'created', 'updated', 'terminated',
    'banking_set', 'banking_updated',
    'commission_changed',
    'payment_created'
  ));
