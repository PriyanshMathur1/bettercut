// Run: node --test tests/reel/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { pickFormat, readProgress, readSeconds, wordCount } from "../../editor/src/prompter.ts";

test("wordCount ignores extra spaces and line breaks", () => {
  assert.equal(wordCount("  Hello   there,\n\nworld. "), 3);
  assert.equal(wordCount("   "), 0);
});

test("readProgress moves through the script at the chosen speed and stops at the end", () => {
  const script = Array.from({ length: 150 }, (_, i) => "w" + i).join(" "); // one minute at 150 wpm
  assert.equal(readProgress(script, 150, 0), 0);
  assert.equal(readProgress(script, 150, 30), 0.5);
  assert.equal(readProgress(script, 150, 600), 1);
  assert.equal(readProgress("", 150, 10), 0);
  assert.equal(readSeconds(script, 150), 60);
});

test("pickFormat takes the first format the browser supports", () => {
  assert.deepEqual(pickFormat("camera", (m) => m === "video/webm"), { mime: "video/webm", ext: "webm" });
  assert.deepEqual(pickFormat("camera", (m) => m === "video/mp4"), { mime: "video/mp4", ext: "mp4" });
  assert.deepEqual(pickFormat("voice", (m) => m.startsWith("audio/mp4")), { mime: "audio/mp4", ext: "m4a" });
  assert.equal(pickFormat("voice", () => false).mime, ""); // let the browser choose
});
