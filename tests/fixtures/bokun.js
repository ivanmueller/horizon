/* ─────────────────────────────────────────────────────────────────────────
   Recorded-shape Bokun fixtures for the booking regression test.
   ─────────────────────────────────────────────────────────────────────────
   The shapes here mirror what workers/bokun/index.js passes through from
   Bokun (/activity.json/:id and /activity.json/:id/availabilities) — the
   Worker is a transparent proxy for those two, so matching Bokun's shape is
   the same as matching the Worker's.

   Availability is GENERATED RELATIVE TO TODAY, never hard-coded, so these
   fixtures cannot rot into "no bookable dates" a month from now.

   These let the suite run offline and deterministically in CI. Run with
   HORIZON_LIVE=1 to bypass all of this and hit the real Worker — do that
   before deploying a redesign, because only the live run proves the actual
   integration still works.
   ───────────────────────────────────────────────────────────────────────── */

export const PRODUCT_ID = 1162721;
export const RATE_ID = 4471382;
export const START_TIME_ID = 5438571;   // 08:30 "New Schedule" — mount()'s preferred slot
export const OTHER_START_TIME_ID = 5438570;
/* Deliberately NOT 269 — that is the value hardcoded in the page's static
   JSON-LD. If the fixture matched it, the "JSON-LD was patched with the live
   price" assertion would pass even when the patch is broken. */
export const ADULT_PRICE = 289;
export const YOUTH_PRICE = 219;

/* Category ids are Bokun's, and the engine joins on the lowercased title
   ("adult", "youth", …) — so titles matter more than ids here. */
export const CATEGORIES_3 = [
  { id: 1481290, title: 'Adult',  fullTitle: 'Adult (18-99)',  minAge: 18, maxAge: 99, price: ADULT_PRICE },
  { id: 1481291, title: 'Youth',  fullTitle: 'Youth (6-17)',   minAge: 6,  maxAge: 17, price: YOUTH_PRICE },
  { id: 1481292, title: 'Infant', fullTitle: 'Infant (0-5)',   minAge: 0,  maxAge: 5,  price: 0 },
];

/* Exercises the count-bucket collapse the Worker depends on:
   adults = adult + senior, youth = youth + child. */
export const CATEGORIES_5 = [
  { id: 1481290, title: 'Adult',  fullTitle: 'Adult (18-64)',  minAge: 18, maxAge: 64, price: ADULT_PRICE },
  { id: 1481293, title: 'Senior', fullTitle: 'Senior (65+)',   minAge: 65, maxAge: null, price: ADULT_PRICE },
  { id: 1481291, title: 'Youth',  fullTitle: 'Youth (12-17)',  minAge: 12, maxAge: 17, price: YOUTH_PRICE },
  { id: 1481294, title: 'Child',  fullTitle: 'Child (6-11)',   minAge: 6,  maxAge: 11, price: YOUTH_PRICE },
  { id: 1481292, title: 'Infant', fullTitle: 'Infant (0-5)',   minAge: 0,  maxAge: 5,  price: 0 },
];

export function buildProduct(categories = CATEGORIES_3) {
  return {
    id: PRODUCT_ID,
    title: 'Banff: Lake Louise Canoe Tour & Moraine Lake | Skip-the-Line',
    durationText: '9–10 hours',
    rates: [{ id: RATE_ID, title: 'Standard' }],
    pricingCategories: categories.map(({ id, title, fullTitle, minAge, maxAge }) => ({
      id, title, fullTitle, minAge, maxAge,
    })),
  };
}

export const PICKUP_PLACES = {
  pickupPlaces: [
    { id: 90001, title: 'Rundlestone Lodge, Banff' },
    { id: 90002, title: 'Canmore — downtown' },
  ],
  dropoffPlaces: [{ id: 90001, title: 'Rundlestone Lodge, Banff' }],
};

function pricesByRate(categories) {
  return [{
    rateId: RATE_ID,
    pricePerCategoryUnit: categories.map((c) => ({
      id: c.id,
      amount: { amount: c.price, currency: 'CAD' },
    })),
  }];
}

/* One 08:30 departure per day. Every 4th day is sold out and every 7th has
   no slot at all, so the calendar renders a realistic mix of available,
   unavailable, and past states.

   `date` is epoch millis at 15:30 UTC — 08:30 Mountain. That is what makes
   the engine's UTC slot-keying agree with its local calendar lookup; see
   docs/booking-contract.md §6 on why that asymmetry is load-bearing. */
export function buildAvailability(startYmd, endYmd, categories = CATEGORIES_3) {
  const out = [];
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);

  for (let t = start, i = 0; t <= end; t += 86400000, i++) {
    const d = new Date(t);
    if (i % 7 === 6) continue;                       // no departure at all
    const soldOut = i % 4 === 3;
    out.push({
      date: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 15, 30),
      startTime: '08:30',
      startTimeId: START_TIME_ID,
      defaultRateId: RATE_ID,
      soldOut,
      unlimitedAvailability: false,
      availabilityCount: soldOut ? 0 : 12,
      minParticipantsToBookNow: null,
      pricesByRate: pricesByRate(categories),
    });
  }
  return out;
}

/* Installs Playwright routes that stand in for the Bokun Worker.
   Returns a `calls` array so a test can assert on what was requested. */
export async function installBokunRoutes(page, { categories = CATEGORIES_3 } = {}) {
  const calls = [];
  const json = (route, body, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });

  await page.route('**/api/product/**', (route) => {
    calls.push({ kind: 'product', url: route.request().url() });
    return json(route, buildProduct(categories));
  });

  await page.route('**/api/pickup-places/**', (route) => {
    calls.push({ kind: 'pickup-places', url: route.request().url() });
    return json(route, PICKUP_PLACES);
  });

  await page.route('**/api/availability/**', (route) => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');
    calls.push({ kind: 'availability', start, end });
    if (!start || !end) return json(route, { error: 'start and end (YYYY-MM-DD) required' }, 400);
    return json(route, buildAvailability(start, end, categories));
  });

  await page.route('**/api/booking/initiate', async (route) => {
    const payload = JSON.parse(route.request().postData() || '{}');
    calls.push({ kind: 'initiate', payload });
    // Mirror the Worker's own validation so the test catches a payload the
    // real endpoint would reject.
    if (!Number.isFinite(payload.tour_id) || payload.tour_id <= 0) {
      return json(route, { error: 'tour_id (positive integer) required' }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date || '')) {
      return json(route, { error: 'date (YYYY-MM-DD) required' }, 400);
    }
    if ((payload.adults || 0) + (payload.youth || 0) + (payload.infants || 0) < 1) {
      return json(route, { error: 'at least one traveller required' }, 400);
    }
    return json(route, { booking_id: '3f6b1c2a-9d84-4e17-b5a0-7c1e2d8f4a90', expires_at: Date.now() + 15 * 60 * 1000 });
  });

  await page.route('**/api/booking/state/**', (route) => {
    const id = route.request().url().split('/').pop();
    calls.push({ kind: 'state', id });
    return json(route, {
      booking_id: id,
      tour_id: PRODUCT_ID,
      date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      time: '08:30',
      activity_id: START_TIME_ID,
      rate_id: RATE_ID,
      adults: 1, youth: 0, infants: 0,
      hotel: null, ref: null,
      currency: 'CAD',
      expires_at: Date.now() + 15 * 60 * 1000,
    });
  });

  return calls;
}

/* Simulates the Worker being unreachable, for the error-path test. */
export async function installFailingRoutes(page) {
  await page.route('**/api/**', (route) => route.abort('failed'));
}
