// panelSummaries.mjs — pure derivations for the orders/products/customers panels.
// No React. Group money by currency (never sum across currencies).

const LOW_STOCK = 10;

export function stockLevel(inventory) {
  if (typeof inventory === "number" && inventory <= 0) return "out"; // 0 or oversold
  if (typeof inventory === "number" && inventory <= LOW_STOCK) return "low";
  return "in";
}

function addMoney(acc, amount, currency) {
  if (currency != null && amount != null) acc[currency] = (acc[currency] || 0) + amount;
}

export function summarizeOrders(orders = []) {
  const valueByCurrency = {};
  let unfulfilled = 0;
  for (const o of orders) {
    addMoney(valueByCurrency, o.total, o.currency);
    if (o.fulfillmentStatus && o.fulfillmentStatus !== "FULFILLED") unfulfilled += 1;
  }
  return { count: orders.length, valueByCurrency, unfulfilled };
}

export function summarizeProducts(products = []) {
  let active = 0;
  let needRestock = 0;
  for (const p of products) {
    if (p.status === "ACTIVE") active += 1;
    const lvl = stockLevel(p.totalInventory);
    if (lvl === "out" || lvl === "low") needRestock += 1;
  }
  return { count: products.length, active, needRestock };
}

export function summarizeCustomers(customers = []) {
  const spentByCurrency = {};
  let totalOrders = 0;
  let maxSpent = 0;
  for (const c of customers) {
    addMoney(spentByCurrency, c.amountSpent, c.currency);
    totalOrders += c.orders || 0;
    if ((c.amountSpent || 0) > maxSpent) maxSpent = c.amountSpent || 0;
  }
  const count = customers.length;
  return { count, spentByCurrency, avgOrders: count ? Math.round(totalOrders / count) : 0, maxSpent };
}
