/* ─────────────────────────────────────────────────────────────────────────
   Redesign-safety test.
   ─────────────────────────────────────────────────────────────────────────
   The suite in booking.spec.js proves the engine still works on the CURRENT
   page. This one proves the harder thing: that it works on a page whose
   markup has been thrown away and rebuilt from scratch.

   The harness in fixtures/redesigned-tour.js shares no id, class, tag
   structure, or naming convention with production. Everything is reconnected
   through the selectors / classes / stepperIds override on mount(). If these
   tests pass, a designer can restructure the tour page however they like and
   the booking integration will survive it.

   Fixture mode only — this is a test of the abstraction, not of Bokun.
   ───────────────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { installBokunRoutes, PRODUCT_ID, ADULT_PRICE } from './fixtures/bokun.js';
import { installRedesignedPage, REDESIGN_URL } from './fixtures/redesigned-tour.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.skip(!!process.env.HORIZON_LIVE, 'fixture-mode only — tests the selector abstraction, not Bokun');

async function open(page) {
  await page.route(/^https:\/\/(fonts\.|cdnjs\.|unpkg\.|api\.mapbox\.|js\.stripe\.)/, (r) => r.abort());
  const calls = await installBokunRoutes(page);
  await installRedesignedPage(page);
  await page.goto(REDESIGN_URL);
  await page.waitForFunction(() => window.BOKUN && (window.BOKUN.ready || window.BOKUN.error),
    null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.BOKUN.error && String(window.BOKUN.error))).toBeFalsy();
  return calls;
}

test.describe('booking engine on completely rebuilt markup', () => {

  test('the harness really does share nothing with production', async ({ page }) => {
    await open(page);
    // Open both dropdowns first so the runtime-generated markup (traveller
    // rows, calendar days) is in the DOM and gets scanned too.
    await page.locator('#guests-toggle').click();
    await page.locator('#when-toggle').click();
    await expect(page.locator('#when-m1-grid .day')).not.toHaveCount(0);

    /* Guard against this test quietly decaying into a copy of the real page.
       Scans the rendered DOM's ids and classes — NOT the raw HTML, which
       legitimately contains the selector-map KEYS (bookNowBtn, dateBtn, …)
       inside the inlined mount() call. The keys are the engine's stable API;
       only the values change in a redesign. */
    const names = await page.evaluate(() => {
      const ids = [], classes = new Set();
      document.querySelectorAll('*').forEach((el) => {
        if (el.id) ids.push(el.id);
        el.classList.forEach((c) => classes.add(c));
      });
      return { ids, classes: [...classes] };
    });
    const all = [...names.ids, ...names.classes].join(' ');

    for (const legacy of ['booking-panel', 'bp-expansion', 'bp-travellers', 'bp-stepper',
                          'bp-cal', 'cal-day', 'bpExpansion', 'bookNowBtn', 'checkAvailBtn',
                          'travellersBtn', 'dateBtn', 'mobileCta', 'btn-plus-', 'count-']) {
      expect(all, `harness DOM still uses the production name "${legacy}"`).not.toContain(legacy);
    }
    // And it is a real page, not an empty one that trivially passes.
    expect(names.ids.length).toBeGreaterThan(15);
    expect(names.classes).toContain('day--open');
  });

  test('price, travellers and calendar all render through the override map', async ({ page }) => {
    await open(page);

    // Price header, via data attributes instead of BEM classes.
    await expect(page.locator('[data-price-value]')).toHaveText(`$${ADULT_PRICE}`);
    await expect(page.locator('[data-price-unit]')).toHaveText(/CAD per person/);
    await expect(page.locator('[data-price]')).not.toHaveClass(/is-pending/);

    // Travellers, with renamed row/stepper classes and renamed stepper ids.
    await page.locator('#guests-toggle').click();
    await expect(page.locator('#guests-popover')).toBeVisible();
    await expect(page.locator('#guests-list .guest-line')).toHaveCount(3);
    await expect(page.locator('#qty-adult')).toHaveText('1');
    await expect(page.locator('#sub-adult')).toBeDisabled();
    await page.locator('#add-adult').click();
    await expect(page.locator('#qty-adult')).toHaveText('2');
    await expect(page.locator('#guests-summary')).toHaveText(/Adult x 2/);
    await page.locator('#sub-adult').click();

    // Calendar, with renamed day classes.
    await page.locator('#when-toggle').click();
    await expect(page.locator('#when-popover')).toBeVisible();
    await expect(page.locator('#when-back')).toBeDisabled();
    await expect(page.locator('#when-m1-label')).toHaveText(/\w+ \d{4}/);
    const open_ = page.locator('#when-m1-grid .day--open, #when-m2-grid .day--open');
    expect(await open_.count()).toBeGreaterThan(0);
    await expect(open_.first().locator('.day-cost')).toHaveText(/^\$\d+/);
  });

  test('full flow: pick a date, see a total, hand off to checkout', async ({ page }) => {
    await open(page);

    await page.locator('#when-toggle').click();
    await page.locator('#when-m1-grid .day--open, #when-m2-grid .day--open').first().click();

    // Selected date still round-trips through the (renamed) date button.
    expect(await page.locator('#when-toggle').getAttribute('data-selected-date'))
      .toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await expect(page.locator('#confirm')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#confirm-name')).not.toBeEmpty();
    await expect(page.locator('#confirm-sum')).toHaveText(`CA$${ADULT_PRICE}.00`);
    await expect(page.locator('#confirm-lines')).toHaveText(/Adult/);
    await expect(page.locator('#confirm-depart')).toHaveText(/\d{1,2}:\d{2} (AM|PM)/);
    await expect(page.locator('#confirm-warning')).toBeHidden();
    await expect(page.locator('#go-to-payment')).toBeEnabled();

    // The money path, unchanged.
    const initiate = page.waitForRequest(
      (r) => r.url().includes('/api/booking/initiate') && r.method() === 'POST');
    await page.locator('#go-to-payment').click();

    const payload = JSON.parse((await initiate).postData());
    expect(payload.tour_id).toBe(PRODUCT_ID);
    expect(payload.adults).toBe(1);
    expect(payload.rate_id).toBeTruthy();
    expect(payload.activity_id).toBeTruthy();

    await page.waitForURL(/\/checkout\/\?id=/, { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get('id')).toMatch(UUID_RE);
  });

  test('validation and capacity limits survive the rename', async ({ page }) => {
    await open(page);
    await page.locator('#when-toggle').click();
    await page.locator('#when-m1-grid .day--open, #when-m2-grid .day--open').first().click();
    await expect(page.locator('#confirm')).toBeVisible({ timeout: 15_000 });

    await page.locator('#guests-toggle').click();
    for (let i = 0; i < 13; i++) await page.locator('#add-adult').click();
    await page.locator('#guests-done').click();

    await expect(page.locator('#confirm-warning')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#confirm-warning')).toHaveText(/Only 12 spots remaining/);
    await expect(page.locator('#confirm-warning')).toHaveClass(/confirm-warning--bad/);
    await expect(page.locator('#go-to-payment')).toBeDisabled();
  });

  test('JSON-LD is still patched on the rebuilt page', async ({ page }) => {
    await open(page);
    const ld = await page.evaluate(() =>
      JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent));
    expect(ld.offers.price).toBe(String(ADULT_PRICE));
    expect(ld.offers.priceCurrency).toBe('CAD');
  });

  test('a wrong script load order says so instead of throwing a cryptic error', async ({ page }) => {
    /* The six files must load client → state → panel → expansion → mobile-cta
       → mount. They used to capture their dependencies at eval time, so
       getting this wrong (or adding `defer` to some tags but not the inline
       mount() call) produced "cannot read properties of undefined". They now
       resolve lazily and name the actual problem. */
    await page.route(/^https:\/\/(fonts\.|cdnjs\.)/, (r) => r.abort());
    await page.route(REDESIGN_URL, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      // mount.js alone, without the modules it depends on.
      body: `<!doctype html><html><body>
        <script src="/js/booking/mount.js"></script>
        <script>try { HorizonBooking.mount({ productId: 1162721 }); }
                catch (e) { window.__err = String(e); }</script>
      </body></html>`,
    }));
    await page.goto(REDESIGN_URL);

    const err = await page.evaluate(() => window.__err);
    expect(err, 'mount() did not fail on a broken load order').toBeTruthy();
    expect(err).toMatch(/HorizonBokunClient is not loaded/);
    expect(err, 'the error must state the required order').toMatch(/bokun-client, booking-state, panel/);
    expect(err, 'the error must warn about defer\/async').toMatch(/no defer\/async/);
    expect(err).toMatch(/booking-contract\.md/);
  });

  test('a selector pointing at nothing is reported, not swallowed', async ({ page }) => {
    const warnings = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.route(/^https:\/\/(fonts\.|cdnjs\.)/, (r) => r.abort());
    await installBokunRoutes(page);
    // A redesign that renamed the checkout button but forgot the map.
    await page.route(REDESIGN_URL, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><body><div id="only-thing-here"></div>
        <script src="/js/booking/bokun-client.js"></script>
        <script src="/js/booking/booking-state.js"></script>
        <script src="/js/booking/panel.js"></script>
        <script src="/js/booking/expansion.js"></script>
        <script src="/js/booking/mobile-cta.js"></script>
        <script src="/js/booking/mount.js"></script>
        <script>HorizonBooking.mount({ productId: 1162721 });</script>
      </body></html>`,
    }));
    await page.goto(REDESIGN_URL);
    await page.waitForTimeout(1500);

    /* The document-level click and Escape handlers are registered
       unconditionally and call closeTravellers()/closeCalendar(). Before
       both were guarded, a page missing the travellers markup threw on
       EVERY click anywhere on the page — which would break unrelated
       features mid-redesign, with the cause nowhere near the symptom. */
    // Raw mouse events: this stub page's <body> has no height, so a locator
    // click would have nothing actionable to aim at.
    await page.mouse.click(5, 5);
    await page.mouse.click(50, 50);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const joined = warnings.join('\n');
    expect(joined, 'engine did not report the missing checkout elements')
      .toMatch(/checkout not mounted/);
    expect(joined, 'engine did not name the selector it could not find')
      .toMatch(/bookNowBtn \(#bookNowBtn\)/);
    expect(joined, 'engine did not report the incomplete panel')
      .toMatch(/booking panel incomplete/);
    expect(joined).toMatch(/docs\/booking-contract\.md/);
    // Loud, but never fatal — a broken selector map must not take the page down.
    expect(errors, 'a missing element threw instead of warning').toEqual([]);
  });
});
