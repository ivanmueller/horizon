import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/* Use a preinstalled Chromium when the environment ships one (the Claude
   Code sandbox does, at /opt/pw-browsers). Otherwise let Playwright resolve
   its own download — which is what CI does after `playwright install`. */
const PREINSTALLED = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOptions = existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {};

/* Booking regression harness — the guard rail for the site redesign.

   Two modes:
     npm run test:booking       fixtures. Deterministic, offline, CI-safe.
                                Proves the front end still drives the flow.
     npm run test:booking:live  the real Worker and real Bokun. Proves the
                                integration itself. Run before deploying.

   Safety boundary: both modes stop at /checkout/. Everything the live mode
   touches is a read, except POST /api/booking/initiate, which only writes a
   KV entry with a 15-minute self-expiring TTL — no Bokun reservation, no
   Stripe call. Do not extend past the checkout page without moving to
   Stripe/Bokun test mode first; see 0B_VALIDATION.md.

   See docs/booking-contract.md for what each assertion protects. */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8788',
    // Pinned so date maths is deterministic. Mountain Time is where the
    // tours actually run, which is what makes the engine's UTC slot-keying
    // agree with its local calendar lookup — see docs/booking-contract.md §6.
    timezoneId: 'America/Edmonton',
    locale: 'en-CA',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL ? undefined : {
    command: 'node tests/static-server.mjs',
    url: 'http://localhost:8788/tours/banff-hidden-gem-canoe-tour/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
