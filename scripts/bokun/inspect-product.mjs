// Phase 0b inspector — pulls everything we need to know about a Bokun
// product before wiring up the booking flow on the website.
//
// Reads:
//   - GET /activity.json/{id}                         (0b.2: product config)
//   - GET /activity.json/{id}/pickup-places           (0b.3: pickup options)
//   - GET /activity.json/{id}/availabilities          (0b.4: live availability)
//   - POST /checkout.json/options/booking-request     (0b.5 dry — optional)
//
// The dry checkout-options POST does NOT reserve a seat. It validates the
// booking payload and returns the payment-method config + a `uti` we can
// use for an actual /submit. We use it here purely to verify that the
// channel's cardProvider.providerType is "REDIRECT" before building.
//
// Raw response bodies for product, pickup-places, and availability are
// dumped to scripts/bokun/.dumps/ (gitignored) so we can grep / jq them.
//
// Usage:
//   node --env-file=scripts/bokun/.env scripts/bokun/inspect-product.mjs [productId]
//   node --env-file=scripts/bokun/.env scripts/bokun/inspect-product.mjs 1162721 --dry-checkout
//   node --env-file=scripts/bokun/.env scripts/bokun/inspect-product.mjs --dry-checkout --coupon=MYCODE
//   node --env-file=scripts/bokun/.env scripts/bokun/inspect-product.mjs --dry-checkout --date=2026-06-01
//
// Defaults: productId 1162721 (Banff-Hidden-Gem-Canoe-Tour),
// availability window = today + 60 days, currency = CAD.
//
// --coupon=CODE attaches the value as BookingRequest.promoCode. Combined
// with --dry-checkout the coupon is validated and applied to the returned
// amount, but no booking is reserved (the options call is non-destructive).
//
// --date=YYYY-MM-DD targets a specific availability slot. Use this when
// the auto-picked first-bookable date is inside the API window but before
// Bokun's per-product booking cutoff (which the availabilities endpoint
// doesn't surface), or when you want to test a particular departure.
//
// --submit-real ⚠ ACTUALLY POSTS to /checkout.json/submit and CREATES A
// REAL RESERVATION in Bokun. Always requires --date. By default also
// requires --coupon (so the reservation is $0). To submit a paid
// reservation — useful for definitively testing whether the channel
// returns a redirectRequest.url for the REDIRECT flow — pass
// --allow-paid alongside --submit-real (without --coupon).
//
// When the resulting CheckoutOption is CUSTOMER_FULL_PAYMENT, the
// inspector adds paymentMethod="CARD" and the cardProvider.uti from
// the /options response, but never paymentToken. That lets us observe:
//   - REDIRECT channel → response carries redirectRequest.url
//   - TOKEN channel    → 400 demanding paymentToken
//
// Cancel any reservation produced by --submit-real from the Bokun
// dashboard right after the run.

import { mkdirSync, writeFileSync } from "node:fs";
import { bokunFetch } from "./api.mjs";

const DEFAULT_PRODUCT_ID = "1162721";
const CURRENCY = "CAD";
const WINDOW_DAYS = 60;
const DUMP_DIR = "scripts/bokun/.dumps";

const args = process.argv.slice(2);
const productId = args.find((a) => /^\d+$/.test(a)) || DEFAULT_PRODUCT_ID;
const dryCheckout = args.includes("--dry-checkout");
const couponArg = args.find((a) => a.startsWith("--coupon="));
const coupon = couponArg ? couponArg.slice("--coupon=".length) : null;
const dateArg = args.find((a) => a.startsWith("--date="));
const targetDate = dateArg ? dateArg.slice("--date=".length) : null;
const submitReal = args.includes("--submit-real");
const allowPaid = args.includes("--allow-paid");

if (submitReal && !targetDate) {
  console.error(
    "--submit-real requires --date=YYYY-MM-DD.\n" +
      "  Refusing to run without an explicit date — the auto-pick can land on a\n" +
      "  slot inside Bokun's per-product booking cutoff.",
  );
  process.exit(2);
}
if (submitReal && !coupon && !allowPaid) {
  console.error(
    "--submit-real without --coupon=CODE will create a REAL paid reservation.\n" +
      "  If you intend to test the REDIRECT flow with a real card, re-run with\n" +
      "  --allow-paid added to confirm.\n" +
      "\n" +
      "  Reminder: at no point does this script transmit your card data. /submit\n" +
      "  returns a redirectRequest.url (on REDIRECT channels) which you open in a\n" +
      "  browser to enter card details on Bokun's hosted Stripe page.",
  );
  process.exit(2);
}

mkdirSync(DUMP_DIR, { recursive: true });

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// Bokun returns availability `date` as Unix millis (e.g. 1777593600000).
// The booking-request schema wants a YYYY-MM-DD string. Send a number
// where a date string is expected and you get back a generic
// "Invalid JSON in body" — type-mismatch on Bokun's deserializer.
function dateToYmd(d) {
  if (typeof d === "number") return ymd(new Date(d));
  if (typeof d === "string") return d.length > 10 ? d.slice(0, 10) : d;
  throw new Error(`unrecognized date shape: ${JSON.stringify(d)}`);
}

function hr(label) {
  console.log("\n" + "=".repeat(72));
  console.log(label);
  console.log("=".repeat(72));
}

function row(k, v) {
  const key = String(k).padEnd(28);
  console.log(`  ${key} ${v}`);
}

function dump(name, body) {
  const path = `${DUMP_DIR}/${name}.json`;
  writeFileSync(path, JSON.stringify(body, null, 2));
  console.log(`  (raw response saved to ${path})`);
}

async function tryFetch(method, path, body) {
  try {
    const data = await bokunFetch(method, path, body);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e };
  }
}

async function main() {
  console.log(`Bokun product inspector — productId=${productId}, currency=${CURRENCY}`);

  // ---------------------------------------------------------------- 0b.2
  hr("0b.2  Product config  (GET /activity.json/" + productId + ")");
  const product = await bokunFetch("GET", `/activity.json/${productId}`);
  dump(`product-${productId}`, product);

  row("title", product.title);
  row("bookingType", product.bookingType);
  row("durationText", product.durationText || product.duration || "—");
  row("cancellationPolicy", product.cancellationPolicy?.summary || product.cancellationPolicy?.description || "—");

  console.log("\n  pricingCategories:");
  for (const c of product.pricingCategories || []) {
    row(
      `  [${c.id}] ${c.title}`,
      `minAge=${c.minAge ?? "—"}  maxAge=${c.maxAge ?? "—"}  fullTitle=${c.fullTitle ?? c.title}`,
    );
  }

  console.log("\n  rates:");
  for (const r of product.rates || []) {
    row(
      `  [${r.id}] ${r.title || "(default rate)"}`,
      `pickupSelectionType=${r.pickupSelectionType}  dropoffSelectionType=${r.dropoffSelectionType}`,
    );
    // Some Bokun setups embed the pickup list directly on the rate object.
    if (Array.isArray(r.pickupPlaces) && r.pickupPlaces.length > 0) {
      console.log(`        rate.pickupPlaces: ${r.pickupPlaces.length} entries`);
      for (const p of r.pickupPlaces) {
        row(`        [${p.id}] ${p.title || p.name}`, p.address || p.description || "");
      }
    }
    if (Array.isArray(r.pickupPlaceIds) && r.pickupPlaceIds.length > 0) {
      row(`        rate.pickupPlaceIds`, r.pickupPlaceIds.join(", "));
    }
  }

  console.log("\n  mainContactFields:");
  for (const f of product.mainContactFields || []) {
    row(`  ${f.fieldId || f.field || f.name}`, `required=${f.required ?? "—"}`);
  }
  console.log("    (note: firstName, lastName, email are always required and not listed here)");

  console.log("\n  bookingQuestions:");
  if (!product.bookingQuestions || product.bookingQuestions.length === 0) {
    console.log("    (none)");
  } else {
    for (const q of product.bookingQuestions) {
      row(`  [${q.id}] ${q.label || q.question}`, `required=${q.required ?? "—"}  scope=${q.scope || "—"}`);
    }
  }

  // ---------------------------------------------------------------- 0b.3
  // Try several pickup-places endpoint variants until one returns a list.
  const defaultRate = (product.rates || [])[0];
  const pickupAttempts = [
    `/activity.json/${productId}/pickup-places`,
    `/activity.json/${productId}/pickup-places?lang=EN&currency=${CURRENCY}`,
    defaultRate?.id ? `/activity.json/${productId}/pickup-places?rateId=${defaultRate.id}` : null,
    defaultRate?.id ? `/activity.json/${productId}/rate/${defaultRate.id}/pickup-places` : null,
  ].filter(Boolean);

  hr("0b.3  Pickup places  (multiple endpoint variants)");
  let pickups = [];
  for (const path of pickupAttempts) {
    const r = await tryFetch("GET", path);
    if (!r.ok) {
      console.log(`  ${path}\n      → ${r.error.status || "?"}: ${r.error.message.split("\n")[0]}`);
      continue;
    }
    const list = Array.isArray(r.data) ? r.data : r.data?.pickupPlaces || [];
    console.log(`  ${path}\n      → returned ${list.length} entries`);
    if (list.length > 0 && pickups.length === 0) {
      pickups = list;
      dump("pickup-places", r.data);
      for (const p of list) {
        row(`        [${p.id}] ${p.title || p.name}`, p.address || p.description || "");
      }
    }
  }
  if (pickups.length === 0) {
    console.log(
      "\n  (still empty — pickup options may live on the rate object in the dumped product JSON,\n" +
        "   or be configured at the booking-channel level. Inspect scripts/bokun/.dumps/product-*.json.)",
    );
  }

  // ---------------------------------------------------------------- 0b.3b
  // Drop-off places — Bokun models them separately from pickups even when
  // most round-trip tours return to the same place. Some products expose a
  // distinct list, others share the pickup list. Hunt the same way.
  const dropoffAttempts = [
    `/activity.json/${productId}/dropoff-places`,
    `/activity.json/${productId}/drop-off-places`,
    `/activity.json/${productId}/dropoff-places?lang=EN&currency=${CURRENCY}`,
    defaultRate?.id ? `/activity.json/${productId}/dropoff-places?rateId=${defaultRate.id}` : null,
  ].filter(Boolean);

  hr("0b.3b  Drop-off places  (multiple endpoint variants)");
  let dropoffs = [];
  for (const path of dropoffAttempts) {
    const r = await tryFetch("GET", path);
    if (!r.ok) {
      console.log(`  ${path}\n      → ${r.error.status || "?"}: ${r.error.message.split("\n")[0]}`);
      continue;
    }
    const list = Array.isArray(r.data) ? r.data : r.data?.dropoffPlaces || r.data?.places || [];
    console.log(`  ${path}\n      → returned ${list.length} entries`);
    if (list.length > 0 && dropoffs.length === 0) {
      dropoffs = list;
      dump("dropoff-places", r.data);
      for (const p of list) {
        row(`        [${p.id}] ${p.title || p.name}`, p.address || p.description || "");
      }
    }
  }
  if (dropoffs.length === 0) {
    console.log("\n  (no dedicated drop-off list — falling back to pickups list for the dry test.)");
    dropoffs = pickups;
  }

  // ---------------------------------------------------------------- 0b.4
  const start = ymd(new Date());
  const end = ymd(new Date(Date.now() + WINDOW_DAYS * 86400 * 1000));
  hr(`0b.4  Availability  (${start} → ${end})`);
  const availPath = `/activity.json/${productId}/availabilities?start=${start}&end=${end}&currency=${CURRENCY}`;
  const avail = await bokunFetch("GET", availPath);
  dump(`availabilities-${productId}-${start}_${end}`, avail);

  if (!Array.isArray(avail) || avail.length === 0) {
    console.log("  (no availability rows in window)");
  } else {
    row("rowsReturned", avail.length);
    const sample = avail[0];
    row("sample.date (raw)", sample.date);
    row("sample.date (asYMD)", dateToYmd(sample.date));
    row("sample.startTime", sample.startTime);
    row("sample.startTimeId", sample.startTimeId);
    row("sample.defaultRateId", sample.defaultRateId);
    row("sample.unlimitedAvailability", String(sample.unlimitedAvailability));
    row("sample.availabilityCount", sample.availabilityCount);
    row("sample.minParticipantsToBookNow", sample.minParticipantsToBookNow);
    if (Array.isArray(sample.pricesByRate) && sample.pricesByRate.length > 0) {
      console.log("\n  sample.pricesByRate[0].pricePerCategoryUnit (raw — verify unit against widget):");
      for (const p of sample.pricesByRate[0].pricePerCategoryUnit || []) {
        row(`  category ${p.id}`, `amount=${p.amount?.amount} ${p.amount?.currency}`);
      }
    }
  }

  // ---------------------------------------------------------------- 0b.5 dry
  if (dryCheckout) {
    hr("0b.5  Dry checkout-options  (POST /checkout.json/options/booking-request)");
    // If --date=YYYY-MM-DD was passed, target that exact day (the auto-pick
    // first-bookable can land on a slot that's inside the API window but
    // before Bokun's per-product booking cutoff). Otherwise fall back to
    // the first row that has spots.
    const firstBookable = targetDate
      ? (avail || []).find((a) => dateToYmd(a.date) === targetDate)
      : (avail || []).find(
          (a) => !a.soldOut && (a.unlimitedAvailability || (a.availabilityCount ?? 0) >= 1),
        );
    if (!firstBookable) {
      if (targetDate) {
        console.log(`  no slot found for --date=${targetDate} in availability window — skipping`);
      } else {
        console.log("  no bookable slot in window — skipping");
      }
    } else {
      const adultCategory = (product.pricingCategories || []).find(
        (c) => /adult/i.test(c.title) || /adult/i.test(c.fullTitle || ""),
      );
      if (!adultCategory) {
        console.log("  could not locate an Adult pricing category — skipping");
      } else {
        const bookingDate = dateToYmd(firstBookable.date);
        // The rate for this product has pickupSelectionType=PRESELECTED
        // and dropoffSelectionType=PRESELECTED — both are mandatory. You
        // cannot send `dropoff: false` and omit the place ID; Bokun rejects
        // with "Invalid ActivityBookingRequest - drop off, but no drop off
        // place specified". So we always send both for products like this.
        const usePickup = pickups.length > 0;
        const useDropoff = dropoffs.length > 0;
        const pickupPlaceId = usePickup ? pickups[0].id : undefined;
        const dropoffPlaceId = useDropoff ? dropoffs[0].id : undefined;

        // BookingRequest.mainContactDetails is an array of AnswerDto
        //   ({ questionId: string, values: string[] }).
        // The actual questionId strings are camelCase ("firstName",
        // "lastName", "email", "phoneNumber") — NOT the UPPER_SNAKE
        // CustomerFieldEnum values found in the OpenAPI (those describe
        // field types in product config, not answer keys).
        // /options doesn't validate question completeness; only /submit
        // does, and it returns "MISSING" with the expected questionId
        // for each missing answer. That's how we discovered the casing.
        //
        // For activities like this one, /submit also requires per-
        // passenger firstName + lastName via PassengerBookingRequest
        // .passengerDetails. Sending only { pricingCategoryId } yields
        // the same "MISSING" errors at submit time.
        const bookingRequest = {
          mainContactDetails: [
            { questionId: "firstName", values: ["Inspect"] },
            { questionId: "lastName", values: ["DryRun"] },
            { questionId: "email", values: ["inspect@example.com"] },
            { questionId: "phoneNumber", values: ["+14035550100"] },
          ],
          activityBookings: [
            {
              activityId: Number(productId),
              rateId: firstBookable.defaultRateId,
              date: bookingDate,
              startTimeId: firstBookable.startTimeId,
              pickup: usePickup,
              ...(pickupPlaceId ? { pickupPlaceId } : {}),
              dropoff: useDropoff,
              ...(dropoffPlaceId ? { dropoffPlaceId } : {}),
              passengers: [
                {
                  pricingCategoryId: adultCategory.id,
                  passengerDetails: [
                    { questionId: "firstName", values: ["Inspect"] },
                    { questionId: "lastName", values: ["DryRun"] },
                  ],
                },
              ],
            },
          ],
          // BookingRequest.promoCode (top-level, per OpenAPI). Present only
          // when --coupon=CODE was passed. The /options endpoint is
          // non-reserving — Bokun validates the code, applies the discount
          // to the returned amount, but no booking is held.
          ...(coupon ? { promoCode: coupon } : {}),
        };
        row("dry-target.date (asYMD)", bookingDate);
        row("dry-target.startTimeId", firstBookable.startTimeId);
        row("dry-target.passenger", `1 × [${adultCategory.id}] ${adultCategory.title}`);
        row("dry-target.pickup", usePickup ? `place ${pickupPlaceId}` : "(omitted — no pickup IDs)");
        row("dry-target.dropoff", useDropoff ? `place ${dropoffPlaceId}` : "(omitted — no dropoff IDs)");
        row("dry-target.promoCode", coupon || "(none)");

        const r = await tryFetch(
          "POST",
          `/checkout.json/options/booking-request?currency=${CURRENCY}`,
          bookingRequest,
        );
        if (!r.ok) {
          console.log(`\n  /checkout.json/options/booking-request rejected: ${r.error.message}`);
          if (r.error.body) console.log("  response body:", JSON.stringify(r.error.body, null, 2));
          console.log("  (request body that was sent:)");
          console.log(JSON.stringify(bookingRequest, null, 2));
        } else {
          dump("checkout-options-response", r.data);
          // Per the OpenAPI Checkout schema, the response is
          //   { options: CheckoutOption[], questions: BookingQuestionsDto }
          // not a bare array.
          const opts = Array.isArray(r.data) ? r.data : r.data?.options || [];
          const opt = opts.find((o) => o.type === "CUSTOMER_FULL_PAYMENT") || opts[0];
          if (!opt) {
            console.log("  no checkout option returned (raw response saved)");
          } else {
            row("option.type", opt.type);
            // Per OpenAPI: CheckoutOption.amount is a number, currency a
            // sibling string, formattedAmount a sibling display string.
            row("option.amount", `${opt.amount} ${opt.currency}  (formatted: ${opt.formattedAmount ?? "—"})`);
            row("option.cardProvider.providerType", opt.paymentMethods?.cardProvider?.providerType);
            row("option.cardProvider.uti present", String(Boolean(opt.paymentMethods?.cardProvider?.uti)));
            // The TOKEN-vs-REDIRECT gate only matters when there's actually
            // a payment to take. CUSTOMER_NO_PAYMENT (e.g. 100%-off coupon
            // zeroing the total) returns no cardProvider at all, which is
            // expected — don't fire the warning in that case.
            if (
              opt.type !== "CUSTOMER_NO_PAYMENT" &&
              opt.paymentMethods?.cardProvider?.providerType !== "REDIRECT"
            ) {
              console.log(
                "\n  WARNING: providerType is not REDIRECT. The build assumes the hosted-payment-page\n" +
                  "  flow. Contact Bokun support to switch the channel before continuing.",
              );
            }

            // ------------------------------------------------------ 0b.5b real submit
            // Optional: actually POST /checkout.json/submit. CREATES A REAL
            // RESERVATION. Guarded by --submit-real and the requires-date
            // check at the top of the script.
            if (submitReal) {
              hr("0b.5b  REAL submit  (POST /checkout.json/submit)  ⚠ creates a real booking");
              const isPaid = opt.type === "CUSTOMER_FULL_PAYMENT";
              const cardProviderUti = opt.paymentMethods?.cardProvider?.uti;
              if (isPaid) {
                console.log(`  ⚠ Submitting a REAL paid reservation: ${opt.amount} ${opt.currency}`);
                console.log("  ⚠ Bokun should reply with redirectRequest.url — open it in a browser");
                console.log("  ⚠ to enter card details on their hosted Stripe page. If you do NOT");
                console.log("  ⚠ open the URL or do NOT complete payment, no money changes hands,");
                console.log("  ⚠ but the reservation still holds a seat — cancel from the dashboard.");
              } else {
                console.log("  ⚠ This call creates a real reservation in Bokun. Cancel it from the");
                console.log("  ⚠ dashboard immediately after this run.");
              }
              console.log("");

              const checkoutRequest = {
                source: "DIRECT_REQUEST",
                checkoutOption: opt.type,
                directBooking: bookingRequest,
                amount: opt.amount,
                currency: opt.currency,
                sendNotificationToMainContact: false,
                showPricesInNotification: false,
                successUrl: "https://gowithhorizon.com/booking/confirmed",
                errorUrl: "https://gowithhorizon.com/booking/failed",
                cancelUrl: "https://gowithhorizon.com/tours/Banff-Hidden-Gem-Canoe-Tour/",
                // For CUSTOMER_FULL_PAYMENT we attach paymentMethod=CARD
                // and the uti returned by /options. We deliberately do NOT
                // include paymentToken — that's the field a TOKEN-flow
                // channel would require us to populate via Stripe.js
                // tokenization. Omitting it lets us observe Bokun's
                // behavior:
                //   - REDIRECT channel → returns redirectRequest.url
                //     pointing to a Bokun-hosted Stripe page
                //   - TOKEN channel    → 400 demanding paymentToken,
                //     definitively confirming TOKEN config
                ...(isPaid ? { paymentMethod: "CARD", ...(cardProviderUti ? { uti: cardProviderUti } : {}) } : {}),
              };

              const sr = await tryFetch(
                "POST",
                `/checkout.json/submit?currency=${CURRENCY}`,
                checkoutRequest,
              );
              if (!sr.ok) {
                console.log(`  /checkout.json/submit rejected: ${sr.error.message}`);
                if (sr.error.body) console.log("  response body:", JSON.stringify(sr.error.body, null, 2));
                console.log("  (request body that was sent:)");
                console.log(JSON.stringify(checkoutRequest, null, 2));
              } else {
                dump("checkout-submit-response", sr.data);
                row("booking.confirmationCode", sr.data?.booking?.confirmationCode ?? "(missing)");
                row("booking.bookingId", sr.data?.booking?.bookingId ?? "(missing)");
                row("booking.totalPrice", sr.data?.booking?.totalPrice ?? "(missing)");
                row("booking.status", sr.data?.booking?.status ?? "(missing)");
                row("redirectRequest present", String(Boolean(sr.data?.redirectRequest)));
                if (sr.data?.redirectRequest) {
                  row("redirectRequest.url", sr.data.redirectRequest.url);
                  row("redirectRequest.method", sr.data.redirectRequest.method ?? "(none)");
                  console.log(
                    "\n  ✓ redirectRequest.url is populated — channel DOES support REDIRECT.\n" +
                      "    The TOKEN providerType label on /options does NOT mean redirects are off.\n" +
                      "    Open the URL above in a browser to see Bokun's hosted payment page.",
                  );
                } else if (isPaid) {
                  console.log(
                    "\n  ✗ no redirectRequest on a paid submit — channel is genuinely TOKEN.\n" +
                      "    Bokun expected paymentToken in the request but didn't get one. The\n" +
                      "    integration would need client-side Stripe.js tokenization to proceed,\n" +
                      "    or you'd email Bokun support to flip the channel to REDIRECT.",
                  );
                } else {
                  console.log(
                    "\n  ✗ no redirectRequest in the response. At $0 this is expected on either\n" +
                      "    flavor (TOKEN or REDIRECT) — Bokun has nothing to charge so nothing\n" +
                      "    to redirect to. Inconclusive about the TOKEN/REDIRECT question.",
                  );
                }
                console.log(
                  "\n  ⚠ A real reservation was created. Find it in your Bokun dashboard\n" +
                    `    by confirmationCode "${sr.data?.booking?.confirmationCode}" and cancel it.`,
                );
              }
            }
          }
        }
      }
    }
  }

  // ----------------------------------------------------- copy-paste summary
  hr("SUMMARY  — paste this into the build doc");
  const adultCategory = (product.pricingCategories || []).find((c) => /adult/i.test(c.title));
  const seniorCategory = (product.pricingCategories || []).find((c) => /senior/i.test(c.title));
  const youthCategory = (product.pricingCategories || []).find((c) => /youth/i.test(c.title));
  const childCategory = (product.pricingCategories || []).find((c) => /child/i.test(c.title) || /kid/i.test(c.title));
  const infantCategory = (product.pricingCategories || []).find((c) => /infant/i.test(c.title));
  const banffPickup = pickups.find((p) => /banff/i.test(p.title || p.name || ""));
  const canmorePickup = pickups.find((p) => /canmore/i.test(p.title || p.name || ""));

  console.log(`PRODUCT_ID                = ${productId}`);
  console.log(`BOOKING_TYPE              = ${product.bookingType}`);
  console.log(`DEFAULT_RATE_ID           = ${defaultRate?.id ?? "?"}`);
  console.log(`PICKUP_SELECTION_TYPE     = ${defaultRate?.pickupSelectionType ?? "?"}`);
  console.log(`DROPOFF_SELECTION_TYPE    = ${defaultRate?.dropoffSelectionType ?? "?"}`);
  console.log(`PRICING_CATEGORY_ADULT    = ${adultCategory?.id ?? "?"}`);
  console.log(`PRICING_CATEGORY_SENIOR   = ${seniorCategory?.id ?? "(none)"}`);
  console.log(`PRICING_CATEGORY_YOUTH    = ${youthCategory?.id ?? "(none)"}`);
  console.log(`PRICING_CATEGORY_CHILD    = ${childCategory?.id ?? "(none)"}`);
  console.log(`PRICING_CATEGORY_INFANT   = ${infantCategory?.id ?? "(none)"}`);
  console.log(`PICKUP_BANFF_ID           = ${banffPickup?.id ?? "?"}`);
  console.log(`PICKUP_CANMORE_ID         = ${canmorePickup?.id ?? "?"}`);
  console.log("");
}

main().catch((e) => {
  console.error("\nInspector failed:");
  console.error(e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
