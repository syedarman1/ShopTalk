"use client";

const TONES = {
  success: "bg-shopify/15 text-shopify-light",
  warn: "bg-amber-500/15 text-amber-400",
  danger: "bg-rose-500/15 text-rose-400",
  muted: "bg-muted text-muted-foreground",
};

export function StatusPill({ tone = "muted", children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone] || TONES.muted}`}>
      {children}
    </span>
  );
}

export function PanelHeader({ icon: Icon, title, badge }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" /> {title}
      </div>
      {badge}
    </div>
  );
}

export function StatStrip({ stats }) {
  return (
    <div
      className="grid gap-4 border-y border-border/50 py-3"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((s) => (
        <div key={s.label}>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
          <div className="text-lg font-semibold">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

export function SplitBar({ parts }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {parts.filter((p) => p.value > 0).map((p, i) => (
        <div key={i} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function SpendBar({ fraction }) {
  const pct = Math.max(2, Math.min(100, (fraction || 0) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-shopify" style={{ width: `${pct}%` }} />
    </div>
  );
}
