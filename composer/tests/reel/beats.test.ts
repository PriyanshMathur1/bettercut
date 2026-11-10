// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { beatsBetween, snapTo } from "../../src/reel/beats.ts";
import { splitMany } from "../../src/reel/edit.ts";

const beats = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];

test("snapTo pulls a time onto the nearest beat only when it is close", () => {
  assert.equal(snapTo(beats, 1.08), 1);
  assert.equal(snapTo(beats, 1.3), 1.3); // too far from 1 and from 1.5
  assert.equal(snapTo(beats, 1.26, 0.3), 1.5); // nearest wins within a wider tolerance
  assert.equal(snapTo(undefined, 2.2), 2.2);
  assert.equal(snapTo([], 2.2), 2.2);
});

test("beatsBetween picks every nth beat inside a range, clear of its ends", () => {
  assert.deepEqual(beatsBetween(beats, 1, 3), [1.5, 2, 2.5]);
  assert.deepEqual(beatsBetween(beats, 0, 4, 2), [0.5, 1.5, 2.5, 3.5]);
  assert.deepEqual(beatsBetween(beats, 0.95, 1.05), []); // the only beat is too close to the edges
  assert.deepEqual(beatsBetween(undefined, 0, 4), []);
});

test("splitMany cuts a shot at several times and skips ones too close to an edge", () => {
  const out = splitMany([{ id: "s1", start: 0, end: 4 }], [3, 1, 3.95, 2]);
  assert.deepEqual(out.map((s) => [s.start, s.end]), [[0, 1], [1, 2], [2, 3], [3, 4]]);
  assert.equal(new Set(out.map((s) => s.id)).size, 4);
});
