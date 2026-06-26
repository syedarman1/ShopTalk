"use client";

import { cn } from "@/lib/utils";

const STATUS = {
  live: { label: "Live", dot: "bg-emerald-500/80", text: "text-muted-foreground" },
  connecting: {
    label: "Connecting…",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
  },
  offline: { label: "Offline", dot: "bg-red-500/70", text: "text-muted-foreground" },
};

export default function Header({ status, stores, demo }) {
  const s = STATUS[status] || STATUS.connecting;
  return (
    <header className="flex items-center justify-between border-b border-border bg-card/40 px-5 py-3">
      <div>
        <h1 className="text-base font-semibold tracking-tight">
          ShopTalk
        </h1>
        <p className="text-xs text-muted-foreground">
          Ask questions about your Shopify stores in plain English.
        </p>
      </div>

      <div className="flex items-center gap-3">
        {demo && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400">
            Demo · sample data
          </span>
        )}
        <div className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            {status === "live" && (
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full animate-ping-slow",
                  s.dot
                )}
              />
            )}
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                s.dot,
                status === "connecting" && "animate-pulse"
              )}
            />
          </span>
          <span className={cn("text-xs font-medium", s.text)}>{s.label}</span>
          <span className="text-xs text-muted-foreground">
            {stores.length} {stores.length === 1 ? "store" : "stores"}
          </span>
        </div>
      </div>
    </header>
  );
}
