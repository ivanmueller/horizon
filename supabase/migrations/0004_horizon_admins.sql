-- horizon_admins — email-keyed allowlist for the internal Horizon
-- team surface at /admin/. Parallel structure to hotel_users; keeps
-- the two access surfaces cleanly separated so a hotel manager can't
-- accidentally see admin data and vice versa.
--
-- Sign-in itself (Supabase Auth) is open to anyone who can prove
-- they own an email. Authorization happens here: the worker checks
-- horizon_admins on every /api/admin/* request and returns 403 if
-- there's no active row.
--
-- Idempotent — re-running this in the SQL Editor doesn't error.

create table if not exists horizon_admins (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        text not null default 'admin' check (role in ('admin')),
  status      text not null default 'active' check (status in ('active', 'revoked')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists horizon_admins_email_idx
  on horizon_admins (lower(email));

-- Same shape as hotel_users: at most one active row per email. Lets
-- us "revoke without delete" by flipping status, and re-grant later
-- without uniqueness collisions on the dead row.
create unique index if not exists horizon_admins_email_active_uniq
  on horizon_admins (lower(email))
  where status = 'active';

drop trigger if exists horizon_admins_set_updated_at on horizon_admins;
create trigger horizon_admins_set_updated_at
  before update on horizon_admins
  for each row execute function set_updated_at();

-- ── RLS policies ─────────────────────────────────────────────────────
-- The worker uses service-role for admin queries (bypasses RLS), so
-- these policies only constrain anon/authenticated keys. Authenticated
-- users can read their own row — the login page uses this to decide
-- whether to route a fresh sign-in to /admin/ or /dashboard/hotel/.
alter table horizon_admins enable row level security;

drop policy if exists horizon_admins_self_read on horizon_admins;
create policy horizon_admins_self_read on horizon_admins
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));
