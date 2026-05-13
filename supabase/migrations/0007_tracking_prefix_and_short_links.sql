-- Phase 1 of the Short.io / QR refactor.
--
-- Three structural changes that together unbundle the three identifier
-- layers (internal UUID / internal tracking code / public short URL):
--
-- 1. hotels.tracking_prefix — 4-char random uppercase alphanumeric, e.g.
--    'X7K2'. Immutable per hotel. Replaces the old "uppercase the slug"
--    convention, which produced colliding prefixes (Fairmont Chateau
--    Lake Louise and Fairmont Coast Luxury Lodge both yielded FCLL).
--    Random avoids the collision class entirely.
--
-- 2. hotel_staff.sequence_number — per-hotel monotonic counter, used to
--    mint opaque tracking codes like X7K2_E_0042. Decouples the
--    employee identifier from the employee's name, so the public-facing
--    short URL (and the QR encoding it) survives staff turnover.
--
-- 3. short_links — mirror table for Short.io's records. Stores
--    short_io_id so we can call Short.io's update API to re-target a
--    redirect later without changing what the QR encodes. This is the
--    single piece of infrastructure that gives us "change the
--    destination later without reprinting" for every QR in the wild.
--
-- See PARTNERS_NAMING.md and ADDING_A_PARTNER.md for the new naming
-- convention this enables.

-- ── hotels.tracking_prefix ─────────────────────────────────────────────────
alter table hotels
  add column if not exists tracking_prefix text;

-- Backfill: assign a unique random prefix to any existing row.
-- The 32-char alphabet omits I, O, 0, 1 to keep codes unambiguous when
-- printed alongside QR codes or read over the phone.
do $$
declare
  alphabet  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  row_id    uuid;
  attempt   int;
begin
  for row_id in select id from hotels where tracking_prefix is null loop
    attempt := 0;
    loop
      candidate := '';
      for i in 1..4 loop
        candidate := candidate || substr(alphabet, floor(random() * 32)::int + 1, 1);
      end loop;
      begin
        update hotels set tracking_prefix = candidate where id = row_id;
        exit;
      exception when unique_violation then
        attempt := attempt + 1;
        if attempt > 50 then
          raise exception 'Could not allocate unique tracking_prefix after 50 attempts';
        end if;
      end;
    end loop;
  end loop;
end $$;

alter table hotels
  alter column tracking_prefix set not null;

create unique index if not exists hotels_tracking_prefix_uniq
  on hotels (tracking_prefix);

-- ── hotel_staff.sequence_number ─────────────────────────────────────────────
alter table hotel_staff
  add column if not exists sequence_number int;

-- Backfill: rank existing rows within each hotel by created_at so the
-- numbering reflects the historical order of onboarding.
with ranked as (
  select id, row_number() over (
    partition by hotel_id order by created_at
  ) as rn
  from hotel_staff
)
update hotel_staff hs
set sequence_number = ranked.rn
from ranked
where hs.id = ranked.id
  and hs.sequence_number is null;

alter table hotel_staff
  alter column sequence_number set not null;

-- Unique within a hotel — two staff at the same property can't share
-- a sequence number. The worker computes next = max + 1 at insert time.
create unique index if not exists hotel_staff_seq_per_hotel_uniq
  on hotel_staff (hotel_id, sequence_number);

-- ── short_links ─────────────────────────────────────────────────────────────
-- One row per Short.io link. Multiple rows can point at the same hotel
-- or staff (lobby QR vs. welcome-packet QR vs. campaign QR), which is
-- why hotel_id and staff_id are not UNIQUE — many-to-one from day one.
--
-- status='retired' soft-deletes: the Short.io redirect stays alive
-- (preserving any printed QR codes in circulation), the row stays as
-- audit history for old click data, but it's hidden from the admin
-- "active links" view.
create table short_links (
  id                  uuid primary key default gen_random_uuid(),

  -- Short.io's internal link id. Required for the update/delete API
  -- calls that re-target the redirect later. Unique so we never
  -- double-record the same Short.io link.
  short_io_id         text not null,

  -- Branded short domain, e.g. 'link.gowithhorizon.com'. Stored per
  -- row so we can support multiple short domains later (regional /
  -- co-branded) without a schema change.
  domain              text not null default 'link.gowithhorizon.com',

  -- Path component, e.g. 'x7k2-e042'. IMMUTABLE after first publish:
  -- once a QR encodes a short_url, the path can never change. To
  -- "rename" a link, create a new short_links row with a new path and
  -- a new QR — the old row stays as-is.
  short_path          text not null,

  -- Computed canonical short URL — kept in the row so the admin UI
  -- and copy-to-clipboard surfaces have a single source of truth.
  short_url           text generated always as (
    'https://' || domain || '/' || short_path
  ) stored,

  -- Current redirect destination. Editable: this is the value that
  -- changes when an employee leaves, a campaign ends, a hotel
  -- rebrands. The QR doesn't care because the QR encodes short_url,
  -- not target_url.
  target_url          text not null,

  -- What kind of entity the link primarily attributes to. 'campaign'
  -- is forward-looking — no campaigns table exists yet; the
  -- short_links.label and notes fields carry campaign metadata for
  -- now.
  link_type           text not null check (link_type in ('hotel', 'staff', 'campaign')),

  -- Both nullable so a single link can attribute at the hotel level
  -- (staff_id null) or the staff level (both set), or be a pure
  -- campaign link (both null) that just redirects somewhere.
  -- ON DELETE SET NULL keeps the click history alive even if the
  -- referenced hotel or staff row is hard-deleted (which shouldn't
  -- happen — we soft-delete via status — but the FK is defensive).
  hotel_id            uuid references hotels(id) on delete set null,
  staff_id            uuid references hotel_staff(id) on delete set null,

  -- Admin-only metadata. label is the human description in the
  -- admin UI ("Lobby QR", "Welcome packet — summer 2026"). notes
  -- is freeform.
  label               text,
  notes               text,

  status              text not null default 'active'
                      check (status in ('active', 'retired')),

  -- Periodically synced from Short.io's stats API by a cron worker
  -- (Phase 5). Cached locally so the admin dashboard doesn't make a
  -- Short.io API call per row on every page load.
  click_count_cached  int not null default 0,
  last_clicked_at     timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (domain, short_path)
);

create unique index short_links_short_io_id_uniq on short_links (short_io_id);
create index        short_links_hotel_id_idx     on short_links (hotel_id);
create index        short_links_staff_id_idx     on short_links (staff_id);
create index        short_links_status_idx       on short_links (status);

create trigger short_links_set_updated_at
  before update on short_links
  for each row execute function set_updated_at();
