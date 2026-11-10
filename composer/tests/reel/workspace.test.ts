// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { askNotes, BIN, binItems, cutAfter, cutBefore, fmtClock, groupOf, keepTab, RAIL, railFor, shapeOf, subTabs, TABS, timecode, toggleShape, withoutSent } from "../../editor/src/workspace.ts";

test("the rail reaches every panel, each exactly once", () => {
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

test("a project's shape is the standard one nearest its frame", () => {
  assert.equal(shapeOf(1920, 1080), "16x9");
  assert.equal(shapeOf(3840, 2160), "16x9");
  assert.equal(shapeOf(1080, 1920), "9x16");
  assert.equal(shapeOf(1080, 1080), "1x1");
  assert.equal(shapeOf(1080, 1350), "4x5");
});

test("a project with no size is a vertical reel", () => {
  assert.equal(shapeOf(), "9x16");
  assert.equal(shapeOf(0, 0), "9x16");
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

test("Media opens on the clip bin, with b-roll beside it", () => {
  assert.equal(RAIL[0].id, "media");
  assert.deepEqual(subTabs(RAIL[0]), [BIN, "B-roll"]);
  assert.deepEqual(subTabs(groupOf("Colour", RAIL)!), ["Motion", "Colour"]);
});

const spec = {
  source: { src: "/p/assets/source.mp4", duration: 30 },
  layers: [
    { kind: "video", src: "/p/assets/cutaway.mov", start: 4, end: 9 },
    { kind: "image", src: "/p/assets/logo.png", start: 0, end: 30 },
    { kind: "audio", src: "/p/assets/whoosh.wav", start: 12, end: 13 },
  ],
  voiceovers: [{ src: "/p/assets/vo.webm", start: 2, end: 6.5 }],
  audio: { music: "/music/bed.mp3" },
};

test("the bin lists clips, then layers, voiceovers and music", () => {
  const items = binItems([{ name: "a.mov", start: 0, seconds: 12 }, { name: "b.mov", start: 12, seconds: 18 }], spec);
  assert.deepEqual(
    items.map((i) => [i.kind, i.name, i.start, i.seconds]),
    [
      ["clip", "a.mov", 0, 12],
      ["clip", "b.mov", 12, 18],
      ["video", "cutaway.mov", 4, 5],
      ["image", "logo.png", 0, 30],
      ["audio", "whoosh.wav", 12, 1],
      ["voice", "Voiceover 1", 2, 4.5],
      ["music", "bed.mp3", null, 0],
    ],
  );
  assert.equal(items[0].src, "/p/assets/source.mp4"); // clips are parts of the one footage file
});

test("a project with no clip list shows its footage as one clip", () => {
  for (const clips of [undefined, []]) {
    const items = binItems(clips, { source: { src: "s.mp4", duration: 30 } });
    assert.deepEqual(items, [{ kind: "clip", name: "Footage", src: "s.mp4", start: 0, seconds: 30 }]);
  }
});

test("timecode counts frames at the project's rate", () => {
  assert.equal(timecode(0, 30), "00:00:00:00");
  assert.equal(timecode(1.5, 30), "00:00:01:15");
  assert.equal(timecode(61 + 23 / 24, 24), "00:01:01:23");
  assert.equal(timecode(3600, 25), "01:00:00:00");
  assert.equal(timecode(0.999, 30), "00:00:01:00"); // rounds to the nearest frame
  assert.equal(timecode(-2, 30), "00:00:00:00");
});

test("previous and next cut step from the playhead", () => {
  const cuts = [3, 7.5, 12];
  assert.equal(cutBefore(cuts, 8), 7.5);
  assert.equal(cutBefore(cuts, 7.5), 3); // already on a cut: go to the one before
  assert.equal(cutBefore(cuts, 2), 0);
  assert.equal(cutAfter(cuts, 8, 20), 12);
  assert.equal(cutAfter(cuts, 12, 20), 20);
  assert.equal(cutAfter(cuts, 3, 20), 7.5);
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
