// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { animatedProps, curve, moveKey, valueRange } from "../../src/reel/graph.ts";

const keys = [{ at: 0, x: 0.2, opacity: 0 }, { at: 1, x: 0.8 }, { at: 2, opacity: 1, ease: "linear" as const }];

test("animatedProps lists the properties keyframes set, in the given order first", () => {
  assert.deepEqual(animatedProps(keys, ["opacity", "x", "y"]), ["opacity", "x"]);
  assert.deepEqual(animatedProps([{ at: 0, glow: 1 }], ["x"]), ["glow"]);
  assert.deepEqual(animatedProps(undefined, ["x"]), []);
});

test("curve samples the property across the range", () => {
  const c = curve(keys, "x", 0.5, [0, 2], 4);
  assert.deepEqual(c.map((p) => p.t), [0, 0.5, 1, 1.5, 2]);
  assert.equal(c[0].v, 0.2);
  assert.equal(c[2].v, 0.8);
  assert.equal(c[4].v, 0.8); // holds after its last keyframe
  assert.deepEqual(curve(undefined, "x", 0.5, [0, 1], 2).map((p) => p.v), [0.5, 0.5, 0.5]); // no keys: the resting value
});

test("valueRange pads the curve and gives a flat one some height", () => {
  assert.deepEqual(valueRange([0, 1]).map((v) => +v.toFixed(2)), [-0.12, 1.12]);
  const flat = valueRange([1, 1, 1]);
  assert.ok(flat[0] < 1 && flat[1] > 1);
  assert.deepEqual(valueRange([]), [0, 1]);
});

test("moveKey changes a keyframe's time and value but never lets it pass its neighbours", () => {
  const moved = moveKey(keys, 1, "x", 1.5, 0.6, [0, 2]);
  assert.deepEqual(moved[1], { at: 1.5, x: 0.6 });
  assert.equal(moveKey(keys, 1, "x", 5, 0.6, [0, 2])[1].at, 1.98); // stops short of the next keyframe
  assert.equal(moveKey(keys, 1, "x", -5, 0.6, [0, 2])[1].at, 0.02); // and of the previous one
  assert.equal(moveKey(keys, 0, "x", -5, 0.6, [0, 2])[0].at, 0); // the first can't leave the range
  const both = moveKey(keys, 0, "opacity", 0.3, 0.5, [0, 2]);
  assert.deepEqual(both[0], { at: 0.3, x: 0.2, opacity: 0.5 }); // its other values travel with it
  assert.deepEqual(moveKey(keys, 9, "x", 1, 1, [0, 2]), keys); // no such keyframe
});
