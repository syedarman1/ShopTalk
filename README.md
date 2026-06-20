# MockBase — Real-time Text-to-Database MCP Playground

MockBase lets you manage a local SQLite database through **Model Context
Protocol (MCP)** tools and watch every mutation appear **instantly** in a
Next.js dashboard. Point an MCP client (Poke, Claude Desktop, Cursor, the MCP
Inspector…) at the MCP server, ask it to create a table or insert a row, and
the change streams into the browser over Server-Sent Events — no refresh.

```
 MCP client (Poke) ──HTTP /mcp──▶ Express (server.js: API + SSE + MCP) ──▶ mockbase.db (SQLite)
                                        │
                                        └──SSE /api/events──▶ Next.js dashboard

 Local-only alternative: mcp-server.js (stdio) ──▶ same DB ──▶ /internal/broadcast ──▶ Express
```

---

## Project structure

```
mockbase/
├── backend/                # Node.js: SQLite + Express API + SSE + MCP server
│   ├── db.js               # better-sqlite3 layer + validated helpers
│   ├── server.js           # Express REST API + SSE broadcaster
│   ├── mcp-server.js       # MCP stdio server (create_table, insert_row, query_data)
│   ├── notify.js           # MCP → dashboard broadcast bridge
│   └── seed.js             # default dataset (also the "Mock Data" target)
└── frontend/               # Next.js (App Router) + Tailwind + shadcn-style UI
    ├── app/                # layout + dashboard page
    ├── components/         # Sidebar, DataTable, ActivityLog, Header, ui primitives
    └── lib/useMockbase.js  # SSE listener + data-fetching hook
```

---

## Prerequisites

- **Node.js 18+** (built and tested on Node 22)
- npm

---

## 1. Run the backend (API + SSE)

```bash
cd backend
npm install
npm start          # http://localhost:4000
```

On first run `mockbase.db` is created automatically. Seed the default data
(`users`, `products`) any time with:

```bash
npm run seed
```

REST endpoints:

| Method | Route                | Description                                  |
| ------ | -------------------- | -------------------------------------------- |
| GET    | `/api/tables`        | All table schemas + row counts               |
| GET    | `/api/data/:table`   | All rows for a table                         |
| GET    | `/api/events`        | **SSE** stream of live database changes      |
| POST   | `/api/seed`          | Seed/top-up mock data (the dashboard button) |
| GET    | `/api/health`        | Health + connected SSE client count          |

---

## 2. Run the frontend (dashboard)

In a second terminal:

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

The dashboard reads the backend URL from `frontend/.env.local`:

```
NEXT_PUBLIC_API_BASE=http://localhost:4000
```

What you get:

- **Schema viewer** (left sidebar) — every table, its columns, types, primary
  keys, and live row counts. The active table expands to show its columns.
- **Real-time data grid** — rows for the selected table; newly inserted rows
  flash as they arrive over SSE.
- **Activity log** — a live feed of incoming MCP traffic
  (e.g. `insert_row → users`), colour-coded by tool.
- **Mock Data button** — seeds a default table so you can test immediately.

---

## 3. Connect the MCP server

`server.js` serves the tools over **streamable HTTP at `/mcp`** — the
recommended transport (see *Connecting to Poke* below and *Deploy*); no stdio
bridge or supergateway required. For local command-based clients (Claude
Desktop, Cursor, MCP Inspector) there's also a **stdio** server, `mcp-server.js`:

```bash
node /ABSOLUTE/PATH/TO/mockbase/backend/mcp-server.js
```

> Keep the backend (`npm start`) running too — the MCP server writes to the
> database on its own, but it needs the Express server alive to push live
> updates to the dashboard. (If the dashboard is offline, writes still persist;
> they just won't stream until you reconnect.)

### Generic MCP client config (Claude Desktop / Cursor / Poke local connector)

Most stdio MCP clients use this JSON shape (e.g. Claude Desktop's
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mockbase": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mockbase/backend/mcp-server.js"],
      "env": { "PORT": "4000" }
    }
  }
}
```

### Connecting to Poke

Poke is cloud-hosted, so it needs an **HTTPS MCP URL** — which `server.js` serves
directly at `/mcp` (streamable HTTP). No stdio bridge, supergateway, or proxy.

- **Local** — expose `:4000` with Poke's own tunnel (it registers the
  integration for you):

  ```bash
  npx poke@latest login
  npx poke@latest tunnel http://localhost:4000/mcp -n "MockBase"
  ```

- **Hosted** — point Poke straight at your deployed URL, no tunnel:

  ```bash
  npx poke@latest mcp add https://your-backend.example.com/mcp -n "MockBase"
  ```

Then text Poke, e.g. *"create a table `books` (title TEXT, author TEXT) and
insert 3 rows"*, and watch the dashboard update live.

### Quick test without a client — MCP Inspector

```bash
cd backend
npx @modelcontextprotocol/inspector node mcp-server.js
```

---

## Deploy (always-on)

For live demos without running anything locally, host the backend (one process:
API + SSE + MCP) and the dashboard.

**Backend → Railway / Render / Fly.io** (any long-running Node host with a disk):

1. Point the service at `backend/` — a `Dockerfile` is included.
2. Add a **persistent volume** and set `MOCKBASE_DB` to a path on it, e.g.
   `MOCKBASE_DB=/data/mockbase.db`. `db.js` reads that env var, so the SQLite
   file lives on the volume and survives restarts. The host injects `PORT`.
3. Deploy. The backend now serves `/api/*`, `/api/events` (SSE), and `/mcp` at
   `https://your-backend.example.com`.

> **Not serverless.** Vercel/Netlify functions and Cloudflare Workers won't work
> for the backend: SQLite needs a persistent disk and SSE needs a long-lived
> connection. Use a long-running container/VM.

**Frontend → Vercel** (or any static/Node host):

1. Set `NEXT_PUBLIC_API_BASE` to the backend URL (see `frontend/.env.example`).
2. Deploy `frontend/`.

**Poke →** `npx poke@latest mcp add https://your-backend.example.com/mcp -n "MockBase"` — no tunnel.

---

## MCP tools

| Tool           | Arguments                                                                 | Behaviour                                                                                   |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `create_table` | `name`, `columns: [{ name, type, primaryKey?, notNull? }]`               | Runs `CREATE TABLE` (auto-adds an `id` PK if none given). Allowed types: TEXT, INTEGER, INT, REAL, NUMERIC, BLOB, BOOLEAN, DATE, DATETIME. |
| `get_schema`   | —                                                                          | All tables with columns, types, PKs, and row counts. Call before mutating.                 |
| `insert_row`   | `table`, `values: { column: value }`                                      | Inserts one row (objects/booleans are coerced for SQLite).                                  |
| `insert_rows`  | `table`, `rows: [{ column: value }, …]`                                   | Bulk insert (max 500) in one transaction — any bad row rolls back the batch.               |
| `add_column`   | `table`, `column: { name, type }`                                         | `ALTER TABLE … ADD COLUMN` (nullable). Existing rows get NULL.                             |
| `reset_playground` | `reseed?`                                                              | Drops **all** tables; optionally reseeds the default demo dataset.                         |
| `update_row`   | `table`, `id`, `values: { column: value }`                                | Updates one row, addressed by primary key. Errors if no row matches.                       |
| `delete_row`   | `table`, `id`                                                              | Deletes one row, addressed by primary key. Errors if no row matches.                       |
| `drop_table`   | `name`                                                                     | Permanently drops the table and all its rows.                                              |
| `query_data`   | `sql`                                                                      | Runs a **read-only** `SELECT` / `WITH … SELECT` and returns rows.                           |

### Safety

`query_data` is hardened against injection: it rejects multiple statements,
anything that isn't a `SELECT`/`WITH`, any DDL/DML keyword
(`INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/REPLACE/TRUNCATE/ATTACH/PRAGMA/…`),
and any prepared statement that isn't a pure reader. Table and column names are
validated against a strict identifier pattern before they touch the database.

### Example prompts for your MCP client

- "Create a table `books` with columns title (TEXT), author (TEXT), year (INTEGER)."
- "Insert a row into `books`: title 'Dune', author 'Frank Herbert', year 1965."
- "Query the 5 most recent users."

Each of these will appear in the dashboard's activity log and update the data
grid in real time.

---

## How real-time sync works

1. An MCP tool call hits `mcp-server.js`, which validates input and writes to
   `mockbase.db` via `better-sqlite3` (WAL mode, so the API and MCP processes
   share the file safely).
2. On success it `POST`s the event to the Express server's
   `/internal/broadcast` endpoint.
3. Express fans the event out to every connected browser over the
   `/api/events` SSE stream.
4. The `useMockbase` hook receives the event, appends it to the activity log,
   and refetches the affected schema/rows — so the UI updates without a refresh.

---

## Scripts reference

**backend/**
- `npm start` — Express API + SSE on `:4000`
- `npm run dev` — same, with `--watch` reload
- `npm run mcp` — start the MCP stdio server
- `npm run seed` — seed/top-up mock data

**frontend/**
- `npm run dev` — Next.js dev server on `:3000`
- `npm run build` / `npm start` — production build + serve
