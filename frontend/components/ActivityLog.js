"use client";

import {
  Plus,
  TableProperties,
  Search,
  Sparkles,
  Activity,
  Radio,
  Pencil,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, Badge } from "./ui";

// Monochrome icons — the icon shape differentiates event types, not color.
const META = {
  table_created: { icon: TableProperties, color: "text-foreground/70" },
  column_added: { icon: TableProperties, color: "text-muted-foreground" },
  row_inserted: { icon: Plus, color: "text-foreground/70" },
  reset: { icon: RefreshCw, color: "text-muted-foreground" },
  row_updated: { icon: Pencil, color: "text-foreground/70" },
  row_deleted: { icon: Trash2, color: "text-muted-foreground" },
  table_dropped: { icon: Trash2, color: "text-foreground/70" },
  query: { icon: Search, color: "text-muted-foreground" },
  seed: { icon: Sparkles, color: "text-foreground/70" },
  connected: { icon: Radio, color: "text-muted-foreground" },
};

// Live feed of incoming MCP traffic.
export function ActivityLog({ activity, status }) {
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Activity Log
        </CardTitle>
        <Badge variant={status === "live" ? "primary" : "default"}>
          {activity.length} events
        </Badge>
      </CardHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {activity.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
            Waiting for MCP activity. Call a tool (create_table, insert_row,
            query_data) or click Mock Data.
          </div>
        ) : (
          <ul className="space-y-1">
            {activity.map((event) => {
              const meta = META[event.type] || {
                icon: Activity,
                color: "text-muted-foreground",
              };
              const Icon = meta.icon;
              return (
                <li
                  key={event.id}
                  className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/40"
                >
                  <Icon
                    className={cn("mt-0.5 h-4 w-4 shrink-0", meta.color)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {event.tool && (
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                          {event.tool}
                        </code>
                      )}
                      {event.table && (
                        <span className="truncate text-xs text-muted-foreground">
                          → {event.table}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-foreground/90">
                      {event.message}
                    </p>
                    {event.detail && (
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70">
                        {typeof event.detail === "string"
                          ? event.detail
                          : JSON.stringify(event.detail)}
                      </p>
                    )}
                  </div>
                  <time className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                    {formatTime(event.timestamp)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

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
