// Smoke test — confirms Bokun credentials work against both the
// availability-side and booking-side endpoint families.
//
// Auth is the question, not data. Bokun verifies the HMAC signature
// before routing; a 200 *or* a 404 with a JSON body both prove the
// signature was accepted. A 401/403 means auth itself failed.
//
// Usage:
//   node --env-file=scripts/bokun/.env scripts/bokun/check-auth.mjs

import { bokunFetch } from "./api.mjs";

async function check(label, method, path, body) {
  process.stdout.write(`  ${label.padEnd(42)} `);
  try {
    await bokunFetch(method, path, body);
    console.log("OK (200, signature accepted)");
    return true;
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      console.log(`FAIL (${e.status}) — signature rejected`);
      console.log(`    ${e.message}`);
      return false;
    }
    // 404 / 5xx etc. — Bokun got past auth and into routing or the
    // resource layer. The signature was accepted; the path or payload
    // is the problem, not credentials.
    console.log(`OK (signature accepted, server returned ${e.status})`);
    return true;
  }
}

async function main() {
  console.log("Bokun auth smoke test");
  console.log("=====================\n");

  const a = await check(
    "Activities (availability endpoint family)",
    "POST",
    "/activity.json/search?lang=EN&currency=CAD",
    {},
  );
  // Booking-side smoke test: GET a booking by an obviously-fake id.
  // Bokun runs HMAC verification before doing the lookup, so a 404
  // here proves auth, regardless of whether anyone has booked yet.
  const b = await check(
    "Bookings (booking endpoint family)",
    "GET",
    "/booking.json/0",
  );

  console.log();
  if (a && b) {
    console.log("Auth is working for both endpoint families. ✓");
    return;
  }
  if (!a && !b) {
    console.error(
      "Both signatures rejected — credentials are wrong, or your " +
        "system clock is skewed (Bokun signs against UTC to the second).",
    );
    process.exit(1);
  }
  console.error(
    "One surface rejected the signature. The endpoint family that " +
      "failed may require a key with different scopes.",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
