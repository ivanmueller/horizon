-- commission_ledger.clawback_status — durable signal for payout-level
-- clawback netting (Phase 5 support).
--
-- Phase 4 (reconcileLedgerForBooking) handles a cancelled/refunded
-- booking by flipping its still-unpaid accrual to 'reversed'. The one
-- case it cannot model that way is a booking that was ALREADY PAID
-- OUT and is then refunded/charged back: commission_ledger.booking_id
-- is UNIQUE, so a negative offset row is structurally impossible, and
-- the money has already left the platform. Phase 4 deliberately left
-- that row as status='paid' and only LOGGED 'CLAWBACK_REQUIRED'.
--
-- A log line is not a queryable signal — the Phase 5 payout run runs
-- in a different request and cannot net against a console log. This
-- column is that durable signal:
--
--   null     — normal row, nothing owed back.
--   pending  — set by Phase 4 when a PAID row is refunded/charged
--              back. The amount in net_payable is owed back to the
--              platform and must be netted out of this hotel's next
--              payout batch.
--   netted   — set by the Phase 5 run once the pending amount has
--              been deducted from a created payout batch. Terminal.
--
-- The row's status stays 'paid' throughout (it WAS paid — that's a
-- true historical fact). clawback_status tracks the recovery
-- lifecycle independently so the audit trail of "what was paid"
-- stays honest while "what was recovered" is also tracked.
--
-- Netting model (encoded in the worker, documented here for the
-- diligence trail): a hotel's next batch nets ALL its pending
-- clawbacks against that batch's gross. If gross > clawbacks the
-- batch pays the difference and every clawback flips to 'netted'. If
-- clawbacks >= gross the batch is skipped entirely and BOTH the
-- accruals and the clawbacks carry forward untouched to the next
-- period (a Stripe Transfer cannot be negative; the deficit is never
-- forced through). This is an intentionally conservative,
-- all-or-nothing-per-hotel-per-period rule — no partial netting — so
-- the money math is trivially auditable.

alter table public.commission_ledger
  add column if not exists clawback_status text
    check (clawback_status in ('pending','netted'));

-- The Phase 5 run's clawback hot path: this hotel's outstanding
-- clawbacks awaiting netting.
create index if not exists commission_ledger_clawback_pending_idx
  on public.commission_ledger (hotel_id)
  where clawback_status = 'pending';
