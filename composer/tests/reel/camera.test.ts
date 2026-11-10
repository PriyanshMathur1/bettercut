// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { CAMERA_MOVES, cameraKeys, framingOf, moveOf } from "../../src/reel/camera.ts";
import { sampleKeys } from "../../src/reel/keyframes.ts";

const shot = { start: 10, end: 14, zoom: 1.2, cx: 0.5, cy: 0.4 };
const at = (keys: any, t: number) => sampleKeys(keys, t, framingOf(shot));

test("push in moves closer across the whole shot", () => {
  const keys = cameraKeys(shot, "push-in")!;
  assert.deepEqual(keys.map((k) => k.at), [10, 14]);
  assert.equal(at(keys, 10).zoom, 1.2);
  assert.ok(at(keys, 12).zoom > 1.2 && at(keys, 12).zoom < 1.42);
  assert.equal(at(keys, 14).zoom, 1.42);
});

test("pull back is push in reversed, ending on the shot's own framing", () => {
  const keys = cameraKeys(shot, "pull-back")!;
  assert.equal(at(keys, 10).zoom, 1.42);
  assert.equal(at(keys, 14).zoom, 1.2);
});

test("settle is quick and then holds the shot's framing", () => {
  const keys = cameraKeys(shot, "settle")!;
  assert.deepEqual(keys.map((k) => k.at), [10, 10.6]);
  assert.equal(at(keys, 13).zoom, 1.2);
});

test("a short shot is never given a move longer than itself", () => {
  const keys = cameraKeys({ start: 3, end: 3.3 }, "settle")!;
  assert.deepEqual(keys.map((k) => k.at), [3, 3.3]);
});

test("slides zoom in enough to have room, and stay inside the picture", () => {
  const wide = { start: 0, end: 5 }; // zoom 1: no room to slide without zooming
  const keys = cameraKeys(wide, "slide-right")!;
  assert.ok((keys[0].zoom as number) >= 1.15);
  assert.ok((keys[1].cx as number) > (keys[0].cx as number));
  const edge = cameraKeys({ start: 0, end: 5, cx: 0.99 }, "slide-right")!;
  assert.ok((edge[1].cx as number) <= 1);
});

test("glide travels at one speed; a slide eases", () => {
  assert.equal(cameraKeys(shot, "glide")![0].ease, "linear");
  assert.equal(cameraKeys(shot, "slide-left")![0].ease, "smooth");
});

test("none or an unknown move clears the camera", () => {
  assert.equal(cameraKeys(shot, ""), undefined);
  assert.equal(cameraKeys(shot, "barrel-roll"), undefined);
});

test("every move has a name, a hint and makes two keyframes", () => {
  for (const m of CAMERA_MOVES) {
    assert.ok(m.name && m.hint, m.id);
    assert.equal(cameraKeys(shot, m.id)!.length, 2, m.id);
  }
  assert.equal(new Set(CAMERA_MOVES.map((m) => m.id)).size, CAMERA_MOVES.length);
});

test("the menu can tell which move a shot has", () => {
  assert.equal(moveOf(shot), "");
  for (const m of CAMERA_MOVES) assert.equal(moveOf({ ...shot, keys: cameraKeys(shot, m.id) }), m.id);
  assert.equal(moveOf({ ...shot, keys: [{ at: 11, zoom: 2 }] }), "custom");
});
