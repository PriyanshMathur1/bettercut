// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { maskOf, maskStyle, maskSvg } from "../../src/reel/masks.ts";

test("maskOf fills in defaults and keeps values in range", () => {
  assert.deepEqual(maskOf({ shape: "ellipse" }), { shape: "ellipse", x: 0.5, y: 0.5, w: 0.8, h: 0.8, feather: 0, invert: false });
  const m = maskOf({ shape: "bogus" as never, x: 3, w: -1, feather: 9 });
  assert.deepEqual([m.shape, m.x, m.w, m.feather], ["rect", 1, 0.02, 1]);
});

test("the SVG shows the shape in white on black, at the right place and size", () => {
  const s = maskSvg({ shape: "rect", x: 0.5, y: 0.25, w: 0.4, h: 0.2 });
  assert.match(s, /<rect width="1000" height="1000" fill="#000"\/>/); // everything hidden...
  assert.match(s, /<rect x="300" y="150" width="400" height="200" rx="0" fill="#fff"\/>/); // ...but the shape
  assert.doesNotMatch(s, /filter/); // no feather, no blur
});

test("invert swaps what shows; feather blurs the edge; ellipse and rounded corners", () => {
  const inv = maskSvg({ shape: "ellipse", x: 0.5, y: 0.5, w: 0.6, h: 0.4, invert: true, feather: 0.5 });
  assert.match(inv, /<rect width="1000" height="1000" fill="#fff"\/>/);
  assert.match(inv, /<ellipse cx="500" cy="500" rx="300" ry="200" fill="#000" filter="url\(#f\)"\/>/);
  assert.match(inv, /stdDeviation="30"/);
  assert.match(maskSvg({ shape: "rounded", w: 0.5, h: 0.4 }), /rx="72"/); // 18% of the shorter side
});

test("maskStyle turns the SVG into CSS mask properties, or nothing without a mask", () => {
  const css = maskStyle({ shape: "rect" });
  assert.ok(css.maskImage.startsWith('url("data:image/svg+xml;utf8,%3Csvg'));
  assert.equal(css.WebkitMaskImage, css.maskImage);
  assert.equal(css.maskMode, "luminance");
  assert.deepEqual(maskStyle(undefined), {});
});
