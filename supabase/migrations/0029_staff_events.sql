-- Activity log for hotel_staff. Mirrors placement_events so the
-- employee lightbox can render the same Stripe-style timeline:
-- onboarded, rate_changed, status_changed, first_booking, etc.
--
-- Worker writes events on: create, role/rate/status updates,
-- termination, and on the first confirmed booking detected for
-- this staff member (handled in the booking-record path).
-- payload carries event-specific data as JSONB so the shape
-- evolves without a migration.
create table if not exists staff_events (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references hotel_staff(id) on delete cascade,
  event_type   text not null check (event_type in (
                 'onboarded', 'rate_changed', 'status_changed',
                 'terminated', 'first_booking'
               )),
  actor_email  text,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists staff_events_staff_idx
  on staff_events (staff_id, created_at desc);
