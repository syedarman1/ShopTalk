// mcp-tools.js — single source of truth for ShopTalk's MCP tools.
// Builds a configured McpServer exposing read-only Shopify queries.
// The `broadcast` callback is injected so the same tools work in two modes:
//   - in-process (server.js passes its SSE broadcast function)
//   - stdio      (mcp-server.js passes notifyDashboard)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listStoreSummaries } from "./stores.js";
import {
  getSales,
  getSalesAllStores,
  getOrders,
  getOrder,
  searchProducts,
  searchCustomers,
} from "./shopify.js";

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

const money = (byCurrency) =>
  Object.entries(byCurrency)
    .map(([cur, amt]) => `${amt.toFixed(2)} ${cur}`)
    .join(", ") || "0";

export function createMcpServer(broadcast = () => {}) {
  const server = new McpServer(
    { name: "shoptalk", version: "1.0.0" },
    {
      instructions:
        "ShopTalk gives read-only access to the owner's Shopify store(s) over a " +
        "live dashboard. Call list_stores first if unsure which stores exist. " +
        "Every tool takes an optional `store` key; omit it to use the default " +
        "store (or, for get_sales, to roll up across all stores). All tools are " +
        "read-only — there is no way to change store data.",
    }
  );

  // list_stores -----------------------------------------------------------
  server.registerTool(
    "list_stores",
    {
      title: "List Stores",
      description: "List the configured Shopify stores (key, label, domain).",
      inputSchema: {},
    },
    async () => {
      try {
        const stores = listStoreSummaries();
        await broadcast({
          type: "stores",
          tool: "list_stores",
          message: `Listed ${stores.length} store${stores.length === 1 ? "" : "s"}`,
          detail: stores,
        });
        return text({ stores });
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_sales -------------------------------------------------------------
  server.registerTool(
    "get_sales",
    {
      title: "Get Sales",
      description:
        "Revenue, order count, and average order value for a period. Omit " +
        "`store` to roll up across all stores.",
      inputSchema: {
        store: z.string().optional().describe("Store key. Omit to roll up all stores."),
        period: z
          .enum(["today", "7d", "30d"])
          .optional()
          .describe("Time window (default today)."),
      },
    },
    async ({ store, period = "today" }) => {
      try {
        if (store) {
          const r = await getSales(store, period);
          const msg =
            `${r.store} — ${r.label}: ${r.orderCount} orders, ` +
            `${money(r.totalsByCurrency)}` +
            (r.capped ? " (capped at 250 orders)" : "");
          await broadcast({
            type: "sales",
            tool: "get_sales",
            store: r.store,
            message: msg,
            detail: r,
          });
          return text(r);
        }
        const r = await getSalesAllStores(period);
        const cappedNote = r.combined.capped
          ? ` (capped at 250 orders in: ${r.combined.cappedStores.join(", ")})`
          : "";
        const failNote = r.failures.length
          ? ` — excluded ${r.failures.length} store(s) with errors: ${r.failures.map((f) => f.store).join(", ")}`
          : "";
        const msg = `All stores — ${r.perStore[0]?.label ?? period}: ${r.combined.orderCount} orders, ${money(r.combined.byCurrency)}${cappedNote}${failNote}`;
        await broadcast({
          type: "sales",
          tool: "get_sales",
          message: msg,
          detail: r,
        });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_orders ------------------------------------------------------------
  server.registerTool(
    "get_orders",
    {
      title: "Get Orders",
      description: "List recent orders, optionally only unfulfilled ones.",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        status: z.enum(["unfulfilled"]).optional().describe("Filter by status."),
        limit: z.number().int().min(1).max(50).optional().describe("Max orders (default 10)."),
      },
    },
    async ({ store, status, limit }) => {
      try {
        const r = await getOrders(store, { status, limit });
        await broadcast({
          type: "orders",
          tool: "get_orders",
          store: r.store,
          message: `${r.store} — ${r.orders.length} ${status ?? "recent"} order${r.orders.length === 1 ? "" : "s"}`,
          detail: r.orders,
        });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_order -------------------------------------------------------------
  server.registerTool(
    "get_order",
    {
      title: "Get Order",
      description: "Full detail for one order by its number (e.g. #1001).",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        name: z.string().describe("Order number, with or without # (e.g. 1001 or #1001)."),
      },
    },
    async ({ store, name }) => {
      try {
        const r = await getOrder(store, name);
        await broadcast({
          type: "order",
          tool: "get_order",
          store: r.store,
          message: r.order ? `${r.store} — order ${r.order.name}` : `${r.store} — order ${name} not found`,
          detail: r.order,
        });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // search_products -------------------------------------------------------
  server.registerTool(
    "search_products",
    {
      title: "Search Products",
      description: "Search products by title/SKU; lists products by title when no query is given.",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        query: z.string().optional().describe("Search text (title, sku, etc.)."),
        limit: z.number().int().min(1).max(50).optional().describe("Max products (default 10)."),
      },
    },
    async ({ store, query, limit }) => {
      try {
        const r = await searchProducts(store, { query, limit });
        await broadcast({
          type: "products",
          tool: "search_products",
          store: r.store,
          message: `${r.store} — ${r.products.length} product${r.products.length === 1 ? "" : "s"}`,
          detail: r.products,
        });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // search_customers ------------------------------------------------------
  server.registerTool(
    "search_customers",
    {
      title: "Search Customers",
      description: 'Search customers. Pass query "orders_count:>1" for repeat customers.',
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        query: z.string().optional().describe("Search text or filter (e.g. orders_count:>1)."),
        limit: z.number().int().min(1).max(50).optional().describe("Max customers (default 10)."),
      },
    },
    async ({ store, query, limit }) => {
      try {
        const r = await searchCustomers(store, { query, limit });
        await broadcast({
          type: "customers",
          tool: "search_customers",
          store: r.store,
          message: `${r.store} — ${r.customers.length} customer${r.customers.length === 1 ? "" : "s"}`,
          detail: r.customers,
        });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  return server;
}
