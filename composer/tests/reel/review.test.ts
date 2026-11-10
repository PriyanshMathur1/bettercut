import { test } from "node:test";
import assert from "node:assert/strict";
import { asNotes, newNotes, onlyHere, spotName, type Comment } from "../../editor/src/review.ts";

const c = (over: Partial<Comment>): Comment => ({ id: "a", name: "Sam", text: "too loud", at: 2, x: null, y: null, version: "v1.mp4", done: false, ...over });

test("a link on this computer's address won't open anywhere else", () => {
  assert.equal(onlyHere("http://localhost:4790"), true);
  assert.equal(onlyHere("http://127.0.0.1:4790"), true);
  assert.equal(onlyHere("http://app.localhost"), true);
  assert.equal(onlyHere("https://reels.example.com"), false);
  assert.equal(onlyHere("http://192.168.1.20:4790"), false);
});

test("spots are named by where they are on the picture", () => {
  assert.equal(spotName({ x: null, y: null }), "whole frame");
  assert.equal(spotName({ x: 0.1, y: 0.1 }), "top left");
  assert.equal(spotName({ x: 0.5, y: 0.9 }), "bottom centre");
  assert.equal(spotName({ x: 0.5, y: 0.5 }), "centre");
  assert.equal(spotName({ x: 0.9, y: 0.5 }), "right");
});

test("open comments become notes at their moment, without doubling up", () => {
  const notes = asNotes([c({ at: 5, text: "cut this", x: 0.9, y: 0.1 }), c({ at: 1 }), c({ at: 3, done: true })]);
  assert.deepEqual(notes, [
    { t: 1, text: "Sam (review): too loud" },
    { t: 5, text: "Sam (review, top right): cut this" },
  ]);
  assert.deepEqual(newNotes([{ t: 1, text: "Sam (review): too loud" }, { t: null, text: "x" }], notes), [notes[1]]);
});
