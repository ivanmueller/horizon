// Tests for resolveCredit — the function that decides who gets paid.
// Run: npm test    (node:test, no deps)
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCredit } from "./index.js";

const hotelSlug = (p) => ({ code: "fairmont-ll", stream: "hotel-slug", position: p, staff_id: null });
const hotelRef = (p) => ({ code: "htl-7q4k9", stream: "hotel", position: p, staff_id: null });
const employee = (p, id) => ({ code: `htl-7q4k9-e${id}`, stream: "employee", position: p, staff_id: `S${id}` });
const placement = (p) => ({ code: "htl-7q4k9-p01", stream: "placement", position: p, staff_id: null });

test("empty funnel → null", () => {
  assert.equal(resolveCredit([], "employee_last_then_hotel_first"), null);
});

test("default: hotel card then employee → employee credited, first-touch = card", () => {
  const c = resolveCredit([hotelSlug(0), employee(1, "042")], "employee_last_then_hotel_first");
  assert.equal(c.staff_id, "S042");
  assert.equal(c.credited_position, 1);
  assert.equal(c.first_touch_code, "fairmont-ll");
});

test("default: employee priority holds even when the employee came FIRST", () => {
  const c = resolveCredit([employee(0, "042"), hotelSlug(1)], "employee_last_then_hotel_first");
  assert.equal(c.staff_id, "S042");
  assert.equal(c.credited_position, 0);
});

test("default: among multiple employees the LAST wins", () => {
  const c = resolveCredit(
    [hotelSlug(0), employee(1, "042"), employee(2, "099")],
    "employee_last_then_hotel_first",
  );
  assert.equal(c.staff_id, "S099");
  assert.equal(c.credited_position, 2);
});

test("default: no employee → FIRST hotel-level touch wins, pool (staff null)", () => {
  const c = resolveCredit([hotelSlug(0), hotelRef(1)], "employee_last_then_hotel_first");
  assert.equal(c.staff_id, null);
  assert.equal(c.credited_position, 0);
});

test("placement-only funnel is non-crediting (pool) but still resolves", () => {
  const c = resolveCredit([placement(0)], "employee_last_then_hotel_first");
  assert.equal(c.staff_id, null);
  assert.equal(c.credited_position, 0);
});

test("first_touch_wins ignores a later employee", () => {
  const c = resolveCredit([hotelSlug(0), employee(1, "042")], "first_touch_wins");
  assert.equal(c.staff_id, null);
  assert.equal(c.credited_position, 0);
});

test("last_touch_wins credits the final touch", () => {
  const c = resolveCredit([employee(0, "042"), hotelSlug(1)], "last_touch_wins");
  assert.equal(c.staff_id, null);
  assert.equal(c.credited_position, 1);
});

test("unknown policy string falls back to the default behaviour", () => {
  const c = resolveCredit([hotelSlug(0), employee(1, "042")], "garbage-policy");
  assert.equal(c.staff_id, "S042");
  assert.equal(c.policy_used, "garbage-policy");
});

test("credited employee with no resolved staff_id (terminated/unknown) → pool", () => {
  const c = resolveCredit(
    [{ code: "htl-7q4k9-e042", stream: "employee", position: 0, staff_id: null }],
    "employee_last_then_hotel_first",
  );
  assert.equal(c.staff_id, null);
});
