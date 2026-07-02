> **Pre-fork MockBase history.** These tools belonged to the original MockBase
> playground (a throwaway SQLite database); **none of them exist in ShopTalk**,
> which is read-only by design.

# MockBase mutation tools — design

**Date:** 2026-06-11 · **Status:** approved

## Problem

MockBase exposes only `create_table`, `insert_row`, and a read-only `query_data`.
An MCP client (Poke) cannot update or delete rows, or remove tables — `query_data`
rejects all mutation keywords by design and there is no typed alternative.

## Decisions (user-approved)

- Add **three** tools: `update_row`, `delete_row`, `drop_table`.
- Rows are targeted **by primary-key id** only — no WHERE-clause parsing, keeping
  the injection surface closed. `create_table` already guarantees every table a PK.
- `query_data`'s read-only gate is unchanged.

## Changes

**backend/db.js** — validated helpers in the existing style (`assertIdentifier`,
`normalizeValue`, `quoteIdent`):
- `getPkColumn(table)` — PK column name via `PRAGMA table_info` (errors if none).
- `updateRow(table, id, values)` — `UPDATE "t" SET "c"=?,… WHERE "pk"=?`;
  0 changes → error ("no row with id …").
- `deleteRow(table, id)` — same shape.
- `dropTable(name)` — existence check, then `DROP TABLE`.

**backend/mcp-tools.js** — register the three tools; broadcast event types
`row_updated`, `row_deleted`, `table_dropped`. Both transports (HTTP `/mcp`,
stdio) inherit them via the shared module.

**frontend** —
- `components/ActivityLog.js`: META entries for the three event types
  (monochrome icons, per theme).
- Dropped-table guard: if the selected table no longer exists after a refetch,
  selection falls back to the first table (avoids fetching a dropped table).

**README** — add the three tools to the tools table.

## Testing

Isolated instance (`:4100`, throwaway DB): happy paths for all three tools;
error paths (unknown table, bad id, 0-change update, dropping nonexistent
table); `tools/list` shows 6 tools; `query_data` still rejects mutations.
Then push → Railway auto-deploy → re-verify `/mcp` in production.
