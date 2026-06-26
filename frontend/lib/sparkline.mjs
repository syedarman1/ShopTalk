// sparkline.mjs — pure: numeric series -> SVG polyline "points" string.
export function sparklinePoints(series, width = 120, height = 28) {
  if (!Array.isArray(series) || series.length < 2) return "";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1; // flat series -> baseline, no divide-by-zero
  const stepX = width / (series.length - 1);
  return series
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
