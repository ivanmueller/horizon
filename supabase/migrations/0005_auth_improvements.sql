-- Horizon Tours — auth improvements.
--
-- Adds password_set_at to hotel_users and horizon_admins so the
-- identifier-first login page can distinguish first-time users
-- (null) from returning users (timestamp set after /dashboard/setup/).
--
-- Adds access_requests for the not_approved path on the login page.
-- Unauthenticated visitors whose email has no active hotel_users or
-- horizon_admins row are offered a request form; submissions land here
-- and are reviewed in the admin Access Requests inbox.

ALTER TABLE hotel_users
  ADD COLUMN IF NOT EXISTS password_set_at timestamptz;

ALTER TABLE horizon_admins
  ADD COLUMN IF NOT EXISTS password_set_at timestamptz;

-- ── access_requests ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS access_requests (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text        NOT NULL,
  name               text        NOT NULL,
  property_requested text,
  role_requested     text,
  reason             text,
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'approved', 'denied')),
  reviewed_by        uuid        REFERENCES horizon_admins(id),
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_requests_status_created_idx
  ON access_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS access_requests_email_idx
  ON access_requests (lower(email));

-- The worker uses service-role for all access_requests queries so RLS
-- never blocks it. Anon/authenticated keys have no read access —
-- a logged-in hotel manager cannot enumerate other requests.
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;
