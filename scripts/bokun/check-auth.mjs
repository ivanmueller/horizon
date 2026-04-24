// Smoke test — confirms Bokun credentials work and both the
// availability-side and booking-side endpoints accept the signature.
//
// Usage:
//   node --env-file=scripts/bokun/.env scripts/bokun/check-auth.mjs

import { bokunFetch } from "./api.mjs";

async function check(label, method, path, body) {
  process.stdout.write(`  ${label.padEnd(40)} `);
  try {
    await bokunFetch(method, path, body);
    console.log("OK");
    return true;
  } catch (e) {
    console.log(`FAIL (${e.status || "?"})`);
    console.log(`    ${e.message}`);
    return false;
  }
}

async function main() {
  console.log("Bokun auth smoke test");
  console.log("=====================\n");

  // One read against each major surface. These paths are known to
  // require a valid HMAC signature, so any 401/403 here means auth
  // itself is broken, not the specific resource.
  const a = await check(
    "Activities (availability endpoint family)",
    "POST",
    "/activity.json/search?lang=EN&currency=CAD",
    {},
  );
  const b = await check(
    "Bookings (booking endpoint family)",
    "POST",
    "/booking.json/activity-booking/search?lang=EN&currency=CAD",
    { pageSize: 1 },
  );

  console.log();
  if (a && b) {
    console.log("Auth is working for both endpoint families. ✓");
    return;
  }
  if (!a && !b) {
    console.error(
      "Both calls failed — credentials are almost certainly wrong or " +
        "your system clock is skewed (Bokun signs against UTC).",
    );
    process.exit(1);
  }
  console.error(
    "One surface failed. Credentials work but the failing endpoint " +
      "family may be disabled for your Bokun account tier.",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
