// db.js — shared SQLite layer for MockBase.
// Opens (and creates) mockbase.db, runs in WAL mode so the Express process and
// the MCP process can safely talk to the same file concurrently, and exposes a
// small set of validated helpers used by both server.js and mcp-server.js.

import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.MOCKBASE_DB || path.join(__dirname, "mockbase.db");

// better-sqlite3 won't create parent directories (e.g. a /data volume mount
// point that isn't attached yet) — ensure the directory exists before opening.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// SQLite identifiers we are willing to create/accept. Keeps CREATE TABLE and
// INSERT free of injection via table/column names.
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Column types we allow in create_table. SQLite is loosely typed, but we
// restrict to the storage classes (plus a couple of common aliases) so the
// generated DDL is predictable.
const ALLOWED_TYPES = new Set([
  "TEXT",
  "INTEGER",
  "INT",
  "REAL",
  "NUMERIC",
  "BLOB",
  "BOOLEAN",
  "DATE",
  "DATETIME",
]);

function assertIdentifier(name, kind = "identifier") {
  if (typeof name !== "string" || !IDENT_RE.test(name)) {
    throw new Error(
      `Invalid ${kind} "${name}". Use letters, numbers and underscores; must start with a letter or underscore.`
    );
  }
  return name;
}

// ---------------------------------------------------------------------------
// Schema / read helpers
// ---------------------------------------------------------------------------

// Returns [{ name, columns: [{name, type, notnull, pk}], rowCount }]
export function getTables() {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all();

  return tables.map((t) => {
    const columns = db
      .prepare(`PRAGMA table_info(${quoteIdent(t.name)})`)
      .all()
      .map((c) => ({
        name: c.name,
        type: c.type || "TEXT",
        notnull: !!c.notnull,
        pk: !!c.pk,
      }));
    const { count } = db
      .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(t.name)}`)
      .get();
    return { name: t.name, columns, rowCount: count };
  });
}

export function getTableData(table, limit = 500) {
  assertIdentifier(table, "table name");
  if (!tableExists(table)) throw new Error(`Table "${table}" does not exist.`);
  return db
    .prepare(`SELECT * FROM ${quoteIdent(table)} LIMIT ?`)
    .all(limit);
}

export function tableExists(table) {
  const row = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`
    )
    .get(table);
  return !!row;
}

function quoteIdent(name) {
  // name is already validated against IDENT_RE before reaching here.
  return `"${name}"`;
}

// ---------------------------------------------------------------------------
// Mutations — used by the MCP tools
// ---------------------------------------------------------------------------

// columns: [{ name, type, primaryKey?, notNull? }]
export function createTable(name, columns) {
  assertIdentifier(name, "table name");
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error("create_table requires a non-empty `columns` array.");
  }

  const defs = columns.map((col) => {
    assertIdentifier(col.name, "column name");
    const type = String(col.type || "TEXT").toUpperCase();
    if (!ALLOWED_TYPES.has(type)) {
      throw new Error(
        `Unsupported column type "${col.type}" for "${col.name}". Allowed: ${[
          ...ALLOWED_TYPES,
        ].join(", ")}.`
      );
    }
    let def = `${quoteIdent(col.name)} ${type}`;
    if (col.primaryKey) def += " PRIMARY KEY";
    if (col.notNull) def += " NOT NULL";
    return def;
  });

  // Guarantee a primary key so rows are addressable in the UI.
  const hasPk = columns.some((c) => c.primaryKey);
  const colSql = hasPk
    ? defs.join(", ")
    : `"id" INTEGER PRIMARY KEY AUTOINCREMENT, ${defs.join(", ")}`;

  const sql = `CREATE TABLE IF NOT EXISTS ${quoteIdent(name)} (${colSql})`;
  db.prepare(sql).run();
  return { table: name, sql };
}

// values: plain object of { column: value }
export function insertRow(table, values) {
  assertIdentifier(table, "table name");
  if (!tableExists(table)) throw new Error(`Table "${table}" does not exist.`);
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("insert_row requires a `values` object.");
  }
  const cols = Object.keys(values);
  if (cols.length === 0) throw new Error("insert_row received no columns.");
  cols.forEach((c) => assertIdentifier(c, "column name"));

  const placeholders = cols.map(() => "?").join(", ");
  const sql = `INSERT INTO ${quoteIdent(table)} (${cols
    .map(quoteIdent)
    .join(", ")}) VALUES (${placeholders})`;
  const params = cols.map((c) => normalizeValue(values[c]));
  const info = db.prepare(sql).run(...params);
  return { table, rowid: info.lastInsertRowid, values };
}

// Primary-key column for a table. create_table guarantees one, but tables
// could predate that or be seeded externally — so fail loudly if absent.
function getPkColumn(table) {
  const cols = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
  const pk = cols.find((c) => c.pk);
  if (!pk) throw new Error(`Table "${table}" has no primary key column.`);
  return pk.name;
}

// values: plain object of { column: value }; row addressed by primary key.
export function updateRow(table, id, values) {
  assertIdentifier(table, "table name");
  if (!tableExists(table)) throw new Error(`Table "${table}" does not exist.`);
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("update_row requires a `values` object.");
  }
  const cols = Object.keys(values);
  if (cols.length === 0) throw new Error("update_row received no columns.");
  cols.forEach((c) => assertIdentifier(c, "column name"));

  const pk = getPkColumn(table);
  const sets = cols.map((c) => `${quoteIdent(c)} = ?`).join(", ");
  const sql = `UPDATE ${quoteIdent(table)} SET ${sets} WHERE ${quoteIdent(pk)} = ?`;
  const params = [...cols.map((c) => normalizeValue(values[c])), id];
  const info = db.prepare(sql).run(...params);
  if (info.changes === 0) {
    throw new Error(`No row in "${table}" with ${pk} = ${id}.`);
  }
  return { table, pk, id, changes: info.changes, values };
}

export function deleteRow(table, id) {
  assertIdentifier(table, "table name");
  if (!tableExists(table)) throw new Error(`Table "${table}" does not exist.`);
  const pk = getPkColumn(table);
  const info = db
    .prepare(`DELETE FROM ${quoteIdent(table)} WHERE ${quoteIdent(pk)} = ?`)
    .run(id);
  if (info.changes === 0) {
    throw new Error(`No row in "${table}" with ${pk} = ${id}.`);
  }
  return { table, pk, id, changes: info.changes };
}

export function dropTable(name) {
  assertIdentifier(name, "table name");
  if (!tableExists(name)) throw new Error(`Table "${name}" does not exist.`);
  db.prepare(`DROP TABLE ${quoteIdent(name)}`).run();
  return { table: name };
}

// Bulk insert in a single transaction — a bad row rolls back the whole batch.
export function insertRows(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("insert_rows requires a non-empty `rows` array.");
  }
  if (rows.length > 500) {
    throw new Error(
      `insert_rows accepts at most 500 rows per call (got ${rows.length}).`
    );
  }
  const run = db.transaction(() => rows.map((r) => insertRow(table, r)));
  const results = run();
  return {
    table,
    count: results.length,
    firstRowid: results[0].rowid,
    lastRowid: results[results.length - 1].rowid,
  };
}

// ALTER TABLE … ADD COLUMN. Nullable only: SQLite requires a DEFAULT to add a
// NOT NULL column, which isn't worth the surface for a playground.
export function addColumn(table, column) {
  assertIdentifier(table, "table name");
  if (!tableExists(table)) throw new Error(`Table "${table}" does not exist.`);
  if (!column || typeof column !== "object") {
    throw new Error("add_column requires a `column` object.");
  }
  assertIdentifier(column.name, "column name");
  const type = String(column.type || "TEXT").toUpperCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(
      `Unsupported column type "${column.type}". Allowed: ${[
        ...ALLOWED_TYPES,
      ].join(", ")}.`
    );
  }
  const sql = `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(
    column.name
  )} ${type}`;
  db.prepare(sql).run();
  return { table, column: column.name, type, sql };
}

// Drop every user table (transactional). The playground's panic button.
export function resetDatabase() {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )
    .all()
    .map((t) => t.name);
  const run = db.transaction(() => {
    for (const name of tables) {
      db.prepare(`DROP TABLE ${quoteIdent(name)}`).run();
    }
  });
  run();
  return { dropped: tables };
}

// better-sqlite3 only binds primitives; coerce objects/arrays/booleans.
function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

// Read-only query gate. Returns { rows, sql }.
export function queryData(sql) {
  if (typeof sql !== "string" || !sql.trim()) {
    throw new Error("query_data requires a SQL string.");
  }
  const trimmed = sql.trim().replace(/;+\s*$/, ""); // tolerate trailing ;

  // Reject anything that smuggles in a second statement.
  if (trimmed.includes(";")) {
    throw new Error("Only a single SELECT statement is allowed.");
  }

  // Must read like a query.
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
    throw new Error("query_data only accepts SELECT (or WITH ... SELECT) queries.");
  }

  // Defense in depth: block obvious mutation keywords as whole words.
  const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i;
  if (FORBIDDEN.test(trimmed)) {
    throw new Error("query_data rejected: write/DDL keyword detected.");
  }

  const stmt = db.prepare(trimmed);
  // better-sqlite3 marks statements that return data as readers. A non-reader
  // (e.g. a sneaky write) throws here rather than mutating anything.
  if (!stmt.reader) {
    throw new Error("query_data only accepts statements that return rows.");
  }
  const rows = stmt.all();
  return { rows, sql: trimmed };
}
