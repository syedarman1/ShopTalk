// revenueChart.mjs — pure SVG geometry for the revenue area chart. No React.
// points: [{ label: string, value: number, prev?: number }]

/** Signed percent change; null when prev is 0/missing or today is missing. */
export function pctChange(today, prev) {
  if (today == null || prev == null || prev === 0) return null;
  return ((today - prev) / prev) * 100;
}

const EMPTY = (width, height, padding) => ({
  areaPath: "", linePath: "", prevPath: null,
  xTicks: [], yGrid: [], dots: [], width, height, padding, baselineY: 0,
});

/** Build area/line/comparison paths, axis ticks, and hover dots from points. */
export function buildRevenueChart(points, opts = {}) {
  const width = opts.width ?? 560;
  const height = opts.height ?? 180;
  const padding = opts.padding ?? { top: 10, right: 8, bottom: 22, left: 8 };
  if (!Array.isArray(points) || points.length < 2) return EMPTY(width, height, padding);

  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const baselineY = padding.top + innerH;

  const todays = points.map((p) => Number(p.value) || 0);
  const hasPrev = points.every((p) => typeof p.prev === "number");
  const prevs = hasPrev ? points.map((p) => Number(p.prev) || 0) : [];
  const max = Math.max(1, ...todays, ...prevs); // >=1 so a flat/zero series stays on baseline

  const stepX = innerW / (points.length - 1);
  const xAt = (i) => padding.left + i * stepX;
  const yAt = (v) => padding.top + innerH - (v / max) * innerH;
  const f = (n) => n.toFixed(1);

  const linePts = todays.map((v, i) => [xAt(i), yAt(v)]);
  const linePath = "M " + linePts.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L ");
  const areaPath =
    `M ${f(xAt(0))} ${f(baselineY)} ` +
    linePts.map(([x, y]) => `L ${f(x)} ${f(y)}`).join(" ") +
    ` L ${f(xAt(points.length - 1))} ${f(baselineY)} Z`;
  const prevPath = hasPrev
    ? "M " + prevs.map((v, i) => `${f(xAt(i))} ${f(yAt(v))}`).join(" L ")
    : null;

  const tickEvery = Math.max(1, Math.ceil(points.length / 7));
  const xTicks = [];
  for (let i = 0; i < points.length; i += tickEvery) xTicks.push({ x: xAt(i), label: points[i].label });

  const yGrid = [0, 0.5, 1].map((g) => ({ y: padding.top + innerH - g * innerH }));
  const dots = points.map((p, i) => ({ x: xAt(i), y: yAt(todays[i]), label: p.label, value: todays[i] }));

  return { areaPath, linePath, prevPath, xTicks, yGrid, dots, width, height, padding, baselineY };
}
