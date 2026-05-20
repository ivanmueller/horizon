-- Managers redesign: expand role + status enums and track who
-- invited each user.
--
-- Roles: rename 'admin' → 'owner' to match the access-control
-- vocabulary users actually understand (Owner > Manager > Read-only)
-- and add 'read_only' for view-only access. Today's 'manager' stays.
--
-- Status: separate the lifecycle (invited / active) from the access
-- gate (suspended / revoked). 'suspended' is reversible — flip back
-- to active to restore access. 'revoked' is permanent removal.
-- 'invited' is derived in the app from password_set_at IS NULL, so
-- it doesn't need a DB state.
--
-- invited_by_email captures who issued the invite, populated from
-- the inviting horizon admin's JWT email at create time.
alter table hotel_users drop constraint if exists hotel_users_role_check;
update hotel_users set role = 'owner' where role = 'admin';
alter table hotel_users
  add constraint hotel_users_role_check
  check (role in ('owner', 'manager', 'read_only'));

alter table hotel_users drop constraint if exists hotel_users_status_check;
alter table hotel_users
  add constraint hotel_users_status_check
  check (status in ('active', 'suspended', 'revoked'));

alter table hotel_users add column if not exists invited_by_email text;
