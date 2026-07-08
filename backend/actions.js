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
