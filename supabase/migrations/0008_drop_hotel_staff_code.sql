-- Drop hotel_staff.code — the per-hotel staff slug (e.g. "fairmont-ll-js")
-- that lived alongside id (uuid) and tracking_code. The slug was never
-- displayed to guests, was never used for attribution (tracking_code is
-- the attribution key, joined on bookings), and was not referenced by
-- any foreign key. With the prefix + sequence_number system from 0007,
-- tracking_code (e.g. X7K2_E_0042) is the canonical human-readable
-- identifier and id (uuid) is the stable internal reference, leaving
-- the slug column doing no work.
--
-- Safety:
--   * No FKs point at hotel_staff.code.
--   * No public-facing code reads it (checkout uses tracking_code only).
--   * Worker, admin UI, partners.json generator, and invoice script
--     have all been updated to stop selecting/writing this column in
--     the same change set as this migration.
--
-- The UNIQUE index on (code) is dropped implicitly when the column
-- goes. Existing bookings and historical attribution are unaffected —
-- they reference hotel_staff(id), not the slug.

alter table public.hotel_staff
  drop column if exists code;
