-- hotels: contract_start_date, property_type, star_rating, region
--
-- New onboarding metadata for the hotel detail drawer's Details card.
-- All nullable so existing rows don't need backfill, and the admin UI
-- can roll out the new fields gradually.
--
-- `region` is intentionally separate from the existing `location`
-- column (constrained to Banff/Canmore for now). `location` is the
-- specific town; `region` is the broader market the hotel rolls up
-- into ("Canadian Rockies", "Alberta", etc.) so reporting can group
-- properties when we expand beyond Banff/Canmore.
--
-- `property_type` is freeform text rather than a CHECK constraint —
-- the right set of categories isn't settled yet (resort, boutique,
-- lodge, urban, B&B...) and a CHECK now would just block us when a
-- new partner doesn't fit the enum.

alter table public.hotels
  add column if not exists contract_start_date date,
  add column if not exists property_type       text,
  add column if not exists star_rating         smallint
    check (star_rating is null or (star_rating between 1 and 5)),
  add column if not exists region              text;
