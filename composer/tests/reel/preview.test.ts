// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { followPlayer, volumeToRestore } from "../../editor/src/preview.ts";

const fakePlayer = (frame: number) => {
  const listeners = new Set<(e: { detail: { frame: number } }) => void>();
  return {
    listeners,
    getCurrentFrame: () => frame,
    addEventListener: (_: "frameupdate", fn: (e: { detail: { frame: number } }) => void) => void listeners.add(fn),
    removeEventListener: (_: "frameupdate", fn: (e: { detail: { frame: number } }) => void) => void listeners.delete(fn),
    emit: (f: number) => listeners.forEach((fn) => fn({ detail: { frame: f } })),
  };
};

test("followPlayer reports where the player is now, then every frame, until stopped", () => {
  const p = fakePlayer(42);
  const seen: number[] = [];
  const stop = followPlayer(p, (f) => seen.push(f));
  assert.deepEqual(seen, [42]); // a player that mounted late still sets the playhead at once
  p.emit(43);
  p.emit(90);
  assert.deepEqual(seen, [42, 43, 90]);
  stop();
  p.emit(91);
  assert.deepEqual(seen, [42, 43, 90]);
  assert.equal(p.listeners.size, 0); // nothing left attached
});

test("following a second player after the first is independent", () => {
  const a = fakePlayer(0);
  const b = fakePlayer(10);
  const seen: string[] = [];
  const stopA = followPlayer(a, (f) => seen.push("a" + f));
  stopA();
  followPlayer(b, (f) => seen.push("b" + f));
  a.emit(5); // the old player no longer moves the playhead
  b.emit(11);
  assert.deepEqual(seen, ["a0", "b10", "b11"]);
});

test("volumeToRestore never leaves the preview silent after an interrupted take", () => {
  assert.equal(volumeToRestore(null), null); // no take was interrupted
  assert.equal(volumeToRestore("0.8"), 0.8);
  assert.equal(volumeToRestore("3"), 1);
  assert.equal(volumeToRestore("0"), 1); // it was silent before the take too: come back audible
  assert.equal(volumeToRestore("garbage"), 1);
});
