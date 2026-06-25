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

// ---------- Network client ----------

const DEFAULT_LIMIT = 10;
const SALES_PAGE = 250; // Admin API max per page; v1 reads one page.

// ---- Access token (client credentials grant) ----
// Shopify removed static admin tokens in 2026; exchange the app's
// clientId/clientSecret for a ~24h token and cache it per store in-process.
const tokenCache = new Map(); // store.key -> { token, expiresAt (ms epoch) }

/** Get a valid Admin API access token for the store, exchanging/refreshing as needed. */
export async function getAccessToken(store) {
  const cached = tokenCache.get(store.key);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const res = await fetch(`https://${store.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: store.clientId,
      client_secret: store.clientSecret,
    }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Token exchange failed for store "${store.key}" (HTTP ${res.status}). ` +
        "Check clientId/clientSecret and that the app is installed on the store."
    );
  }
  if (!res.ok) {
    throw new Error(`Token exchange error for "${store.key}": HTTP ${res.status}.`);
  }
  const json = await res.json();
  // Refresh a minute before the ~24h expiry to avoid edge-of-expiry failures.
  const ttl = ((json.expires_in ?? 86399) - 60) * 1000;
  tokenCache.set(store.key, { token: json.access_token, expiresAt: Date.now() + ttl });
  return json.access_token;
}

/**
 * Run an Admin GraphQL query against a store object. Fetches/caches a token via
 * the client credentials grant; on a 401 it drops the cached token and retries
 * once with a fresh one; on a 429 it backs off and retries. Throws on auth,
 * HTTP, or GraphQL errors with a clear message.
 */
export async function shopifyGraphQL(store, query, variables = {}) {
  const url = `https://${store.shopDomain}/admin/api/${store.apiVersion}/graphql.json`;
  const body = JSON.stringify({ query, variables });

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await getAccessToken(store);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body,
    });

    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      tokenCache.delete(store.key);
      if (attempt === 0) continue;
      throw new Error(
        `Authentication failed for store "${store.key}" (HTTP ${res.status}). ` +
          "Check the app's scopes and that it is installed on the store."
      );
    }
    if (!res.ok) {
      throw new Error(`Shopify API error for "${store.key}": HTTP ${res.status}.`);
    }

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(`GraphQL error for "${store.key}": ${json.errors[0].message}`);
    }
    return json.data;
  }
  throw new Error(`Shopify API for "${store.key}" failed after retries.`);
}

const ORDER_FIELDS = `
  name createdAt displayFulfillmentStatus displayFinancialStatus
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  customer { displayName }
`;

/** Sales for one store over a period (single page of up to 250 orders). */
export async function getSales(storeKey, period = "today") {
  const store = resolveStore(storeKey);
  const { since, label } = periodToRange(period, new Date());
  const query = `
    query($q: String!) {
      orders(first: ${SALES_PAGE}, query: $q, sortKey: CREATED_AT, reverse: true) {
        edges { node { ${ORDER_FIELDS} } }
        pageInfo { hasNextPage }
      }
    }`;
  const data = await shopifyGraphQL(store, query, {
    q: `created_at:>=${since}`,
  });
  const edges = data.orders.edges;
  const totalsByCurrency = {};
  for (const { node } of edges) {
    const o = shapeOrder(node);
    if (o.currency != null && o.total != null) {
      totalsByCurrency[o.currency] = (totalsByCurrency[o.currency] || 0) + o.total;
    }
  }
  const orderCount = edges.length;
  const averageByCurrency = {};
  for (const [cur, total] of Object.entries(totalsByCurrency)) {
    averageByCurrency[cur] = orderCount ? total / orderCount : 0;
  }
  return {
    store: store.key,
    label,
    orderCount,
    totalsByCurrency,
    averageByCurrency,
    capped: data.orders.pageInfo.hasNextPage, // true => more than 250 orders in period
  };
}

/** Sales rolled up across every configured store. */
export async function getSalesAllStores(period = "today") {
  const perStore = await Promise.all(
    getStores().map((store) => getSales(store.key, period))
  );
  const combined = aggregateSales(perStore);
  return { perStore, combined };
}

/** Recent orders for one store, optionally filtered to unfulfilled. */
export async function getOrders(storeKey, { status, limit = DEFAULT_LIMIT } = {}) {
  const store = resolveStore(storeKey);
  const filter = status === "unfulfilled" ? "fulfillment_status:unfulfilled" : null;
  const query = `
    query($q: String, $n: Int!) {
      orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) {
        edges { node { ${ORDER_FIELDS} } }
      }
    }`;
  const data = await shopifyGraphQL(store, query, { q: filter, n: limit });
  return { store: store.key, orders: data.orders.edges.map((e) => shapeOrder(e.node)) };
}

/** A single order by its name (e.g. "#1001"). */
export async function getOrder(storeKey, name) {
  const store = resolveStore(storeKey);
  const clean = name.startsWith("#") ? name : `#${name}`;
  const query = `
    query($q: String!) {
      orders(first: 1, query: $q) {
        edges { node {
          ${ORDER_FIELDS}
          lineItems(first: 20) { edges { node { title quantity } } }
        } }
      }
    }`;
  const data = await shopifyGraphQL(store, query, { q: `name:${clean}` });
  const edge = data.orders.edges[0];
  if (!edge) return { store: store.key, order: null };
  const order = shapeOrder(edge.node);
  order.lineItems = edge.node.lineItems.edges.map((e) => ({
    title: e.node.title,
    quantity: e.node.quantity,
  }));
  return { store: store.key, order };
}

/** Search products by text; lists by title when no query is given. */
export async function searchProducts(storeKey, { query: q, limit = DEFAULT_LIMIT } = {}) {
  const store = resolveStore(storeKey);
  // Admin products has no sales-based sort; RELEVANCE needs a query, else TITLE.
  const sortKey = q ? "RELEVANCE" : "TITLE";
  const gql = `
    query($q: String, $n: Int!) {
      products(first: $n, query: $q, sortKey: ${sortKey}) {
        edges { node {
          title status totalInventory
          priceRangeV2 { minVariantPrice { amount currencyCode } }
        } }
      }
    }`;
  const data = await shopifyGraphQL(store, gql, { q: q || null, n: limit });
  return { store: store.key, products: data.products.edges.map((e) => shapeProduct(e.node)) };
}

/** Search customers; pass query "orders_count:>1" for repeat customers. */
export async function searchCustomers(storeKey, { query: q, limit = DEFAULT_LIMIT } = {}) {
  const store = resolveStore(storeKey);
  const gql = `
    query($q: String, $n: Int!) {
      customers(first: $n, query: $q) {
        edges { node {
          displayName defaultEmailAddress { emailAddress } numberOfOrders
          amountSpent { amount currencyCode }
        } }
      }
    }`;
  const data = await shopifyGraphQL(store, gql, { q: q || null, n: limit });
  return { store: store.key, customers: data.customers.edges.map((e) => shapeCustomer(e.node)) };
}
