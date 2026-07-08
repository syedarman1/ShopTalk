// Staged write actions: codes, TTL, single-use, proposals, executors.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SHOPIFY_STORES = JSON.stringify([
  { key: "alpha", label: "Alpha", shopDomain: "alpha.myshopify.com", clientId: "i", clientSecret: "s", apiVersion: "2026-01" },
]);
const { stageAction, takeAction, _clearPending } = await import("../actions.js");

test("stageAction returns an unambiguous single-use code and takeAction consumes it", () => {
  _clearPending();
  const { code, expiresAt } = stageAction("cancel_refund", "alpha", { orderName: "#1" });
  assert.match(code, /^R-[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(new Date(expiresAt) > new Date());
  const action = takeAction(code.toLowerCase()); // case-insensitive
  assert.equal(action.kind, "cancel_refund");
  assert.equal(action.payload.orderName, "#1");
  assert.throws(() => takeAction(code), /used already|never existed/i); // single-use
});

test("expired codes are rejected with a clear message", () => {
  _clearPending();
  const { code } = stageAction("inventory_adjust", "alpha", {}, { ttlMs: -1 });
  assert.throws(() => takeAction(code), /expired/i);
});

test("inventory actions get the I- prefix", () => {
  _clearPending();
  const { code } = stageAction("inventory_adjust", "alpha", {});
  assert.match(code, /^I-/);
});

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const TOKEN_OK = { access_token: "tok", scope: "read_orders", expires_in: 86399 };
const tokenOr = (handler) => async (url, init = {}) =>
  String(url).includes("/oauth/access_token") ? json(TOKEN_OK) : handler(String(url), init);
const { proposeCancelRefund, proposeInventoryAdjust, confirmAction } = await import("../actions.js");

const ORDER_2176 = { data: { orders: { edges: [{ node: {
  id: "gid://shopify/Order/2176", name: "#2176", createdAt: "2026-06-17T00:00:00Z",
  test: false, cancelledAt: null, displayFulfillmentStatus: "FULFILLED",
  displayFinancialStatus: "PAID",
  currentTotalPriceSet: { shopMoney: { amount: "42.98", currencyCode: "USD" } },
  customer: { displayName: "A" }, lineItems: { edges: [] },
} }] } } };

test("proposeCancelRefund stages with order details and a summary", async (t) => {
  _clearPending();
  t.mock.method(globalThis, "fetch", tokenOr(() => json(ORDER_2176)));
  const p = await proposeCancelRefund("alpha", { order: "2176" });
  assert.match(p.code, /^R-/);
  assert.match(p.summary, /#2176/);
  assert.match(p.summary, /42\.98/);
});

test("confirmAction executes orderCancel with the staged GID and surfaces userErrors", async (t) => {
  _clearPending();
  let mutationBody = null;
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if (body.query.includes("orderCancel")) { mutationBody = body; return json({ data: { orderCancel: { orderCancelUserErrors: [] } } }); }
    return json(ORDER_2176);
  }));
  const p = await proposeCancelRefund("alpha", { order: "2176", reason: "customer" });
  const r = await confirmAction(p.code);
  assert.equal(r.executed, true);
  assert.equal(mutationBody.variables.orderId, "gid://shopify/Order/2176");
  assert.equal(mutationBody.variables.reason, "CUSTOMER");
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if (body.query.includes("orderCancel")) return json({ data: { orderCancel: { orderCancelUserErrors: [{ field: null, message: "already cancelled" }] } } });
    return json(ORDER_2176);
  }));
  const p2 = await proposeCancelRefund("alpha", { order: "2176" });
  await assert.rejects(() => confirmAction(p2.code), /already cancelled/);
});

const VARIANTS_ONE = { data: { productVariants: { edges: [{ node: {
  id: "gid://v1", title: "Default Title", inventoryItem: { id: "gid://ii1" }, product: { title: "Trail Hoodie" },
} }] } } };
const LOCATIONS = { data: { locations: { edges: [
  { node: { id: "gid://loc1", name: "Main Warehouse", isActive: true } },
] } } };

test("proposeInventoryAdjust resolves variant + location and stages", async (t) => {
  _clearPending();
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if (body.query.includes("productVariants")) return json(VARIANTS_ONE);
    if (body.query.includes("locations")) return json(LOCATIONS);
    throw new Error("unexpected");
  }));
  const p = await proposeInventoryAdjust("alpha", { product: "hoodie", delta: -3 });
  assert.match(p.code, /^I-/);
  assert.match(p.summary, /Trail Hoodie/);
  assert.match(p.summary, /-3/);
  assert.equal(p.location, "Main Warehouse");
});

test("ambiguous product matches are rejected with candidates", async (t) => {
  _clearPending();
  const TWO = { data: { productVariants: { edges: [
    { node: { id: "v1", title: "S", inventoryItem: { id: "i1" }, product: { title: "Hoodie" } } },
    { node: { id: "v2", title: "M", inventoryItem: { id: "i2" }, product: { title: "Hoodie" } } },
  ] } } };
  t.mock.method(globalThis, "fetch", tokenOr(() => json(TWO)));
  await assert.rejects(() => proposeInventoryAdjust("alpha", { product: "hoodie", delta: 1 }), /Multiple variants.*S.*M/s);
});

test("confirmAction executes inventoryAdjustQuantities with the staged change", async (t) => {
  _clearPending();
  let mutationBody = null;
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if (body.query.includes("productVariants")) return json(VARIANTS_ONE);
    if (body.query.includes("locations")) return json(LOCATIONS);
    if (body.query.includes("inventoryAdjustQuantities")) { mutationBody = body; return json({ data: { inventoryAdjustQuantities: { userErrors: [] } } }); }
    throw new Error("unexpected");
  }));
  const p = await proposeInventoryAdjust("alpha", { product: "hoodie", delta: 5 });
  const r = await confirmAction(p.code);
  assert.equal(r.executed, true);
  assert.deepEqual(mutationBody.variables.input.changes, [{ delta: 5, inventoryItemId: "gid://ii1", locationId: "gid://loc1" }]);
});
