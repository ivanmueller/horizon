-- Add an optional tour_slug to placements so a placement can link
-- directly to a specific tour page instead of the hotel homepage.
-- When set, the short link target becomes /tours/<slug>/?hotel=X&ref=Y
-- instead of /?hotel=X&ref=Y, taking the visitor straight to the
-- advertised tour while preserving full referral attribution.

alter table placements
  add column if not exists tour_slug text;
