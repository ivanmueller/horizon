// Phase 0b.1 — does Bokun accept Stripe PaymentMethod IDs (pm_xxx) as paymentToken.token?
//
// This is the single architectural keystone for the SetupIntent flow. If
// Bokun says yes, we proceed with the spec as written (frontend uses
// SetupIntents and submits pm_xxx to /checkout.json/submit). If it says no
// — i.e. only the legacy tok_xxx tokens are accepted — we fall back to
// Architecture B (charge directly via PaymentIntent, then create a
// RESERVE_FOR_EXTERNAL_PAYMENT booking in Bokun).
//
// What this script does:
//   1. Creates a Stripe PaymentMethod from the basic test card 4242…
//      (or reuses one passed in via --pm=pm_xxx).
//   2. Looks up the canoe-tour product, picks the targeted day's slot.
//   3. Calls /checkout.json/options/booking-request to get the uti +
//      cardProvider config (validates the booking shape, no reservation).
//   4. Calls /checkout.json/submit with paymentMethod=CARD, the uti, and
//      paymentToken.token = pm.id.
//   5. Prints the verdict + cleanup instructions.
//
// ⚠ THIS CREATES A REAL RESERVATION IN BOKUN. Cancel it from the
//    Bokun dashboard immediately after the run (the script prints the
//    confirmationCode so you can find it).
//
// ⚠ Stripe TEST MODE assumed. Bokun's Stripe Connect link must point at
//    your TEST Stripe account, otherwise the server-side charge will fail
//    even if Bokun accepts the token format. (Bokun extranet → Payment
//    providers → Stripe → it should say "test mode".)
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_… \
//   node --env-file=scripts/bokun/.env scripts/bokun/test-pm-in-bokun.mjs --date=2026-06-15
//
//   STRIPE_SECRET_KEY=sk_test_… \
//   node --env-file=scripts/bokun/.env scripts/bokun/test-pm-in-bokun.mjs \
//     --date=2026-06-15 --pm=pm_existing_id
//
// Defaults: productId 1162721 (Banff-Hidden-Gem-Canoe-Tour), test card
// 4242 4242 4242 4242 (12/2030, CVC 123), 1 adult passenger.

import { bokunFetch } from "./api.mjs";

const PRODUCT_ID = "1162721";
const CURRENCY = "CAD";

const args = process.argv.slice(2);
const dateArg = args.find((a) => a.startsWith("--date="));
const pmArg = args.find((a) => a.startsWith("--pm="));
const targetDate = dateArg ? dateArg.slice("--date=".length) : null;
const presetPm = pmArg ? pmArg.slice("--pm=".length) : null;

if (!targetDate) {
  console.error(
    "--date=YYYY-MM-DD is required. Pick a real bookable slot inside Bokun's\n" +
      "booking cutoff window — run `scripts/bokun/inspect-product.mjs` first to find one.",
  );
  process.exit(2);
}

if (!process.env.STRIPE_SECRET_KEY && !presetPm) {
  console.error(
    "STRIPE_SECRET_KEY env var is required (or pass --pm=pm_existing_id).\n" +
      "Use a sk_test_ key from Stripe Dashboard in test mode.",
  );
  process.exit(2);
}

function hr(label) {
  console.log("\n──── " + label + " ────");
}

function dateToYmd(d) {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  if (typeof d === "number") return new Date(d).toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

async function stripeRequest(method, path, body) {
  const res = await fetch("https://api.stripe.com" + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Stripe ${method} ${path} → ${res.status}: ${data?.error?.message || JSON.stringify(data)}`,
    );
  }
  return data;
}

async function main() {
  hr("step 1 — Stripe PaymentMethod");
  let pmId;
  if (presetPm) {
    pmId = presetPm;
    console.log("  using preset --pm=" + pmId);
  } else {
    // Stripe disables raw card-data API access by default; use the canonical
    // test token instead (tok_visa → 4242 4242 4242 4242). For SCA testing,
    // pass --pm=pm_card_threeDSecureRequired (or similar) — the full list is
    // at https://stripe.com/docs/testing#test-account-numbers.
    const pm = await stripeRequest("POST", "/v1/payment_methods", {
      type: "card",
      "card[token]": "tok_visa",
    });
    pmId = pm.id;
    console.log("  created  " + pmId + "  (test token tok_visa → 4242)");
  }

  hr("step 2 — Bokun product / slot lookup");
  const product = await bokunFetch("GET", `/activity.json/${PRODUCT_ID}`);
  const adultCat = (product.pricingCategories || []).find((c) => /adult/i.test(c.title));
  if (!adultCat) throw new Error("No Adult pricing category on product " + PRODUCT_ID);
  console.log("  product       " + product.title);
  console.log("  adult cat     " + adultCat.id + " (" + adultCat.title + ")");

  const start = targetDate;
  const endD = new Date(targetDate + "T00:00:00Z");
  endD.setUTCDate(endD.getUTCDate() + 1);
  const end = endD.toISOString().slice(0, 10);
  const avail = await bokunFetch(
    "GET",
    `/activity.json/${PRODUCT_ID}/availabilities?start=${start}&end=${end}&currency=${CURRENCY}`,
  );
  const slot = (Array.isArray(avail) ? avail : []).find((a) => dateToYmd(a.date) === targetDate);
  if (!slot) {
    throw new Error(
      `No availability for ${targetDate}. Pick a date that's bookable — run inspect-product.mjs first.`,
    );
  }
  console.log("  slot          startTimeId=" + slot.startTimeId + ", rateId=" + slot.defaultRateId);

  const pickupResp = await bokunFetch("GET", `/activity.json/${PRODUCT_ID}/pickup-places`);
  const pickups = pickupResp?.pickupPlaces || [];
  const dropoffs = pickupResp?.dropoffPlaces || pickups;
  if (pickups.length === 0) throw new Error("No pickup places on product " + PRODUCT_ID);
  const pickupId = pickups[0].id;
  const dropoffId = dropoffs[0].id;
  console.log("  pickup/drop   " + pickupId + " / " + dropoffId);

  const bookingRequest = {
    mainContactDetails: [
      { questionId: "firstName", values: ["Phase0b"] },
      { questionId: "lastName", values: ["Test"] },
      { questionId: "email", values: ["phase0b@example.com"] },
      { questionId: "phoneNumber", values: ["+14035550100"] },
    ],
    activityBookings: [
      {
        activityId: Number(PRODUCT_ID),
        rateId: slot.defaultRateId,
        date: targetDate,
        startTimeId: slot.startTimeId,
        pickup: true,
        pickupPlaceId: pickupId,
        dropoff: true,
        dropoffPlaceId: dropoffId,
        passengers: [
          {
            pricingCategoryId: adultCat.id,
            passengerDetails: [
              { questionId: "firstName", values: ["Phase0b"] },
              { questionId: "lastName", values: ["Test"] },
            ],
          },
        ],
      },
    ],
  };

  hr("step 3 — Bokun /checkout.json/options/booking-request");
  const optsResp = await bokunFetch(
    "POST",
    `/checkout.json/options/booking-request?currency=${CURRENCY}`,
    bookingRequest,
  );
  const opts = Array.isArray(optsResp) ? optsResp : optsResp?.options || [];
  const opt = opts.find((o) => o.type === "CUSTOMER_FULL_PAYMENT") || opts[0];
  if (!opt) throw new Error("No checkout option returned. Raw: " + JSON.stringify(optsResp));
  if (opt.type !== "CUSTOMER_FULL_PAYMENT") {
    throw new Error(
      "Got option.type=" + opt.type + " — need CUSTOMER_FULL_PAYMENT to test the token flow.",
    );
  }
  const uti = opt.paymentMethods?.cardProvider?.uti;
  console.log("  amount        " + opt.amount + " " + opt.currency);
  console.log("  providerType  " + opt.paymentMethods?.cardProvider?.providerType);
  console.log("  uti           " + (uti ? "present" : "(missing)"));

  hr("step 4 — Bokun /checkout.json/submit  (paymentToken.token = " + pmId + ")");
  console.log("  ⚠ creating a REAL reservation in Bokun. Cancel it from the dashboard after this run.");
  const checkoutRequest = {
    source: "DIRECT_REQUEST",
    checkoutOption: "CUSTOMER_FULL_PAYMENT",
    directBooking: bookingRequest,
    amount: opt.amount,
    currency: opt.currency,
    paymentMethod: "CARD",
    ...(uti ? { uti } : {}),
    paymentToken: { token: pmId },
    sendNotificationToMainContact: false,
    showPricesInNotification: false,
    successUrl: "https://gowithhorizon.com/booking-confirmed/",
    errorUrl: "https://gowithhorizon.com/tours/Banff-Hidden-Gem-Canoe-Tour/?booking=failed",
    cancelUrl: "https://gowithhorizon.com/tours/Banff-Hidden-Gem-Canoe-Tour/",
  };

  let submitResp;
  let submitErr;
  try {
    submitResp = await bokunFetch(
      "POST",
      `/checkout.json/submit?currency=${CURRENCY}`,
      checkoutRequest,
    );
  } catch (e) {
    submitErr = e;
  }

  hr("verdict");
  if (submitResp) {
    const code = submitResp?.booking?.confirmationCode;
    const status = submitResp?.booking?.status;
    if (code && status) {
      console.log("  ✓ PROCEED with Architecture A.");
      console.log("    Bokun accepted pm_xxx in paymentToken.token and confirmed the booking.");
      console.log("    confirmationCode = " + code);
      console.log("    status           = " + status);
      console.log("    bookingId        = " + (submitResp.booking.bookingId ?? "?"));
      console.log("");
      console.log("  ⚠ Cancel reservation " + code + " from the Bokun dashboard now.");
    } else if (submitResp?.redirectRequest?.url) {
      console.log("  ? Bokun returned a redirectRequest.url instead of confirming directly.");
      console.log("    This means the channel is in REDIRECT mode and the token was ignored —");
      console.log("    you'd need to email Bokun support to switch the channel to TOKEN.");
      console.log("    redirectRequest.url = " + submitResp.redirectRequest.url);
    } else {
      console.log("  ? Unexpected response shape — inspect manually:");
      console.log(JSON.stringify(submitResp, null, 2));
    }
  } else {
    const msg = submitErr?.message || "(no message)";
    const body = submitErr?.body;
    console.log("  ✗ Bokun rejected the submit. Inspect the message:");
    console.log("    " + msg.split("\n")[0]);
    if (body) console.log("    body: " + JSON.stringify(body));
    console.log("");
    if (/invalid token format|invalid token|tok_/i.test(msg + JSON.stringify(body || ""))) {
      console.log("  → Looks like a token-format rejection. Use Architecture B (PaymentIntent +");
      console.log("    RESERVE_FOR_EXTERNAL_PAYMENT). The SetupIntent flow is not viable here.");
    } else if (/no such payment_method|payment_method.*not found/i.test(msg)) {
      console.log("  → Bokun's Stripe is connected to a different account than your test key.");
      console.log("    Verify the Stripe Connect link in Bokun → Payment providers points at the");
      console.log("    same Stripe account that minted this pm_xxx (and is in TEST mode).");
    } else {
      console.log("  → Unrecognized failure mode. Read the Bokun message carefully and adjust.");
    }
  }
}

main().catch((e) => {
  console.error("\nScript failed: " + (e?.message || e));
  if (e?.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
