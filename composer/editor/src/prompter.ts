// Teleprompter maths. Pure, so it runs under `node --test`.

/** Words in a script. */
export function wordCount(script: string): number {
  return script.trim() ? script.trim().split(/\s+/).length : 0;
}

/** How far through the script the reader should be, 0..1, after `seconds` at `wpm` words a minute. */
export function readProgress(script: string, wpm: number, seconds: number): number {
  const n = wordCount(script);
  if (!n || wpm <= 0) return 0;
  return Math.min(1, Math.max(0, (seconds * wpm) / 60 / n));
}

/** Seconds the script takes to read at `wpm`. */
export function readSeconds(script: string, wpm: number): number {
  return wpm > 0 ? (wordCount(script) / wpm) * 60 : 0;
}

/** The first recording format this browser supports, and the file extension to save it under. */
export function pickFormat(kind: "camera" | "screen" | "voice", supported: (mime: string) => boolean): { mime: string; ext: string } {
  const options =
    kind !== "voice"
      ? [["video/webm;codecs=vp9,opus", "webm"], ["video/webm;codecs=vp8,opus", "webm"], ["video/webm", "webm"], ["video/mp4", "mp4"]]
      : [["audio/webm;codecs=opus", "webm"], ["audio/webm", "webm"], ["audio/mp4", "m4a"]];
  for (const [mime, ext] of options) if (supported(mime)) return { mime, ext };
  return { mime: "", ext: "webm" };
}
