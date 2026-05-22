// Pure local logic for partners.json → expected Bokun tracking codes.
// No network calls. Used by sync-partners.mjs and runnable standalone
// for sanity checking.
//
// Phase 1 of the Short.io refactor decoupled the tracking code from
// the slug: codes are now opaque values like htl-7q4k9 (hotel) and
// htl-7q4k9-e042 (staff), generated server-side by the worker. There is
// no derivation rule any more — partners.json holds the authoritative
// tracking_code string and this script reads it verbatim.
//
// Whether to keep syncing these into Bokun's referral system is a
// separate question — Horizon attribution is now Supabase-side
// (bookings.staff_id) and no longer depends on Bokun referral codes
// (see supabase/migrations/0002_drop_bokun_tracking_code.sql).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARTNERS_JSON = resolve(__dirname, "../../partners.json");

export function loadPartners() {
  const raw = readFileSync(PARTNERS_JSON, "utf8");
  return JSON.parse(raw);
}

// Flatten partners.json into the canonical list of tracking codes
// present in the database. Each entry includes display name + role
// so downstream tooling can produce a readable plan.
export function expectedTrackingCodes(partners = loadPartners()) {
  const out = [];
  for (const hotel of partners.hotels || []) {
    if (hotel.status !== "active") continue;
    if (hotel.default_tracking_code) {
      out.push({
        trackingCode: hotel.default_tracking_code,
        kind: "hotel",
        hotelCode: hotel.code,
        displayName: hotel.name,
        commissionPct: hotel.commission_pct,
        dealType: hotel.type,
      });
    }
    for (const emp of hotel.employees || []) {
      if (emp.status !== "active") continue;
      if (!emp.tracking_code) continue;
      out.push({
        trackingCode: emp.tracking_code,
        kind: "employee",
        hotelCode: hotel.code,
        employeeCode: emp.code,
        displayName: `${emp.name} (${hotel.name})`,
        kickbackPct: emp.kickback_pct,
      });
    }
  }
  return out;
}

// Run as a script: print the expected tracking codes.
if (import.meta.url === `file://${process.argv[1]}`) {
  const list = expectedTrackingCodes();
  console.log(`Expected Bokun tracking codes (${list.length}):\n`);
  for (const t of list) {
    console.log(`  ${t.trackingCode.padEnd(24)} ${t.kind.padEnd(9)} ${t.displayName}`);
  }
}
