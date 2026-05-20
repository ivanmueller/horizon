-- Idempotency for payment creates. Audit flagged that a double-click
-- or a network retry on POST /api/admin/payments could insert two
-- rows for what the admin meant as one entry. Client generates a
-- UUID per form-open and sends it as an Idempotency-Key header; the
-- worker stores it on the row, and the partial unique index makes a
-- duplicate retry fail at the database — at which point the worker
-- catches the violation, fetches the original row, and returns it
-- unchanged. No second payment_created event fires.
--
-- The partial WHERE clause lets pre-existing rows (and any future
-- ones intentionally created without a key, e.g. backfills) coexist
-- without sharing a uniqueness pool.
alter table payments
  add column if not exists idempotency_key text;

create unique index if not exists payments_idempotency_key_uq
  on payments (hotel_id, idempotency_key)
  where idempotency_key is not null;
