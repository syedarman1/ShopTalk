import { test } from "node:test";
import assert from "node:assert/strict";
import { sparklinePoints } from "../lib/sparkline.mjs";

test("maps a two-point series to corner-to-corner points (y inverted)", () => {
  assert.equal(sparklinePoints([0, 10], 100, 10), "0.0,10.0 100.0,0.0");
});

test("returns empty string for too-short or invalid input", () => {
  assert.equal(sparklinePoints([5], 100, 10), "");
  assert.equal(sparklinePoints([], 100, 10), "");
  assert.equal(sparklinePoints(null, 100, 10), "");
});

test("a flat series stays on the baseline (no divide-by-zero)", () => {
  assert.equal(sparklinePoints([4, 4, 4], 100, 10), "0.0,10.0 50.0,10.0 100.0,10.0");
});
