"use client";
import { ShoppingBag, Receipt, Package, Users, Store, Radio } from "lucide-react";
import { cn } from "../lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const META = {
  sales: { icon: ShoppingBag, color: "text-foreground/70" },
  orders: { icon: Receipt, color: "text-muted-foreground" },
  order: { icon: Receipt, color: "text-foreground/70" },
  products: { icon: Package, color: "text-muted-foreground" },
  customers: { icon: Users, color: "text-foreground/70" },
  stores: { icon: Store, color: "text-muted-foreground" },
  connected: { icon: Radio, color: "text-muted-foreground" },
};

export default function ActivityLog({ activity }) {
  return (
    <ul className="space-y-0.5">
      <AnimatePresence initial={false}>
        {activity.map((event) => {
          const meta = META[event.type] ?? { icon: Radio, color: "text-muted-foreground" };
          const Icon = meta.icon;
          return (
            <motion.li
              key={event.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/40"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.color)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {event.tool && (
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{event.tool}</code>
                  )}
                  {event.store && <span className="text-xs text-muted-foreground">→ {event.store}</span>}
                </div>
                <p className="mt-0.5 truncate text-[13px] text-foreground/90">{event.message}</p>
              </div>
              <time className="font-mono text-[10px] text-muted-foreground">{formatTime(event.timestamp)}</time>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

// formatTime is a local helper (carried over from the original ActivityLog.js).
// lib/utils.js exports only `cn` — it does NOT export formatTime.
function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}
