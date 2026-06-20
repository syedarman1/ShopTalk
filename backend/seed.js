// seed.js — populates mockbase.db with a friendly default dataset.
// Used on first boot and by the dashboard's "Mock Data" button. Safe to run
// repeatedly: it creates tables if missing and tops up sample rows.

import { db, createTable, insertRow, tableExists } from "./db.js";

const SAMPLE_USERS = [
  { name: "Ada Lovelace", email: "ada@mockbase.dev", role: "admin" },
  { name: "Alan Turing", email: "alan@mockbase.dev", role: "engineer" },
  { name: "Grace Hopper", email: "grace@mockbase.dev", role: "engineer" },
  { name: "Katherine Johnson", email: "katherine@mockbase.dev", role: "analyst" },
];

const SAMPLE_PRODUCTS = [
  { title: "Quantum Mug", price: 18.5, in_stock: 42 },
  { title: "Recursive Notebook", price: 12.0, in_stock: 120 },
  { title: "SSE Stream Sticker Pack", price: 6.75, in_stock: 300 },
];

const EXTRA_NAMES = [
  "Margaret Hamilton",
  "Barbara Liskov",
  "Donald Knuth",
  "Edsger Dijkstra",
  "Tim Berners-Lee",
  "Radia Perlman",
];

// Runs the full seed. Returns a short, human-readable summary of what changed
// so the API/SSE layer can report it in the activity log.
export function seedMockData() {
  const changes = [];

  if (!tableExists("users")) {
    createTable("users", [
      { name: "name", type: "TEXT", notNull: true },
      { name: "email", type: "TEXT" },
      { name: "role", type: "TEXT" },
      { name: "created_at", type: "DATETIME" },
    ]);
    changes.push('created table "users"');
  }

  if (!tableExists("products")) {
    createTable("products", [
      { name: "title", type: "TEXT", notNull: true },
      { name: "price", type: "REAL" },
      { name: "in_stock", type: "INTEGER" },
    ]);
    changes.push('created table "products"');
  }

  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (userCount === 0) {
    for (const u of SAMPLE_USERS) {
      insertRow("users", { ...u, created_at: new Date().toISOString() });
    }
    changes.push(`inserted ${SAMPLE_USERS.length} rows into "users"`);
  } else {
    // Already seeded — add one fresh user so the button visibly does something.
    const name = EXTRA_NAMES[Math.floor(Math.random() * EXTRA_NAMES.length)];
    insertRow("users", {
      name,
      email: `${name.split(" ")[0].toLowerCase()}${userCount}@mockbase.dev`,
      role: "guest",
      created_at: new Date().toISOString(),
    });
    changes.push(`inserted 1 row into "users"`);
  }

  const productCount = db.prepare("SELECT COUNT(*) AS c FROM products").get().c;
  if (productCount === 0) {
    for (const p of SAMPLE_PRODUCTS) insertRow("products", p);
    changes.push(`inserted ${SAMPLE_PRODUCTS.length} rows into "products"`);
  }

  return changes.length ? changes.join("; ") : "database already seeded";
}

// Allow `npm run seed` from the CLI.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("[seed]", seedMockData());
}
