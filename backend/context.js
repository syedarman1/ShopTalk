// context.js — per-request tenant binding via AsyncLocalStorage.
// Single-tenant (self-host) never enters a tenant context, so boundStore()/
// boundNamespace() are no-ops and every store/action helper behaves as before.
// The cloud service wraps each request in runInTenant({ store, namespace }, …),
// binding one shop's injected-token store to every tool call in that request.
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();

export function runInTenant(ctx, fn) {
  return als.run(ctx, fn);
}
export function boundStore() {
  return als.getStore()?.store ?? null;
}
export function boundNamespace() {
  return als.getStore()?.namespace ?? "";
}
