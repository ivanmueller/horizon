-- Stripe Connect payouts — schema foundation (Phase 1).
--
-- Introduces the storage for paying referral commission to partner
-- hotels via Stripe Connect. No behaviour ships in this migration —
-- it is pure schema so it can deploy ahead of the worker code and be
-- rolled back cleanly if needed. The accrual hook, reversal hook,
-- onboarding endpoints, payout run and webhook all land in later
-- phases against these tables.
--
-- Design decisions encoded here (settled with product before coding):
--
-- 1. Connect accounts are HOTEL-level only. A hotel onboards one
--    Stripe Express (transfers-only) account and distributes to its
--    own staff internally. hotel_staff is never a payout target —
--    commission_ledger.staff_id is retained for reporting/statement
--    breakdowns only.
--
-- 2. Rates are SNAPSHOT at accrual time. commission_pct and
--    platform_fee_pct are copied onto each ledger row when the
--    booking confirms, so a later edit to hotels.commission_pct /
--    hotels.platform_fee_pct never retroactively changes money
--    already owed. This is the auditable, diligence-proof model.
--
-- 3. Platform fee is EXPLICIT and SEPARATED, not baked into
--    commission. We store gross commission, the fee, and the net
--    independently so partner statements are honest line-items and
--    Horizon's marketplace revenue is a single SUM(platform_fee_amount).
--    Fee base is the commission (the partner's earnings), not gross
--    booking value — the conventional "take rate on partner revenue".
--
-- 4. Payouts are MONTHLY and only after the tour has passed (refund
--    window closed). Eligibility is a query predicate on
--    commission_ledger.tour_date, not a stored status, to minimise
--    state transitions and drift.
--
-- 5. Idempotency is enforced in the schema, mirroring the existing
--    bookings ON CONFLICT discipline:
--      • commission_ledger.booking_id is UNIQUE — one accrual per
--        booking, re-runs are no-ops.
--      • payouts UNIQUE (hotel_id, period) — one batch per hotel per
--        month, re-runs are safe; the Stripe Transfer idempotency key
--        is payouts.id.

-- ── hotels: Stripe Connect account linkage ────────────────────────────────
-- stripe_connect_account_id  — Stripe acct_… id, set when the hotel
--   manager first triggers onboarding. Nullable until then.
-- stripe_payouts_enabled     — driven SOLELY by the account.updated
--   webhook (payouts_enabled && details_submitted). Never trusted
--   from a client. This is the flag the admin profile reads to show
--   the "verified / payouts enabled" state and the payout run reads
--   to decide whether a hotel is payable.
-- stripe_onboarded_at        — first time payouts became enabled.
alter table public.hotels
  add column if not exists stripe_connect_account_id text,
  add column if not exists stripe_payouts_enabled    boolean not null default false,
  add column if not exists stripe_onboarded_at        timestamptz;

create unique index if not exists hotels_stripe_connect_account_id_uniq
  on public.hotels (stripe_connect_account_id)
  where stripe_connect_account_id is not null;

-- ── payouts ───────────────────────────────────────────────────────────────
-- One row per hotel per monthly batch. Created by the payout run.
-- UNIQUE (hotel_id, period) makes the run idempotent; payouts.id is
-- the Stripe Transfer idempotency key so a retried run never
-- double-pays.
--
-- status lifecycle:
--   pending     — row created, Transfer not yet attempted
--   processing  — Transfer submitted to Stripe, awaiting confirmation
--   paid        — Stripe confirmed the transfer (via webhook)
--   failed      — Stripe rejected / transfer failed; failed_reason set,
--                  the run reverts this batch's ledger rows for retry
create table public.payouts (
  id                   uuid        primary key default gen_random_uuid(),
  hotel_id             uuid        not null references public.hotels(id),

  -- Calendar month the batch covers, 'YYYY-MM'. Human-readable on
  -- purpose — it's shown on partner statements and in the admin UI.
  period               text        not null check (period ~ '^\d{4}-\d{2}$'),

  amount_total         numeric(12,2) not null default 0,
  currency             text        not null default 'CAD',

  status               text        not null default 'pending'
                       check (status in ('pending','processing','paid','failed')),

  -- Populated once the Transfer is created / confirmed.
  stripe_transfer_id   text,
  stripe_transfer_group text,
  failed_reason        text,
  paid_at              timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (hotel_id, period)
);

create index payouts_hotel_id_idx on public.payouts (hotel_id);
create index payouts_status_idx   on public.payouts (status);
create unique index payouts_stripe_transfer_id_uniq
  on public.payouts (stripe_transfer_id)
  where stripe_transfer_id is not null;

create trigger payouts_set_updated_at
  before update on public.payouts
  for each row execute function set_updated_at();

-- ── commission_ledger ─────────────────────────────────────────────────────
-- One row per attributed booking. Written by the accrual hook when a
-- booking confirms (Phase 2). booking_id is UNIQUE so the fire-and-
-- forget retry path the checkout page already uses produces exactly
-- one accrual.
--
-- staff_id is reporting-only — money always goes to the hotel's
-- Connect account; the hotel distributes the staff kickback portion
-- internally. The staff breakdown still surfaces on the hotel's
-- statement.
--
-- Amount columns (all CAD-scale numeric(12,2)):
--   booking_amount       — paid tour total (bookings.amount snapshot)
--   commission_amount    = booking_amount * commission_pct/100  (gross to partner)
--   platform_fee_amount  = commission_amount * platform_fee_pct/100  (Horizon take)
--   net_payable          = commission_amount - platform_fee_amount   (the Transfer)
-- The worker computes these and writes them; they are stored (not
-- generated) because the inputs are snapshots, not live FKs.
--
-- status lifecycle:
--   accrued   — owed, not yet paid. Becomes payable when
--               tour_date <= cutoff AND booking still 'confirmed'.
--   paid      — included in a completed payout; payout_id set.
--   reversed  — booking was cancelled/refunded before payout (or a
--               clawback adjustment row offsetting an already-paid one).
--   excluded  — not accruable: null booking amount, unattributable,
--               or manually excluded by an admin. Never paid. Logged.
create table public.commission_ledger (
  id                  uuid        primary key default gen_random_uuid(),

  -- Idempotency anchor. One accrual per booking, ever.
  booking_id          uuid        not null unique references public.bookings(id),

  hotel_id            uuid        not null references public.hotels(id),
  -- Reporting only — NOT a payout target. ON DELETE SET NULL keeps
  -- the accrual (and the money owed) alive even if a staff row is
  -- hard-deleted (shouldn't happen — staff soft-delete — but
  -- defensive, matching short_links).
  staff_id            uuid        references public.hotel_staff(id) on delete set null,

  booking_amount      numeric(12,2),
  currency            text        not null default 'CAD',

  -- Snapshots of the rates at accrual time. Nullable platform fee
  -- mirrors hotels.platform_fee_pct (enterprise deals can have none).
  commission_pct      numeric(5,2) not null default 0,
  platform_fee_pct    numeric(5,2),

  commission_amount   numeric(12,2) not null default 0,
  platform_fee_amount numeric(12,2) not null default 0,
  net_payable         numeric(12,2) not null default 0,

  -- Drives payout eligibility: payable once this date has passed
  -- (tour completed → refund window closed). Copied from
  -- bookings.date at accrual.
  tour_date           date,

  status              text        not null default 'accrued'
                      check (status in ('accrued','paid','reversed','excluded')),

  -- Set when this row is rolled into a payout batch.
  payout_id           uuid        references public.payouts(id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index commission_ledger_hotel_id_idx  on public.commission_ledger (hotel_id);
create index commission_ledger_staff_id_idx   on public.commission_ledger (staff_id);
create index commission_ledger_status_idx     on public.commission_ledger (status);
create index commission_ledger_payout_id_idx  on public.commission_ledger (payout_id);
-- The payout run's hot path: accrued rows whose tour has passed.
create index commission_ledger_payable_idx
  on public.commission_ledger (hotel_id, tour_date)
  where status = 'accrued';

create trigger commission_ledger_set_updated_at
  before update on public.commission_ledger
  for each row execute function set_updated_at();

-- ── payout_audit ──────────────────────────────────────────────────────────
-- Append-only history of every meaningful change to a payouts row.
-- Mirrors short_link_audit: who changed what, when, from/to. Money
-- movement must be reconstructable forever; rows are tiny so
-- retention is permanent. Cascades if the parent payout is deleted
-- (shouldn't happen — payouts are immutable post-paid — but the FK
-- is defensive and matches the short_link_audit choice).
create table public.payout_audit (
  id              uuid        primary key default gen_random_uuid(),
  payout_id       uuid        not null
                  references public.payouts(id) on delete cascade,
  actor_email     text,
  actor_sub       text,
  field           text        not null
                  check (field in ('status','amount_total','stripe_transfer_id','failed_reason')),
  old_value       text,
  new_value       text,
  created_at      timestamptz not null default now()
);

create index payout_audit_payout_idx
  on public.payout_audit (payout_id, created_at desc);
