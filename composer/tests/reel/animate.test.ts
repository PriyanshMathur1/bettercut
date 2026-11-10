// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { ANIM_PRESETS, applyPreset, clearPhase, phaseWindow, propsOf } from "../../src/reel/animate.ts";
import { sampleKeys } from "../../src/reel/keyframes.ts";

const rest = { x: 0.5, y: 0.4, scale: 0.6, rotate: 0, opacity: 1 };
const at = (keys: ReturnType<typeof applyPreset>, t: number) => sampleKeys(keys, t, rest);

test("every preset has a name, and in/out presets a duration and a state away from rest", () => {
  for (const p of ANIM_PRESETS) {
    assert.ok(p.name, p.id);
    if (p.phase === "loop") assert.ok(p.swing && p.period, p.id);
    else assert.ok(p.away && p.dur > 0, p.id);
    assert.ok(propsOf(p).length > 0, p.id);
  }
  assert.equal(new Set(ANIM_PRESETS.map((p) => p.id)).size, ANIM_PRESETS.length);
});

test("an in preset starts away from rest and lands exactly on it", () => {
  const keys = applyPreset(undefined, "slide-up", rest, 4);
  assert.deepEqual(at(keys, 0), { ...rest, y: 0.52, opacity: 0 });
  assert.deepEqual(at(keys, 0.5), rest);
  assert.deepEqual(at(keys, 3), rest); // and stays there
  assert.ok(at(keys, 0.25).y < 0.52 && at(keys, 0.25).y > 0.4); // in between, on the way
});

test("an out preset leaves rest only at the end", () => {
  const keys = applyPreset(undefined, "fade-out", rest, 4);
  assert.equal(at(keys, 3).opacity, 1);
  assert.equal(at(keys, 3.6).opacity, 1);
  assert.equal(at(keys, 4).opacity, 0);
  assert.ok(at(keys, 3.8).opacity > 0 && at(keys, 3.8).opacity < 1);
});

test("Pop overshoots its size on the way in, then settles", () => {
  const keys = applyPreset(undefined, "pop", rest, 3);
  const peak = Math.max(...Array.from({ length: 45 }, (_, i) => at(keys, i * 0.01).scale));
  assert.ok(peak > rest.scale * 1.02, `peak ${peak}`); // goes past its size
  assert.equal(at(keys, 0.45).scale, rest.scale); // and lands on it
});

test("in and out can be combined, and both fit a short item", () => {
  let keys = applyPreset(undefined, "zoom-in", rest, 0.6);
  keys = applyPreset(keys, "fade-out", rest, 0.6);
  const [, inEnd] = phaseWindow("in", 0.6, 0.5);
  assert.equal(inEnd, 0.29); // shortened to just under half the item
  assert.equal(at(keys, 0.29).scale, rest.scale); // the zoom-in still lands
  assert.equal(at(keys, 0.31).opacity, 1); // the fade-out starts after it
  let reverse = applyPreset(undefined, "fade-out", rest, 0.6); // either order gives the same result
  reverse = applyPreset(reverse, "zoom-in", rest, 0.6);
  assert.deepEqual(reverse, keys);
  assert.equal(at(keys, 0.6).opacity, 0);
});

test("a new in preset replaces the old one, and keeps keyframes elsewhere", () => {
  let keys = [{ at: 2, x: 0.8 }]; // the user's own move in the middle
  keys = applyPreset(keys, "spin-in", rest, 4);
  keys = applyPreset(keys, "fade-in", rest, 4);
  assert.equal(at(keys, 0).rotate, 0); // spin is gone
  assert.equal(at(keys, 0).opacity, 0); // fade is there
  assert.ok(keys.some((k) => k.at === 2 && k.x === 0.8)); // the user's keyframe survives
});

test("a loop runs the item's whole life and only moves its own property", () => {
  const keys = applyPreset(undefined, "pulse", rest, 3);
  assert.equal(keys.length, 11); // a key every 0.3 s from 0 to 3
  assert.ok(keys.every((k) => Object.keys(k).every((p) => ["at", "scale", "ease"].includes(p))));
  assert.ok(Math.abs(at(keys, 0.3).scale - rest.scale * 1.08) < 1e-9);
  assert.equal(at(keys, 0.6).scale, rest.scale);
  const long = applyPreset(undefined, "pulse", rest, 600);
  assert.ok(long.length <= 121); // capped
});

test("clearPhase removes an animation without touching other properties or times", () => {
  const keys = [{ at: 0, opacity: 0, x: 0.3 }, { at: 0.4, opacity: 1 }, { at: 2, x: 0.8 }];
  assert.deepEqual(clearPhase(keys, "in", 4, ["opacity"]), [{ at: 0, x: 0.3 }, { at: 2, x: 0.8 }]);
  assert.deepEqual(clearPhase(keys, "in", 4), [{ at: 2, x: 0.8 }]);
  assert.deepEqual(clearPhase(undefined, "out", 4), []);
});

test("unknown presets and items too short to animate leave keyframes alone", () => {
  const keys = [{ at: 1, x: 0.2 }];
  assert.deepEqual(applyPreset(keys, "nope", rest, 4), keys);
  assert.deepEqual(applyPreset(keys, "fade-in", rest, 0.02), keys);
});
