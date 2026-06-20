"use client";

import { useEffect, useRef, useState } from "react";
import { Table2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, Badge } from "./ui";

// Responsive data grid for the selected table. New rows flash in as they
// arrive over SSE.
export function DataTable({ table, schema, rows, loading }) {
  const columns = schema?.columns?.map((c) => c.name) ?? inferColumns(rows);
  const prevIdsRef = useRef(new Set());
  const [flashIds, setFlashIds] = useState(new Set());

  const pkName = schema?.columns?.find((c) => c.pk)?.name || "id";

  // Diff incoming rows against the previous render to highlight new ones.
  useEffect(() => {
    const currentIds = new Set(rows.map((r, i) => rowKey(r, pkName, i)));
    const fresh = new Set();
    for (const id of currentIds) {
      if (!prevIdsRef.current.has(id)) fresh.add(id);
    }
    // Don't flash on the very first paint.
    if (prevIdsRef.current.size > 0 && fresh.size > 0) {
      setFlashIds(fresh);
      const t = setTimeout(() => setFlashIds(new Set()), 1200);
      prevIdsRef.current = currentIds;
      return () => clearTimeout(t);
    }
    prevIdsRef.current = currentIds;
  }, [rows, pkName]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-primary" />
          {table || "No table selected"}
          {schema && (
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {schema.columns.length} cols
            </span>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          {loading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <Badge variant="primary">{rows.length} rows</Badge>
        </div>
      </CardHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        {!table ? (
          <Empty text="Select a table from the schema sidebar." />
        ) : rows.length === 0 ? (
          <Empty text="This table has no rows yet. Insert one via the MCP insert_row tool." />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="border-b border-border px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const key = rowKey(row, pkName, i);
                return (
                  <tr
                    key={key}
                    className={cn(
                      "border-b border-border/60 transition-colors hover:bg-muted/40",
                      flashIds.has(key) && "animate-flash-in"
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="px-4 py-2.5 align-top font-mono text-[13px] whitespace-pre-wrap"
                      >
                        {renderCell(row[col])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function Empty({ text }) {
  return (
    <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function inferColumns(rows) {
  return rows.length ? Object.keys(rows[0]) : [];
}

function rowKey(row, pkName, i) {
  return row?.[pkName] != null ? `pk:${row[pkName]}` : `idx:${i}`;
}

function renderCell(value) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground/50">null</span>;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
