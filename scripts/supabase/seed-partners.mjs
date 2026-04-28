// Seed hotels + hotel_staff from partners.json into Supabase.
//
// Idempotent — safe to run repeatedly. Uses PostgREST upsert
// (Prefer: resolution=merge-duplicates) keyed on the unique `code` slug.
//
// Setup:
//   cp scripts/supabase/.env.example scripts/supabase/.env
//   # paste SUPABASE_URL + SUPABASE_SERVICE_KEY into scripts/supabase/.env
//
// Run:
//   node --env-file=scripts/supabase/.env scripts/supabase/seed-partners.mjs
//
// The service_role key bypasses Row-Level Security. This script is meant
// for local one-shot use; never deploy it or call it from a browser.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "SUPABASE_URL and SUPABASE_SERVICE_KEY are required.\n" +
      "Copy scripts/supabase/.env.example to scripts/supabase/.env and run with\n" +
      "  node --env-file=scripts/supabase/.env scripts/supabase/seed-partners.mjs",
  );
  process.exit(1);
}

const partnersPath = path.join(REPO, "partners.json");
const partners = JSON.parse(fs.readFileSync(partnersPath, "utf8"));

const HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function rest(method, p, { body, prefer } = {}) {
  const url = `${SUPABASE_URL}/rest/v1${p}`;
  const headers = { ...HEADERS };
  if (prefer) headers["Prefer"] = prefer;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${p} → ${res.status} ${res.statusText}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function hotelRow(h) {
  return {
    code:                  h.code,
    name:                  h.name,
    location:              h.location,
    type:                  h.type,
    commission_pct:        h.commission_pct ?? 0,
    kickback_pool_pct:     h.kickback_pool_pct ?? null,
    default_tracking_code: h.default_tracking_code ?? null,
    status:                h.status ?? "active",
    effective_date:        h.effective_date ?? null,
    notes:                 h.notes ?? null,
  };
}

function staffRow(hotelId, e) {
  return {
    hotel_id:      hotelId,
    code:          e.code,
    name:          e.name,
    tracking_code: e.tracking_code ?? null,
    kickback_pct:  e.kickback_pct ?? 0,
    status:        e.status ?? "active",
  };
}

async function upsertHotels() {
  const rows = partners.hotels.map(hotelRow);
  console.log(`Upserting ${rows.length} hotels…`);
  await rest("POST", "/hotels?on_conflict=code", {
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function fetchHotelIdMap() {
  const rows = await rest("GET", "/hotels?select=id,code");
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}

async function upsertStaff(hotelIdByCode) {
  const rows = [];
  for (const h of partners.hotels) {
    const hotelId = hotelIdByCode[h.code];
    if (!hotelId) {
      console.warn(`  skip — no hotel id resolved for ${h.code}`);
      continue;
    }
    for (const e of h.employees || []) {
      rows.push(staffRow(hotelId, e));
    }
  }
  if (rows.length === 0) {
    console.log("No staff rows to upsert.");
    return;
  }
  console.log(`Upserting ${rows.length} hotel_staff rows…`);
  await rest("POST", "/hotel_staff?on_conflict=code", {
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

await upsertHotels();
const hotelIdByCode = await fetchHotelIdMap();
await upsertStaff(hotelIdByCode);
console.log("Seed complete.");
