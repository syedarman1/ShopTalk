// shopify.js — Shopify Admin GraphQL client + read helpers for ShopTalk.
// Pure helpers (period math, result shaping, aggregation) are unit-tested;
// the network functions live in the same module and are exercised by smoke.js.

import { resolveStore, getStores } from "./stores.js";

// ---------- Pure helpers (network-free) ----------

/** Map a named period to an ISO `since` timestamp relative to `now`. */
export function periodToRange(period, now) {
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  if (period === "today") {
    return { since: midnight.toISOString(), label: "today" };
  }
  const days = { "7d": 7, "30d": 30 }[period];
  if (!days) {
    throw new Error(`Unknown period "${period}". Use today, 7d, or 30d.`);
  }
  const since = new Date(midnight.getTime() - days * 24 * 60 * 60 * 1000);
  return { since: since.toISOString(), label: `last ${days} days` };
}

/** Flatten a GraphQL order node into a clean object. */
export function shapeOrder(node) {
  const money = node.currentTotalPriceSet?.shopMoney ?? {};
  return {
    name: node.name,
    createdAt: node.createdAt,
    total: money.amount != null ? Number(money.amount) : null,
    currency: money.currencyCode ?? null,
    fulfillmentStatus: node.displayFulfillmentStatus ?? null,
    financialStatus: node.displayFinancialStatus ?? null,
    customer: node.customer?.displayName ?? null,
  };
}

/** Flatten a GraphQL product node. */
export function shapeProduct(node) {
  const price = node.priceRangeV2?.minVariantPrice ?? {};
  return {
    title: node.title,
    status: node.status ?? null,
    totalInventory: node.totalInventory ?? null,
    price: price.amount != null ? Number(price.amount) : null,
    currency: price.currencyCode ?? null,
  };
}

/** Flatten a GraphQL customer node. */
export function shapeCustomer(node) {
  const spent = node.amountSpent ?? {};
  return {
    name: node.displayName,
    email: node.defaultEmailAddress?.emailAddress ?? null,
    orders: node.numberOfOrders != null ? Number(node.numberOfOrders) : null,
    amountSpent: spent.amount != null ? Number(spent.amount) : null,
    currency: spent.currencyCode ?? null,
  };
}

/** Sum order counts and group revenue totals by currency across stores. */
export function aggregateSales(perStore) {
  const byCurrency = {};
  let orderCount = 0;
  for (const s of perStore) {
    orderCount += s.orderCount;
    for (const [cur, amt] of Object.entries(s.totalsByCurrency)) {
      byCurrency[cur] = (byCurrency[cur] || 0) + amt;
    }
  }
  return { byCurrency, orderCount };
}
