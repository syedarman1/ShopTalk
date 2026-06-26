import { test } from "node:test";
import assert from "node:assert/strict";
import { composeDemoState } from "../lib/demoSequencer.mjs";
import { DEMO_SCRIPT } from "../lib/demoData.mjs";

const A = DEMO_SCRIPT[0], B = DEMO_SCRIPT[1];

test("empty: nothing shown", () => {
  const s = composeDemoState([], null);
  assert.deepEqual(s.chat, []);
  assert.equal(s.typing, false);
  assert.equal(s.latest, null);
  assert.deepEqual(s.activity, []);
});

test("phase 'user': only the question bubble, no typing, no result yet", () => {
  const s = composeDemoState([], { step: A, phase: "user", ts: 1 });
  assert.equal(s.chat.length, 1);
  assert.equal(s.chat[0].role, "user");
  assert.equal(s.typing, false);
  assert.equal(s.latest, null);
  assert.equal(s.activity.length, 0);
});

test("phase 'typing': question + typing flag, no reply/result", () => {
  const s = composeDemoState([], { step: A, phase: "typing", ts: 1 });
  assert.equal(s.chat.length, 1);
  assert.equal(s.typing, true);
  assert.equal(s.latest, null);
});

test("phase 'reply': question + reply, typing off, result not landed", () => {
  const s = composeDemoState([], { step: A, phase: "reply", ts: 1 });
  assert.equal(s.chat.length, 2);
  assert.equal(s.chat[1].role, "poke");
  assert.equal(s.typing, false);
  assert.equal(s.latest, null);
  assert.equal(s.activity.length, 0);
});

test("phase 'result': reply shown, latest set, activity row added", () => {
  const s = composeDemoState([], { step: A, phase: "result", ts: 5 });
  assert.equal(s.chat.length, 2);
  assert.equal(s.latest, A.event);
  assert.equal(s.activity.length, 1);
  assert.equal(s.activity[0].timestamp, 5);
});

test("history + current: prior exchange persists; newest activity first; unique keys", () => {
  const s = composeDemoState([{ step: A, ts: 1 }], { step: B, phase: "result", ts: 2 });
  assert.equal(s.chat.length, 4);
  assert.equal(s.latest, B.event);
  assert.equal(s.activity[0].type, B.event.type);
  assert.equal(s.activity[1].type, A.event.type);
  const ids = s.chat.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("while current is mid-flight, latest stays the last completed step's event", () => {
  const s = composeDemoState([{ step: A, ts: 1 }], { step: B, phase: "typing", ts: 2 });
  assert.equal(s.latest, A.event);
});

test("a survivor's chat key is stable when the oldest exchange is dropped (no re-key flicker)", () => {
  const full = composeDemoState([{ step: A, ts: 1 }, { step: B, ts: 2 }], null);
  const dropped = composeDemoState([{ step: B, ts: 2 }], null);
  const kFull = full.chat.find((m) => m.text === B.question).id;
  const kDropped = dropped.chat.find((m) => m.text === B.question).id;
  assert.equal(kFull, kDropped);
});
