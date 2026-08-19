import { test } from '@playwright/test';
import { installBokunRoutes } from './fixtures/bokun.js';

/* Driven by tools/visual-diff.sh, which sets SHOT_PATH. Skipped in a normal
   suite run — on its own it asserts nothing; the comparison is the point. */
test.skip(!process.env.SHOT_PATH, 'run via tools/visual-diff.sh');

/* Renders the tour page under mocked data and writes a full-page screenshot.
   Run once with the pre-extraction file in place and once with the extracted
   one; "no visual change" is the central claim of the extraction and this is
   the check of it. Driven by tools/visual-compare.sh. */
test('screenshot the tour page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route(/^https:\/\/(fonts\.|cdnjs\.|unpkg\.|api\.mapbox\.|js\.stripe\.)/, (r) => r.abort());
  await installBokunRoutes(page);
  await page.goto(process.env.PAGE_URL || '/tours/banff-hidden-gem-canoe-tour/');
  await page.waitForFunction(() => window.BOKUN && (window.BOKUN.ready || window.BOKUN.error),
    null, { timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: process.env.SHOT_PATH, fullPage: true, animations: 'disabled' });
});
