-- Activity log for placements. One row per significant event in a
-- placement's lifecycle so the lightbox can render a Stripe-style
-- timeline ("Design v2 uploaded by Matteo · 2d ago", "Status changed
-- to Active", etc.).
--
-- Worker writes events for: create, status_changed, asset_uploaded,
-- asset_replaced, first_scan. Reads via GET /placements/:id/events.
-- payload carries event-specific data (old/new status, asset filename
-- + version, etc.) as JSONB so we can evolve the shape without a
-- schema migration each time.
create table if not exists placement_events (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null references placements(id) on delete cascade,
  event_type   text not null check (event_type in (
                 'created', 'status_changed', 'asset_uploaded',
                 'asset_replaced', 'first_scan', 'status_auto_active'
               )),
  actor_email  text,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists placement_events_placement_idx
  on placement_events (placement_id, created_at desc);
