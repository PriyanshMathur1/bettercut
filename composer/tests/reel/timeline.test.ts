// Run: node --test tests/reel/*.test.ts   (Node 22.6+ strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPages,
  cutWordSpans,
  outputWords,
  placeSegments,
  rangeToOutput,
  snapToOutput,
  subtractSpans,
  toOutput,
  toSource,
  totalOutDuration,
  autoZoomFor,
  sortAndMerge,
} from "../../src/reel/timeline.ts";

const close = (a: number | null, b: number) => {
  assert.notEqual(a, null);
  assert.ok(Math.abs((a as number) - b) < 1e-6, `${a} != ${b}`);
};

const words = [
  { text: "Hello", start: 0.1, end: 0.4 },
  { text: "um", start: 0.5, end: 0.7, cut: true },
  { text: "world.", start: 0.9, end: 1.3 },
  { text: "Next", start: 3.0, end: 3.3 },
  { text: "line", start: 3.4, end: 3.7 },
];

test("sortAndMerge merges overlaps and drops slivers", () => {
  assert.deepEqual(sortAndMerge([{ start: 2, end: 3 }, { start: 0, end: 1 }, { start: 0.5, end: 2.1 }, { start: 5, end: 5.01 }]), [
    { start: 0, end: 3 },
  ]);
});

test("subtractSpans splits a segment and keeps its fields", () => {
  const out = subtractSpans([{ id: "a", start: 0, end: 10, zoom: 1.2 }], [{ start: 3, end: 4 }]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => [s.start, s.end, s.zoom, s.id]), [
    [0, 3, 1.2, "a.0"],
    [4, 10, 1.2, "a.1"],
  ]);
});

test("cut word removes the gap up to the next word", () => {
  const spans = cutWordSpans(words);
  assert.equal(spans.length, 1);
  close(spans[0].start, 0.48);
  close(spans[0].end, 0.87);
});

test("placeSegments applies word cuts and lays shots end to end", () => {
  const placed = placeSegments({ segments: [{ start: 0, end: 1.5 }, { start: 2.9, end: 3.8 }], words });
  assert.equal(placed.length, 3);
  close(placed[0].outStart, 0);
  close(placed[1].outStart, 0.48);
  close(totalOutDuration(placed), 0.48 + (1.5 - 0.87) + 0.9);
});

test("source <-> output mapping round-trips inside kept time", () => {
  const placed = placeSegments({ segments: [{ start: 0, end: 1.5 }, { start: 2.9, end: 3.8 }], words: [] });
  close(toOutput(placed, 3.0), 1.6);
  assert.equal(toOutput(placed, 2.0), null);
  close(toSource(placed, 1.6), 3.0);
  close(snapToOutput(placed, 2.0), 1.5);
});

test("rangeToOutput spans a cut contiguously", () => {
  const placed = placeSegments({ segments: [{ start: 0, end: 1.5 }, { start: 2.9, end: 3.8 }], words: [] });
  const r = rangeToOutput(placed, 1.0, 3.2)!;
  close(r.start, 1.0);
  close(r.end, 1.8);
  assert.equal(rangeToOutput(placed, 1.6, 2.5), null);
});

test("outputWords drops cut words and words inside cuts", () => {
  const placed = placeSegments({ segments: [{ start: 0, end: 1.5 }], words });
  const ow = outputWords(placed, words);
  assert.deepEqual(ow.map((w) => w.text), ["Hello", "world."]);
});

test("buildPages breaks on sentence end, page size and pauses", () => {
  const placed = placeSegments({ segments: [{ start: 0, end: 5 }], words: [] });
  const ow = outputWords(placed, words.map((w) => ({ ...w, cut: false })));
  const pages = buildPages(ow, 4);
  assert.deepEqual(pages.map((p) => p.words.map((w) => w.text).join(" ")), ["Hello um world.", "Next line"]);
  // first page holds until at most 0.7s after its last word
  close(pages[0].end, 1.3 + 0.7);
});

test("autoZoomFor alternates and respects explicit zoom", () => {
  assert.equal(autoZoomFor("alternate", 0), 1);
  assert.equal(autoZoomFor("alternate", 1), 1.18);
  assert.equal(autoZoomFor("off", 1, 1.5), 1.5);
});

test("speed ramps stretch output time and map back", () => {
  const placed = placeSegments({ segments: [{ start: 0, end: 2, speed: 2 }, { start: 3, end: 4 }], words: [] });
  close(placed[0].outEnd, 1);
  close(totalOutDuration(placed), 2);
  close(toOutput(placed, 1.0), 0.5);
  close(toSource(placed, 0.5), 1.0);
  const r = rangeToOutput(placed, 1.0, 3.5)!;
  close(r.start, 0.5);
  close(r.end, 1.5);
});
