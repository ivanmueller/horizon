// Generate partners.json from Supabase.
//
// Runs as part of every Cloudflare Pages build (`npm run build:partners`).
// Reads the `hotels` + `hotel_staff` tables and writes a fresh
// partners.json at the repo root that static pages — tour, checkout,
// dashboards — fetch verbatim from /partners.json. No worker round
// trip on the read path; partners.json is just a static asset cached
// at the CDN edge.
//
// Source of truth is Supabase. Admins edit at /admin/hotels/, those
// writes hit the worker, and the worker pings the Cloudflare Pages
// deploy hook so a fresh build regenerates this file. Within ~60s
// the change is live everywhere.
//
// Env (set in CF Pages → Settings → Environment variables; supply
// locally via `--env-file=scripts/supabase/.env`):
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//
// The service-role key bypasses RLS; this script is build-time only,
// never runs from a browser.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "SUPABASE_URL and SUPABASE_SERVICE_KEY are required.\n" +
      "  • Cloudflare Pages: set in Dashboard → Settings → Environment variables.\n" +
      "  • Local: use the same .env as the seed script:\n" +
      "    node --env-file=scripts/supabase/.env scripts/build/generate-partners-json.mjs",
  );
  process.exit(1);
}

const HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
};

async function rest(p) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Supabase ${p} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Postgres `numeric` columns come back from PostgREST as strings to
// preserve precision; JSON-serialise them as numbers (or null).
function num(v) {
  return v == null ? null : Number(v);
}

async function main() {
  const hotelFields =
    "id,code,name,location,type,status,effective_date," +
    "default_tracking_code,commission_pct,kickback_pool_pct,notes";
  const staffFields =
    "hotel_id,code,name,tracking_code,kickback_pct,status";

  const [hotels, staff] = await Promise.all([
    rest(`/hotels?select=${hotelFields}&order=code.asc`),
    rest(`/hotel_staff?select=${staffFields}&order=code.asc`),
  ]);

  const staffByHotel = new Map();
  for (const s of staff) {
    const list = staffByHotel.get(s.hotel_id) || [];
    list.push({
      code:          s.code,
      name:          s.name,
      tracking_code: s.tracking_code,
      kickback_pct:  num(s.kickback_pct),
      status:        s.status,
    });
    staffByHotel.set(s.hotel_id, list);
  }

  const partners = {
    _notes:
      "Auto-generated from Supabase on each Cloudflare Pages build. Do NOT " +
      "edit by hand — changes will be overwritten on the next build. Add or " +
      "edit hotels at /admin/hotels/.",
    hotels: hotels.map((h) => ({
      code:                  h.code,
      name:                  h.name,
      location:              h.location,
      type:                  h.type,
      status:                h.status,
      effective_date:        h.effective_date,
      default_tracking_code: h.default_tracking_code,
      commission_pct:        num(h.commission_pct),
      kickback_pool_pct:     num(h.kickback_pool_pct),
      employees:             staffByHotel.get(h.id) || [],
      notes:                 h.notes,
    })),
  };

  const outPath = path.join(REPO, "partners.json");
  await fs.writeFile(outPath, JSON.stringify(partners, null, 2) + "\n");

  const totalEmployees = partners.hotels.reduce(
    (n, h) => n + h.employees.length,
    0,
  );
  console.log(
    `Wrote ${partners.hotels.length} hotel(s) (${totalEmployees} employee(s)) → ` +
      path.relative(REPO, outPath),
  );
}

await main();
