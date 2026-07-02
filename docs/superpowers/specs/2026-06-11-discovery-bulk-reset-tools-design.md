> **Pre-fork MockBase history.** These tools belonged to the original MockBase
> playground (a throwaway SQLite database); **none of them exist in ShopTalk**,
> which is read-only by design.

# MockBase discovery / bulk / schema-evolution / reset tools — design

**Date:** 2026-06-11 · **Status:** approved

## Problem

Four gaps an MCP client (Poke) hits in real conversations:
1. **No schema discovery** — `PRAGMA` is blocked by the query gate, so Poke
   guesses column names and errors on typos it can't see coming.
2. **No bulk insert** — "insert 20 customers" costs 20 round trips and 20
   activity events.
3. **No schema evolution** — adding a column requires drop-and-recreate,
   losing data mid-demo.
4. **No reset** — cleaning up after a demo means dropping tables one by one.

## Tools (user approved all four)

- `get_schema` — no args; returns `getTables()` (tables, columns, types, PKs,
  row counts). **Silent** — no broadcast, so Poke can call it freely without
  spamming the activity log.
- `insert_rows(table, rows[])` — bulk insert in **one transaction** (all-or-
  nothing; a bad row rolls back the whole batch). Max 500 rows per call,
  enforced with a clear error. Broadcasts a single existing-type
  `row_inserted` event ("Inserted N rows…"), so the dashboard needs no changes
  for it.
- `add_column(table, column{name,type})` — `ALTER TABLE … ADD COLUMN`.
  Nullable only (SQLite requires a DEFAULT for NOT NULL adds — out of scope).
  Type allowlist reused. Broadcasts new event `column_added`.
- `reset_playground(reseed?)` — drops **all** user tables in a transaction;
  optionally reseeds the default dataset via `seedMockData()`. Broadcasts new
  event `reset`.

Also: set the MCP server's `instructions` (SDK `ServerOptions`) telling
clients to call `get_schema` before mutating and to prefer `insert_rows` for
multiple rows.

## Changes

- **backend/db.js** — `insertRows` (transaction over existing per-row
  validation), `addColumn` (ident + type validation), `resetDatabase`
  (enumerate user tables from `sqlite_master`, drop in transaction).
- **backend/mcp-tools.js** — four registrations + `instructions`; imports
  `seedMockData` for the reseed path (no import cycle: mcp-tools → seed → db).
- **frontend/lib/useMockbase.js** — add `column_added`, `reset` to the
  refetch list.
- **frontend/components/ActivityLog.js** — META icons: `column_added` →
  TableProperties, `reset` → RefreshCw (monochrome per theme).
- **README** — four new rows in the tools table.

## Testing

Isolated `:4100` instance, throwaway DB: `tools/list` = 10; `get_schema`
matches created schema; `insert_rows` happy path + **rollback proof** (bad row
in batch leaves count unchanged) + >500 cap error; `add_column` then insert
into the new column; `reset_playground` with and without `reseed`; query gate
unchanged. Push → Railway auto-deploy → verify 10 tools in prod.
