/* ─────────────────────────────────────────────────────────────────────────
   Design-system guard.
   ─────────────────────────────────────────────────────────────────────────
   A new palette is the easiest way to ship a booking page nobody can read,
   and contrast failures are invisible to the person who chose the colours.
   This audits the tokens as the browser actually computes them, in both
   themes, so a rebrand cannot quietly drop the checkout button below AA.

   It also pins the one CSS behaviour the booking engine depends on: the
   `hidden` attribute must keep winning over `display`. See
   docs/booking-contract.md §2.
   ───────────────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';

test.skip(!!process.env.HORIZON_LIVE, 'static asset test; no Bokun involved');

/* Body text and button labels need 4.5:1. Control boundaries and disabled
   controls are held to 3:1 — WCAG 1.4.11 for the former, and disabled
   controls are formally exempt but illegible is still illegible. */
const BAR_3 = new Set(['--border-control', '--action-disabled-text']);

for (const theme of ['light', 'dark']) {
  test(`token contrast holds in ${theme}`, async ({ page }) => {
    await page.route(/^https:\/\/fonts\./, (r) => r.abort());
    await page.goto('/css/tours/_kitchen-sink.html');
    if (theme === 'dark') {
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; render(); });
    }
    await page.waitForFunction(() => document.querySelectorAll('#contrast tbody tr').length > 0);

    const rows = await page.$$eval('#contrast tbody tr', (trs) => trs.map((tr) => {
      const td = tr.querySelectorAll('td');
      return {
        fg: td[0].querySelector('code').textContent,
        pair: td[0].textContent.replace(/\s+/g, ' ').trim(),
        ratio: parseFloat(td[1].textContent),
      };
    }));

    expect(rows.length, 'contrast table did not render').toBeGreaterThan(10);
    const failures = rows
      .map((r) => ({ ...r, bar: BAR_3.has(r.fg) ? 3 : 4.5 }))
      .filter((r) => r.ratio < r.bar)
      .map((r) => `${r.pair} — ${r.ratio}:1, needs ${r.bar}:1`);

    expect(failures, `contrast failures in ${theme}`).toEqual([]);
  });
}

test('the [hidden] attribute still beats display', async ({ page }) => {
  /* The engine opens and closes the travellers dropdown, the calendar and
     the expansion card by toggling this attribute. A component that sets
     `display` would pin them open and break booking with no error. */
  await page.route(/^https:\/\/fonts\./, (r) => r.abort());
  await page.goto('/css/tours/_kitchen-sink.html');
  const display = await page.$eval('[hidden][style*="display:flex"]',
    (el) => getComputedStyle(el).display);
  expect(display, '[hidden] was overridden — booking dropdowns cannot close').toBe('none');
});

test('no component reaches past the semantic layer', async ({ page }) => {
  // Mirrors tools/check-tokens.mjs so CI enforces it too.
  const { execSync } = await import('node:child_process');
  expect(() => execSync('node tools/check-tokens.mjs', { stdio: 'pipe' })).not.toThrow();
});
