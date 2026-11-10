// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { activeFx, addFx, amountOf, CLIP_FX, cssFunction, filterFor, overlaysFor, removeFx, rgb01, setFx, svgSpec } from "../../src/reel/clipfx.ts";

test("every effect has a default strength, and strength stays between 0 and 1", () => {
  for (const f of CLIP_FX) assert.ok(f.amount > 0 && f.amount <= 1, f.id);
  assert.equal(amountOf({ type: "blur" }), 0.3);
  assert.equal(amountOf({ type: "blur", amount: 7 }), 1);
  assert.equal(amountOf({ type: "blur", amount: -1 }), 0);
  assert.equal(amountOf({ type: "blur", amount: NaN }), 0.3);
  assert.equal(amountOf({ type: "made-up", amount: 1 }), 0); // unknown effects do nothing
});

test("css effects become filter functions; blur scales with the frame", () => {
  assert.equal(cssFunction({ type: "bw", amount: 1 }, 1), "grayscale(1)");
  assert.equal(cssFunction({ type: "blur", amount: 0.5 }, 1), "blur(15px)");
  assert.equal(cssFunction({ type: "blur", amount: 0.5 }, 0.5), "blur(7.5px)"); // half-size frame, half the blur
  assert.equal(cssFunction({ type: "darken", amount: 1 }, 1), "brightness(0.2)"); // never fully black
  assert.equal(cssFunction({ type: "hue", amount: 0.5 }, 1), "hue-rotate(180deg)");
});

test("filterFor keeps the order of the stack and skips effects that are off, unknown or drawn on top", () => {
  const stack = [{ type: "bw", amount: 1 }, { type: "glow", amount: 0.5 }, { type: "grain", amount: 0.5 }, { type: "blur", amount: 0 }, { type: "nope" }, { type: "contrast", amount: 0.5 }];
  assert.equal(filterFor(stack, 1, "a"), "grayscale(1) url(#fx-a-1) contrast(1.5)");
  assert.equal(filterFor([...stack].reverse(), 1, "a"), "contrast(1.5) url(#fx-a-4) grayscale(1)"); // ids follow the position
  assert.equal(filterFor(undefined, 1, "a"), "");
  assert.deepEqual(activeFx(stack).map((e) => e.type), ["bw", "glow", "grain", "contrast"]);
});

test("overlaysFor lists grain and vignette with their strength", () => {
  assert.deepEqual(overlaysFor([{ type: "vignette", amount: 0.8 }, { type: "bw" }, { type: "grain" }]), [{ type: "vignette", amount: 0.8 }, { type: "grain", amount: 0.5 }]);
  assert.deepEqual(overlaysFor([{ type: "grain", amount: 0 }]), []);
});

test("svg effects get the numbers they need", () => {
  assert.deepEqual(svgSpec({ type: "fringe", amount: 0.5 }, 1), { type: "fringe", shift: 8 });
  assert.deepEqual(svgSpec({ type: "glow", amount: 1 }, 1), { type: "glow", blur: 32, gain: 1.6 });
  const d = svgSpec({ type: "duotone", amount: 0.5, color: "#000", color2: "#ffffff" }, 1);
  assert.deepEqual(d, { type: "duotone", mix: 0.5, dark: [0, 0, 0], light: [1, 1, 1] });
  assert.equal(svgSpec({ type: "blur" }, 1), null);
  assert.deepEqual(rgb01("#FF8000"), [1, 0.502, 0]);
  assert.deepEqual(rgb01("not a colour"), [0, 0, 0]);
});

test("adding, changing and removing effects", () => {
  let fx = addFx(undefined, "glow");
  fx = addFx(fx, "duotone");
  assert.deepEqual(fx, [{ type: "glow", amount: 0.5 }, { type: "duotone", amount: 1, color: "#1B1464", color2: "#FFD23F" }]);
  assert.deepEqual(addFx(fx, "made-up"), fx); // unknown: nothing added
  assert.equal(setFx(fx, 0, { amount: 3 })[0].amount, 1);
  assert.equal(setFx(fx, 1, { color: "#FF0000" })[1].color, "#FF0000");
  assert.deepEqual(removeFx(fx, 0).map((e) => e.type), ["duotone"]);
});
