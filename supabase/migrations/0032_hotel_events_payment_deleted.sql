-- Extend hotel_events to track payment deletions as well as
-- creations. Initially we only logged 'payment_created' (track
-- generation only) — pulled in 'payment_deleted' once the admin
-- needed visibility into housekeeping changes too. Drop + recreate
-- because Postgres can't ALTER a CHECK constraint in place.
alter table hotel_events
  drop constraint if exists hotel_events_event_type_check;
alter table hotel_events
  add  constraint hotel_events_event_type_check
  check (event_type in (
    'created', 'updated', 'terminated',
    'banking_set', 'banking_updated',
    'commission_changed',
    'payment_created', 'payment_deleted'
  ));
