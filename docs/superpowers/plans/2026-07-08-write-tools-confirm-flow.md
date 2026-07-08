# Write Tools + Confirm Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two write actions (cancel+refund an order; adjust inventory) that only execute after the merchant texts back a one-time confirmation code — 14 → 17 tools.

**Architecture:** New `backend/actions.js`: an in-process staging store (code → pending action, 15-min TTL, single-use delete-before-execute) plus proposal validators and mutation executors. Three tool registrations + an instructions rewrite. `run_query`'s mutation guard is untouched — the escape hatch stays read-only; writes have exactly one door.

**Tech Stack:** existing stack; no new deps (`node:crypto` for codes).

## Global Constraints
- Nothing executes in a propose_* call; `confirm_action` is the only executor and requires the exact staged code (case-insensitive input, normalized).
- Codes: unambiguous alphabet (no 0/O/1/I/L), single-use, `PENDING_TTL_MS = 15 * 60 * 1000`.
- v1 cancel = FULL refund + restock + notify customer; partial refunds are documented as admin-only.
- Docs must stop claiming pure read-only the same commit the tools land.
- New scopes (`write_orders`, `write_inventory`, `read_inventory`, `read_locations`) are the user's dance; tools surface Shopify's access error until granted. Live testing: propose-only against real data; NO live confirm of a refund unless the user explicitly asks.

---

### Task 1: staging core (TDD)

**Files:** Create `backend/actions.js` (staging part), `backend/test/actions.test.js` (staging tests).

**Interfaces:** `stageAction(kind, storeKey, payload, { ttlMs?, prefix? }) => { code, expiresAt }` · `takeAction(code) => action` (throws unknown/expired; deletes first) · `PENDING_TTL_MS` · `_clearPending()` (tests).

- [ ] **Step 1: tests** (start `backend/test/actions.test.js`):

```js
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
```

- [ ] **Step 2:** red. **Step 3: implement** (top of `backend/actions.js`):

```js
// actions.js — staged write actions behind one-time confirmation codes.
// propose_* stages; confirm_action(code) is the ONLY executor. Nothing here
// runs on first ask — the merchant must text the code back.
import { randomBytes } from "node:crypto";
import { resolveStore } from "./stores.js";
import { shopifyGraphQL, getOrder } from "./shopify.js";

export const PENDING_TTL_MS = 15 * 60 * 1000;
const pending = new Map(); // CODE -> { kind, store, payload, expiresAt }

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O/1/I/L lookalikes... (see note)
function makeCode(prefix) {
  const bytes = randomBytes(4);
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${prefix}-${s}`;
}

export function stageAction(kind, storeKey, payload, { ttlMs = PENDING_TTL_MS, prefix } = {}) {
  const code = makeCode(prefix ?? (kind === "cancel_refund" ? "R" : "I"));
  const expiresAtMs = Date.now() + ttlMs;
  pending.set(code, { kind, store: storeKey ?? null, payload, expiresAt: expiresAtMs });
  return { code, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function takeAction(code) {
  const key = String(code).trim().toUpperCase();
  const action = pending.get(key);
  if (!action) {
    throw new Error(`No pending action with code "${key}" — it may have been used already or never existed. Propose again.`);
  }
  pending.delete(key); // single-use: delete before execute
  if (Date.now() > action.expiresAt) {
    throw new Error(`Code "${key}" expired (codes last 15 minutes). Propose the action again.`);
  }
  return action;
}

export function _clearPending() {
  pending.clear();
}
```
(Note: the alphabet includes I as a *prefix* only via `I-`; the random part draws from the alphabet which excludes I/L/O/0/1 — the regex in the test matches that.) Remove "I" from CODE_ALPHABET commentary confusion: the constant string literally is `ABCDEFGHJKMNPQRSTVWXYZ23456789` (no I, L, O, 0, 1).

- [ ] **Step 4:** green → commit `Staged-action core: one-time confirmation codes with TTL`.

---

### Task 2: proposals + executors (TDD)

**Files:** Modify `backend/actions.js` (append), `backend/shopify.js` (`ORDER_FIELDS` gains `id`; `shapeOrder` passes it through), `backend/test/shopify.test.js` (shapeOrder expectations gain `id`), `backend/test/actions.test.js` (append).

**Interfaces:** `proposeCancelRefund(storeKey, { order, reason? })` · `proposeInventoryAdjust(storeKey, { product, delta, location? })` · `confirmAction(code)` — all exported from `actions.js`.

- [ ] **Step 1: shapeOrder id** — in `shopify.js`, `ORDER_FIELDS` starts `id name createdAt …`; `shapeOrder` returns `id: node.id ?? null,` first. Update the two `shapeOrder` deepEqual tests in `test/shopify.test.js` to include `id: null` (their fixtures have no id) — and the flatten test's fixture gains `id: "gid://shopify/Order/1"` with the expectation updated.
- [ ] **Step 2: tests** (append to `actions.test.js`):

```js
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
  // and Shopify-rejection path:
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
```

- [ ] **Step 3: implement** (append to `actions.js`):

```js
const CANCEL_REASONS = new Set(["customer", "declined", "fraud", "inventory", "other", "staff"]);

/** Validate + stage an order cancellation with full refund. Executes NOTHING. */
export async function proposeCancelRefund(storeKey, { order, reason = "other" } = {}) {
  const store = resolveStore(storeKey);
  if (!CANCEL_REASONS.has(reason)) {
    throw new Error(`reason must be one of: ${[...CANCEL_REASONS].join(", ")}`);
  }
  const found = await getOrder(store.key, String(order));
  if (!found.order) throw new Error(`Order ${order} not found on ${store.key}.`);
  const o = found.order;
  if (o.cancelledAt) throw new Error(`Order ${o.name} is already cancelled.`);
  if (o.financialStatus === "REFUNDED") throw new Error(`Order ${o.name} is already refunded.`);
  if (!o.id) throw new Error(`Order ${o.name} is missing its id — cannot stage.`);
  const staged = stageAction("cancel_refund", store.key, {
    orderId: o.id, orderName: o.name, reason,
  });
  const total = o.total != null ? `${o.total.toFixed(2)} ${o.currency}` : "the full amount";
  return {
    ...staged,
    order: o.name,
    total: o.total,
    currency: o.currency,
    summary: `Cancel ${o.name} and refund ${total} to the customer (items restocked, customer notified). This cannot be undone.`,
  };
}

/** Validate + stage an inventory correction. Executes NOTHING. */
export async function proposeInventoryAdjust(storeKey, { product, delta, location } = {}) {
  const store = resolveStore(storeKey);
  if (!Number.isInteger(delta) || delta === 0) throw new Error("delta must be a non-zero integer.");
  const data = await shopifyGraphQL(store, `
    query($q: String!) {
      productVariants(first: 5, query: $q) {
        edges { node { id title inventoryItem { id } product { title } } }
      }
    }`, { q: String(product) });
  const variants = data.productVariants.edges.map((e) => e.node);
  if (variants.length === 0) throw new Error(`No product variant matches "${product}".`);
  if (variants.length > 1) {
    const list = variants.map((v) => `${v.product.title} — ${v.title}`).join("; ");
    throw new Error(`Multiple variants match "${product}" — narrow the search. Candidates: ${list}`);
  }
  const v = variants[0];
  const locData = await shopifyGraphQL(store, `{
    locations(first: 10) { edges { node { id name isActive } } }
  }`);
  let locs = locData.locations.edges.map((e) => e.node).filter((l) => l.isActive);
  if (location) locs = locs.filter((l) => l.name.toLowerCase().includes(String(location).toLowerCase()));
  if (locs.length === 0) {
    throw new Error(location ? `No active location matching "${location}".` : "No active locations on this store.");
  }
  const loc = locs[0];
  const label = `${v.product.title}${v.title && v.title !== "Default Title" ? ` (${v.title})` : ""} at ${loc.name}`;
  const staged = stageAction("inventory_adjust", store.key, {
    inventoryItemId: v.inventoryItem.id, locationId: loc.id, delta, label,
  });
  return {
    ...staged,
    label,
    delta,
    location: loc.name,
    summary: `Adjust available stock of ${label} by ${delta > 0 ? "+" : ""}${delta} (recorded as a correction).`,
  };
}

async function executeAction(action) {
  const store = resolveStore(action.store);
  if (action.kind === "cancel_refund") {
    const data = await shopifyGraphQL(store, `
      mutation($orderId: ID!, $reason: OrderCancelReason!) {
        orderCancel(orderId: $orderId, reason: $reason, refund: true, restock: true, notifyCustomer: true, staffNote: "via ShopTalk confirm code") {
          orderCancelUserErrors { field message }
        }
      }`, { orderId: action.payload.orderId, reason: String(action.payload.reason).toUpperCase() });
    const errs = data.orderCancel?.orderCancelUserErrors ?? [];
    if (errs.length) throw new Error(`Shopify rejected the cancellation: ${errs.map((e) => e.message).join(" | ")}`);
    return {
      executed: true,
      kind: action.kind,
      order: action.payload.orderName,
      note: "Cancellation with full refund submitted — Shopify processes it as a background job.",
    };
  }
  if (action.kind === "inventory_adjust") {
    const data = await shopifyGraphQL(store, `
      mutation($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          userErrors { field message }
        }
      }`, {
      input: {
        reason: "correction",
        name: "available",
        changes: [{
          delta: action.payload.delta,
          inventoryItemId: action.payload.inventoryItemId,
          locationId: action.payload.locationId,
        }],
      },
    });
    const errs = data.inventoryAdjustQuantities?.userErrors ?? [];
    if (errs.length) throw new Error(`Shopify rejected the adjustment: ${errs.map((e) => e.message).join(" | ")}`);
    return { executed: true, kind: action.kind, adjusted: action.payload.label, delta: action.payload.delta };
  }
  throw new Error(`Unknown action kind "${action.kind}".`);
}

/** The ONLY executor. Requires the exact one-time code the merchant texted back. */
export async function confirmAction(code) {
  const action = takeAction(code);
  return executeAction(action);
}
```

- [ ] **Step 4:** full suite green → commit `Write actions: cancel+refund and inventory adjust, staged behind codes`.

---

### Task 3: tool registrations + instructions + smoke

**Files:** Modify `backend/mcp-tools.js`.

- [ ] **Step 1:** import `{ proposeCancelRefund, proposeInventoryAdjust, confirmAction }` from `./actions.js`; register after `get_shop_info`:

```js
  // propose_cancel_refund ------------------------------------------------------
  server.registerTool(
    "propose_cancel_refund",
    {
      title: "Propose: Cancel + Refund Order",
      description:
        "STAGE a full cancel-and-refund for an order. Executes NOTHING — it " +
        "returns a summary and a one-time code. Show both to the merchant and " +
        "STOP; only confirm_action with their echoed code executes. Full " +
        "refund + restock + customer notification; partial refunds are " +
        "admin-only. Requires the write_orders scope.",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        order: z.string().describe("Order number, with or without # (e.g. 2176)."),
        reason: z.enum(["customer", "declined", "fraud", "inventory", "other", "staff"]).optional()
          .describe("Cancellation reason (default other)."),
      },
    },
    async ({ store, order, reason }) => {
      try {
        const r = await proposeCancelRefund(store, { order, reason });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // propose_inventory_adjust ---------------------------------------------------
  server.registerTool(
    "propose_inventory_adjust",
    {
      title: "Propose: Inventory Adjustment",
      description:
        "STAGE a stock correction (+/- units) for one product variant at one " +
        "location. Executes NOTHING — returns a summary and a one-time code; " +
        "show both to the merchant and STOP. Only confirm_action with their " +
        "echoed code executes. Requires write_inventory (+ read_inventory, " +
        "read_locations).",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        product: z.string().describe("Product/variant search text — must match exactly one variant."),
        delta: z.number().int().describe("Signed adjustment, e.g. -3 or 12. Not zero."),
        location: z.string().optional().describe("Location name filter (default: first active location)."),
      },
    },
    async ({ store, product, delta, location }) => {
      try {
        const r = await proposeInventoryAdjust(store, { product, delta, location });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // confirm_action ---------------------------------------------------------------
  server.registerTool(
    "confirm_action",
    {
      title: "Confirm Staged Action",
      description:
        "Execute a previously staged write action. ONLY call this when the " +
        "merchant's own message explicitly contains the code (e.g. 'confirm " +
        "R-7GK2'). Never guess, reuse, or auto-fill codes. Codes are " +
        "single-use and expire after 15 minutes.",
      inputSchema: {
        code: z.string().describe("The one-time code the merchant texted back."),
      },
    },
    async ({ code }) => {
      try {
        const r = await confirmAction(code);
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );
```

- [ ] **Step 2: instructions** — replace the final sentence of the `instructions` string ("Everything is read-only: there is no way to change store data.") with:

```
"Reads are the default. Exactly two write actions exist — cancel+refund an " +
"order, and adjust inventory — and they NEVER execute directly: the " +
"propose_* tool stages the action and returns a one-time code; present the " +
"summary and code to the merchant and STOP. Call confirm_action ONLY when " +
"the merchant's reply explicitly contains that code — never guess or " +
"auto-confirm. Everything else cannot change store data.",
```

- [ ] **Step 3:** suite + boot smoke `tools/list` = **17** → commit `Register write tools + confirm ritual in instructions (17 tools)`.

---

### Task 4: docs honesty + push + CI + live propose check

**Files:** `README.md`, `SECURITY.md`.

- [ ] **Step 1: README** — counts fourteen → seventeen (explainer, heading, tree). Table +3 rows (propose_cancel_refund / propose_inventory_adjust / confirm_action — each stating "stages only; executes via texted code"). Rewrite the read-only pitch paragraphs: "Who this is for" paragraph and the tools-table footer paragraph now say: reads by default; two write actions exist and each requires texting back a one-time confirmation code — a misread text still can't change anything; only a deliberate confirmation can. Scopes line adds `write_orders`, `write_inventory`, `read_inventory`, `read_locations` (optional, only for the write tools). Roadmap: "Write actions" line → shipped (propose→confirm), future = more actions under the same ritual.
- [ ] **Step 2: SECURITY.md** — read-only bullet → "Read-mostly:" wording with the confirm-code model described in two sentences; scope list updated.
- [ ] **Step 3:** full suite; commit `Docs: 17 tools, propose→confirm write model (read-only claim retired honestly)`; push; watch CI to success.
- [ ] **Step 4: live (read-only) verification** — `proposeCancelRefund('main', { order: '2176' })` against the real store: expect a summary naming #2176/$42.98 + an R- code; DO NOT confirm. `proposeInventoryAdjust` live only if scopes landed (needs read_locations); otherwise note pending. Report the scope status from a fresh token mint.

## Self-Review
**Spec coverage:** staging/TTL/single-use (T1), both proposals + executors + GID plumbing (T2), tools + instructions ritual (T3), docs honesty + live propose-only (T4). ✓
**Type consistency:** `stageAction(kind, storeKey, payload, opts)` used identically in both proposals; `confirmAction(code)` consumed by the tool; `shapeOrder().id` produced in T2-step1 and consumed by `proposeCancelRefund`; mutation variable shapes match the test assertions. ✓
**No placeholders.** ✓
