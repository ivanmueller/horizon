// Dump the BookingQuestionsDto for a Bokun product — i.e. the exact list of
// questionIds the product expects answered on the main contact, on each
// passenger, and on the booking itself.
//
// Use this when /checkout.json/submit returns "InvalidAnswersException" so
// you can see what's required and add the missing fields to the modal.
//
// Usage:
//   node --env-file=scripts/bokun/.env scripts/bokun/dump-questions.mjs
//   node --env-file=scripts/bokun/.env scripts/bokun/dump-questions.mjs --date=2026-10-31
//
// Defaults: productId 1162721 (Banff-Hidden-Gem-Canoe-Tour). Picks the
// first bookable date if --date isn't passed.

import { bokunFetch } from "./api.mjs";

const PRODUCT_ID = "1162721";
const CURRENCY = "CAD";

const args = process.argv.slice(2);
const dateArg = args.find((a) => a.startsWith("--date="));
const targetDate = dateArg ? dateArg.slice("--date=".length) : null;

function dateToYmd(d) {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  if (typeof d === "number") return new Date(d).toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function rule(label) {
  console.log("\n──── " + label + " ────");
}

function printQuestion(q, indent) {
  const pad = " ".repeat(indent);
  const required = q.required ? "REQUIRED" : "optional";
  const type = q.dataType || q.type || "?";
  console.log(`${pad}${q.questionId.padEnd(28)}  ${required.padEnd(8)}  ${type}  ${q.label || ""}`);
  if (q.allowedValues && q.allowedValues.length > 0) {
    console.log(`${pad}  allowedValues: ${q.allowedValues.slice(0, 6).join(", ")}${q.allowedValues.length > 6 ? " …" : ""}`);
  }
}

function printQuestionGroup(label, group) {
  rule(label);
  if (!group) {
    console.log("  (none)");
    return;
  }
  // BookingQuestionsDto can present questions in various shapes depending on
  // tier; handle the common ones.
  const list =
    Array.isArray(group) ? group :
    Array.isArray(group.questions) ? group.questions :
    Array.isArray(group.bookingQuestions) ? group.bookingQuestions :
    [];
  if (list.length === 0) {
    console.log("  (none)");
    console.log("  raw shape:", JSON.stringify(group, null, 2).split("\n").slice(0, 12).join("\n  "));
    return;
  }
  list.forEach((q) => printQuestion(q, 2));
}

async function main() {
  const product = await bokunFetch("GET", `/activity.json/${PRODUCT_ID}`);
  const adultCat = (product.pricingCategories || []).find((c) => /adult/i.test(c.title));
  if (!adultCat) throw new Error("No Adult pricing category");

  // Pick a date
  const start = targetDate || new Date().toISOString().slice(0, 10);
  const endD = new Date(start + "T00:00:00Z");
  endD.setUTCDate(endD.getUTCDate() + (targetDate ? 1 : 60));
  const end = endD.toISOString().slice(0, 10);

  const avail = await bokunFetch(
    "GET",
    `/activity.json/${PRODUCT_ID}/availabilities?start=${start}&end=${end}&currency=${CURRENCY}`,
  );
  const slot = targetDate
    ? (Array.isArray(avail) ? avail : []).find((a) => dateToYmd(a.date) === targetDate)
    : (Array.isArray(avail) ? avail : []).find(
        (a) => !a.soldOut && (a.unlimitedAvailability || (a.availabilityCount ?? 0) >= 1),
      );
  if (!slot) throw new Error(`No bookable slot found (target: ${targetDate || "first-bookable"})`);

  const pickupResp = await bokunFetch("GET", `/activity.json/${PRODUCT_ID}/pickup-places`);
  const pickups = pickupResp?.pickupPlaces || [];
  const dropoffs = pickupResp?.dropoffPlaces || pickups;

  const bookingRequest = {
    mainContactDetails: [
      { questionId: "firstName", values: ["Inspect"] },
      { questionId: "lastName", values: ["Run"] },
      { questionId: "email", values: ["inspect@example.com"] },
      { questionId: "phoneNumber", values: ["+14035550100"] },
    ],
    activityBookings: [
      {
        activityId: Number(PRODUCT_ID),
        rateId: slot.defaultRateId,
        date: dateToYmd(slot.date),
        startTimeId: slot.startTimeId,
        pickup: pickups.length > 0,
        ...(pickups[0]?.id ? { pickupPlaceId: pickups[0].id } : {}),
        dropoff: dropoffs.length > 0,
        ...(dropoffs[0]?.id ? { dropoffPlaceId: dropoffs[0].id } : {}),
        passengers: [
          {
            pricingCategoryId: adultCat.id,
            passengerDetails: [
              { questionId: "firstName", values: ["Inspect"] },
              { questionId: "lastName", values: ["Run"] },
            ],
          },
        ],
      },
    ],
  };

  console.log("Product   ", product.title);
  console.log("Date/slot ", dateToYmd(slot.date), slot.startTime, "rateId=" + slot.defaultRateId);

  const optsResp = await bokunFetch(
    "POST",
    `/checkout.json/options/booking-request?currency=${CURRENCY}`,
    bookingRequest,
  );

  rule("RAW /options response — `questions` field");
  console.log(JSON.stringify(optsResp?.questions ?? null, null, 2));

  rule("RAW /options response — top-level keys");
  console.log(Object.keys(optsResp || {}).join(", ") || "(empty)");

  // Now actually try /submit with a placeholder token. Bokun runs the
  // BookingRequest validation before charging, so we can read the per-field
  // errors out of the response without any real payment happening.
  rule("trial /submit (placeholder token, validation only)");
  const opts = Array.isArray(optsResp) ? optsResp : optsResp?.options || [];
  const opt = opts.find((o) => o.type === "CUSTOMER_FULL_PAYMENT") || opts[0];
  const uti = opt?.paymentMethods?.cardProvider?.uti;

  const submitRequest = {
    source: "DIRECT_REQUEST",
    checkoutOption: "CUSTOMER_FULL_PAYMENT",
    directBooking: bookingRequest,
    amount: opt?.amount,
    currency: opt?.currency,
    paymentMethod: "CARD",
    ...(uti ? { uti } : {}),
    paymentToken: { token: "pm_validation_only_placeholder" },
    sendNotificationToMainContact: false,
    showPricesInNotification: false,
    successUrl: "https://gowithhorizon.com/booking-confirmed/",
    errorUrl: "https://gowithhorizon.com/tours/Banff-Hidden-Gem-Canoe-Tour/",
    cancelUrl: "https://gowithhorizon.com/tours/Banff-Hidden-Gem-Canoe-Tour/",
  };

  let submitResp;
  let submitErr;
  try {
    submitResp = await bokunFetch(
      "POST",
      `/checkout.json/submit?currency=${CURRENCY}`,
      submitRequest,
    );
  } catch (e) {
    submitErr = e;
  }

  if (submitErr) {
    console.log("status :", submitErr.status);
    console.log("message:", (submitErr.message || "").split("\n")[0]);
    console.log("body   :");
    console.log(JSON.stringify(submitErr.body ?? null, null, 2));
  } else {
    console.log("(no error — got a response)");
    console.log(JSON.stringify(submitResp, null, 2).slice(0, 2000));
  }
}

main().catch((e) => {
  console.error("\nScript failed:", e?.message || e);
  if (e?.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
