// shopify.js — Shopify Admin GraphQL client + read helpers for ShopTalk.
// Pure helpers (period math, result shaping, aggregation) are unit-tested;
// the network functions live in the same module and are exercised by smoke.js.

import { resolveStore, getStores } from "./stores.js";

// ---------- Pure helpers (network-free) ----------

// UTC ISO string for the start of `now`'s calendar day in the given IANA time zone.
function startOfDayISO(now, timeZone) {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now); // e.g. "2026-06-25"
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = {};
  for (const part of dtf.formatToParts(now)) p[part.type] = part.value;
  const hour = p.hour === "24" ? "00" : p.hour;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second);
  // The formatter is second-precision, so compare against `now` truncated to
  // whole seconds — otherwise sub-second input skews the offset (and the
  // returned midnight) by the millisecond remainder.
  const offsetMs = asUTC - Math.floor(now.getTime() / 1000) * 1000; // tz offset at `now`
  const localMidnightAsUTC = new Date(`${ymd}T00:00:00.000Z`).getTime();
  return new Date(localMidnightAsUTC - offsetMs).toISOString();
}

/** Map a named period to an ISO time range relative to `now`, in `timeZone`. */
export function periodToRange(period, now, timeZone = "UTC") {
  const startToday = startOfDayISO(now, timeZone);
  if (period === "today") return { since: startToday, label: "today" };
  if (period === "yesterday") {
    // 1ms before today's local midnight is an instant inside yesterday (local),
    // so its local day-start is yesterday's midnight — DST-safe.
    const since = startOfDayISO(new Date(Date.parse(startToday) - 1), timeZone);
    return { since, until: startToday, label: "yesterday" };
  }
  const days = { "7d": 7, "30d": 30 }[period];
  if (!days) {
    throw new Error(`Unknown period "${period}". Use today, yesterday, 7d, or 30d.`);
  }
  const since = new Date(Date.parse(startToday) - days * 24 * 60 * 60 * 1000).toISOString();
  return { since, label: `last ${days} days` };
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
    test: node.test === true,
    cancelledAt: node.cancelledAt ?? null,
  };
}

/**
 * Revenue summary for a list of shaped orders. Test orders (Shopify's
 * Bogus/test gateway) and cancelled orders are excluded so "today's sales"
 * reflects real, live revenue — not test checkouts or voided orders. Totals
 * are grouped by currency (never summed across currencies); AOV is per currency.
 */
export function summarizeSales(orders) {
  const totalsByCurrency = {};
  const countByCurrency = {};
  let orderCount = 0;
  for (const o of orders) {
    if (o.test || o.cancelledAt != null) continue; // exclude test & cancelled from revenue
    orderCount += 1;
    if (o.currency != null && o.total != null) {
      totalsByCurrency[o.currency] = (totalsByCurrency[o.currency] || 0) + o.total;
      countByCurrency[o.currency] = (countByCurrency[o.currency] || 0) + 1;
    }
  }
  // AOV is per currency: a currency's total divided by *its own* order count,
  // not the overall count (which would understate it in multi-currency stores).
  const averageByCurrency = {};
  for (const [cur, total] of Object.entries(totalsByCurrency)) {
    averageByCurrency[cur] = total / countByCurrency[cur];
  }
  return { orderCount, totalsByCurrency, countByCurrency, averageByCurrency };
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

/**
 * Sum order counts and group revenue by currency across stores; track capped
 * stores; and compute per-currency average order value for the combined view
 * (a currency's total ÷ its own order count across all stores) so the rollup
 * reports AOV the same way single-store get_sales does.
 */
export function aggregateSales(perStore) {
  const byCurrency = {};
  const countByCurrency = {};
  let orderCount = 0;
  const cappedStores = [];
  for (const s of perStore) {
    orderCount += s.orderCount;
    if (s.capped) cappedStores.push(s.store);
    for (const [cur, amt] of Object.entries(s.totalsByCurrency)) {
      byCurrency[cur] = (byCurrency[cur] || 0) + amt;
    }
    for (const [cur, n] of Object.entries(s.countByCurrency || {})) {
      countByCurrency[cur] = (countByCurrency[cur] || 0) + n;
    }
  }
  const averageByCurrency = {};
  for (const [cur, total] of Object.entries(byCurrency)) {
    if (countByCurrency[cur]) averageByCurrency[cur] = total / countByCurrency[cur];
  }
  return { byCurrency, orderCount, averageByCurrency, capped: cappedStores.length > 0, cappedStores };
}

// ---------- Network client ----------

const DEFAULT_LIMIT = 10;
const SALES_PAGE = 250; // Admin API max per page; v1 reads one page.

// ---- Access token (client credentials grant) ----
// Shopify removed static admin tokens in 2026; exchange the app's
// clientId/clientSecret for a ~24h token and cache it per store in-process.
const tokenCache = new Map(); // store.key -> { token, expiresAt (ms epoch) }

const tzCache = new Map(); // store.key -> IANA timezone string

/** Fetch & cache the shop's IANA timezone; defaults to "UTC" on any failure. */
export async function getShopTimezone(store) {
  if (tzCache.has(store.key)) return tzCache.get(store.key);
  let tz = "UTC";
  try {
    const data = await shopifyGraphQL(store, `{ shop { ianaTimezone } }`);
    tz = data?.shop?.ianaTimezone || "UTC";
  } catch {
    tz = "UTC";
  }
  tzCache.set(store.key, tz);
  return tz;
}

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

  let authRetried = false;
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
      if (!authRetried) { authRetried = true; continue; }
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
  name createdAt displayFulfillmentStatus displayFinancialStatus test cancelledAt
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  customer { displayName }
`;

/** Sales for one store over a period (single page of up to 250 orders). */
export async function getSales(storeKey, period = "today") {
  const store = resolveStore(storeKey);
  const timeZone = await getShopTimezone(store);
  const { since, until, label } = periodToRange(period, new Date(), timeZone);
  const query = `
    query($q: String!) {
      orders(first: ${SALES_PAGE}, query: $q, sortKey: CREATED_AT, reverse: true) {
        edges { node { ${ORDER_FIELDS} } }
        pageInfo { hasNextPage }
      }
    }`;
  const data = await shopifyGraphQL(store, query, {
    q: `created_at:>=${since}` + (until ? ` created_at:<${until}` : ""),
  });
  const orders = data.orders.edges.map((e) => shapeOrder(e.node));
  // Excludes test & cancelled orders so revenue reflects real sales.
  const { orderCount, totalsByCurrency, countByCurrency, averageByCurrency } = summarizeSales(orders);
  return {
    store: store.key,
    label,
    orderCount,
    totalsByCurrency,
    countByCurrency,
    averageByCurrency,
    capped: data.orders.pageInfo.hasNextPage, // true => more than 250 orders in period
  };
}

/**
 * Sales rolled up across every configured store. Uses allSettled so one
 * misconfigured store (expired token, uninstalled app, network blip) doesn't
 * wipe out the whole rollup — healthy stores are still reported, and failed
 * ones are surfaced in `failures` so the answer is honest about what's missing.
 */
export async function getSalesAllStores(period = "today") {
  const stores = getStores();
  const settled = await Promise.allSettled(
    stores.map((store) => getSales(store.key, period))
  );
  const perStore = [];
  const failures = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") perStore.push(res.value);
    else failures.push({ store: stores[i].key, error: res.reason?.message || String(res.reason) });
  });
  const combined = aggregateSales(perStore);
  return { perStore, combined, failures };
}

/** Active products at/below a stock threshold, lowest inventory first. */
export async function getLowStock(storeKey, { threshold = 10, limit = 10 } = {}) {
  const store = resolveStore(storeKey);
  const gql = `
    query($q: String!, $n: Int!) {
      products(first: $n, query: $q, sortKey: INVENTORY_TOTAL) {
        edges { node {
          title status totalInventory
          priceRangeV2 { minVariantPrice { amount currencyCode } }
        } }
      }
    }`;
  const data = await shopifyGraphQL(store, gql, {
    q: `status:active inventory_total:<=${threshold}`,
    n: limit,
  });
  return {
    store: store.key,
    threshold,
    products: data.products.edges.map((e) => shapeProduct(e.node)),
  };
}

/**
 * Morning-briefing bundle: yesterday's sales, unfulfilled orders, and
 * low-stock products — per store (all stores unless storeKey is given).
 * Store-level failures don't kill the briefing; they surface in `failures`.
 * Read-only and pull-only: nothing here schedules or sends anything.
 */
export async function getDailyBriefing({ storeKey, lowStockThreshold = 10 } = {}) {
  const stores = storeKey ? [resolveStore(storeKey)] : getStores();
  const settled = await Promise.allSettled(
    stores.map(async (store) => {
      const [sales, orders, lowStock] = await Promise.all([
        getSales(store.key, "yesterday"),
        getOrders(store.key, { status: "unfulfilled", limit: 10 }),
        getLowStock(store.key, { threshold: lowStockThreshold }),
      ]);
      return {
        store: store.key,
        label: store.label,
        sales,
        unfulfilled: { count: orders.orders.length, orders: orders.orders },
        lowStock,
      };
    })
  );
  const perStore = [];
  const failures = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") perStore.push(res.value);
    else failures.push({ store: stores[i].key, error: res.reason?.message || String(res.reason) });
  });
  return { period: "yesterday", stores: perStore, failures };
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
