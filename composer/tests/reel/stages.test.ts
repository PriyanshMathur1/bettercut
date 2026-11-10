import { test } from "node:test";
import assert from "node:assert/strict";
import { headline, progress, waiting, type PipelineView, type StageRow } from "../../editor/src/stages.ts";

const row = (name: string, status: StageRow["status"], extra: Partial<StageRow> = {}): StageRow => ({ id: name.toLowerCase(), name, approve: true, status, summary: "", note: "", ...extra });
const view = (stage: number, stages: StageRow[], finished = false): PipelineView => ({ pipeline: "talking-head", name: "Talking-head reel", brief: "", stage, finished, stages, now: { status: "" } });

test("the strip says what is happening and how far along", () => {
  const v = view(1, [row("Brief", "done"), row("Rough cut", "doing"), row("Polish", "todo")]);
  assert.equal(headline(v), "Claude is on Rough cut (2 of 3)");
  assert.equal(progress(v), 0.33);
  assert.equal(waiting(v), null);
});

test("a stage waiting for the creator is offered for approval", () => {
  const v = view(1, [row("Brief", "done"), row("Rough cut", "review", { summary: "cut to 40 s" }), row("Polish", "todo")]);
  assert.equal(headline(v), "Rough cut is ready for you (2 of 3)");
  assert.equal(waiting(v)?.summary, "cut to 40 s");
  assert.equal(progress(v), 0.63);
});

test("sent back and finished", () => {
  assert.equal(headline(view(0, [row("Brief", "doing", { note: "shorter" })])), "Claude is redoing Brief (1 of 1)");
  const done = view(0, [row("Brief", "done")], true);
  assert.equal(headline(done), "Talking-head reel: finished");
  assert.equal(progress(done), 1);
  assert.equal(waiting(done), null);
});
