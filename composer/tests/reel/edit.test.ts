// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { baseOf, freezeAt, MIN_SHOT, MIN_SPAN, moveShot, patchShot, placeSpan, rampShot, removeShot, shotAt, SPEED_RAMPS, splitAt, trimShot } from "../../src/reel/edit.ts";
import { cutList, cutTimes, outputWords, placeSegments, rangeToOutput, snapToOutput, toSource, totalOutDuration } from "../../src/reel/timeline.ts";

const shots = () => [
  { id: "s1", start: 0, end: 4, zoom: 1.2 },
  { id: "s2", start: 5, end: 9 },
];

test("splitAt cuts the shot under the playhead and keeps its settings", () => {
  const out = splitAt(shots(), 2);
  assert.deepEqual(splitAt([{ id: "h", start: 0, end: 4, hold: 1 }], 2).map((s) => s.hold), [undefined, 1]);
  assert.deepEqual(out.map((s) => [s.start, s.end]), [[0, 2], [2, 4], [5, 9]]);
  assert.equal(out[1].zoom, 1.2);
  assert.notEqual(out[1].id, out[0].id);
  assert.equal(new Set(out.map((s) => s.id)).size, 3);
});

test("splitAt does nothing in a gap or too close to an edge", () => {
  assert.deepEqual(splitAt(shots(), 4.5), shots());
  assert.deepEqual(splitAt(shots(), 0.05), shots());
  assert.deepEqual(splitAt(shots(), 9 - MIN_SHOT / 2), shots());
});

test("removeShot deletes a shot but never the last one", () => {
  assert.deepEqual(removeShot(shots(), 0).map((s) => s.id), ["s2"]);
  const one = [{ id: "s1", start: 0, end: 4 }];
  assert.deepEqual(removeShot(one, 0), one);
  assert.deepEqual(removeShot(shots(), 7), shots());
});

test("trimShot stops at neighbours, the footage ends and the minimum length", () => {
  assert.equal(trimShot(shots(), 1, "start", 4.4, 10)[1].start, 4.4);
  assert.equal(trimShot(shots(), 1, "start", 1, 10)[1].start, 4); // previous shot ends at 4
  assert.equal(trimShot(shots(), 0, "end", 8, 10)[0].end, 5); // next shot starts at 5
  assert.equal(trimShot(shots(), 1, "end", 99, 10)[1].end, 10); // end of footage
  assert.equal(trimShot(shots(), 0, "start", -3, 10)[0].start, 0);
  assert.equal(trimShot(shots(), 0, "end", 0, 10)[0].end, MIN_SHOT);
  assert.equal(trimShot(shots(), 0, "start", 9, 10)[0].start, 4 - MIN_SHOT);
});

test("patchShot sets and clears fields", () => {
  assert.equal(patchShot(shots(), 1, { speed: 2 })[1].speed, 2);
  assert.equal("zoom" in patchShot(shots(), 0, { zoom: undefined })[0], false);
});

test("shotAt and baseOf find shots by source time, whatever the playing order", () => {
  const reordered = [shots()[1], shots()[0]];
  assert.equal(shotAt(reordered, 6), 0);
  assert.equal(shotAt(reordered, 4.5), -1);
  assert.equal(baseOf(reordered, { start: 5.5, end: 7 }), 0); // a piece left after a text cut
});

test("moveShot changes the playing order and the reel follows it", () => {
  const moved = moveShot(shots(), 1, 0);
  assert.deepEqual(moved.map((s) => s.id), ["s2", "s1"]);
  assert.deepEqual(moveShot(shots(), 0, 99).map((s) => s.id), ["s2", "s1"]);
  const words = [{ text: "first", start: 1, end: 1.5 }, { text: "second", start: 6, end: 6.5 }];
  const placed = placeSegments({ segments: moved, words });
  assert.deepEqual(placed.map((p) => [p.id, p.outStart, p.outEnd]), [["s2", 0, 4], ["s1", 4, 8]]);
  // captions come out in playing order, and source <-> output mapping still round-trips
  assert.deepEqual(outputWords(placed, words).map((w) => w.text), ["second", "first"]);
  assert.equal(toSource(placed, 1), 6);
  assert.equal(snapToOutput(placed, 4.5), 0); // in the gap: the next footage is s2, which now plays first
  // something spanning both shots covers the whole reel, never a negative range
  assert.deepEqual(rangeToOutput(placed, 0, 9), { start: 0, end: 8 });
});

test("trimShot uses the neighbour in the footage, not in the playing order", () => {
  const moved = moveShot(shots(), 1, 0); // s2 (5-9) plays first, s1 (0-4) second
  assert.equal(trimShot(moved, 0, "start", 1, 10)[0].start, 4);
  assert.equal(trimShot(moved, 1, "end", 8, 10)[1].end, 5);
});

test("freezeAt holds the frame under the playhead and the reel gets longer", () => {
  const out = freezeAt(shots(), 2, 1.5);
  assert.deepEqual(out.map((s) => [s.start, s.end, s.hold, s.join]), [[0, 2, 1.5, undefined], [2, 4, undefined, true], [5, 9, undefined, undefined]]);
  const placed = placeSegments({ segments: out, words: [] });
  assert.equal(totalOutDuration(placed), 8 + 1.5);
  assert.equal(toSource(placed, 2.7), 2); // during the hold the footage stays on the frozen frame
  assert.equal(toSource(placed, 4), 2.5); // and carries on afterwards
  assert.deepEqual(cutTimes(placed), [5.5]); // the freeze is not a cut; the real one is
  assert.deepEqual(freezeAt(shots(), 4, 1).map((s) => s.hold), [1, undefined]); // at a shot's end: no split
  assert.deepEqual(freezeAt(shots(), 4.5, 1), shots()); // in a gap: nothing
});

test("rampShot turns a shot into seamless speed steps that cover the same footage", () => {
  const out = rampShot(shots(), 0, "slow-middle");
  const steps = out.slice(0, 5);
  assert.deepEqual(steps.map((s) => s.speed), SPEED_RAMPS["slow-middle"].speeds);
  assert.equal(steps[0].start, 0);
  assert.equal(steps[4].end, 4);
  for (let k = 1; k < 5; k++) assert.equal(steps[k].start, steps[k - 1].end);
  assert.deepEqual(steps.map((s) => !!s.join), [false, true, true, true, true]);
  assert.equal(new Set(out.map((s) => s.id)).size, out.length);
  assert.equal(steps[2].zoom, 1.2);
  const placed = placeSegments({ segments: out, words: [] });
  assert.deepEqual(placed.slice(0, 5).map((p) => p.shot), [0, 0, 0, 0, 0]); // one visual shot: no punch-in flicker
  assert.deepEqual(cutTimes(placed).length, 1);
  assert.deepEqual(rampShot([{ id: "x", start: 0, end: 0.5 }], 0, "speed-up"), [{ id: "x", start: 0, end: 0.5 }]); // too short
});

test("each cut carries its own transition; text-cut pieces and joins do not", () => {
  const segs = [
    { id: "a", start: 0, end: 4 },
    { id: "b", start: 5, end: 9, transition: "whip-left" },
    { id: "c", start: 9, end: 10, join: true, transition: "glitch" },
    { id: "d", start: 11, end: 12, transition: "none" },
  ];
  const words = [{ text: "x", start: 6, end: 6.5, cut: true }, { text: "y", start: 7, end: 7.5 }];
  const cuts = cutList(placeSegments({ segments: segs, words }));
  // into b (its own), inside b after the text cut (default), into d (none); the join into c is no cut
  assert.deepEqual(cuts.map((c) => c.transition), ["whip-left", undefined, "none"]);
});

test("placeSpan moves and resizes an overlay inside the footage", () => {
  const o = { kind: "keyword", start: 2, end: 4 };
  assert.deepEqual(placeSpan(o, "move", 5, 10), { kind: "keyword", start: 5, end: 7 });
  assert.deepEqual(placeSpan(o, "move", 9.5, 10), { kind: "keyword", start: 8, end: 10 }); // keeps its length
  assert.equal(placeSpan(o, "move", -3, 10).start, 0);
  assert.equal(placeSpan(o, "start", 3.95, 10).start, 4 - MIN_SPAN);
  assert.equal(placeSpan(o, "end", 99, 10).end, 10);
  assert.equal(placeSpan(o, "end", 0, 10).end, 2 + MIN_SPAN);
});
