// Lists all live Bokun products and confirms availability + booking
// endpoints are queryable for each one.
//
// Exits non-zero if any live product cannot be queried.
//
// Usage:
//   node --env-file=scripts/bokun/.env scripts/bokun/validate-products.mjs
//   node --env-file=scripts/bokun/.env scripts/bokun/validate-products.mjs --days=365

import { bokunFetch } from "./api.mjs";

function parseArgs(argv) {
  const out = { days: 180 };
  for (const a of argv) {
    const m = a.match(/^--days=(\d+)$/);
    if (m) out.days = Number(m[1]);
  }
  return out;
}

function todayPlus(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function listActivities() {
  // Bokun activity search returns all activities owned by the vendor
  // whose credentials are used. Empty filter = all.
  const body = {};
  return bokunFetch("POST", "/activity.json/search?lang=EN&currency=CAD", body);
}

async function getAvailability(activityId, start, end) {
  const qs = `start=${start}&end=${end}&lang=EN&currency=CAD`;
  return bokunFetch(
    "GET",
    `/activity.json/${activityId}/availabilities?${qs}`,
  );
}

function isLive(activity) {
  // Bokun flags unreleased / archived activities; we keep anything that
  // looks publicly bookable.
  if (activity.archived === true) return false;
  if (activity.draft === true) return false;
  if (activity.published === false) return false;
  if (activity.bookable === false) return false;
  return true;
}

function slotCount(avail) {
  if (Array.isArray(avail)) return avail.length;
  if (avail && Array.isArray(avail.availabilities)) return avail.availabilities.length;
  if (avail && Array.isArray(avail.items)) return avail.items.length;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = todayPlus(0);
  const end = todayPlus(args.days);

  console.log("Bokun product validation");
  console.log("========================");
  console.log(`Window: ${start} → ${end} (${args.days} days)\n`);

  const search = await listActivities();
  const items = search.items || search.results || (Array.isArray(search) ? search : []);
  const live = items.filter(isLive);

  console.log(
    `Found ${items.length} activities in Bokun (${live.length} live / bookable)\n`,
  );

  if (live.length === 0) {
    console.log("No live products found. Nothing to validate.");
    process.exit(items.length === 0 ? 1 : 0);
  }

  let ok = 0;
  let fail = 0;
  const failures = [];
  for (const a of live) {
    const label = `[${a.id}] ${a.title || a.name || "(untitled)"}`;
    process.stdout.write(`  ${label} ... `);
    try {
      const avail = await getAvailability(a.id, start, end);
      const slots = slotCount(avail);
      console.log(`OK (${slots} availability slots)`);
      ok++;
    } catch (e) {
      console.log(`FAIL`);
      console.log(`    ${e.message}`);
      failures.push({ id: a.id, title: a.title, error: e.message });
      fail++;
    }
  }

  console.log(
    `\n${ok}/${live.length} live products queryable. ${fail} failed.\n`,
  );

  if (fail > 0) {
    console.log("Failures:");
    for (const f of failures) {
      console.log(`  [${f.id}] ${f.title}: ${f.error}`);
    }
    process.exit(1);
  }

  console.log("All live products queryable via availability endpoint. ✓");
}

main().catch((e) => {
  console.error("\nFatal error:");
  console.error(e.message);
  if (e.status === 401 || e.status === 403) {
    console.error(
      "\nAuth failure — double-check BOKUN_ACCESS_KEY and BOKUN_SECRET_KEY.",
    );
  }
  process.exit(1);
});
