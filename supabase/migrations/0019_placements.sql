-- Phase 1 of the Placements feature.
--
-- A "placement" is a passive, hotel-level marketing surface — a lobby
-- rack card, a table tent, a welcome-packet insert, a website widget.
-- Unlike a staff referral, a placement has no employee behind it and
-- earns no kickback: it attributes to the hotel at the pool level.
--
-- The placement's canonical attribution identifier stays inside the
-- existing htl- tracking-code family so the worker's checkout ?ref
-- matching and commission regex need only an additive change (allow
-- "-pNN" alongside the staff "-eNNN" suffix). A placement ?ref never
-- matches a hotel_staff row, so it correctly resolves to hotel-pool
-- attribution with zero risk to staff commission accounting.
--
--   code            'htl-8x7yu-p01'  — minted, canonical, in the URL
--   name            'Lobby rack card' — human label, admin display
--   tag             'RACK'            — short display tag (optional)
--
-- sequence_number is the per-hotel monotonic counter the worker uses
-- to mint the "-pNN" suffix, mirroring hotel_staff.sequence_number.

create table placements (
  id                  uuid primary key default gen_random_uuid(),

  hotel_id            uuid not null references hotels(id) on delete cascade,

  -- Per-hotel monotonic counter. The worker computes next = max + 1
  -- at insert time and retries on the unique index below.
  sequence_number     int not null,

  -- Canonical attribution code, e.g. 'htl-8x7yu-p01'. Lowercase +
  -- hyphen by construction so it drops straight into a short-URL
  -- path, exactly like the staff tracking_code.
  code                text not null unique,

  placement_type      text not null
                      check (placement_type in (
                        'rack_card', 'table_tent', 'welcome_packet',
                        'website_widget', 'lobby_qr', 'custom'
                      )),

  -- Human-readable display name ("Lobby rack card"). Distinct from
  -- the machine code: the code is for attribution, the name is for
  -- people.
  name                text not null,

  -- Short uppercase display tag ("RACK"). Defaults are derived from
  -- placement_type in the worker; editable. Display-only — never
  -- used for attribution.
  tag                 text,

  status              text not null default 'draft'
                      check (status in ('draft', 'active', 'retired')),

  -- Deployment metadata (Phase 2 populates these via the admin UI).
  location_in_hotel   text,
  quantity_printed    int,
  deployed_at         timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Unique within a hotel — two placements at the same property can't
-- share a sequence number. The worker computes next = max + 1.
create unique index placements_seq_per_hotel_uniq
  on placements (hotel_id, sequence_number);
create index placements_hotel_id_idx on placements (hotel_id);
create index placements_status_idx   on placements (status);

create trigger placements_set_updated_at
  before update on placements
  for each row execute function set_updated_at();

-- ── short_links.link_type — add 'placement' ────────────────────────────────
-- A placement gets its own Short.io short link (Phase 2 mints it),
-- recorded in short_links exactly like hotel/staff links. Extend the
-- check constraint to admit the new type.
alter table short_links
  drop constraint if exists short_links_link_type_check;
alter table short_links
  add constraint short_links_link_type_check
  check (link_type in ('hotel', 'staff', 'campaign', 'placement'));
