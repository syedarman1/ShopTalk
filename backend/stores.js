// stores.js — multi-store registry for ShopTalk.
// Stores are configured via the SHOPIFY_STORES env var: a JSON array of
// { key, label, shopDomain, adminAccessToken, apiVersion? } objects.

const DEFAULT_API_VERSION = "2026-01";

/**
 * Parse and validate the SHOPIFY_STORES JSON from a given env object.
 * Pure: takes env in, returns the store array. Throws on misconfig.
 */
export function parseStoresEnv(env) {
  const raw = env.SHOPIFY_STORES;
  if (!raw) {
    throw new Error(
      "SHOPIFY_STORES is not set. Provide a JSON array of stores " +
        '(e.g. SHOPIFY_STORES=\'[{"key":"main","label":"Main",' +
        '"shopDomain":"main.myshopify.com","adminAccessToken":"shpat_..."}]\').'
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`SHOPIFY_STORES is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("SHOPIFY_STORES must be a non-empty JSON array.");
  }
  return parsed.map((s, i) => {
    for (const field of ["key", "label", "shopDomain", "adminAccessToken"]) {
      if (!s[field]) {
        throw new Error(`Store at index ${i} is missing required field "${field}".`);
      }
    }
    return {
      key: s.key,
      label: s.label,
      shopDomain: s.shopDomain,
      adminAccessToken: s.adminAccessToken,
      apiVersion: s.apiVersion || DEFAULT_API_VERSION,
    };
  });
}

let cache = null;

/** Read stores from process.env once, then memoize. */
export function getStores() {
  if (!cache) cache = parseStoresEnv(process.env);
  return cache;
}

/** Resolve a store by key, or the first store if no key given. */
export function resolveStore(key) {
  const stores = getStores();
  if (!key) return stores[0];
  const found = stores.find((s) => s.key === key);
  if (!found) {
    const valid = stores.map((s) => s.key).join(", ");
    throw new Error(`Unknown store "${key}". Configured stores: ${valid}.`);
  }
  return found;
}

/** Tokenless summaries for the list_stores tool. */
export function listStoreSummaries() {
  return getStores().map(({ key, label, shopDomain }) => ({ key, label, shopDomain }));
}
