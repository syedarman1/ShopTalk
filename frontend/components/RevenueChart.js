"use client";
import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { buildRevenueChart } from "../lib/revenueChart.mjs";
import { money } from "../lib/format.mjs";

const VIEW_W = 560;
const VIEW_H = 180;

export default function RevenueChart({ points, currency = "USD" }) {
  const reduce = useReducedMotion();
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);
  const chart = buildRevenueChart(points, { width: VIEW_W, height: VIEW_H });
  if (!chart.linePath) return null;

  const fmt = (v) => money(v, currency, { maximumFractionDigits: 0 });

  function onMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    let nearest = chart.dots[0];
    for (const d of chart.dots) {
      if (Math.abs(d.x - x) < Math.abs(nearest.x - x)) nearest = d;
    }
    setHover(nearest);
  }

  return (
    <div className="w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="Revenue today compared with yesterday"
      >
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#008060" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#008060" stopOpacity="0" />
          </linearGradient>
        </defs>

        {chart.yGrid.map((g, i) => (
          <line key={i} x1={chart.padding.left} y1={g.y} x2={VIEW_W - chart.padding.right} y2={g.y}
            className="text-foreground" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
        ))}

        <path d={chart.areaPath} fill="url(#revFill)" stroke="none" />

        {chart.prevPath && (
          <path d={chart.prevPath} className="text-muted-foreground" fill="none"
            stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="4 4" />
        )}

        <motion.path d={chart.linePath} fill="none" stroke="#008060" strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }} />

        {hover && (
          <g>
            <line x1={hover.x} y1={chart.padding.top} x2={hover.x} y2={chart.baselineY}
              className="text-foreground" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
            <circle cx={hover.x} cy={hover.y} r="3.5" fill="#008060" />
          </g>
        )}

        {chart.xTicks.map((t, i) => (
          <text key={i} x={t.x} y={VIEW_H - 6} textAnchor="middle"
            className="fill-muted-foreground" style={{ fontSize: 10 }}>{t.label}</text>
        ))}
      </svg>

      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-shopify" /> Today</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-current" /> Yesterday</span>
        </div>
        {hover && <span className="font-mono text-foreground">{hover.label} · {fmt(hover.value)}</span>}
      </div>
    </div>
  );
}
