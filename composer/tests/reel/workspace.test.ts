// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { askNotes, fmtClock, groupOf, keepTab, LAST_REEL_KEY, RAIL, railFor, readWorkspace, STORAGE_KEY, TABS, toggleShape, withoutSent, writeWorkspace, type KeyStore } from "../../editor/src/workspace.ts";

const memory = (init: Record<string, string> = {}): KeyStore & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = v) };
};
const broken: KeyStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

test("Simple's rail reaches every panel Pro has, each exactly once", () => {
  const onRail = RAIL.flatMap((g) => g.tabs);
  assert.deepEqual([...onRail].sort(), [...TABS].sort());
  assert.equal(new Set(onRail).size, onRail.length);
});

test("every rail button has a label and a tooltip", () => {
  for (const g of RAIL) {
    assert.ok(g.label.trim(), g.id);
    assert.ok(g.hint.trim(), g.id);
  }
});

test("the cloud rail drops Mimic and its now-empty button", () => {
  const rail = railFor(TABS.filter((t) => t !== "Mimic"));
  assert.ok(!rail.some((g) => g.id === "mimic"));
  assert.equal(rail.length, RAIL.length - 1);
});

test("a group keeps only the tabs on offer", () => {
  const rail = railFor(["Looks", "Titles"]);
  assert.deepEqual(
    rail.map((g) => [g.id, g.tabs]),
    [
      ["looks", ["Looks"]],
      ["graphics", ["Titles"]],
    ],
  );
});

test("groupOf finds the button for a tab", () => {
  assert.equal(groupOf("Colour", RAIL)?.id, "effects");
  assert.equal(groupOf("Brand", RAIL)?.id, "format");
  assert.equal(groupOf("Nope", RAIL), undefined);
});

test("keepTab keeps a shown tab, else falls back to the first", () => {
  assert.equal(keepTab("Colour", ["Motion", "Colour"]), "Colour");
  assert.equal(keepTab("Looks", ["Motion", "Colour"]), "Motion");
  assert.equal(keepTab("Looks", []), "Looks");
});

test("shapes toggle on and off, but never to none", () => {
  assert.deepEqual(toggleShape(["9x16"], "1x1"), ["9x16", "1x1"]);
  assert.deepEqual(toggleShape(["9x16", "1x1"], "9x16"), ["1x1"]);
  assert.deepEqual(toggleShape(["9x16"], "9x16"), ["9x16"]);
});

test("Ask sends queued notes plus the typed one, about the whole reel", () => {
  const queued = [{ t: 3.2, text: "bigger captions here" }];
  assert.deepEqual(askNotes(queued, "  make the hook punchier "), [
    { t: 3.2, text: "bigger captions here" },
    { t: null, text: "make the hook punchier" },
  ]);
});

test("Ask with an empty bar sends just the queue", () => {
  assert.deepEqual(askNotes([], "   "), []);
  assert.deepEqual(askNotes([{ t: 1, text: "cut this" }], ""), [{ t: 1, text: "cut this" }]);
});

test("new users start in Simple", () => {
  assert.equal(readWorkspace(memory()), "simple");
  assert.equal(readWorkspace(undefined), "simple");
});

test("the choice is remembered", () => {
  const store = memory();
  writeWorkspace(store, "pro");
  assert.equal(store.data[STORAGE_KEY], "pro");
  assert.equal(readWorkspace(store), "pro");
  writeWorkspace(store, "simple");
  assert.equal(readWorkspace(store), "simple");
});

test("an unknown saved value means Simple", () => {
  assert.equal(readWorkspace(memory({ [STORAGE_KEY]: "expert" })), "simple");
});

test("blocked storage neither throws nor breaks the editor", () => {
  assert.equal(readWorkspace(broken), "simple");
  assert.doesNotThrow(() => writeWorkspace(broken, "pro"));
});

test("people who have used the editor before stay in Pro until they choose", () => {
  assert.equal(readWorkspace(memory({ [LAST_REEL_KEY]: "my-reel" })), "pro"); // has opened a reel: the layout they know
  assert.equal(readWorkspace(memory({ [LAST_REEL_KEY]: "" })), "simple"); // the key exists but no reel was ever opened
  assert.equal(readWorkspace(memory({ [LAST_REEL_KEY]: "my-reel", [STORAGE_KEY]: "simple" })), "simple"); // a saved choice wins
});

test("a finished Ask removes only the notes it sent", () => {
  const a = { t: 1, text: "cut this" };
  const b = { t: null, text: "warmer colour" };
  const sent = [a, b];
  const pinnedMeanwhile = { t: 4, text: "cut this" }; // same words as a, pinned while the AI was working
  assert.deepEqual(withoutSent([a, b, pinnedMeanwhile], sent), [pinnedMeanwhile]);
  assert.deepEqual(withoutSent([a, b], sent), []);
  assert.deepEqual(withoutSent([], sent), []);
});

test("fmtClock shows minutes, seconds and tenths", () => {
  assert.equal(fmtClock(0), "0:00.0");
  assert.equal(fmtClock(12.34), "0:12.3");
  assert.equal(fmtClock(75.06), "1:15.1");
});
