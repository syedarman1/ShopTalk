// smoke.js — manual read-only smoke test against the configured store(s).
// Usage: SHOPIFY_STORES='[...]' node smoke.js
import { listStoreSummaries } from "./stores.js";
import { getSales, getOrders, searchProducts, searchCustomers } from "./shopify.js";

const run = async () => {
  console.log("Stores:", listStoreSummaries());
  const key = listStoreSummaries()[0].key;
  console.log("\n--- get_sales today ---");
  console.log(await getSales(key, "today"));
  console.log("\n--- get_orders (5) ---");
  console.log(await getOrders(key, { limit: 5 }));
  console.log("\n--- search_products (5) ---");
  console.log(await searchProducts(key, { limit: 5 }));
  console.log("\n--- search_customers (5) ---");
  console.log(await searchCustomers(key, { limit: 5 }));
};

run().catch((err) => {
  console.error("SMOKE FAILED:", err.message);
  process.exit(1);
});
