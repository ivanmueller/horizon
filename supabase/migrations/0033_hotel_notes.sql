-- Persistent storage for admin-authored notes attached to a hotel.
-- Surfaces in the hotel-profile Recent activity timeline (newest at
-- the top above the seeded "Hotel was created" event) and in the
-- sticky yellow Notes panel in the right rail.
--
-- v1 stored these in localStorage keyed by hotel id, which lost the
-- notes on a different browser / cache clear. This table moves them
-- to a shared source of truth so any admin sees the same context on
-- the same hotel.
--
-- author_email + author_display are denormalised on the row so the
-- byline keeps reading correctly even if the admin account is later
-- renamed or removed. text is unbounded by design — composer hints
-- promote short markdown, but operational context (escalations,
-- contract changes) can be long-form.
create table if not exists hotel_notes (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id) on delete cascade,
  text            text not null check (length(text) > 0),
  author_email    text,
  author_display  text,
  created_at      timestamptz not null default now()
);

create index if not exists hotel_notes_hotel_idx
  on hotel_notes (hotel_id, created_at desc);
