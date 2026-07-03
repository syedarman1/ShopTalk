// mcp-tools.js — single source of truth for ShopTalk's MCP tools.
// Builds a configured McpServer exposing read-only Shopify queries; served
// over streamable HTTP by server.js and over stdio by mcp-server.js.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listStoreSummaries } from "./stores.js";
import {
  getSales,
  getSalesAllStores,
  getDailyBriefing,
  getOrders,
  getOrder,
  searchProducts,
  searchCustomers,
  runReadQuery,
  getDisputes,
  getBestSellers,
  getPayouts,
  getRefunds,
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

export function createMcpServer() {
  const server = new McpServer(
    { name: "shoptalk", version: "1.0.0" },
    {
      instructions:
        "ShopTalk gives read-only access to the owner's Shopify store(s). " +
        "Call list_stores first if unsure which stores exist. Every tool takes " +
        "an optional `store` key; omit it for the default store (get_sales " +
        "rolls up across all stores when omitted). Coverage: sales & AOV " +
        "(get_sales), morning summary (get_daily_briefing), orders (get_orders, " +
        "get_order), refunds (get_refunds), chargebacks (get_disputes), payouts " +
        "& balance (get_payouts), products & stock (search_products), best " +
        "sellers (get_best_sellers), customers (search_customers). For anything " +
        "else, use run_query with a read-only Admin GraphQL query. Prefer the " +
        "dedicated tools when one fits. If neither a tool nor run_query can " +
        "answer, say so plainly — never invent numbers. Everything is " +
        "read-only: there is no way to change store data.",
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
          .enum(["today", "yesterday", "7d", "30d"])
          .optional()
          .describe("Time window (default today)."),
      },
    },
    async ({ store, period = "today" }) => {
      try {
        if (store) {
          const r = await getSales(store, period);
          return text(r);
        }
        const r = await getSalesAllStores(period);
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_daily_briefing ------------------------------------------------------
  server.registerTool(
    "get_daily_briefing",
    {
      title: "Daily Briefing",
      description:
        "Morning summary for the merchant: yesterday's sales (revenue, orders, " +
        "AOV), orders still unfulfilled, and low-stock products — per store. " +
        "Use it for scheduled morning check-ins or when asked \"how's my store " +
        "doing?\". Read-only.",
      inputSchema: {
        store: z.string().optional().describe("Store key (all stores if omitted)."),
        lowStockThreshold: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Inventory at/below this counts as low stock (default 10)."),
      },
    },
    async ({ store, lowStockThreshold }) => {
      try {
        const r = await getDailyBriefing({ storeKey: store, lowStockThreshold });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_best_sellers --------------------------------------------------------
  server.registerTool(
    "get_best_sellers",
    {
      title: "Best Sellers",
      description:
        "Top products by units actually sold over a period (test and cancelled " +
        "orders excluded). Use for \"what's selling?\" / \"top products this month\".",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        period: z.enum(["today", "yesterday", "7d", "30d"]).optional().describe("Window (default 30d)."),
        limit: z.number().int().min(1).max(20).optional().describe("How many products (default 5)."),
      },
    },
    async ({ store, period, limit }) => {
      try {
        const r = await getBestSellers(store, { period, limit });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_disputes -------------------------------------------------------------
  server.registerTool(
    "get_disputes",
    {
      title: "Chargebacks / Disputes",
      description:
        "Shopify Payments chargebacks and inquiries — amount, reason, status, " +
        "and the evidence-due deadline. Default lists OPEN disputes " +
        "(needs response / under review). Requires the app to have the " +
        "read_shopify_payments_disputes AND read_shopify_payments_accounts " +
        "scopes (grant them and reinstall if missing).",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        status: z.enum(["open", "all"]).optional().describe("open (default) or all."),
        limit: z.number().int().min(1).max(50).optional().describe("Max disputes (default 10)."),
      },
    },
    async ({ store, status, limit }) => {
      try {
        const r = await getDisputes(store, { status, limit });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_payouts ---------------------------------------------------------------
  server.registerTool(
    "get_payouts",
    {
      title: "Payouts & Balance",
      description:
        "Shopify Payments: current balance and recent payouts with status " +
        "(scheduled / in transit / paid) — \"when does my money land?\". Requires " +
        "the read_shopify_payments_payouts AND read_shopify_payments_accounts " +
        "scopes (grant them and reinstall if missing).",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        limit: z.number().int().min(1).max(20).optional().describe("Max payouts (default 5)."),
      },
    },
    async ({ store, limit }) => {
      try {
        const r = await getPayouts(store, { limit });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_refunds ---------------------------------------------------------------
  server.registerTool(
    "get_refunds",
    {
      title: "Recent Refunds",
      description:
        "Recently refunded or partially refunded orders (ordered by last " +
        "update, which approximates refund time).",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        limit: z.number().int().min(1).max(50).optional().describe("Max orders (default 10)."),
      },
    },
    async ({ store, limit }) => {
      try {
        const r = await getRefunds(store, { limit });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // run_query -----------------------------------------------------------------
  server.registerTool(
    "run_query",
    {
      title: "Run Read Query",
      description:
        "Escape hatch: run any READ-ONLY Shopify Admin GraphQL query when no " +
        "dedicated tool covers the question. Mutations are rejected and the app " +
        "holds read scopes only. Keep selections small (a few fields, first: <= 10). " +
        "Examples — shop info: { shop { name currencyCode plan { displayName } } } | " +
        "abandoned checkouts: { abandonedCheckouts(first: 5) { edges { node { " +
        "createdAt totalPriceSet { shopMoney { amount currencyCode } } } } } }",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        query: z.string().describe("A GraphQL query document. Mutations are rejected."),
        variables: z.record(z.string(), z.any()).optional().describe("Optional GraphQL variables."),
      },
    },
    async ({ store, query, variables }) => {
      try {
        const r = await runReadQuery(store, query, variables ?? {});
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
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  return server;
}
