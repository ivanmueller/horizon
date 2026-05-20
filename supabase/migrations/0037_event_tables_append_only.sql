-- Append-only enforcement for placement_events and staff_events.
-- Extends the protection migration 0035 added for hotel_events to
-- the other two audit tables that feed the hotel-profile timeline.
--
-- Single shared trigger function uses TG_TABLE_NAME so the error
-- message correctly identifies the blocked table at the call site,
-- without three near-identical function bodies. Same rationale as
-- 0035: service_role bypasses RLS, so the only way to actually
-- enforce append-only against a worker compromise is a trigger.
--
-- Cascade caveat carries over: placement_events.placement_id and
-- staff_events.staff_id both declare ON DELETE CASCADE. Hard
-- deleting a placement or staff row will be blocked by these
-- triggers. In practice both are soft-deleted (status flips to
-- 'retired' / 'terminated'), so the cascade path doesn't fire.

create or replace function event_table_no_mutate() returns trigger
language plpgsql as $$
begin
  raise exception
    '% is append-only; % is not permitted on this table',
    tg_table_name, tg_op;
end;
$$;

drop trigger if exists placement_events_no_update on placement_events;
create trigger placement_events_no_update
  before update on placement_events
  for each row execute function event_table_no_mutate();

drop trigger if exists placement_events_no_delete on placement_events;
create trigger placement_events_no_delete
  before delete on placement_events
  for each row execute function event_table_no_mutate();

drop trigger if exists staff_events_no_update on staff_events;
create trigger staff_events_no_update
  before update on staff_events
  for each row execute function event_table_no_mutate();

drop trigger if exists staff_events_no_delete on staff_events;
create trigger staff_events_no_delete
  before delete on staff_events
  for each row execute function event_table_no_mutate();
