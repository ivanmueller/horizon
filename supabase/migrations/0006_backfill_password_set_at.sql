-- Backfill password_set_at for rows that predate 0005_auth_improvements.
--
-- Any horizon_admin or hotel_user that existed before that migration
-- already has a Supabase Auth account and a working password, so their
-- password_set_at should not be null. Without this, the login-page
-- preflight returns first_time_setup for them and sends an OTP instead
-- of showing the password field.

UPDATE horizon_admins
  SET password_set_at = now()
  WHERE password_set_at IS NULL
    AND status = 'active';

UPDATE hotel_users
  SET password_set_at = now()
  WHERE password_set_at IS NULL
    AND status = 'active';
