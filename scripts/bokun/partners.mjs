// Pure local logic for partners.json → expected Bokun tracking codes.
// No network calls. Used by sync-partners.mjs and runnable standalone
// for sanity checking.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARTNERS_JSON = resolve(__dirname, "../../partners.json");

// Mirrors PARTNERS_NAMING.md:
//   trackingCode = hotelcode.toUpperCase().replace(/-/g, "_")
export function codeToTrackingCode(code) {
  return code.toUpperCase().replace(/-/g, "_");
}

export function loadPartners() {
  const raw = readFileSync(PARTNERS_JSON, "utf8");
  return JSON.parse(raw);
}

// Flatten partners.json into the canonical list of tracking codes that
// must exist in Bokun. Each entry includes display name + role so the
// sync script can produce a readable plan.
export function expectedTrackingCodes(partners = loadPartners()) {
  const out = [];
  for (const hotel of partners.hotels || []) {
    if (hotel.status !== "active") continue;
    const expected = codeToTrackingCode(hotel.code);
    if (hotel.default_tracking_code && hotel.default_tracking_code !== expected) {
      throw new Error(
        `partners.json: hotel "${hotel.code}" has default_tracking_code ` +
          `"${hotel.default_tracking_code}" but naming convention requires "${expected}"`,
      );
    }
    out.push({
      trackingCode: expected,
      kind: "hotel",
      hotelCode: hotel.code,
      displayName: hotel.name,
      commissionPct: hotel.commission_pct,
      dealType: hotel.type,
    });
    for (const emp of hotel.employees || []) {
      if (emp.status !== "active") continue;
      const empExpected = codeToTrackingCode(emp.code);
      if (emp.tracking_code && emp.tracking_code !== empExpected) {
        throw new Error(
          `partners.json: employee "${emp.code}" has tracking_code ` +
            `"${emp.tracking_code}" but naming convention requires "${empExpected}"`,
        );
      }
      out.push({
        trackingCode: empExpected,
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
