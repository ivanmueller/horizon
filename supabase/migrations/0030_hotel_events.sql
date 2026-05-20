-- Activity log for the hotel record itself. Mirrors placement_events
-- and staff_events so the hotel profile's Events section can render
-- the same Stripe-style timeline by UNIONing this table with the
-- per-entity ones.
--
-- Worker writes events on: create, update (per field-set), terminate,
-- banking changes, commission changes. payload carries event-specific
-- data as JSONB so the shape evolves without a migration each time.
--
-- Payouts intentionally do NOT route through this table — they get
-- their own dedicated payment_events table in a follow-up migration.
create table if not exists hotel_events (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  event_type   text not null check (event_type in (
                 'created', 'updated', 'terminated',
                 'banking_set', 'banking_updated',
                 'commission_changed'
               )),
  actor_email  text,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists hotel_events_hotel_idx
  on hotel_events (hotel_id, created_at desc);

-- Backfill: one 'created' row per existing hotel so every profile
-- shows a "Hotel was created" event from day one, with the original
-- creation timestamp preserved. Guarded by NOT EXISTS so re-running
-- the migration is a no-op.
insert into hotel_events (hotel_id, event_type, payload, created_at)
select
  h.id,
  'created',
  jsonb_build_object('name', h.name, 'code', h.code),
  h.created_at
from hotels h
where not exists (
  select 1 from hotel_events e
  where e.hotel_id = h.id and e.event_type = 'created'
);
