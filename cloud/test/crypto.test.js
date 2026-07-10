import { test } from "node:test";
import assert from "node:assert/strict";
process.env.CLOUD_ENC_KEY = "a".repeat(64); // 32 bytes hex
const { encrypt, decrypt } = await import("../crypto.js");

test("round-trips a token and produces different ciphertext each time (random IV)", () => {
  const t = "shpat_tenant_secret_token";
  const a = encrypt(t), b = encrypt(t);
  assert.notEqual(a, b);
  assert.equal(decrypt(a), t);
  assert.equal(decrypt(b), t);
});

test("a tampered ciphertext fails authentication", () => {
  const blob = encrypt("hello");
  const raw = Buffer.from(blob, "base64"); raw[raw.length - 1] ^= 0xff;
  assert.throws(() => decrypt(raw.toString("base64")), /decrypt/i);
});
