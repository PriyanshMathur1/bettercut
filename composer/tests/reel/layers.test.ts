// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { drawOrder, kindOf, layerBase, layerVolume, moveTrack, newLayer, topTrack, tracksOf } from "../../src/reel/layers.ts";

const L = (track: number, id: string, kind: "video" | "image" | "audio" = "image") => ({ id, kind, src: id + ".png", track, start: 0, end: 2 });

test("kindOf reads the kind from the file name", () => {
  assert.equal(kindOf("logo.PNG"), "image");
  assert.equal(kindOf("song.mp3?sig=abc"), "audio");
  assert.equal(kindOf("clip.mp4"), "video");
  assert.equal(kindOf("voice.webm", false), "audio"); // a webm with no picture
});

test("defaults: pictures are 60% wide and silent, audio plays at full volume", () => {
  assert.deepEqual(layerBase(L(1, "a")), { x: 0.5, y: 0.5, scale: 0.6, rotate: 0, opacity: 1 });
  assert.equal(layerVolume(L(1, "v", "video")), 0);
  assert.equal(layerVolume(L(1, "s", "audio")), 1);
  assert.equal(layerVolume({ ...L(1, "s", "audio"), volume: 9 }), 2);
});

test("tracks: in use, the next free one, and drawing order", () => {
  const layers = [L(3, "c"), L(1, "a"), L(3, "d"), L(2, "b")];
  assert.deepEqual(tracksOf(layers), [1, 2, 3]);
  assert.equal(topTrack(layers), 4);
  assert.equal(topTrack(undefined), 1);
  assert.deepEqual(drawOrder(layers).map((l) => l.id), ["a", "b", "c", "d"]); // same track keeps list order
});

test("moveTrack swaps a lone layer with the next track, and splits a shared track", () => {
  const layers = [L(1, "a"), L(2, "b"), L(3, "c")];
  assert.deepEqual(moveTrack(layers, 0, 1).map((l) => [l.id, l.track]), [["a", 2], ["b", 1], ["c", 3]]); // a now draws over b
  assert.deepEqual(moveTrack(layers, 2, 1), layers); // already on top
  assert.deepEqual(moveTrack(layers, 0, -1), layers); // already at the bottom
  assert.deepEqual(moveTrack(layers, 2, -1).map((l) => l.track), [1, 3, 2]);
  const shared = [L(1, "a"), L(1, "b"), L(2, "c")];
  assert.deepEqual(moveTrack(shared, 1, 1).map((l) => l.track), [1, 2, 3]); // b lifted above a, under c
  assert.deepEqual(moveTrack(shared, 1, -1).map((l) => l.track), [2, 1, 3]); // b dropped below a
  assert.deepEqual(moveTrack([L(1, "a"), L(5, "c")], 1, -1).map((l) => l.track), [2, 1]); // gaps closed
});

test("newLayer starts at the playhead on a new top track, images for 3 seconds", () => {
  assert.deepEqual(newLayer([L(2, "x")], "a.png", "image", 1.23456, 0), { kind: "image", src: "a.png", track: 3, start: 1.235, end: 4.235 });
  assert.equal(newLayer(undefined, "a.mp4", "video", 0, 7.5).end, 7.5);
});
