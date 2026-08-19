/* ─────────────────────────────────────────────────────────────────────────
   Booking flow regression test — the safety net for the site redesign.
   ─────────────────────────────────────────────────────────────────────────
   Run this before and after every redesign commit that touches the tour
   page. It exercises the whole chain that earns money:

       Bokun product + availability  →  price on the page + JSON-LD offer
       Bokun pricing categories      →  traveller rows + count buckets
       Bokun availability            →  bookable calendar days
       cart + slot                   →  validated total
       POST /api/booking/initiate    →  /checkout/?id=<uuid>

   TWO MODES
     npm run test:booking        fixtures (default) — deterministic, offline,
                                 safe for CI. Proves the front end still
                                 drives the flow correctly.
     npm run test:booking:live   real Worker, real Bokun. Proves the
                                 integration itself still works. Run this
                                 before deploying a redesign.

   The live mode stops at the checkout page on purpose: everything it touches
   is a read except POST /api/booking/initiate, which only writes a KV entry
   with a 15-minute self-expiring TTL — no Bokun reservation, no Stripe call.
   Do not extend past /checkout/ without moving to test mode first
   (0B_VALIDATION.md).

   Every assertion here maps to a line in docs/booking-contract.md.
   ───────────────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import {
  PRODUCT_ID, RATE_ID, START_TIME_ID, ADULT_PRICE,
  CATEGORIES_3, CATEGORIES_5,
  installBokunRoutes, installFailingRoutes,
} from './fixtures/bokun.js';

const TOUR = '/tours/banff-hidden-gem-canoe-tour/';
const LIVE = !!process.env.HORIZON_LIVE;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* In fixture mode, stand in for the Worker. In live mode, do nothing and let
   the page talk to the real thing. */
async function arrange(page, opts = {}) {
  if (LIVE) return [];
  // Third-party assets (fonts, Leaflet, Mapbox tiles) are irrelevant to the
  // booking flow and only add latency and flake offline. Cut them.
  await page.route(/^https:\/\/(fonts\.|cdnjs\.|unpkg\.|api\.mapbox\.|js\.stripe\.)/, (r) => r.abort());
  return installBokunRoutes(page, opts);
}

/* window.BOKUN.ready is part of the documented contract precisely so tests
   and live debugging have one reliable signal to wait on. */
async function waitForBokun(page) {
  await page.waitForFunction(
    () => window.BOKUN && (window.BOKUN.ready || window.BOKUN.error),
    null, { timeout: 45_000 },
  );
  const err = await page.evaluate(() => window.BOKUN.error && String(window.BOKUN.error));
  expect(err, LIVE
    ? 'Bokun bootstrap failed — the Worker or Bokun is down, not the front end'
    : 'Bokun bootstrap failed against fixtures — this IS a front-end regression',
  ).toBeFalsy();
}

/* Opens the calendar and clicks the first bookable day, paging forward if
   the visible two months have none. */
async function selectFirstAvailableDate(page, maxMonths = 4) {
  await page.locator('#dateBtn').click();
  await expect(page.locator('#calendarDropdown')).toBeVisible();
  for (let i = 0; i < maxMonths; i++) {
    const available = page.locator('#calendarDropdown .cal-day--available');
    if (await available.count() > 0) {
      await available.first().click();
      return true;
    }
    await page.locator('#calNext').click();
    await page.waitForTimeout(800); // lazy availability fetch for the new window
  }
  return false;
}

async function openAndSelect(page, opts) {
  await arrange(page, opts);
  await page.goto(TOUR);
  await waitForBokun(page);
  expect(await selectFirstAvailableDate(page), 'no bookable date within 4 months').toBe(true);
  await expect(page.locator('#bpExpansion')).toBeVisible({ timeout: 15_000 });
}

test.describe('canoe tour booking engine', () => {

  test('engine loads and exposes its documented globals', async ({ page }) => {
    await arrange(page);
    await page.goto(TOUR);
    await waitForBokun(page);

    const shape = await page.evaluate(() => ({
      hasNamespace:   typeof window.HorizonBooking === 'object',
      mounted:        !!(window.HorizonBooking && window.HorizonBooking.instance),
      hasBokun:       typeof window.BOKUN === 'object',
      hasBokunBooking:typeof window.bokunBooking === 'object',
      showExpansion:  typeof window.__horizonShowExpansion === 'function',
      productTitle:   window.BOKUN.product && window.BOKUN.product.title,
      categories:     (window.BOKUN.product?.pricingCategories || []).map((c) => c.title),
      currency:       window.BOKUN.currency,
      lowestAdultPrice: window.BOKUN.lowestAdultPrice,
      slots:          (window.BOKUN.availability || []).length,
      pickupPlaces:   (window.BOKUN.pickupPlaces || []).length,
    }));

    // Contract §3 — the globals other code and future pages may read.
    expect(shape.hasNamespace, 'window.HorizonBooking missing — engine did not load').toBe(true);
    expect(shape.mounted, 'mount() did not run').toBe(true);
    expect(shape.hasBokun).toBe(true);
    expect(shape.hasBokunBooking).toBe(true);
    expect(shape.showExpansion, 'back-compat global __horizonShowExpansion dropped').toBe(true);

    expect(shape.productTitle, 'no product title from Bokun').toBeTruthy();
    expect(shape.categories.length, 'no pricing categories').toBeGreaterThan(0);
    expect(shape.categories.some((t) => /adult/i.test(t)), 'no Adult category').toBe(true);
    expect(shape.currency).toBe('CAD');
    expect(shape.lowestAdultPrice, 'no live price derived').toBeGreaterThan(0);
    expect(shape.slots, 'no availability slots in the 60-day window').toBeGreaterThan(0);
    expect(shape.pickupPlaces, 'pickup places not loaded').toBeGreaterThan(0);
  });

  test('live price renders in the panel, the JSON-LD offer, and the shared cache', async ({ page }) => {
    await arrange(page);
    await page.goto(TOUR);
    await waitForBokun(page);

    await expect(page.locator('.booking-panel__price-amount')).toHaveText(/^\$\d+/);
    await expect(page.locator('.booking-panel__price')).not.toHaveClass(/booking-panel__price--loading/);
    await expect(page.locator('.booking-panel__price-unit')).toHaveText(/CAD per person/);

    // Contract §4 — SEO. A redesign that drops the JSON-LD block loses rich results.
    const ld = await page.evaluate(() =>
      JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent));
    const live = await page.evaluate(() => window.BOKUN.lowestAdultPrice);
    expect(ld.offers.price, 'JSON-LD offer price not patched with the live price').toBe(String(live));
    expect(ld.offers.priceCurrency).toBe('CAD');

    // Contract §4 — the cache /tours/ shares with this page.
    const cached = await page.evaluate((id) =>
      JSON.parse(localStorage.getItem('hzn_price_' + id)), PRODUCT_ID);
    expect(cached, 'price cache not written — /tours/ → tour page will shimmer').toBeTruthy();
    expect(cached.price).toBe(live);
    expect(cached.exp).toBeGreaterThan(Date.now());
  });

  test('a cached price paints before the engine loads (no shimmer on repeat visit)', async ({ page }) => {
    await arrange(page);
    // Seed the cache the way a previous visit or the /tours/ listing would.
    await page.addInitScript((args) => {
      localStorage.setItem('hzn_price_' + args.id,
        JSON.stringify({ price: args.price, exp: Date.now() + 3600_000 }));
    }, { id: PRODUCT_ID, price: 199 });

    // Hold the API so nothing but the pre-paint snippet can have run.
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route('**/api/product/**', async (route) => { await gate; return route.fallback(); });

    await page.goto(TOUR, { waitUntil: 'commit' });
    await expect(page.locator('.booking-panel__price-amount')).toHaveText('$199');
    await expect(page.locator('.booking-panel__price')).not.toHaveClass(/booking-panel__price--loading/);
    release();
  });

  test('traveller rows render from Bokun categories and enforce the adult minimum', async ({ page }) => {
    await arrange(page);
    await page.goto(TOUR);
    await waitForBokun(page);

    await page.locator('#travellersBtn').click();
    await expect(page.locator('#travellersDropdown')).toBeVisible();

    const categories = await page.evaluate(() =>
      window.BOKUN.product.pricingCategories.map((c) => c.title));
    await expect(page.locator('#bp-travellers-rows .bp-travellers__row')).toHaveCount(categories.length);

    // Adult seeded at 1 and floored there.
    await expect(page.locator('#count-adult')).toHaveText('1');
    await expect(page.locator('#btn-minus-adult')).toBeDisabled();
    await expect(page.locator('#travellersLabel')).toHaveText(/Adult x 1/);

    await page.locator('#btn-plus-adult').click();
    await expect(page.locator('#count-adult')).toHaveText('2');
    await expect(page.locator('#btn-minus-adult')).toBeEnabled();
    await expect(page.locator('#travellersLabel')).toHaveText(/Adult x 2/);
    expect(await page.evaluate(() => window.bokunBooking.counts.adult)).toBe(2);

    await page.locator('#btn-minus-adult').click();
    await expect(page.locator('#count-adult')).toHaveText('1');
    await expect(page.locator('#btn-minus-adult')).toBeDisabled();
  });

  test('calendar offers bookable days with live per-day prices', async ({ page }) => {
    await arrange(page);
    await page.goto(TOUR);
    await waitForBokun(page);

    await page.locator('#dateBtn').click();
    await expect(page.locator('#calendarDropdown')).toBeVisible();
    await expect(page.locator('#calPrev'), 'must not page before the current month').toBeDisabled();
    await expect(page.locator('#calMonth1')).toHaveText(/\w+ \d{4}/);
    await expect(page.locator('#calMonth2')).toHaveText(/\w+ \d{4}/);

    const days = page.locator('#calendarDropdown .cal-day--available');
    expect(await days.count(), 'no bookable days in the visible two months').toBeGreaterThan(0);
    await expect(days.first().locator('.cal-day__price')).toHaveText(/^\$\d+/);

    for (const past of await page.locator('#calendarDropdown .cal-day--past').all()) {
      await expect(past).toBeDisabled();
    }
    for (const un of await page.locator('#calendarDropdown .cal-day--unavailable').all()) {
      await expect(un).toBeDisabled();
    }
  });

  test('paging past the loaded window lazy-fetches more availability', async ({ page }) => {
    const calls = await arrange(page);
    await page.goto(TOUR);
    await waitForBokun(page);
    await page.locator('#dateBtn').click();

    const before = LIVE ? 0 : calls.filter((c) => c.kind === 'availability').length;
    // The bootstrap loads 60 days; three pages forward always overruns it.
    for (let i = 0; i < 3; i++) {
      await page.locator('#calNext').click();
      await page.waitForTimeout(800);
    }
    if (!LIVE) {
      expect(calls.filter((c) => c.kind === 'availability').length,
        'no extra availability fetch when paging past the loaded window').toBeGreaterThan(before);
    }
    // Whatever it fetched, the far month must still render bookable days.
    expect(await page.locator('#calendarDropdown .cal-day--available').count()).toBeGreaterThan(0);
  });

  test('selecting a date populates the expansion with a validated total', async ({ page }) => {
    await openAndSelect(page);

    // Contract §2 — the selected date lives on the DOM node.
    expect(await page.locator('#dateBtn').getAttribute('data-selected-date'),
      'dateBtn.dataset.selectedDate not set').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.locator('#dateLabel')).not.toHaveText('Select date');

    // Slot captured for the checkout handoff.
    const slot = await page.evaluate(() => ({
      startTimeId: window.bokunBooking.startTimeId,
      rateId: window.bokunBooking.rateId,
      startTime: window.bokunBooking.slot && window.bokunBooking.slot.startTime,
    }));
    expect(slot.startTimeId, 'no startTimeId captured').toBeTruthy();
    expect(slot.rateId, 'no rateId captured — Bokun submit will fail').toBeTruthy();
    expect(slot.startTime).toMatch(/^\d{1,2}:\d{2}$/);

    await expect(page.locator('#expansionTotal')).toHaveText(/^CA\$\d+\.\d{2}$/);
    await expect(page.locator('#expansionBreakdown')).toHaveText(/Adult/i);
    await expect(page.locator('#expansionDate')).toHaveText(/\w+day, \w+ \d+, \d{4}/);
    await expect(page.locator('#expansionStartTime')).toHaveText(/\d{1,2}:\d{2} (AM|PM)/);
    await expect(page.locator('#expansionTitle')).not.toBeEmpty();

    // Valid cart ⇒ checkout enabled, no validation message.
    await expect(page.locator('#bookNowBtn')).toBeEnabled();
    await expect(page.locator('#expansionValidation')).toBeHidden();

    const total = Number((await page.locator('#expansionTotal').textContent()).replace(/[^\d.]/g, ''));
    expect(total, 'total is zero for a paying adult').toBeGreaterThan(0);
    if (!LIVE) expect(total).toBe(ADULT_PRICE);
  });

  test('total tracks party size', async ({ page }) => {
    await openAndSelect(page);
    const readTotal = async () =>
      Number((await page.locator('#expansionTotal').textContent()).replace(/[^\d.]/g, ''));
    const one = await readTotal();

    await page.locator('#travellersBtn').click();
    await page.locator('#btn-plus-adult').click();
    await page.locator('#travellersContinue').click();
    // The expansion runs a deliberate 350ms skeleton before recalculating.
    await expect.poll(readTotal, { timeout: 15_000 }).toBe(one * 2);
  });

  test('infants are complimentary but still count toward capacity', async ({ page }) => {
    test.skip(LIVE, 'category mix is fixture-controlled');
    await openAndSelect(page);
    const readTotal = async () =>
      Number((await page.locator('#expansionTotal').textContent()).replace(/[^\d.]/g, ''));
    const before = await readTotal();

    await page.locator('#travellersBtn').click();
    await page.locator('#btn-plus-infant').click();
    await page.locator('#travellersContinue').click();

    await expect(page.locator('#expansionBreakdown')).toHaveText(/complimentary/i, { timeout: 15_000 });
    expect(await readTotal(), 'infant added money to the total').toBe(before);
    // …but the participant still ships to Bokun.
    expect(await page.evaluate(() => window.bokunBooking.counts.infant)).toBe(1);
  });

  test('over-capacity carts are blocked before checkout', async ({ page }) => {
    test.skip(LIVE, 'would need a genuinely near-full departure');
    await openAndSelect(page);

    // Fixture departures hold 12. Push past it.
    await page.locator('#travellersBtn').click();
    for (let i = 0; i < 13; i++) await page.locator('#btn-plus-adult').click();
    await page.locator('#travellersContinue').click();

    await expect(page.locator('#expansionValidation')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#expansionValidation')).toHaveText(/Only 12 spots remaining/);
    await expect(page.locator('#expansionValidation')).toHaveClass(/bp-expansion__validation--error/);
    await expect(page.locator('#bookNowBtn'), 'over-capacity cart could still check out').toBeDisabled();
  });

  test('check availability with no date bounces into the calendar', async ({ page }) => {
    await arrange(page);
    await page.goto(TOUR);
    await waitForBokun(page);

    await page.locator('#checkAvailBtn').click();
    await expect(page.locator('#calendarDropdown')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#bpExpansion')).toBeHidden();
  });

  test('continue to checkout sends the contracted payload and hands off', async ({ page }) => {
    await openAndSelect(page);
    await expect(page.locator('#bookNowBtn')).toBeEnabled({ timeout: 15_000 });

    const initiate = page.waitForRequest(
      (r) => r.url().includes('/api/booking/initiate') && r.method() === 'POST');
    const started = page.evaluate(() => new Promise((res) => {
      document.addEventListener('horizon:checkout_started', (e) => res(e.detail), { once: true });
    }));

    await page.locator('#bookNowBtn').click();

    // Contract §5 — the payload the Worker validates.
    const payload = JSON.parse((await initiate).postData());
    expect(payload.tour_id).toBe(PRODUCT_ID);
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.adults, 'adults bucket empty — the category collapse broke').toBeGreaterThan(0);
    expect(payload).toHaveProperty('youth');
    expect(payload).toHaveProperty('infants');
    expect(payload.activity_id, 'activity_id missing — Bokun cannot resolve the departure').toBeTruthy();
    expect(payload.rate_id, 'rate_id missing — Bokun submit will reject').toBeTruthy();
    expect(payload.time).toMatch(/^\d{1,2}:\d{2}$/);
    expect(payload.currency).toBe('CAD');
    // The Worker nulls any tour_image not on the apex domain.
    expect(payload.tour_image).toMatch(/^https:\/\/gowithhorizon\.com\//);

    const detail = await started;
    expect(detail.booking_id).toMatch(UUID_RE);
    expect(detail.tour_id).toBe(PRODUCT_ID);

    await page.waitForURL(/\/checkout\/\?id=/, { timeout: 30_000 });
    const id = new URL(page.url()).searchParams.get('id');
    expect(id, 'booking_id in the redirect is not a uuid').toMatch(UUID_RE);
    expect(id).toBe(detail.booking_id);
  });

  test('five Bokun categories collapse into the three Worker buckets', async ({ page }) => {
    test.skip(LIVE, 'category mix is fixture-controlled');
    await openAndSelect(page, { categories: CATEGORIES_5 });

    // 2 adult + 1 senior → adults: 3;  1 youth + 2 child → youth: 3;  1 infant.
    await page.locator('#travellersBtn').click();
    await page.locator('#btn-plus-adult').click();      // adult 1 → 2
    await page.locator('#btn-plus-senior').click();     // senior 0 → 1
    await page.locator('#btn-plus-youth').click();      // youth 0 → 1
    await page.locator('#btn-plus-child').click();
    await page.locator('#btn-plus-child').click();      // child 0 → 2
    await page.locator('#btn-plus-infant').click();     // infant 0 → 1
    await page.locator('#travellersContinue').click();

    await expect(page.locator('#bookNowBtn')).toBeEnabled({ timeout: 15_000 });
    const initiate = page.waitForRequest(
      (r) => r.url().includes('/api/booking/initiate') && r.method() === 'POST');
    await page.locator('#bookNowBtn').click();

    const payload = JSON.parse((await initiate).postData());
    expect(payload.adults,  'senior must bill as adult').toBe(3);
    expect(payload.youth,   'child must bill as youth').toBe(3);
    expect(payload.infants).toBe(1);
  });

  test('a dead Worker degrades visibly instead of silently', async ({ page }) => {
    test.skip(LIVE, 'would require taking the Worker down');
    await installFailingRoutes(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(TOUR);
    await page.waitForFunction(() => window.BOKUN && window.BOKUN.error, null, { timeout: 30_000 });

    // The traveller area tells the visitor something is wrong…
    await expect(page.locator('#bp-travellers-rows')).toContainText(/Couldn't load tour info/i);
    // …and nothing throws, so the rest of the page still works.
    expect(errors, 'uncaught page errors during the failure path').toEqual([]);
    await expect(page.locator('#tourDescription')).toBeVisible();
  });

  test('checkout page rehydrates the booking from the Worker', async ({ page }) => {
    test.skip(!LIVE, 'live-only: the checkout page needs Stripe.js and the real KV pouch');
    await openAndSelect(page);
    await expect(page.locator('#bookNowBtn')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#bookNowBtn').click();
    await page.waitForURL(/\/checkout\/\?id=/, { timeout: 30_000 });

    // The far side of the only seam between the two pages.
    const state = await page.waitForResponse(
      (r) => r.url().includes('/api/booking/state/') && r.status() === 200, { timeout: 30_000 });
    const body = await state.json();
    expect(body.tour_id).toBe(PRODUCT_ID);
    expect(body.adults).toBeGreaterThan(0);
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.rate_id).toBeTruthy();
  });
});
