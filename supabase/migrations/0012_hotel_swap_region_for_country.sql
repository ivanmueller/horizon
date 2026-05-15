-- Drop hotels.region, add hotels.country
--
-- region (added in 0010) was always going to overlap with the
-- new address column — admins were going to enter "Banff Townsite"
-- in both fields. Country, on the other hand, is genuinely
-- orthogonal to address and matters for cross-border expansion:
-- different currencies, different tax rules, different legal
-- entities. Country lives at the national level; the address
-- carries the city/region detail.
--
-- Stored as freeform text so admins can type "Canada" or "United
-- States" naturally. If a future use case needs ISO codes, a
-- normalisation migration is cheap.
--
-- Safe to apply: region has no FK dependencies, no public
-- partners.json output, and isn't populated for any real hotel
-- (added late in the design phase, only test data has touched it).

alter table public.hotels
  drop column if exists region,
  add  column if not exists country text;
