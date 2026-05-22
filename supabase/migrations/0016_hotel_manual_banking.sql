-- Manual payout banking on the hotel profile (pilot phase).
--
-- Phase-1 launch decision: no automated transfers. Horizon pays each
-- partner hotel's commission MANUALLY (Interac e-Transfer or EFT) from
-- its own bank while validating the model in the Rockies. Stripe
-- Connect (the stripe_connect_* columns from 0014) stays in the schema
-- and the worker, just unused — re-enabled later without a migration.
--
-- An admin records the hotel's payout details here (collected from the
-- hotel directly); no hotel-facing self-serve form in this phase.
--
-- payout_method drives which fields are meaningful:
--   'etransfer' → payout_etransfer_email (+ payout_account_holder)
--   'eft'       → payout_eft_institution / _transit / _account
--                 (+ payout_account_holder)
--   null        → nothing recorded yet
--
-- Sensitivity note (honest, for the diligence trail): EFT
-- institution/transit/account numbers are financial PII. They are
-- stored as plain columns here — Supabase Postgres is encrypted at
-- rest at the storage layer, and access is gated by the service-role
-- key + the admin auth check on every /api/admin route. No
-- application-layer field encryption in this phase: deliberate, for a
-- low-volume pilot. Interac e-Transfer (email only) is the lighter
-- option and carries no account-number storage at all. Revisit
-- (app-layer encryption, or hand it back to Stripe Connect) before
-- this scales beyond the pilot.

alter table public.hotels
  add column if not exists payout_method          text
    check (payout_method in ('etransfer','eft')),
  add column if not exists payout_account_holder  text,
  add column if not exists payout_etransfer_email text,
  add column if not exists payout_eft_institution text,
  add column if not exists payout_eft_transit     text,
  add column if not exists payout_eft_account     text,
  add column if not exists payout_updated_at      timestamptz;
