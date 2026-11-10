// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createSaver, type SaveState } from "../../editor/src/saver.ts";

/** A saver wired to fake timers and a save function the test controls. */
const rig = (fail: () => boolean = () => false) => {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const saved: string[] = [];
  const states: (SaveState | string)[] = [];
  let gate: Promise<void> | null = null;
  const saver = createSaver<string>({
    save: async (v) => {
      if (gate) await gate;
      if (fail()) throw new Error("server is down");
      saved.push(v);
    },
    onState: (s, e) => states.push(e ? `${s}: ${e}` : s),
    delay: 700,
    backoff: [1000, 3000],
    setTimer: (fn, ms) => (timers.set(++id, { fn, ms }), id),
    clearTimer: (t) => void timers.delete(t as number),
  });
  return {
    saver,
    saved,
    states,
    waits: () => [...timers.values()].map((t) => t.ms),
    /** Run the pending timer and let the save settle. */
    tick: async () => {
      const [key, t] = [...timers.entries()][0] ?? [];
      if (key === undefined) return;
      timers.delete(key);
      t!.fn();
      await new Promise((r) => setImmediate(r));
    },
    hold: () => {
      let open!: () => void;
      gate = new Promise<void>((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
  };
};

test("an edit is saved after a pause, and quick edits become one save", async () => {
  const r = rig();
  r.saver.push("a");
  r.saver.push("ab");
  r.saver.push("abc");
  assert.deepEqual(r.waits(), [700]);
  assert.equal(r.saver.state(), "dirty");
  await r.tick();
  assert.deepEqual(r.saved, ["abc"]);
  assert.equal(r.saver.state(), "saved");
});

test("a failed save says so, keeps the edit and retries on its own", async () => {
  let down = true;
  const r = rig(() => down);
  r.saver.push("edit");
  await r.tick();
  assert.equal(r.saver.state(), "failed");
  assert.ok(r.states.includes("failed: server is down"));
  assert.deepEqual(r.waits(), [1000]); // first automatic retry
  await r.tick();
  assert.deepEqual(r.waits(), [3000]); // second, later
  down = false;
  await r.tick();
  assert.deepEqual(r.saved, ["edit"]);
  assert.equal(r.saver.state(), "saved");
});

test("after the automatic retries it waits, and Retry saves", async () => {
  let down = true;
  const r = rig(() => down);
  r.saver.push("edit");
  await r.tick();
  await r.tick();
  await r.tick();
  assert.deepEqual(r.waits(), []); // gave up trying on its own
  assert.equal(r.saver.state(), "failed");
  down = false;
  assert.equal(await r.saver.retry(), true);
  assert.deepEqual(r.saved, ["edit"]);
  assert.equal(r.saver.state(), "saved");
});

test("a new edit after a failure starts the retries again and saves the newest", async () => {
  let down = true;
  const r = rig(() => down);
  r.saver.push("old");
  await r.tick();
  await r.tick();
  await r.tick();
  down = false;
  r.saver.push("new");
  assert.deepEqual(r.waits(), [700]);
  await r.tick();
  assert.deepEqual(r.saved, ["new"]);
});

test("an edit made while a save is on its way is saved next", async () => {
  const r = rig();
  const release = r.hold();
  r.saver.push("first");
  const going = r.tick();
  r.saver.push("second"); // arrives mid-save
  release();
  await going;
  await new Promise((x) => setImmediate(x));
  assert.deepEqual(r.saved, ["first"]);
  assert.equal(r.saver.state(), "dirty");
  await r.tick();
  assert.deepEqual(r.saved, ["first", "second"]);
  assert.equal(r.saver.state(), "saved");
});

test("flush saves now and reports whether it worked", async () => {
  const r = rig();
  r.saver.push("now");
  assert.equal(await r.saver.flush(), true);
  assert.deepEqual(r.saved, ["now"]);
  assert.deepEqual(r.waits(), []);
  assert.equal(await r.saver.flush(), true); // nothing pending is fine

  const bad = rig(() => true);
  bad.saver.push("x");
  assert.equal(await bad.saver.flush(), false);
  assert.equal(bad.saver.state(), "failed");
});

test("flush waits for a save already on its way, then saves what came after", async () => {
  const r = rig();
  const release = r.hold();
  r.saver.push("one");
  const going = r.tick();
  r.saver.push("two");
  const flushed = r.saver.flush();
  release();
  await going;
  assert.equal(await flushed, true);
  assert.deepEqual(r.saved, ["one", "two"]);
});

test("cancel forgets a pending edit", async () => {
  const r = rig();
  r.saver.push("discard me");
  r.saver.cancel();
  assert.deepEqual(r.waits(), []);
  assert.equal(r.saver.state(), "saved");
  assert.equal(await r.saver.flush(), true);
  assert.deepEqual(r.saved, []);
});
