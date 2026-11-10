import { test } from "node:test";
import assert from "node:assert/strict";
import { RAMP, removeZoomAt, setZoomAt, viewAt, viewTransform, zoomAt, type Zoom } from "../../src/reel/zooms.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("a zoom eases in, holds and eases back out", () => {
  const zs: Zoom[] = [{ start: 2, end: 5, x: 0.2, y: 0.3, zoom: 2 }];
  near(viewAt(zs, 1).zoom, 1);
  near(viewAt(zs, 2).zoom, 1);
  const mid = viewAt(zs, 2 + RAMP / 2);
  assert.ok(mid.zoom > 1 && mid.zoom < 2);
  assert.deepEqual(viewAt(zs, 3), { zoom: 2, x: 0.2, y: 0.3 });
  near(viewAt(zs, 5).zoom, 2);
  near(viewAt(zs, 5 + RAMP).zoom, 1);
  near(viewAt(zs, 9).x, 0.5);
});

test("close zooms pan across without pulling out", () => {
  const zs: Zoom[] = [
    { start: 6, end: 8, x: 0.8, y: 0.8, zoom: 2 },
    { start: 1, end: 3, x: 0.2, y: 0.2, zoom: 2 },
    { start: 3.5, end: 5, x: 0.4, y: 0.2, zoom: 1.5 },
  ];
  near(viewAt(zs, 3.2).zoom, 2); // held between the first two
  const pan = viewAt(zs, 3.5 + RAMP / 2);
  assert.ok(pan.zoom < 2 && pan.zoom > 1.5 && pan.x > 0.2 && pan.x < 0.4);
  near(viewAt(zs, 5.5).zoom, 1.5); // 5 -> 6 is less than two ramps: still held
  near(viewAt(zs, 6 + RAMP).x, 0.8);
});

test("the zoomed picture always covers the box", () => {
  assert.equal(viewTransform({ zoom: 1, x: 0.1, y: 0.1 }, 1000, 500), undefined);
  // centred on a corner: clamped so the picture's corner sits on the box's corner
  assert.equal(viewTransform({ zoom: 2, x: 0, y: 0 }, 1000, 500), "translate(0.00px, 0.00px) scale(2.0000)");
  assert.equal(viewTransform({ zoom: 2, x: 1, y: 1 }, 1000, 500), "translate(-1000.00px, -500.00px) scale(2.0000)");
  assert.equal(viewTransform({ zoom: 2, x: 0.5, y: 0.5 }, 1000, 500), "translate(-500.00px, -250.00px) scale(2.0000)");
});

test("adding, moving and removing a zoom at the playhead", () => {
  let zs = setZoomAt(undefined, 4, 0.3, 0.6);
  assert.deepEqual(zs, [{ start: 4, end: 6.5, x: 0.3, y: 0.6, zoom: 1.8 }]);
  zs = setZoomAt(zs, 5, 0.7, 0.2); // inside it: moves its centre
  assert.deepEqual(zs, [{ start: 4, end: 6.5, x: 0.7, y: 0.2, zoom: 1.8 }]);
  zs = setZoomAt(zs, 2, 0.5, 0.5); // before it: stops where the next one starts
  assert.deepEqual(zs.map((z) => [z.start, z.end]), [[2, 4], [4, 6.5]]);
  assert.equal(zoomAt(zs, 5)?.x, 0.7);
  assert.deepEqual(removeZoomAt(zs, 5).map((z) => z.start), [2]);
});
