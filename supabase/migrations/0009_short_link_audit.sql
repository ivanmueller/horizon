-- short_link_audit
-- Append-only history of every meaningful change made to a row in
-- short_links. Captures who changed what, when, from what value to
-- what value. Surfaced inside the admin short-link Edit modal so
-- the change-log is visible to anyone re-targeting a destination,
-- and never disappears even if the parent row is later retired.
--
-- Scope: target_url, label, notes, status. short_io_id, short_path,
-- domain, and short_url are immutable post-creation so they're not
-- candidates for the log.
--
-- Retention: forever. Audit rows are cheap (one TEXT pair + uuid +
-- timestamp). Even at 100k retargets the table stays under a few MB.

create table public.short_link_audit (
  id              uuid        primary key default gen_random_uuid(),
  short_link_id   uuid        not null
                  references public.short_links(id) on delete cascade,
  actor_email     text,
  actor_sub       text,
  field           text        not null
                  check (field in ('target_url','label','notes','status')),
  old_value       text,
  new_value       text,
  created_at      timestamptz not null default now()
);

-- Lookup path: every modal load fetches `WHERE short_link_id = ? ORDER BY created_at DESC`.
create index short_link_audit_link_idx
  on public.short_link_audit (short_link_id, created_at desc);
