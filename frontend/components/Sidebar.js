"use client";

import { Database, Table2, KeyRound, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./ui";

// Schema viewer: every table, its row count, and an expandable column list.
export function Sidebar({ tables, selectedTable, onSelect, lastEventTable }) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Database className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">MockBase</div>
          <div className="text-[11px] text-muted-foreground">
            text-to-database
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" /> Schema
        </span>
        <span>{tables.length} tables</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {tables.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            No tables yet.
            <br />
            Use the MCP <code className="font-mono">create_table</code> tool or
            click <span className="text-primary">Mock Data</span>.
          </div>
        )}

        {tables.map((table) => {
          const active = table.name === selectedTable;
          const flash = table.name === lastEventTable;
          return (
            <button
              key={table.name}
              onClick={() => onSelect(table.name)}
              className={cn(
                "mb-1 w-full rounded-md px-3 py-2 text-left transition-colors",
                active ? "bg-primary/15" : "hover:bg-muted",
                flash && "animate-flash-in"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Table2
                    className={cn(
                      "h-4 w-4",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  {table.name}
                </span>
                <Badge variant={active ? "primary" : "default"}>
                  {table.rowCount}
                </Badge>
              </div>

              {active && (
                <ul className="mt-2 space-y-1 border-l border-border pl-3">
                  {table.columns.map((col) => (
                    <li
                      key={col.name}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        {col.pk && (
                          <KeyRound className="h-3 w-3 text-muted-foreground" />
                        )}
                        {col.name}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground/70">
                        {col.type}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
