"use client";
import { sparklinePoints } from "../lib/sparkline.mjs";

export default function Sparkline({ series, width = 160, height = 36 }) {
  const points = sparklinePoints(series, width, height);
  if (!points) return null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="text-shopify-light"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
