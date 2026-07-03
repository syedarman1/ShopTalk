// introspect.js — targeted Admin-schema introspection so the AI can look up
// real field names instead of guessing (the thing that makes run_query reliable).
import { resolveStore } from "./stores.js";
import { shopifyGraphQL } from "./shopify.js";

/** Render an introspection type ref like [Order!]! */
export function renderTypeRef(ref) {
  if (!ref) return "Unknown";
  if (ref.kind === "NON_NULL") return `${renderTypeRef(ref.ofType)}!`;
  if (ref.kind === "LIST") return `[${renderTypeRef(ref.ofType)}]`;
  return ref.name ?? "Unknown";
}

const TYPE_REF = "kind name ofType { kind name ofType { kind name ofType { kind name } } }";
const typeCache = new Map(); // `${store.key}:${type}` -> shaped result

export async function getSchemaType(storeKey, typeName = "QueryRoot") {
  const store = resolveStore(storeKey);
  const key = `${store.key}:${typeName}`;
  if (typeCache.has(key)) return typeCache.get(key);
  const query = `
    query($name: String!) {
      __type(name: $name) {
        name kind description
        fields(includeDeprecated: false) {
          name description
          type { ${TYPE_REF} }
          args { name type { ${TYPE_REF} } }
        }
        inputFields { name type { ${TYPE_REF} } }
        enumValues(includeDeprecated: false) { name }
      }
    }`;
  const data = await shopifyGraphQL(store, query, { name: typeName });
  const t = data.__type;
  if (!t) {
    throw new Error(`No type "${typeName}" in the Admin schema. Check capitalization (e.g. Order, Customer, Product, QueryRoot).`);
  }
  const shaped = {
    type: t.name,
    kind: t.kind,
    description: t.description ?? null,
    fields: (t.fields ?? []).map((f) => ({
      name: f.name,
      type: renderTypeRef(f.type),
      args: (f.args ?? []).map((a) => `${a.name}: ${renderTypeRef(a.type)}`),
      description: f.description ? String(f.description).slice(0, 140) : null,
    })),
    inputFields: (t.inputFields ?? []).map((f) => ({ name: f.name, type: renderTypeRef(f.type) })),
    enumValues: (t.enumValues ?? []).map((e) => e.name),
  };
  typeCache.set(key, shaped);
  return shaped;
}
