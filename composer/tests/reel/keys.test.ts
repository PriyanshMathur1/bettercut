// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_RATE, playbackAction, SHORTCUTS, shuttle, stepFrame, typingIn } from "../../editor/src/keys.ts";

test("L plays forward and speeds up to the limit", () => {
  assert.equal(shuttle(0, "l"), 1);
  assert.equal(shuttle(1, "l"), 2);
  assert.equal(shuttle(2, "l"), 4);
  assert.equal(shuttle(4, "l"), MAX_RATE);
});

test("J plays backwards and speeds up to the limit", () => {
  assert.equal(shuttle(0, "j"), -1);
  assert.equal(shuttle(-1, "j"), -2);
  assert.equal(shuttle(-4, "j"), -MAX_RATE);
});

test("changing direction starts again at normal speed, and K stops", () => {
  assert.equal(shuttle(4, "j"), -1);
  assert.equal(shuttle(-2, "l"), 1);
  assert.equal(shuttle(4, "k"), 0);
  assert.equal(shuttle(-2, "k"), 0);
});

test("stepping stays inside the video", () => {
  assert.equal(stepFrame(10, 1, 100), 11);
  assert.equal(stepFrame(0, -1, 100), 0);
  assert.equal(stepFrame(99, 10, 100), 99);
  assert.equal(stepFrame(5, -10, 100), 0);
});

test("keys map to playback actions", () => {
  assert.deepEqual(playbackAction({ key: "L" }), { do: "shuttle", key: "l" });
  assert.deepEqual(playbackAction({ key: " " }), { do: "toggle" });
  assert.deepEqual(playbackAction({ key: "ArrowLeft" }), { do: "step", by: -1 });
  assert.deepEqual(playbackAction({ key: "ArrowRight", shiftKey: true }), { do: "step", by: 10 });
  assert.deepEqual(playbackAction({ key: "ArrowUp" }), { do: "cut", way: "prev" });
  assert.deepEqual(playbackAction({ key: "End" }), { do: "edge", way: "end" });
  assert.deepEqual(playbackAction({ key: "?", shiftKey: true }), { do: "help" });
});

test("other keys and modifier combos are left alone", () => {
  assert.equal(playbackAction({ key: "x" }), null);
  assert.equal(playbackAction({ key: "l", metaKey: true }), null); // the browser's own shortcut
  assert.equal(playbackAction({ key: "ArrowLeft", altKey: true }), null);
});

test("typing in a field is recognised", () => {
  assert.equal(typingIn({ tagName: "INPUT" }), true);
  assert.equal(typingIn({ tagName: "TEXTAREA" }), true);
  assert.equal(typingIn({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(typingIn({ tagName: "BUTTON" }), false);
  assert.equal(typingIn(null), false);
});

test("the shortcut sheet lists each key once, with a description", () => {
  const all = SHORTCUTS.flatMap((g) => g.items);
  assert.ok(all.length >= 15);
  assert.equal(new Set(all.map((i) => i.keys)).size, all.length);
  for (const i of all) assert.ok(i.does.trim());
});
