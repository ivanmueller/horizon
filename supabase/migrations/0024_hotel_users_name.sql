-- Adds a display name to hotel_users so the Managers section in the
-- admin can show "Anna Liang" instead of an opaque email. Nullable
-- for existing rows; required for new invites at the application layer
-- (worker validation in handleAdminHotelUserCreate), not the DB, so
-- backfills don't fail before we've gone through and named the
-- historical managers.
alter table hotel_users add column if not exists name text;
