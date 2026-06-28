import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoopback, mcpAuthorized } from "../auth.js";

// Minimal Express-like request stub.
function mockReq({ headers = {}, query = {}, remoteAddress = "203.0.113.7" } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    get: (name) => lower[name.toLowerCase()],
    query,
    socket: { remoteAddress },
  };
}

test("isLoopback is true for loopback addresses, false otherwise", () => {
  assert.equal(isLoopback(mockReq({ remoteAddress: "127.0.0.1" })), true);
  assert.equal(isLoopback(mockReq({ remoteAddress: "::1" })), true);
  assert.equal(isLoopback(mockReq({ remoteAddress: "::ffff:127.0.0.1" })), true);
  assert.equal(isLoopback(mockReq({ remoteAddress: "203.0.113.7" })), false);
});

test("with no token configured, only loopback requests are authorized (fail closed)", () => {
  const local = mockReq({ remoteAddress: "127.0.0.1" });
  const remote = mockReq({ remoteAddress: "203.0.113.7" });
  assert.equal(mcpAuthorized(local, ""), true);
  assert.equal(mcpAuthorized(remote, ""), false);
  assert.equal(mcpAuthorized(remote, null), false);
});

test("with a token, a matching Bearer header is authorized regardless of origin", () => {
  const req = mockReq({ headers: { authorization: "Bearer s3cret" } });
  assert.equal(mcpAuthorized(req, "s3cret"), true);
});

test("with a token, X-API-Key and X-ShopTalk-Token are accepted", () => {
  assert.equal(mcpAuthorized(mockReq({ headers: { "x-api-key": "s3cret" } }), "s3cret"), true);
  assert.equal(mcpAuthorized(mockReq({ headers: { "x-shoptalk-token": "s3cret" } }), "s3cret"), true);
});

test("with a token, ?token= is accepted (for EventSource which can't set headers)", () => {
  assert.equal(mcpAuthorized(mockReq({ query: { token: "s3cret" } }), "s3cret"), true);
});

test("with a token, a wrong or missing secret is rejected even from loopback", () => {
  const wrong = mockReq({ headers: { authorization: "Bearer nope" }, remoteAddress: "127.0.0.1" });
  const none = mockReq({ remoteAddress: "127.0.0.1" });
  assert.equal(mcpAuthorized(wrong, "s3cret"), false);
  assert.equal(mcpAuthorized(none, "s3cret"), false);
});
