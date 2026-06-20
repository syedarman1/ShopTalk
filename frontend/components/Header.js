"use client";

import { Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

const STATUS = {
  live: { label: "Live", dot: "bg-emerald-500/80", text: "text-muted-foreground" },
  connecting: {
    label: "Connecting…",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
  },
  offline: { label: "Offline", dot: "bg-red-500/70", text: "text-muted-foreground" },
};

export function Header({ status, onSeed, onRefresh, seeding }) {
  const s = STATUS[status] || STATUS.connecting;
  return (
    <header className="flex items-center justify-between border-b border-border bg-card/40 px-5 py-3">
      <div>
        <h1 className="text-base font-semibold tracking-tight">
          Real-time Database Playground
        </h1>
        <p className="text-xs text-muted-foreground">
          Every MCP mutation streams here live over SSE.
        </p>
      </div>

      <div className="flex items-center gap-3">
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
        </div>

        <Button variant="outline" size="icon" onClick={onRefresh} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>

        <Button onClick={onSeed} disabled={seeding}>
          <Sparkles className="h-4 w-4" />
          Mock Data
        </Button>
      </div>
    </header>
  );
}
