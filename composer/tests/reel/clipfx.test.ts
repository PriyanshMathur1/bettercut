// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { activeFx, addFx, amountOf, blurRadius, CLIP_FX, cssFunction, filterFor, listFx, overlaysFor, removeFx, rgb01, setFx, svgFilters } from "../../src/reel/clipfx.ts";

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
  assert.equal(cssFunction({ type: "hue", amount: 1 }, 1), "hue-rotate(180deg)"); // full strength is the opposite colours, not a full circle
  assert.equal(cssFunction({ type: "hue", amount: 0.5 }, 1), "hue-rotate(90deg)");
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

test("svg filters are built as data whose ids match what filterFor refers to", () => {
  const stack = [{ type: "bw" }, { type: "glow", amount: 1 }, { type: "fringe", amount: 0.5 }, { type: "duotone", amount: 0.5, color: "#000", color2: "#ffffff" }, { type: "glow", amount: 0 }];
  const filters = svgFilters(stack, 1, "a");
  assert.deepEqual(filters.map((f) => f.id), ["fx-a-1", "fx-a-2", "fx-a-3"]); // the switched-off glow has no filter
  for (const f of filters) assert.ok(filterFor(stack, 1, "a").includes(`url(#${f.id})`), f.id);
  assert.equal((filterFor(stack, 1, "a").match(/url\(/g) || []).length, filters.length); // and no reference without a filter

  // every step reads the picture or an earlier step, and only the last step leaves its result unnamed
  for (const f of filters) {
    const made = new Set(["SourceGraphic"]);
    f.steps.forEach((s, i) => {
      for (const key of ["in", "in2"]) if (s.attrs[key] !== undefined) assert.ok(made.has(String(s.attrs[key])), `${f.id} step ${i} reads ${s.attrs[key]}`);
      if (i < f.steps.length - 1) assert.ok(s.attrs.result, `${f.id} step ${i} has no result`);
      else assert.equal(s.attrs.result, undefined);
      if (s.attrs.result) made.add(String(s.attrs.result));
    });
  }

  const [glow, fringe, duo] = filters;
  assert.equal(glow.steps[0].attrs.stdDeviation, 32);
  assert.equal(glow.region.width, "140%"); // room for the glow to spread past the picture
  assert.deepEqual([fringe.steps[1].attrs.dx, fringe.steps[4].attrs.dx], [8, -8]); // red one way, blue the other
  assert.equal(fringe.steps[0].attrs.values, "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"); // red channel only
  assert.deepEqual(duo.steps[1].tables, { r: "0 1", g: "0 1", b: "0 1" });
  assert.deepEqual([duo.steps[2].attrs.k2, duo.steps[2].attrs.k3], [0.5, 0.5]); // half duotone, half original
  assert.equal(svgFilters(stack, 0.5, "a")[0].steps[0].attrs.stdDeviation, 18); // sizes follow the frame
  assert.deepEqual(rgb01("#FF8000"), [1, 0.502, 0]);
  assert.deepEqual(rgb01("not a colour"), [0, 0, 0]);
});

test("a malformed effect list never throws: it is treated as what can be understood of it", () => {
  const junk = { type: "blur" } as unknown as never[]; // one effect written where a list belongs
  assert.deepEqual(listFx(junk), []);
  assert.equal(filterFor(junk, 1, "a"), "");
  assert.deepEqual(svgFilters(junk, 1, "a"), []);
  assert.deepEqual(overlaysFor(junk), []);
  const mixed = [null, "blur", { amount: 1 }, { type: "bw" }, { type: "made-up" }] as unknown as never[];
  assert.deepEqual(listFx(mixed).map((e) => e.type), ["bw", "made-up"]); // unknown types are kept so they can be removed
  assert.equal(filterFor(mixed, 1, "a"), "grayscale(1)");
  assert.deepEqual(removeFx(mixed, 1).map((e) => e.type), ["bw"]);
});

test("blurRadius adds up the blur a stack applies", () => {
  assert.equal(blurRadius([{ type: "blur", amount: 0.5 }, { type: "bw" }, { type: "blur", amount: 1 }], 1), 45);
  assert.equal(blurRadius([{ type: "blur", amount: 0.5 }], 0.5), 7.5);
  assert.equal(blurRadius([{ type: "glow" }], 1), 0);
  assert.equal(blurRadius(undefined, 1), 0);
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
