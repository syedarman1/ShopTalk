# Write Tools with Confirm Flow — Design Spec (Phase 1 of Kitchen packaging)

**Date:** 2026-07-08
**Status:** Approved. User explicitly reversed the read-only-only decision:
writes are in, gated behind a propose→confirm pattern. Phase 2 (multi-tenant
Kitchen template) is a separate spec later.

## The safety model

No write executes on first ask. Two-step, always:

1. A **propose_*** tool validates the request against live data, stages a
   pending action, and returns a human summary plus a one-time code
   (e.g. `R-2176-XK4`). Poke texts that to the merchant.
2. **confirm_action(code)** executes it — only when the merchant has replied
   with the code. Codes are single-use, expire after **15 minutes**, and are
   stored in-process (a restart clears pending actions — failing safe).

Server instructions: Poke must NEVER call confirm_action unless the user's
message explicitly contains the code; it must show the summary and wait.

## New tools (14 → 17)

### `propose_cancel_refund({ store?, order, reason? })`
- Resolves the order (existing exact-match `getOrder`); rejects if not found,
  already cancelled/refunded.
- Stages `{ kind: "cancel_refund", orderId, orderName, total, currency, reason }`.
- Returns `{ summary, code, expiresAt, orderName, total, currency }` — summary
  like `Cancel #2176 and refund $42.98 USD to the customer. Reply with code
  R-2176-XK4 to execute.`
- `reason` enum: customer | declined | fraud | inventory | other (default
  other) → Shopify `OrderCancelReason`.
- v1 executes a FULL refund + restock via the `orderCancel` mutation
  (`refund: true, restock: true, notifyCustomer: true`); partial-amount refunds
  stay in Shopify admin (documented).

### `propose_inventory_adjust({ store?, product, delta, location? })`
- `product` is a search string; resolve via `productVariants(first: 5, query)`
  → need exactly one match (else return candidates and ask to narrow);
  captures `inventoryItem.id` + variant/product titles.
- `location` optional name filter; default = first active location
  (`locations(first: 10)`).
- Stages `{ kind: "inventory_adjust", inventoryItemId, locationId, delta,
  label }`; summary like `Adjust "Trail Hoodie" at Main Warehouse by -3
  (new count applied as a correction). Reply with code I-7GK2 to execute.`

### `confirm_action({ store?, code })`
- Looks up the pending action: unknown → clear error; expired → clear error;
  wrong store → error. Executes exactly once (delete-before-execute).
- `cancel_refund` → `orderCancel(orderId, reason, refund: true, restock: true,
  notifyCustomer: true, staffNote: "via ShopTalk")`; surface
  `orderCancelUserErrors` verbatim on failure.
- `inventory_adjust` → `inventoryAdjustQuantities(input: { reason:
  "correction", name: "available", changes: [{ delta, inventoryItemId,
  locationId }] })`; surface `userErrors`.
- Returns `{ executed: true, kind, detail }` or the error.

## Implementation

- New module `backend/actions.js`: pure-ish staging store —
  `proposeAction(kind, payload, summary)` → `{ code, expiresAt }`,
  `takeAction(code)` (atomic get+delete, TTL check), `PENDING_TTL_MS = 15 min`,
  code format `${prefix}-${base32-ish 4 chars}` via crypto randomness; plus the
  two executors and resolution helpers that call `shopifyGraphQL` with the
  mutations above. Mutations go through `shopifyGraphQL` directly — the
  `runReadQuery` mutation guard is untouched (the escape hatch stays read-only).
- `mcp-tools.js`: three registrations + instructions rewrite: mention the two
  write capabilities, the code ritual, "never confirm without the user's
  explicit code", and that everything else remains read-only.
- Scopes (user is adding now): `write_orders`, `write_inventory`,
  `read_inventory`, `read_locations` — tools degrade with Shopify's access
  error until granted.

## Docs (honesty updates — required, not optional)

- README: tool table +3; count fourteen → seventeen; the "read-only" pitch
  reworded everywhere it appears: reads by default; exactly two write actions
  exist and each requires texting back a one-time confirmation code; a misread
  text still can't change anything — only a deliberate confirmation can.
- SECURITY.md: same rewording; scope list updated.

## Testing

Mocked-fetch (existing pattern): staging returns code + summary and stores
once; confirm with wrong/expired/reused code fails cleanly; happy-path
cancel_refund invokes `orderCancel` with the staged ID and surfaces
userErrors; inventory path resolves variant + location, ambiguous product
returns candidates; TTL expiry (inject clock or short TTL param). Plus
`tools/list` smoke = 17. Live verification: propose against a real order
(NO confirm), assert summary/code; confirm-path live test only on a
user-designated throwaway adjustment (inventory +0/-0 or a $0 test), never a
real refund without the user asking.

## Non-goals (Phase 1)

Partial refunds, multi-item inventory batches, any other mutations, Phase 2
multi-tenancy/OAuth/Kitchen registration (separate spec), changes to run_query
(stays read-only).
