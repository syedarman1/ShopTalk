import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SHOPIFY_STORES = JSON.stringify([
  { key: "alpha", label: "Alpha", shopDomain: "alpha.myshopify.com", clientId: "i", clientSecret: "s", apiVersion: "2026-01" },
]);
const { renderTypeRef, getSchemaType } = await import("../introspect.js");

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const TOKEN_OK = { access_token: "tok", scope: "read_orders", expires_in: 86399 };

test("renderTypeRef unwraps NON_NULL and LIST", () => {
  assert.equal(renderTypeRef({ kind: "SCALAR", name: "String" }), "String");
  assert.equal(renderTypeRef({ kind: "NON_NULL", ofType: { kind: "SCALAR", name: "Int" } }), "Int!");
  assert.equal(
    renderTypeRef({ kind: "NON_NULL", ofType: { kind: "LIST", ofType: { kind: "NON_NULL", ofType: { kind: "OBJECT", name: "Order" } } } }),
    "[Order!]!"
  );
});

test("getSchemaType shapes fields/args and caches per type", async (t) => {
  let gql = 0;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (String(url).includes("/oauth/access_token")) return json(TOKEN_OK);
    gql += 1;
    return json({ data: { __type: {
      name: "Order", kind: "OBJECT", description: "An order.",
      fields: [{
        name: "disputes", description: "Dispute summaries",
        type: { kind: "NON_NULL", ofType: { kind: "LIST", ofType: { kind: "NON_NULL", ofType: { kind: "OBJECT", name: "OrderDisputeSummary" } } } },
        args: [{ name: "first", type: { kind: "SCALAR", name: "Int" } }],
      }],
      inputFields: null, enumValues: null,
    } } });
  });
  const shape = await getSchemaType("alpha", "Order");
  assert.equal(shape.fields[0].type, "[OrderDisputeSummary!]!");
  assert.deepEqual(shape.fields[0].args, ["first: Int"]);
  await getSchemaType("alpha", "Order");
  assert.equal(gql, 1); // cached
});

test("getSchemaType throws a helpful error for unknown types", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    String(url).includes("/oauth/access_token") ? json(TOKEN_OK) : json({ data: { __type: null } })
  );
  await assert.rejects(() => getSchemaType("alpha", "Nope"), /No type "Nope"/);
});
