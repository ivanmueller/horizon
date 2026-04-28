-- Drop bokun_tracking_code columns — moving to direct, human-readable
-- tracking codes only (the slugs we control in partners.json, like
-- FAIRMONT_LL_JS). The hex strings Bokun auto-generates per referral
-- entry are no longer used for staff_id resolution or any audit trail.
--
-- Rationale: we're not relying on Bokun's referral-tracking system any
-- more. Commission tracking is Horizon-side via the bookings table, so
-- the hex tracking codes — which were always a manual copy-back step
-- from the Bokun extranet — become dead weight. Each partial unique
-- index built on these columns also goes.
--
-- The companion partners.json clean-up + seed-script update + worker
-- handler change all land in follow-up commits; this migration is the
-- floor they build on.

-- bookings.bokun_tracking_code: stored verbatim from the inbound
-- checkout payload. Audit trail is preserved via hotel_id + staff_id
-- joins; the column is redundant.
alter table bookings drop column if exists bokun_tracking_code;

-- hotel_staff.bokun_tracking_code: was the lookup key for staff_id
-- resolution at insert time. The worker is being switched to match on
-- hotel_staff.tracking_code (the slug, which is already unique).
drop index if exists hotel_staff_bokun_tracking_code_uniq;
alter table hotel_staff drop column if exists bokun_tracking_code;

-- Backfill hotel_staff.tracking_code uniqueness — partial unique index
-- so the worker's slug-based lookup is unambiguous and so partners.json
-- typos surface as upsert errors rather than silent collisions.
create unique index if not exists hotel_staff_tracking_code_uniq
  on hotel_staff (tracking_code)
  where tracking_code is not null;

-- hotels.bokun_tracking_code: was used for the (now-removed) hand-off
-- to Bokun at checkout time. No longer needed.
drop index if exists hotels_bokun_tracking_code_uniq;
alter table hotels drop column if exists bokun_tracking_code;
