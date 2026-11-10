// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { nearestKey, removeKey, sampleKeys, setKey } from "../../src/reel/keyframes.ts";

const base = { x: 0.5, scale: 1 };

test("with no keys, or none for a property, the base value is kept", () => {
  assert.deepEqual(sampleKeys(undefined, 1, base), base);
  assert.deepEqual(sampleKeys([{ at: 0, scale: 2 }], 1, base), { x: 0.5, scale: 2 });
});

test("values hold before the first key and after the last, and travel in between", () => {
  const keys = [{ at: 1, x: 0.2, ease: "linear" as const }, { at: 3, x: 0.8 }];
  assert.equal(sampleKeys(keys, 0, base).x, 0.2);
  assert.equal(sampleKeys(keys, 9, base).x, 0.8);
  assert.ok(Math.abs(sampleKeys(keys, 2, base).x - 0.5) < 1e-9);
  assert.ok(Math.abs(sampleKeys(keys, 1.5, base).x - 0.35) < 1e-9);
});

test("smooth eases in and out, hold jumps at the next key", () => {
  const s = [{ at: 0, x: 0 }, { at: 1, x: 1 }];
  assert.ok(sampleKeys(s, 0.25, base).x < 0.25); // slower than linear at the start
  assert.ok(Math.abs(sampleKeys(s, 0.5, base).x - 0.5) < 1e-9);
  assert.ok(sampleKeys(s, 0.75, base).x > 0.75);
  const h = [{ at: 0, x: 0, ease: "hold" as const }, { at: 1, x: 1 }];
  assert.equal(sampleKeys(h, 0.99, base).x, 0);
  assert.equal(sampleKeys(h, 1, base).x, 1);
});

test("each property animates from its own keys", () => {
  const keys = [{ at: 0, x: 0, ease: "linear" as const }, { at: 1, scale: 3 }, { at: 2, x: 1 }];
  const v = sampleKeys(keys, 1, base);
  assert.ok(Math.abs(v.x - 0.5) < 1e-9); // x ignores the scale-only key in the middle
  assert.equal(v.scale, 3);
});

test("setKey merges into a nearby key, else inserts in time order; removeKey deletes", () => {
  let keys = setKey(undefined, 2, { x: 0.3 });
  keys = setKey(keys, 0.5, { x: 0.1 });
  assert.deepEqual(keys.map((k) => k.at), [0.5, 2]);
  keys = setKey(keys, 2.05, { scale: 1.5 }); // within tolerance of the key at 2
  assert.deepEqual(keys, [{ at: 0.5, x: 0.1 }, { at: 2, x: 0.3, scale: 1.5 }]);
  assert.equal(nearestKey(keys, 0.55), 0);
  assert.equal(nearestKey(keys, 1.2), -1);
  assert.deepEqual(removeKey(keys, 0), [{ at: 2, x: 0.3, scale: 1.5 }]);
});
