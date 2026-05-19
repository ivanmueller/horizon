-- Placement status lifecycle: draft → pending.
--
-- A new placement now starts "pending" — it isn't live until the
-- material is verified (rack card printed, widget generated, …) and
-- an admin manually flips it to "active". 'draft' is renamed to
-- 'pending' (same meaning, clearer word); 'active' / 'retired'
-- unchanged.

update placements set status = 'pending' where status = 'draft';

alter table placements drop constraint if exists placements_status_check;
alter table placements
  add constraint placements_status_check
  check (status in ('pending', 'active', 'retired'));

alter table placements alter column status set default 'pending';
