-- Append-only enforcement for hotel_events.
--
-- Why a trigger and not an RLS policy: the worker uses the service
-- role key, which bypasses RLS in Supabase. An RLS policy on
-- hotel_events therefore offers zero protection against a worker
-- compromise. A BEFORE UPDATE/DELETE trigger fires regardless of
-- the calling role (including service_role and the postgres
-- superuser inside Supabase's pooler), so it actually makes the
-- audit trail tamper-evident: an attacker who gets the service
-- key can still INSERT noise, but they cannot rewrite or erase
-- the rows that document their actions without first dropping
-- the trigger — which is itself a logged DDL event.
--
-- Cascade-delete caveat: hotel_events.hotel_id is declared
-- ON DELETE CASCADE. The trigger will block that cascade too if
-- a hotel is ever hard-deleted. In practice hotels are
-- soft-deleted (status flips to 'terminated' — see
-- handleAdminHotelTerminate), so this path never fires. For a
-- true GDPR-style hard erasure of a hotel, a DBA temporarily
-- disables this trigger, performs the delete, and re-enables.
--
-- Placement_events and staff_events keep the same vulnerability
-- profile and should get the same treatment in a follow-up
-- migration; scoping this one to hotel_events per the audit ask.

create or replace function hotel_events_no_mutate() returns trigger
language plpgsql as $$
begin
  raise exception
    'hotel_events is append-only; % is not permitted on this table',
    tg_op;
end;
$$;

drop trigger if exists hotel_events_no_update on hotel_events;
create trigger hotel_events_no_update
  before update on hotel_events
  for each row execute function hotel_events_no_mutate();

drop trigger if exists hotel_events_no_delete on hotel_events;
create trigger hotel_events_no_delete
  before delete on hotel_events
  for each row execute function hotel_events_no_mutate();
