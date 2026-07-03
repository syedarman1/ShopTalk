import { test } from "node:test";
import assert from "node:assert/strict";
import { money } from "../lib/format.mjs";

test("money formats a valid ISO currency with symbol and separators", () => {
  assert.equal(money(2480, "USD"), "$2,480.00");
  assert.equal(money(137.784, "USD"), "$137.78");
});

test("money supports maximumFractionDigits", () => {
  assert.equal(money(240, "USD", { maximumFractionDigits: 0 }), "$240");
});

test("money falls back cleanly for unknown currency codes", () => {
  assert.equal(money(10, "USDX"), "10.00 USDX");
});

test("money handles a missing currency without saying 'undefined'", () => {
  assert.equal(money(10, undefined), "10.00");
  assert.equal(money(10, null), "10.00");
});

test("money renders a dash for non-numeric amounts", () => {
  assert.equal(money(NaN, "USD"), "—");
  assert.equal(money("abc", "USD"), "—");
});
