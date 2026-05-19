-- Remove the unused Stripe Connect / automated-payout schema.
--
-- Decision: the pilot pays partner commission MANUALLY (Interac
-- e-Transfer / EFT — see 0016). Stripe Connect onboarding, the
-- account.updated webhook, the commission accrual ledger and the
-- payout run were all removed from the worker and admin UI. This
-- migration drops the now-orphaned schema so the database matches the
-- code and nothing dead lingers to confuse future work.
--
-- Safe to run: no hotels were ever onboarded to Connect and no
-- bookings were accrued, so these objects hold no data. Reversible
-- only by re-applying 0014/0015 (kept in history as a record) — if
-- automated payouts return later they should be re-introduced
-- deliberately, not silently revived.
--
-- KEPT: hotels.payout_method / payout_account_holder /
-- payout_etransfer_email / payout_eft_* / payout_updated_at (0016 —
-- the manual banking that replaced Connect). KEPT: the booking-
-- payment Stripe flow (unrelated to Connect).

-- Order matters: payout_audit and commission_ledger both FK into
-- payouts. CASCADE covers the FKs/indexes/triggers defensively.
drop table if exists public.payout_audit       cascade;
drop table if exists public.commission_ledger  cascade;
drop table if exists public.payouts            cascade;

-- hotels Connect linkage (the partial unique index drops with the
-- column).
alter table public.hotels
  drop column if exists stripe_connect_account_id,
  drop column if exists stripe_payouts_enabled,
  drop column if exists stripe_onboarded_at;
