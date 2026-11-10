// Timeline edits on the list of shots (spec.segments). Pure functions, no runtime imports: shared by the
// editor and `node --test`. Times are SOURCE seconds. Every function returns a new, source-ordered list.

import type { ReelSegment } from "./types";

export const MIN_SHOT = 0.15;

const round = (t: number) => Math.round(t * 1000) / 1000;
const sorted = (segments: ReelSegment[]) => [...segments].sort((a, b) => a.start - b.start);

let counter = 0;
const newId = (segments: ReelSegment[]) => {
  const used = new Set(segments.map((s) => s.id));
  let id = "";
  do id = `c${++counter}`;
  while (used.has(id));
  return id;
};

/** Index (in source order) of the shot that contains source time `t`, or -1. */
export function shotAt(segments: ReelSegment[], t: number): number {
  return sorted(segments).findIndex((s) => t >= s.start - 1e-6 && t <= s.end + 1e-6);
}

/** Index of the shot a placed piece came from (text cuts split a shot into pieces). */
export function baseOf(segments: ReelSegment[], piece: { start: number; end: number }): number {
  return sorted(segments).findIndex((s) => piece.start >= s.start - 1e-6 && piece.end <= s.end + 1e-6);
}

/** Cut the shot under `t` in two. Returns the same shots if `t` is too close to an edge or in no shot. */
export function splitAt(segments: ReelSegment[], t: number): ReelSegment[] {
  const list = sorted(segments);
  const i = shotAt(list, t);
  if (i < 0) return list;
  const s = list[i];
  if (t - s.start < MIN_SHOT || s.end - t < MIN_SHOT) return list;
  const cut = round(t);
  list.splice(i, 1, { ...s, end: cut }, { ...s, id: newId(list), start: cut });
  return list;
}

/** Remove shot `i`. The last remaining shot can't be removed: a reel needs footage. */
export function removeShot(segments: ReelSegment[], i: number): ReelSegment[] {
  const list = sorted(segments);
  if (list.length <= 1 || i < 0 || i >= list.length) return list;
  list.splice(i, 1);
  return list;
}

/**
 * Move one edge of shot `i` to source time `t`. The edge stops at the neighbouring shot (shots never
 * overlap), at the ends of the footage, and before the shot gets shorter than MIN_SHOT.
 */
export function trimShot(segments: ReelSegment[], i: number, edge: "start" | "end", t: number, duration: number): ReelSegment[] {
  const list = sorted(segments);
  const s = list[i];
  if (!s) return list;
  if (edge === "start") {
    const lo = i > 0 ? list[i - 1].end : 0;
    list[i] = { ...s, start: round(Math.min(Math.max(t, lo), s.end - MIN_SHOT)) };
  } else {
    const hi = i < list.length - 1 ? list[i + 1].start : duration;
    list[i] = { ...s, end: round(Math.max(Math.min(t, hi), s.start + MIN_SHOT)) };
  }
  return list;
}

/** Change fields of shot `i` (speed, zoom…). A value of undefined removes the field. */
export function patchShot(segments: ReelSegment[], i: number, patch: Partial<ReelSegment>): ReelSegment[] {
  const list = sorted(segments);
  if (!list[i]) return list;
  const next: Record<string, unknown> = { ...list[i], ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  list[i] = next as unknown as ReelSegment;
  return list;
}
