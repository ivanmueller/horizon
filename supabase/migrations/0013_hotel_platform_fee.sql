-- hotels.platform_fee_pct
--
-- Horizon's platform cut on each booking. Stored per-hotel so
-- partners on different agreements can sit on different platform
-- fees without code changes. Default 5 matches our standard
-- Stripe-Connect-style split: hotel gets commission_pct, Horizon
-- platform takes platform_fee_pct, the tour operator (Horizon
-- Tours) keeps the residual.
--
-- Nullable so a deal with no platform fee (e.g. enterprise
-- pricing) is representable. The admin UI defaults the field
-- to 5 on new hotels and shows '—' when null.

alter table public.hotels
  add column if not exists platform_fee_pct numeric(5,2) default 5
    check (platform_fee_pct is null or (platform_fee_pct >= 0 and platform_fee_pct <= 100));
