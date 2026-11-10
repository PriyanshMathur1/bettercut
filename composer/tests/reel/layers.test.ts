// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { drawOrder, kindOf, layerBase, layerProblem, layerVolume, moveTrack, newLayer, placeLayer, playable, topTrack, tracksOf, trimLayerStart } from "../../src/reel/layers.ts";

const L = (track: number, id: string, kind: "video" | "image" | "audio" = "image") => ({ id, kind, src: id + ".png", track, start: 0, end: 2 });

test("kindOf trusts the file's own type, then its name", () => {
  assert.equal(kindOf("logo.PNG"), "image");
  assert.equal(kindOf("song.mp3?sig=abc"), "audio");
  assert.equal(kindOf("clip.mp4"), "video");
  assert.equal(kindOf("voice.webm", "audio/webm"), "audio"); // sound only, despite the video-style name
  assert.equal(kindOf("scan.bmp", "image/bmp"), "image");
  assert.equal(kindOf("photo", "image/jpeg"), "image"); // no extension at all
  assert.equal(kindOf("photo.heic"), "image"); // never mistaken for a video
});

test("layerProblem names image types a browser can't draw", () => {
  assert.match(layerProblem("photo.heic", "image/heic") || "", /JPG or PNG/);
  assert.match(layerProblem("scan.TIFF") || "", /JPG or PNG/);
  assert.equal(layerProblem("photo.jpg", "image/jpeg"), null);
  assert.equal(layerProblem("clip.mp4", "video/mp4"), null);
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

test("newLayer starts at the playhead on a new top track, with its own id and its file's length", () => {
  assert.deepEqual(newLayer([L(2, "x")], "a.png", "image", 1.23456, 0), { id: "m2", kind: "image", src: "a.png", track: 3, start: 1.235, end: 4.235 });
  const v = newLayer(undefined, "a.mp4", "video", 0, 7.5);
  assert.deepEqual([v.end, v.media, v.id], [7.5, 7.5, "m1"]);
  assert.equal(newLayer([{ ...L(1, "m2") }], "b.png", "image", 0, 0).id, "m3"); // never reuses an id
  assert.equal("media" in newLayer(undefined, "a.mp4", "video", 0, 0), false); // length unknown
});

test("playable is what is left of the file from where the layer enters it", () => {
  const v = { kind: "video" as const, src: "a.mp4", track: 1, start: 0, end: 9, media: 4 };
  assert.equal(playable(v), 4);
  assert.equal(playable({ ...v, from: 1.5 }), 2.5);
  assert.equal(playable({ ...v, from: 9 }), 0);
  assert.equal(playable({ ...v, media: undefined }), Infinity); // unknown: no limit
  assert.equal(playable({ ...v, kind: "image" as const }), Infinity);
});

test("trimLayerStart sets the new start and where the file is entered", () => {
  const v = { kind: "video" as const, src: "a.mp4", track: 1, start: 4, end: 10 };
  const later = trimLayerStart(v, 6, 1); // the caller found that 1 s of screen time was removed
  assert.deepEqual([later.start, later.from], [6, 1]);
  const back = trimLayerStart(later, 4, 0);
  assert.deepEqual([back.start, "from" in back], [4, false]); // back at the file's beginning
  assert.equal(trimLayerStart(v, 5, -3).from, undefined); // never before the file's beginning
  assert.equal(trimLayerStart(v, 99, 2).start, 9.8); // keeps a minimum length
  assert.deepEqual([trimLayerStart(later, 7).start, trimLayerStart(later, 7).from], [7, 1]); // no `from` given: unchanged
  const img = trimLayerStart({ kind: "image" as const, src: "a.png", track: 1, start: 4, end: 10 }, 1, 5);
  assert.deepEqual([img.start, "from" in img], [1, false]); // an image just moves its start
});

test("placeLayer sets the resting position, or a keyframe when the position is animated", () => {
  const still = { kind: "image" as const, src: "a.png", track: 1, start: 0, end: 5, keys: [{ at: 1, opacity: 0.5 }] };
  const moved = placeLayer(still, 2, 0.25, 0.75);
  assert.deepEqual([moved.x, moved.y, moved.keys], [0.25, 0.75, still.keys]); // opacity keys don't make the position animated
  const anim = { ...still, keys: [{ at: 0, x: 0.1, y: 0.1 }, { at: 4, x: 0.9, y: 0.9 }] };
  assert.deepEqual(placeLayer(anim, 4.05, 0.5, 0.6).keys, [{ at: 0, x: 0.1, y: 0.1 }, { at: 4, x: 0.5, y: 0.6 }]); // updates the nearby key
  assert.deepEqual(placeLayer(anim, 2, 0.5, 0.6).keys!.map((k) => k.at), [0, 2, 4]); // adds one in between
  assert.deepEqual([placeLayer(still, 0, 9, -9).x, placeLayer(still, 0, 9, -9).y], [1.5, -0.5]); // stays near the frame
});
