-- Expands the placement status pipeline from
-- (pending, active, paused, retired) to
-- (designed, printed, active, paused, retired).
--
-- 'designed' replaces 'pending' as the initial state. 'printed'
-- is a new state meaning physical material has been deployed in
-- the hotel but no scan has happened yet. The worker
-- (syncClickCounts) auto-transitions 'printed' → 'active' on the
-- first cached click for the placement's short link.
--
-- Migration order:
--   1. Drop the old check constraint.
--   2. Rename existing 'pending' rows to 'designed' so the new
--      constraint accepts them.
--   3. Add the new constraint with all five legal states.
--   4. Update the column default to 'designed' for new rows.
alter table placements drop constraint if exists placements_status_check;

update placements set status = 'designed' where status = 'pending';

alter table placements
  add constraint placements_status_check
  check (status in ('designed', 'printed', 'active', 'paused', 'retired'));

alter table placements alter column status set default 'designed';
