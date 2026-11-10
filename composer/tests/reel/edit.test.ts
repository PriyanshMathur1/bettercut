// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { baseOf, MIN_SHOT, patchShot, removeShot, shotAt, splitAt, trimShot } from "../../src/reel/edit.ts";

const shots = () => [
  { id: "s1", start: 0, end: 4, zoom: 1.2 },
  { id: "s2", start: 5, end: 9 },
];

test("splitAt cuts the shot under the playhead and keeps its settings", () => {
  const out = splitAt(shots(), 2);
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

test("shotAt and baseOf find shots by source time, whatever the list order", () => {
  const unordered = [shots()[1], shots()[0]];
  assert.equal(shotAt(unordered, 6), 1);
  assert.equal(shotAt(unordered, 4.5), -1);
  assert.equal(baseOf(unordered, { start: 5.5, end: 7 }), 1); // a piece left after a text cut
});
