// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { angleAt, cameraPieces, covers, setCamAt } from "../../src/reel/multicam.ts";

const cam1 = { id: "cam1", src: "angle1.mp4", offset: 2, duration: 30 };
const shot = { index: 0, start: 4, end: 10, outStart: 0, outEnd: 6 };

test("angleAt is the last switch at or before the moment, main before any", () => {
  const cams = [{ at: 5, angle: "cam1" }, { at: 8, angle: "main" }];
  assert.equal(angleAt(cams, 1), "main");
  assert.equal(angleAt(cams, 5), "cam1");
  assert.equal(angleAt(cams, 7.9), "cam1");
  assert.equal(angleAt(cams, 9), "main");
  assert.equal(angleAt(undefined, 3), "main");
});

test("a shot splits where the camera changes, keeping its place in the reel", () => {
  const pieces = cameraPieces([shot], [{ at: 6, angle: "cam1" }, { at: 8, angle: "main" }], [cam1]);
  assert.deepEqual(pieces.map((p) => [p.start, p.end, p.outStart, p.outEnd, p.cam?.id ?? "main"]), [
    [4, 6, 0, 2, "main"],
    [6, 8, 2, 4, "cam1"],
    [8, 10, 4, 6, "main"],
  ]);
});

test("speed and a freeze frame carry over: the freeze stays on the last piece", () => {
  const fast = { ...shot, speed: 2, outEnd: 3 + 1, hold: 1 };
  const pieces = cameraPieces([fast], [{ at: 6, angle: "cam1" }], [cam1]);
  assert.deepEqual(pieces.map((p) => [p.outStart, p.outEnd, p.hold]), [[0, 1, undefined], [1, 4, 1]]);
});

test("reversed shots, stretches an angle didn't record, and same-camera pieces", () => {
  assert.deepEqual(cameraPieces([{ ...shot, reverse: true }], [{ at: 6, angle: "cam1" }], [cam1]).length, 1);
  const late = { id: "late", src: "l.mp4", offset: -7, duration: 30 }; // starts recording at main time 7
  assert.equal(covers(late, 6, 8), false);
  const pieces = cameraPieces([shot], [{ at: 6, angle: "late" }], [late]);
  assert.deepEqual(pieces.map((p) => p.cam?.id ?? "main"), ["main"]); // falls back to main, merged into one piece
  assert.deepEqual(cameraPieces([shot], [{ at: 5, angle: "gone" }], [cam1]).length, 1); // an unknown angle is main
  assert.deepEqual(cameraPieces([shot], undefined, [cam1]), [shot]); // no switches: unchanged
});

test("setCamAt adds a switch and drops ones that change nothing", () => {
  let cams = setCamAt(undefined, 3, "cam1");
  assert.deepEqual(cams, [{ at: 3, angle: "cam1" }]);
  cams = setCamAt(cams, 7, "main");
  assert.deepEqual(cams, [{ at: 3, angle: "cam1" }, { at: 7, angle: "main" }]);
  assert.deepEqual(setCamAt(cams, 5, "cam1"), cams); // already on cam1 there
  assert.deepEqual(setCamAt(cams, 3, "main"), []); // switching the first one back to main leaves nothing to do
});
