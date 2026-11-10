// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { sentencesOf, setTranslation, translationAt, translationRows } from "../../src/reel/translate.ts";

const words = [
  { text: "Hello", start: 0, end: 0.4 },
  { text: "um", start: 0.5, end: 0.7, cut: true },
  { text: "world.", start: 0.8, end: 1.2 },
  { text: "Second", start: 2, end: 2.4 },
  { text: "one!", start: 2.5, end: 2.9 },
  { text: "after", start: 6, end: 6.3 },
  { text: "a", start: 6.4, end: 6.5 },
  { text: "pause", start: 6.6, end: 7 },
];

test("sentencesOf groups kept words by punctuation and long pauses", () => {
  const s = sentencesOf(words);
  assert.deepEqual(s.map((x) => x.text), ["Hello world.", "Second one!", "after a pause"]);
  assert.deepEqual(s.map((x) => [x.start, x.end]), [[0, 1.2], [2, 2.9], [6, 7]]);
  assert.deepEqual([s[0].first, s[0].last], [0, 2]);
});

test("unpunctuated speech is broken into readable lines", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ text: "w" + i, start: i * 0.3, end: i * 0.3 + 0.2 }));
  assert.deepEqual(sentencesOf(many).map((s) => s.text.split(" ").length), [18, 18, 4]);
});

test("translationAt finds the line being spoken and lets it linger briefly", () => {
  const lines = [{ start: 0, end: 1.2, text: "Hola mundo." }, { start: 2, end: 2.9, text: "" }];
  assert.equal(translationAt(lines, 0.5)?.text, "Hola mundo.");
  assert.equal(translationAt(lines, 1.4)?.text, "Hola mundo.");
  assert.equal(translationAt(lines, 1.8), null);
  assert.equal(translationAt(lines, 2.5), null); // an empty line shows nothing
  assert.equal(translationAt(undefined, 1), null);
});

test("setTranslation fills one sentence and keeps the others", () => {
  let lines = setTranslation(words, undefined, 1, " El segundo! ");
  assert.deepEqual(lines, [{ start: 2, end: 2.9, text: "El segundo!" }]);
  lines = setTranslation(words, lines, 0, "Hola mundo.");
  assert.deepEqual(lines.map((l) => l.text), ["Hola mundo.", "El segundo!"]);
  assert.deepEqual(translationRows(words, lines).map((r) => r.translated), ["Hola mundo.", "El segundo!", ""]);
  assert.deepEqual(setTranslation(words, lines, 0, "").map((l) => l.text), ["El segundo!"]); // cleared
});

test("rows follow the transcript when a word is cut later", () => {
  const lines = [{ start: 0, end: 1.2, text: "Hola mundo." }];
  const edited = words.map((w, i) => (i === 0 ? { ...w, cut: true } : w)); // sentence now starts at 0.8
  assert.equal(translationRows(edited, lines)[0].translated, "Hola mundo.");
});
