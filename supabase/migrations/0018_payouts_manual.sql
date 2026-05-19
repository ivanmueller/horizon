-- Manual payout record (pilot phase).
--
-- Reinstates a lean `payouts` table — NOT the automated payout-run
-- schema removed in 0017. This is a hand-entered log: after an admin
-- pays a hotel its commission (Interac e-Transfer / EFT / other),
-- they record the payment here so the dashboard can show
-- outstanding-vs-paid. No accrual, no status lifecycle, no Stripe.
--
-- A row is a completed fact, not a workflow. Fixing a mistake = delete
-- the row and add a corrected one (the worker exposes DELETE).
--
-- period is an optional free label ('YYYY-MM') for "which month this
-- payment covers" — manual payments don't always map cleanly to a
-- calendar month, so it is nullable.

create table if not exists public.payouts (
  id           uuid          primary key default gen_random_uuid(),
  hotel_id     uuid          not null references public.hotels(id),
  period       text          check (period ~ '^\d{4}-\d{2}$'),
  amount       numeric(12,2) not null check (amount > 0),
  currency     text          not null default 'CAD',
  paid_at      date          not null,
  method       text          check (method in ('etransfer','eft','other')),
  reference    text,
  note         text,
  created_at   timestamptz   not null default now()
);

create index if not exists payouts_hotel_id_idx on public.payouts (hotel_id);
create index if not exists payouts_paid_at_idx   on public.payouts (paid_at desc);
