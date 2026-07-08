// actions.js — staged write actions behind one-time confirmation codes.
// propose_* stages; confirm_action(code) is the ONLY executor. Nothing here
// runs on first ask — the merchant must text the code back.
import { randomBytes } from "node:crypto";
import { resolveStore } from "./stores.js";
import { shopifyGraphQL, getOrder } from "./shopify.js";

export const PENDING_TTL_MS = 15 * 60 * 1000;
const pending = new Map(); // CODE -> { kind, store, payload, expiresAt }

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O/1/I/L lookalikes
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
