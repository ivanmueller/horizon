// #6 verification: the legacy inline capture block (Banff page) and the
// new js/referral.js must not fight each other in a way that DROPS a
// referral. This proves the dual path is safe (so no refactor needed yet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const REF_PATH = resolve(import.meta.dirname, "../../js/referral.js");
let bust = 0;

// Fresh JS context per "page load": reset globals, then re-import the
// IIFE with a cache-busting query so it re-executes.
async function loadPage({ search = "", path = "/", preHorizon, store }) {
  const ls = store || {};
  globalThis.localStorage = {
    getItem: (k) => ls[k] ?? null,
    setItem: (k, v) => { ls[k] = String(v); },
  };
  let cookie = "";
  globalThis.document = {
    get cookie() { return cookie; },
    set cookie(v) { cookie = v.split(";")[0]; },
  };
  globalThis.window = {
    location: { search, hostname: "gowithhorizon.com", protocol: "https:", pathname: path },
  };
  if (preHorizon) globalThis.window.HORIZON = preHorizon;
  globalThis.location = globalThis.window.location;
  await import(pathToFileURL(REF_PATH).href + `?b=${bust++}`);
  return { H: globalThis.window.HORIZON, store: ls };
}

test("htl- employee code: inline regex rejects it, referral.js still captures it", async () => {
  // Legacy inline block uses /^[a-z0-9_]{2,40}$/ which rejects hyphens,
  // so it leaves HORIZON.ref unset for real htl- codes.
  const { H } = await loadPage({ search: "?ref=htl-7q4k9-e042", path: "/tours/x/" });
  assert.equal(H.ref, "HTL-7Q4K9-E042");
  assert.equal(H.funnel.touchpoints.length, 1);
  assert.equal(H.funnel.touchpoints[0].stream, "employee");
});

test("legacy underscore code already set by inline block is NOT overridden", async () => {
  const { H } = await loadPage({
    search: "?ref=FAIRMONT_JS",
    path: "/tours/x/",
    preHorizon: { ref: "FAIRMONT_JS" }, // inline block set this first
  });
  assert.equal(H.ref, "FAIRMONT_JS"); // preserved exactly
  assert.equal(H.funnel.touchpoints.length, 1); // still recorded for the funnel
});

test("inline-set hotel slug is preserved and the funnel still captures it", async () => {
  const { H } = await loadPage({
    search: "?hotel=fairmont-ll",
    path: "/tours/x/",
    preHorizon: { hotel: "fairmont-ll" },
  });
  assert.equal(H.hotel, "fairmont-ll");
  assert.equal(H.funnel.touchpoints[0].stream, "hotel-slug");
});

test("cross-page: scan on page 1, no params on page 2 → attribution restored", async () => {
  const shared = {};
  await loadPage({ search: "?hotel=fairmont-ll", path: "/tours/a/", store: shared });
  const { H } = await loadPage({ search: "", path: "/tours/b/", store: shared });
  assert.equal(H.hotel, "fairmont-ll"); // restored from store, not lost
});

test("full override scenario survives end to end (card → employee → refresh)", async () => {
  const shared = {};
  await loadPage({ search: "?hotel=fairmont-ll", path: "/tours/a/", store: shared });
  await loadPage({ search: "?ref=htl-7q4k9-e042", path: "/tours/a/", store: shared });
  const { H } = await loadPage({ search: "", path: "/checkout/", store: shared });
  assert.equal(H.hotel, "fairmont-ll");
  assert.equal(H.ref, "HTL-7Q4K9-E042"); // employee credited
  assert.equal(H.funnel.touchpoints.length, 2); // card touch NOT dropped
  assert.equal(H.funnel.touchpoints[0].stream, "hotel-slug");
});
