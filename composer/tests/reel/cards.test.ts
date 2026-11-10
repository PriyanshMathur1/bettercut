// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { barLengths, countUp, parseStat, parseStats, ringFill, stagger } from "../../src/reel/cards.ts";

test("parseStat reads 'Label: value' with whatever sits around the number", () => {
  assert.deepEqual(parseStat("Followers: 12.4k"), { prefix: "", value: 12.4, places: 1, suffix: "k", label: "Followers" });
  assert.deepEqual(parseStat("Revenue: $3,200"), { prefix: "$", value: 3200, places: 0, suffix: "", label: "Revenue" });
  assert.deepEqual(parseStat("Time saved: 2.50 hrs"), { prefix: "", value: 2.5, places: 2, suffix: " hrs", label: "Time saved" });
});

test("parseStat reads 'value label' too", () => {
  assert.deepEqual(parseStat("+38% Watch time"), { prefix: "+", value: 38, places: 0, suffix: "%", label: "Watch time" });
  assert.deepEqual(parseStat("10x Faster edits"), { prefix: "", value: 10, places: 0, suffix: "x", label: "Faster edits" });
});

test("a line without a number keeps its words, and a colon in words is not a value", () => {
  assert.equal(Number.isNaN(parseStat("No number here").value), true);
  assert.equal(parseStat("No number here").label, "No number here");
  assert.equal(parseStat("Note: read this").label, "Note: read this");
  assert.equal(parseStat("Note: read this").value, NaN);
  assert.deepEqual(parseStats(["A: 1", "  ", "", "B: 2"]).map((s) => s.label), ["A", "B"]);
});

test("countUp counts to the number as written, keeping its decimals and symbols", () => {
  const s = parseStat("Revenue: $3,200");
  assert.equal(countUp(s, 0), "$0");
  assert.equal(countUp(s, 0.5), "$1,600");
  assert.equal(countUp(s, 1), "$3,200");
  assert.equal(countUp(s, 9), "$3,200"); // never past it
  assert.equal(countUp(parseStat("Time: 2.50 hrs"), 1), "2.50 hrs"); // the space before the unit is kept
  assert.equal(countUp(parseStat("Views: 12.4k"), 1), "12.4k"); // and none is added where there was none
  assert.equal(countUp(parseStat("After: 10 min"), 0.5), "5 min");
  assert.equal(countUp(parseStat("words only"), 1), "");
});

test("bars are measured against the largest value", () => {
  assert.deepEqual(barLengths(parseStats(["A: 50", "B: 100", "C: 25"])), [0.5, 1, 0.25]);
  assert.deepEqual(barLengths(parseStats(["A: -5", "B: words", "C: 10"])), [0, 0, 1]);
  assert.deepEqual(barLengths([]), []);
});

test("ringFill and stagger stay in range", () => {
  assert.equal(ringFill(68), 0.68);
  assert.equal(ringFill(150), 1);
  assert.equal(ringFill(-3), 0);
  assert.equal(ringFill(undefined), 0);
  assert.equal(ringFill(3, 4), 0.75);
  assert.equal(stagger(0, 3), 0.2);
  assert.equal(stagger(2, 3), 1.1);
  assert.equal(stagger(0, 1), 0.2);
});
