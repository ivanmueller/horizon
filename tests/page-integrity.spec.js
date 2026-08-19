/* ─────────────────────────────────────────────────────────────────────────
   Page integrity — the non-booking things a redesign silently breaks.
   ─────────────────────────────────────────────────────────────────────────
   booking.spec.js guards the money path and redesign.spec.js guards the
   selector abstraction. This file guards the couplings that belong to the
   PAGE rather than the engine: inline onclick attributes, state seeded in
   markup that JS reads back, and defaults duplicated between markup and
   script.

   None of these fail loudly. Each is a feature that just stops working.
   ───────────────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { installBokunRoutes } from './fixtures/bokun.js';

const TOUR = '/tours/banff-hidden-gem-canoe-tour/';

test.skip(!!process.env.HORIZON_LIVE, 'page-structure tests; no need to spend live Bokun calls');

async function open(page) {
  await page.route(/^https:\/\/(fonts\.|cdnjs\.|unpkg\.|api\.mapbox\.|js\.stripe\.)/, (r) => r.abort());
  await installBokunRoutes(page);
  await page.goto(TOUR);
}

test.describe('page-level couplings', () => {

  test('every inline onclick attribute resolves to a real global function', async ({ page }) => {
    /* Inline handlers are evaluated in global scope. Wrapping their defining
       script in an IIFE, or moving it to an ES module, breaks them silently
       and immediately — and "tidy up the last inline scripts" is an obvious
       thing to do during a redesign. */
    await open(page);

    const handlers = await page.evaluate(() =>
      [...document.querySelectorAll('[onclick]')].map((el) => el.getAttribute('onclick')));
    expect(handlers.length, 'no inline handlers found — did the markup change?').toBe(9);

    // Every distinct function named in an onclick must actually exist.
    const fnNames = [...new Set(handlers.map((h) => h.replace(/\(.*$/, '')))];
    expect(fnNames.sort()).toEqual(['openWydLightbox', 'toggleDescription']);
    for (const fn of fnNames) {
      expect(await page.evaluate((n) => typeof window[n], fn),
        `window.${fn} is not a function — an inline onclick will throw`).toBe('function');
    }

    // The itinerary handlers must cover 0..7 with no gap or duplicate.
    const indices = handlers.filter((h) => h.startsWith('openWydLightbox'))
      .map((h) => Number(h.match(/\((\d+)\)/)[1])).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('markup seeds the hidden-state machine the JS reads back', async ({ page }) => {
    /* `hidden` is state here, not decoration: the engine reads it to decide
       whether a toggle opens or closes. Ship the markup without these seeds
       and both dropdowns plus the whole expansion card render open on load,
       with every toggle inverted. */
    await open(page);
    for (const id of ['bpExpansion', 'expansionBadge', 'expansionValidation',
                      'travellersDropdown', 'calendarDropdown']) {
      expect(await page.locator(`#${id}`).getAttribute('hidden'),
        `#${id} must start hidden`).not.toBeNull();
    }
  });

  test('the hidden attribute still wins over the badge display rule', async ({ page }) => {
    /* .bp-expansion__badge sets display:inline-block, which beats the UA's
       [hidden]{display:none}. A dedicated .bp-expansion__badge[hidden] rule
       puts it back. Drop that rule in a CSS cleanup and the scarcity badge
       shows permanently, with stale text. */
    await open(page);
    await expect(page.locator('#expansionBadge')).toBeHidden();
    const display = await page.locator('#expansionBadge')
      .evaluate((el) => getComputedStyle(el).display);
    expect(display, 'hidden badge is not display:none — the [hidden] override is gone').toBe('none');
  });

  test('dropdown open animations depend on :not([hidden]), not a class', async ({ page }) => {
    // Swapping `hidden` for an `is-open` class would silently kill these.
    await open(page);
    await page.locator('#travellersBtn').click();
    const anim = await page.locator('#travellersDropdown')
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(anim, 'dropdown open animation lost').toBe('dropdownFadeIn');
  });

  test('the pickup pill default agrees between markup and script', async ({ page }) => {
    /* Two sources of truth for one piece of state: the --active class in the
       markup and `var activeLocation = 'canmore'` in the pickup-map script.
       Change the markup default alone and the map opens on the wrong town
       until the visitor clicks a pill. */
    await open(page);
    await page.waitForFunction(() => window.BOKUN && window.BOKUN.ready, null, { timeout: 30_000 });

    expect(await page.locator('.bp-pickup__pill--active').count(),
      'exactly one pill should start active').toBe(1);
    expect(await page.locator('.bp-pickup__pill--active').getAttribute('data-location')).toBe('canmore');

    // The map button lives inside the expansion, so open that first.
    await page.locator('#dateBtn').click();
    await page.locator('#calendarDropdown .cal-day--available').first().click();
    await expect(page.locator('#bpExpansion')).toBeVisible({ timeout: 15_000 });

    // The lightbox title is set from the script's own default before the map
    // initialises, so this reads the JS half of the duplicated state. (Leaflet
    // is blocked offline; the map itself never draws, which is fine here.)
    await page.locator('#pickupMapBtn').click();
    await expect(page.locator('#mapLightboxTitle')).toHaveText(/Canmore pickup details/);
    await expect(page.locator('#mapLightboxSubtitle')).toHaveText(/Canmore pickup/);
  });

  test('the description collapse seed matches what the toggle expects', async ({ page }) => {
    await open(page);
    // Seeded collapsed in markup; toggleDescription assumes that starting state.
    await expect(page.locator('#tourDescription')).toHaveClass(/tour-description--collapsed/);
    await expect(page.locator('#descriptionToggle')).toHaveText(/See more/);
  });
});
