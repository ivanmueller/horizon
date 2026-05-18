-- commission_ledger.kickback_pct — accrual snapshot of the attributed
-- staff member's kickback rate (Phase 2 support).
--
-- 0014 snapshotted commission_pct and platform_fee_pct only. Per the
-- agreed model (and ADDING_A_PARTNER.md), a kickback-type hotel earns
-- commission_pct PLUS the attributed staff member's kickback_pct on
-- that staff member's own bookings — additive, paid in full to the
-- HOTEL's Connect account, which then distributes the kickback portion
-- to the employee internally. Pool hotels have no per-employee
-- kickback (kickback_pool_pct is the hotel's own internal split, not
-- a Horizon obligation, so it never enters this column or the payout).
--
-- Nullable: null when no staff was attributed (hotel-pool booking) or
-- the hotel is pool-type. When set, it is frozen at accrual time like
-- the other rate snapshots so a later edit to hotel_staff.kickback_pct
-- never rewrites money already owed.
--
-- Effect on the amount columns written by the accrual hook:
--   commission_amount   = booking_amount
--                         * (commission_pct + coalesce(kickback_pct,0)) / 100
--   platform_fee_amount = commission_amount * platform_fee_pct / 100
--   net_payable         = commission_amount - platform_fee_amount

alter table public.commission_ledger
  add column if not exists kickback_pct numeric(5,2);
