// mcp-tools.js — single source of truth for MockBase's MCP tools.
//
// Builds a configured McpServer exposing create_table / insert_row / query_data.
// The `broadcast` callback is injected so the exact same tools work in two modes:
//   - in-process  (server.js passes its SSE broadcast function directly)
//   - stdio        (mcp-server.js passes notifyDashboard, an HTTP POST to the
//                   running Express server's /internal/broadcast)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  createTable,
  insertRow,
  insertRows,
  updateRow,
  deleteRow,
  dropTable,
  addColumn,
  resetDatabase,
  getTables,
  queryData,
} from "./db.js";
import { seedMockData } from "./seed.js";

// Plain-text tool result helper for the MCP client.
const text = (value) => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const errorText = (message) => ({
  content: [{ type: "text", text: `Error: ${message}` }],
  isError: true,
});

/**
 * Build a fresh MockBase MCP server.
 *
 * @param {(event: object) => unknown | Promise<unknown>} broadcast
 *   Invoked after each successful mutation to announce it to the dashboard.
 *   Defaults to a no-op so the server is usable without a dashboard.
 */
export function createMcpServer(broadcast = () => {}) {
  const server = new McpServer(
    { name: "mockbase", version: "1.0.0" },
    {
      instructions:
        "MockBase is a demo SQLite playground wired to a live dashboard. " +
        "Call get_schema first to see the current tables and columns before " +
        "querying or mutating — column names must match exactly. Prefer " +
        "insert_rows when adding more than one row. update_row/delete_row " +
        "address rows by primary key (use query_data to find ids). " +
        "reset_playground wipes everything; use it when asked to start fresh.",
    }
  );

  // -------------------------------------------------------------------------
  // get_schema
  // -------------------------------------------------------------------------
  server.registerTool(
    "get_schema",
    {
      title: "Get Schema",
      description:
        "List every table with its columns (name, type, not-null, primary " +
        "key) and current row count. Call this before querying or mutating " +
        "so column names match exactly.",
      inputSchema: {},
    },
    async () => {
      try {
        // Read-only and expected to be called often — deliberately silent
        // (no broadcast), so it never spams the dashboard's activity log.
        return text({ tables: getTables() });
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // -------------------------------------------------------------------------
  // create_table
  // -------------------------------------------------------------------------
  server.registerTool(
    "create_table",
    {
      title: "Create Table",
      description:
        "Create a new SQLite table. Provide a table name and an array of columns " +
        "with types. An auto-incrementing integer `id` primary key is added " +
        "automatically unless one of your columns is marked as the primary key.",
      inputSchema: {
        name: z
          .string()
          .describe("Table name (letters, numbers, underscores)."),
        columns: z
          .array(
            z.object({
              name: z.string().describe("Column name."),
              type: z
                .enum([
                  "TEXT",
                  "INTEGER",
                  "INT",
                  "REAL",
                  "NUMERIC",
                  "BLOB",
                  "BOOLEAN",
                  "DATE",
                  "DATETIME",
                ])
                .describe("SQLite column type."),
              primaryKey: z.boolean().optional(),
              notNull: z.boolean().optional(),
            })
          )
          .min(1)
          .describe("Columns to create."),
      },
    },
    async ({ name, columns }) => {
      try {
        const result = createTable(name, columns);
        await broadcast({
          type: "table_created",
          tool: "create_table",
          table: name,
          message: `Created table "${name}" (${columns.length} column${
            columns.length === 1 ? "" : "s"
          })`,
          detail: result.sql,
        });
        return text(`Table "${name}" created.\n\nDDL:\n${result.sql}`);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // -------------------------------------------------------------------------
  // insert_row
  // -------------------------------------------------------------------------
  server.registerTool(
    "insert_row",
    {
      title: "Insert Row",
      description:
        "Insert a single row into an existing table. Pass the table name and a " +
        "JSON object of column/value pairs.",
      inputSchema: {
        table: z.string().describe("Target table name."),
        values: z
          .record(z.string(), z.any())
          .describe("Object of { column: value } pairs to insert."),
      },
    },
    async ({ table, values }) => {
      try {
        const result = insertRow(table, values);
        await broadcast({
          type: "row_inserted",
          tool: "insert_row",
          table,
          message: `Inserted row into "${table}" (id ${result.rowid})`,
          detail: result.values,
        });
        return text(`Inserted into "${table}". New rowid: ${result.rowid}.`);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // -------------------------------------------------------------------------
  // insert_rows
  // -------------------------------------------------------------------------
  server.registerTool(
    "insert_rows",
    {
      title: "Insert Rows (bulk)",
      description:
        "Insert multiple rows into an existing table in one transaction — " +
        "if any row is invalid, the whole batch is rolled back. Max 500 rows " +
        "per call. Prefer this over insert_row when adding more than one row.",
      inputSchema: {
        table: z.string().describe("Target table name."),
        rows: z
          .array(z.record(z.string(), z.any()))
          .min(1)
          .max(500)
          .describe("Array of { column: value } objects, one per row."),
      },
    },
    async ({ table, rows }) => {
      try {
        const result = insertRows(table, rows);
        await broadcast({
          type: "row_inserted",
          tool: "insert_rows",
          table,
          message: `Inserted ${result.count} rows into "${table}"`,
          detail: { count: result.count, lastRowid: result.lastRowid },
        });
        return text(
          `Inserted ${result.count} rows into "${table}" (rowids ${result.firstRowid}–${result.lastRowid}).`
        );
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // -------------------------------------------------------------------------
  // update_row
  // -------------------------------------------------------------------------
  server.registerTool(
    "update_row",
    {
      title: "Update Row",
      description:
        "Update a single row in an existing table, addressed by its primary " +
        "key. Pass the table name, the row's primary-key value, and a JSON " +
        "object of column/value pairs to change. Use query_data first to find " +
        "the row's id.",
      inputSchema: {
        table: z.string().describe("Target table name."),
        id: z
          .union([z.number(), z.string()])
          .describe("Primary-key value of the row to update."),
        values: z
          .record(z.string(), z.any())
          .describe("Object of { column: value } pairs to change."),
      },
    },
    async ({ table, id, values }) => {
      try {
        const result = updateRow(table, id, values);
        await broadcast({
          type: "row_updated",
          tool: "update_row",
          table,
          message: `Updated row ${result.pk}=${id} in "${table}"`,
          detail: result.values,
        });
        return text(
          `Updated row in "${table}" where ${result.pk} = ${id}.`
        );
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // -------------------------------------------------------------------------
  // delete_row
  // -------------------------------------------------------------------------
  server.registerTool(
    "delete_row",
    {
      title: "Delete Row",
      description:
        "Delete a single row from an existing table, addressed by its primary " +
        "key. Use query_data first to find the row's id.",
      inputSchema: {
        table: z.string().describe("Target table name."),
        id: z
          .union([z.number(), z.string()])
          .describe("Primary-key value of the row to delete."),
      },
    },
    async ({ table, id }) => {
      try {
        const result = deleteRow(table, id);
        await broadcast({
          type: "row_deleted",
          tool: "delete_row",
          table,
          message: `Deleted row ${result.pk}=${id} from "${table}"`,
        });
        return text(
          `Deleted row from "${table}" where ${result.pk} = ${id}.`
        );
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // -------------------------------------------------------------------------
  // drop_table
  // -------------------------------------------------------------------------
  server.registerTool(
    "drop_table",
    {
      title: "Drop Table",
      description:
        "Permanently delete an entire table and all of its rows. This cannot " +
        "be undone.",
      inputSchema: {
        name: z.string().describe("Name of the table to drop."),
      },
    },
    async ({ name }) => {
      try {
        dropTable(name);
        await broadcast({
          type: "table_dropped",
          tool: "drop_table",
          table: name,
          message: `Dropped table "${name}"`,
        });
        return text(`Table "${name}" dropped.`);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // -------------------------------------------------------------------------
  // add_column
  // -------------------------------------------------------------------------
  server.registerTool(
    "add_column",
    {
      title: "Add Column",
      description:
        "Add a new (nullable) column to an existing table without losing " +
        "data. Existing rows get NULL for the new column.",
      inputSchema: {
        table: z.string().describe("Target table name."),
        column: z
          .object({
            name: z.string().describe("New column name."),
            type: z
              .enum([
                "TEXT",
                "INTEGER",
                "INT",
                "REAL",
                "NUMERIC",
                "BLOB",
                "BOOLEAN",
                "DATE",
                "DATETIME",
              ])
              .describe("SQLite column type."),
          })
          .describe("Column to add."),
      },
    },
    async ({ table, column }) => {
      try {
        const result = addColumn(table, column);
        await broadcast({
          type: "column_added",
          tool: "add_column",
          table,
          message: `Added column "${result.column}" (${result.type}) to "${table}"`,
          detail: result.sql,
        });
        return text(
          `Added column "${result.column}" (${result.type}) to "${table}".`
        );
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // -------------------------------------------------------------------------
  // reset_playground
  // -------------------------------------------------------------------------
  server.registerTool(
    "reset_playground",
    {
      title: "Reset Playground",
      description:
        "Drop ALL tables and start fresh. Pass reseed=true to restore the " +
        "default demo dataset (users, products) afterwards. This cannot be " +
        "undone.",
      inputSchema: {
        reseed: z
          .boolean()
          .optional()
          .describe("Re-create the default demo dataset after wiping."),
      },
    },
    async ({ reseed }) => {
      try {
        const { dropped } = resetDatabase();
        let summary = `Playground reset — dropped ${dropped.length} table${
          dropped.length === 1 ? "" : "s"
        }`;
        if (reseed) {
          seedMockData();
          summary += ", reseeded default dataset";
        }
        await broadcast({
          type: "reset",
          tool: "reset_playground",
          message: summary,
          detail: { dropped, reseeded: !!reseed },
        });
        return text(`${summary}.`);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // -------------------------------------------------------------------------
  // query_data
  // -------------------------------------------------------------------------
  server.registerTool(
    "query_data",
    {
      title: "Query Data",
      description:
        "Run a read-only SQL SELECT (or WITH ... SELECT) query and return the " +
        "rows. Write and DDL statements are rejected.",
      inputSchema: {
        sql: z.string().describe("A single read-only SELECT statement."),
      },
    },
    async ({ sql }) => {
      try {
        const { rows, sql: cleanSql } = queryData(sql);
        await broadcast({
          type: "query",
          tool: "query_data",
          message: `Query returned ${rows.length} row${
            rows.length === 1 ? "" : "s"
          }`,
          detail: cleanSql,
        });
        return text({ rowCount: rows.length, rows });
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  return server;
}
