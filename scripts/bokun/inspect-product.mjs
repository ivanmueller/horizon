// Phase 0b inspector — pulls everything we need to know about a Bokun
// product before wiring up the booking flow on the website.
//
// Reads:
//   - GET /activity.json/{id}                    (0b.2: product config)
//   - GET /activity.json/{id}/pickup-places      (0b.3: pickup options)
//   - GET /activity.json/{id}/availabilities     (0b.4: live availability)
//   - POST /checkout.json/options/booking-request  (0b.5 dry — optional)
//
// The dry checkout-options POST does NOT reserve a seat. It validates the
// booking payload and returns the payment-method config + a `uti` we can
// use for an actual /submit. We use it here purely to verify that the
// channel's cardProvider.providerType is "REDIRECT" before building.
//
// Usage:
//   node --env-file=scripts/bokun/.env scripts/bokun/inspect-product.mjs [productId]
//   node --env-file=scripts/bokun/.env scripts/bokun/inspect-product.mjs 1162721 --dry-checkout
//
// Defaults: productId 1162721 (Banff-Hidden-Gem-Canoe-Tour),
// availability window = today + 60 days, currency = CAD.

import { bokunFetch } from "./api.mjs";

const DEFAULT_PRODUCT_ID = "1162721";
const CURRENCY = "CAD";
const WINDOW_DAYS = 60;

const args = process.argv.slice(2);
const productId = args.find((a) => /^\d+$/.test(a)) || DEFAULT_PRODUCT_ID;
const dryCheckout = args.includes("--dry-checkout");

function ymd(d) {
  return d.toISOString().slice(0, 10);
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

async function main() {
  console.log(`Bokun product inspector — productId=${productId}, currency=${CURRENCY}`);

  // ---------------------------------------------------------------- 0b.2
  hr("0b.2  Product config  (GET /activity.json/" + productId + ")");
  const product = await bokunFetch("GET", `/activity.json/${productId}`);

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
  }

  console.log("\n  mainContactFields:");
  for (const f of product.mainContactFields || []) {
    row(`  ${f.fieldId || f.field || f.name}`, `required=${f.required ?? "—"}`);
  }

  console.log("\n  bookingQuestions:");
  if (!product.bookingQuestions || product.bookingQuestions.length === 0) {
    console.log("    (none)");
  } else {
    for (const q of product.bookingQuestions) {
      row(`  [${q.id}] ${q.label || q.question}`, `required=${q.required ?? "—"}  scope=${q.scope || "—"}`);
    }
  }

  // ---------------------------------------------------------------- 0b.3
  hr("0b.3  Pickup places  (GET /activity.json/" + productId + "/pickup-places)");
  let pickups = [];
  try {
    pickups = await bokunFetch("GET", `/activity.json/${productId}/pickup-places`);
    if (!Array.isArray(pickups) || pickups.length === 0) {
      console.log("  (no pickup places returned)");
    } else {
      for (const p of pickups) {
        row(`  [${p.id}] ${p.title || p.name}`, p.description || p.address || "");
      }
    }
  } catch (e) {
    console.log("  pickup-places fetch failed:", e.message);
  }

  // ---------------------------------------------------------------- 0b.4
  const start = ymd(new Date());
  const end = ymd(new Date(Date.now() + WINDOW_DAYS * 86400 * 1000));
  hr(`0b.4  Availability  (${start} → ${end})`);
  const availPath = `/activity.json/${productId}/availabilities?start=${start}&end=${end}&currency=${CURRENCY}`;
  const avail = await bokunFetch("GET", availPath);

  if (!Array.isArray(avail) || avail.length === 0) {
    console.log("  (no availability rows in window)");
  } else {
    row("rowsReturned", avail.length);
    const sample = avail[0];
    row("sample.date", sample.date);
    row("sample.startTime", sample.startTime);
    row("sample.startTimeId", sample.startTimeId);
    row("sample.defaultRateId", sample.defaultRateId);
    row("sample.unlimitedAvailability", String(sample.unlimitedAvailability));
    row("sample.availabilityCount", sample.availabilityCount);
    row("sample.minParticipantsToBookNow", sample.minParticipantsToBookNow);
    if (Array.isArray(sample.pricesByRate) && sample.pricesByRate.length > 0) {
      console.log("\n  sample.pricesByRate[0].pricePerCategoryUnit:");
      for (const p of sample.pricesByRate[0].pricePerCategoryUnit || []) {
        row(
          `  category ${p.id}`,
          `amount=${p.amount?.amount} ${p.amount?.currency}  (display=${(p.amount?.amount / 100).toFixed(2)})`,
        );
      }
    }
  }

  // ---------------------------------------------------------------- 0b.5 dry
  if (dryCheckout) {
    hr("0b.5  Dry checkout-options  (POST /checkout.json/options/booking-request)");
    const firstBookable = (avail || []).find(
      (a) => !a.soldOut && (a.unlimitedAvailability || (a.availabilityCount ?? 0) >= 1),
    );
    if (!firstBookable) {
      console.log("  no bookable slot in window — skipping");
    } else {
      const adultCategory = (product.pricingCategories || []).find(
        (c) => /adult/i.test(c.title) || /adult/i.test(c.fullTitle || ""),
      );
      if (!adultCategory) {
        console.log("  could not locate an Adult pricing category — skipping");
      } else {
        const bookingRequest = {
          mainContactDetails: {
            firstName: "Inspect",
            lastName: "DryRun",
            email: "inspect@example.com",
            phoneNumber: "+14035550100",
          },
          activityBookings: [
            {
              activityId: Number(productId),
              rateId: firstBookable.defaultRateId,
              date: firstBookable.date,
              startTimeId: firstBookable.startTimeId,
              pickup: false,
              dropoff: false,
              passengers: [{ pricingCategoryId: adultCategory.id }],
            },
          ],
        };
        row("dry-target.date", firstBookable.date);
        row("dry-target.startTimeId", firstBookable.startTimeId);
        row("dry-target.passenger", `1 × [${adultCategory.id}] ${adultCategory.title}`);

        let opts;
        try {
          opts = await bokunFetch(
            "POST",
            `/checkout.json/options/booking-request?currency=${CURRENCY}`,
            bookingRequest,
          );
        } catch (e) {
          console.log("\n  /checkout.json/options/booking-request rejected:", e.message);
          console.log("  this is the call that needs to succeed before we build — investigate.");
          process.exit(1);
        }

        const opt = Array.isArray(opts) ? opts.find((o) => o.type === "CUSTOMER_FULL_PAYMENT") : opts;
        if (!opt) {
          console.log("  no CUSTOMER_FULL_PAYMENT option returned");
        } else {
          row("option.type", opt.type);
          row("option.amount", `${opt.amount?.amount} ${opt.amount?.currency}`);
          row("option.cardProvider.providerType", opt.paymentMethods?.cardProvider?.providerType);
          row("option.cardProvider.uti present", String(Boolean(opt.paymentMethods?.cardProvider?.uti)));
          if (opt.paymentMethods?.cardProvider?.providerType !== "REDIRECT") {
            console.log(
              "\n  WARNING: providerType is not REDIRECT. The build assumes the hosted-payment-page\n" +
                "  flow. Contact Bokun support to switch the channel before continuing.",
            );
          }
        }
      }
    }
  }

  // ----------------------------------------------------- copy-paste summary
  hr("SUMMARY  — paste this into the build doc");
  const adultCategory = (product.pricingCategories || []).find((c) => /adult/i.test(c.title));
  const seniorCategory = (product.pricingCategories || []).find((c) => /senior/i.test(c.title));
  const childCategory = (product.pricingCategories || []).find(
    (c) => /child/i.test(c.title) || /kid/i.test(c.title) || /youth/i.test(c.title),
  );
  const defaultRate = (product.rates || [])[0];
  const banffPickup = pickups.find((p) => /banff/i.test(p.title || p.name || ""));
  const canmorePickup = pickups.find((p) => /canmore/i.test(p.title || p.name || ""));

  console.log(`PRODUCT_ID                = ${productId}`);
  console.log(`BOOKING_TYPE              = ${product.bookingType}`);
  console.log(`DEFAULT_RATE_ID           = ${defaultRate?.id ?? "?"}`);
  console.log(`PICKUP_SELECTION_TYPE     = ${defaultRate?.pickupSelectionType ?? "?"}`);
  console.log(`DROPOFF_SELECTION_TYPE    = ${defaultRate?.dropoffSelectionType ?? "?"}`);
  console.log(`PRICING_CATEGORY_ADULT    = ${adultCategory?.id ?? "?"}`);
  console.log(`PRICING_CATEGORY_SENIOR   = ${seniorCategory?.id ?? "(none)"}`);
  console.log(`PRICING_CATEGORY_CHILD    = ${childCategory?.id ?? "(none)"}`);
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
