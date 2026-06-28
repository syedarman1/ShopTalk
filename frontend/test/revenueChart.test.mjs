import { test } from "node:test";
import assert from "node:assert/strict";
import { pctChange, buildRevenueChart } from "../lib/revenueChart.mjs";

test("pctChange computes signed percent change", () => {
  assert.equal(Math.round(pctChange(2480, 2100)), 18);
  assert.equal(Math.round(pctChange(80, 100)), -20);
});

test("pctChange guards divide-by-zero and missing input", () => {
  assert.equal(pctChange(100, 0), null);
  assert.equal(pctChange(100, undefined), null);
  assert.equal(pctChange(null, 100), null);
});

test("buildRevenueChart returns drawable paths for a normal series", () => {
  const pts = [
    { label: "8a", value: 0, prev: 5 },
    { label: "9a", value: 10, prev: 8 },
    { label: "10a", value: 6, prev: 9 },
  ];
  const c = buildRevenueChart(pts, { width: 300, height: 100 });
  assert.ok(c.linePath.startsWith("M"));
  assert.ok(c.areaPath.endsWith("Z"));
  assert.ok(c.prevPath && c.prevPath.startsWith("M"));
  assert.equal(c.dots.length, 3);
});

test("buildRevenueChart prevPath is null when any point lacks prev", () => {
  const c = buildRevenueChart(
    [{ label: "8a", value: 1 }, { label: "9a", value: 2 }],
    { width: 100, height: 50 }
  );
  assert.equal(c.prevPath, null);
});

test("buildRevenueChart x-ticks include the first label and stay sparse", () => {
  const pts = Array.from({ length: 14 }, (_, i) => ({ label: `h${i}`, value: i }));
  const c = buildRevenueChart(pts, { width: 560, height: 180 });
  assert.equal(c.xTicks[0].label, "h0");
  assert.ok(c.xTicks.length <= 8);
});

test("buildRevenueChart handles degenerate input without throwing", () => {
  for (const bad of [[], [{ label: "a", value: 1 }], null, undefined]) {
    const c = buildRevenueChart(bad, { width: 100, height: 50 });
    assert.equal(c.linePath, "");
    assert.equal(c.areaPath, "");
    assert.equal(c.dots.length, 0);
  }
});

test("buildRevenueChart does not divide by zero for an all-zero series", () => {
  const c = buildRevenueChart(
    [{ label: "a", value: 0 }, { label: "b", value: 0 }],
    { width: 100, height: 50 }
  );
  assert.ok(c.linePath.startsWith("M"));
  assert.ok(!c.linePath.includes("NaN"));
});
