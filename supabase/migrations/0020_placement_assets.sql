-- Phase 3 of the Placements feature: asset storage infrastructure.
--
-- A placement (rack card, table tent, …) carries design files: the
-- editable design, a print-ready export, a generated QR. Those binary
-- assets live in a private Supabase Storage bucket; this table is the
-- queryable mirror (one row per uploaded file/version), exactly the
-- same pattern short_links uses for Short.io.
--
-- The bucket is private. Browsers never hold the service key — the
-- worker mints short-lived signed upload/download URLs (see
-- supabaseStorageSignUpload / supabaseStorageSignDownload).

-- ── Private storage bucket ─────────────────────────────────────────
-- Buckets are rows in storage.buckets. Idempotent so re-running the
-- migration set is safe. public=false → no anonymous access; every
-- read goes through a signed URL.
insert into storage.buckets (id, name, public)
values ('placement-assets', 'placement-assets', false)
on conflict (id) do nothing;

-- ── placement_assets ──────────────────────────────────────────────
create table placement_assets (
  id                  uuid primary key default gen_random_uuid(),

  placement_id        uuid not null
                      references placements(id) on delete cascade,

  -- What role this file plays for the placement:
  --   design      — the editable / source artwork
  --   print_ready — the export sent to the printer
  --   qr          — generated QR image
  kind                text not null
                      check (kind in ('design', 'print_ready', 'qr')),

  -- Original filename as uploaded, for display/download naming.
  filename            text not null,

  -- Object key within the 'placement-assets' bucket. Unique so a
  -- given upload is recorded exactly once.
  storage_path        text not null unique,

  content_type        text,
  byte_size           bigint,

  -- Per (placement_id, kind) monotonic counter. The worker computes
  -- next = max + 1 at record time so version history survives
  -- re-uploads without overwriting the previous file.
  version             int not null,

  -- Lifecycle of this specific asset version. 'designed' on upload;
  -- later phases advance it (printed / deployed) or retire it.
  status              text not null default 'designed'
                      check (status in ('designed', 'printed', 'deployed', 'retired')),

  uploaded_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index placement_assets_ver_uniq
  on placement_assets (placement_id, kind, version);
create index placement_assets_placement_id_idx
  on placement_assets (placement_id);
create index placement_assets_status_idx
  on placement_assets (status);

create trigger placement_assets_set_updated_at
  before update on placement_assets
  for each row execute function set_updated_at();
