// Review comments in the editor: pure helpers (editor, tests).

export interface Comment {
  id: string;
  name: string;
  text: string;
  at: number;
  x: number | null;
  y: number | null;
  version: string;
  done: boolean;
}

/** True when a link on this address would only open on this computer. */
export function onlyHere(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h === "localhost" || h === "::1" || h === "[::1]" || h.endsWith(".localhost") || /^127\./.test(h) || h === "0.0.0.0";
  } catch {
    return true;
  }
}

/** Where on the picture a comment points, in words. */
export function spotName(c: Pick<Comment, "x" | "y">): string {
  if (c.x == null || c.y == null) return "whole frame";
  const col = c.x < 1 / 3 ? "left" : c.x > 2 / 3 ? "right" : "centre";
  const row = c.y < 1 / 3 ? "top" : c.y > 2 / 3 ? "bottom" : "middle";
  return row === "middle" && col === "centre" ? "centre" : row === "middle" ? col : `${row} ${col === "centre" ? "centre" : col}`;
}

/** Open comments as notes for the AI, pinned to their moment (reel seconds). */
export function asNotes(comments: Comment[]): { t: number; text: string }[] {
  return comments
    .filter((c) => !c.done)
    .map((c) => ({ t: c.at, text: `${c.name} (review${c.x == null ? "" : `, ${spotName(c)}`}): ${c.text}` }))
    .sort((a, b) => a.t - b.t);
}

/** Notes that aren't already pinned (so asking twice doesn't double them). */
export function newNotes<N extends { t: number | null; text: string }>(have: N[], add: { t: number; text: string }[]): { t: number; text: string }[] {
  return add.filter((a) => !have.some((h) => h.t === a.t && h.text === a.text));
}
