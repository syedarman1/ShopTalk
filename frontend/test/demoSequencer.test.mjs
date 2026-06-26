import { test } from "node:test";
import assert from "node:assert/strict";
import { demoStateFor } from "../lib/demoSequencer.mjs";
import { DEMO_SCRIPT } from "../lib/demoData.mjs";

test("demoStateFor([]) is empty", () => {
  const s = demoStateFor([]);
  assert.deepEqual(s.chat, []);
  assert.equal(s.latest, null);
  assert.deepEqual(s.activity, []);
});

test("one played step yields a user+poke chat pair, latest, and one activity row", () => {
  const step = DEMO_SCRIPT[0];
  const s = demoStateFor([{ step, ts: 1000 }]);
  assert.equal(s.chat.length, 2);
  assert.equal(s.chat[0].role, "user");
  assert.equal(s.chat[0].text, step.question);
  assert.equal(s.chat[1].role, "poke");
  assert.equal(s.chat[1].text, step.reply);
  assert.equal(s.latest, step.event);
  assert.equal(s.activity.length, 1);
  assert.equal(s.activity[0].type, step.event.type);
  assert.equal(s.activity[0].timestamp, 1000);
});

test("two played steps: latest is the last; activity is newest-first", () => {
  const a = DEMO_SCRIPT[0], b = DEMO_SCRIPT[1];
  const s = demoStateFor([{ step: a, ts: 1 }, { step: b, ts: 2 }]);
  assert.equal(s.chat.length, 4);
  assert.equal(s.latest, b.event);
  assert.equal(s.activity[0].type, b.event.type); // newest first
  assert.equal(s.activity[1].type, a.event.type);
});
