-- Adds 'paused' to the placement status check so admins can pause a
-- placement (kebab menu in the placement detail lightbox) without
-- retiring it. Pause is reversible — flipping back to 'active'
-- restores normal behaviour. The 'designed' and 'printed' states
-- from the full pipeline land in a later migration alongside the
-- worker-driven auto-transitions.
alter table placements drop constraint if exists placements_status_check;
alter table placements
  add constraint placements_status_check
  check (status in ('pending', 'active', 'paused', 'retired'));
