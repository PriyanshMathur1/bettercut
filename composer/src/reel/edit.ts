// Timeline edits on the list of shots (spec.segments). Pure functions, no runtime imports: shared by the
// editor and `node --test`. Times are SOURCE seconds. The list order is the playing order, so every
// function keeps it. Shots never overlap in the footage, which keeps each spoken word in exactly one shot.

import type { ReelSegment } from "./types";

export const MIN_SHOT = 0.15;

const round = (t: number) => Math.round(t * 1000) / 1000;

let counter = 0;
const newId = (segments: ReelSegment[]) => {
  const used = new Set(segments.map((s) => s.id));
  let id = "";
  do id = `c${++counter}`;
  while (used.has(id));
  return id;
};

const without = (s: ReelSegment, ...keys: (keyof ReelSegment)[]) => {
  const out: Record<string, unknown> = { ...s };
  for (const k of keys) delete out[k];
  return out as unknown as ReelSegment;
};

/** Index of the shot that contains source time `t`, or -1. */
export function shotAt(segments: ReelSegment[], t: number): number {
  return segments.findIndex((s) => t >= s.start - 1e-6 && t <= s.end + 1e-6);
}

/** Index of the shot a placed piece came from (text cuts split a shot into pieces). */
export function baseOf(segments: ReelSegment[], piece: { start: number; end: number }): number {
  return segments.findIndex((s) => piece.start >= s.start - 1e-6 && piece.end <= s.end + 1e-6);
}

/** Cut the shot under `t` in two. Returns the same shots if `t` is too close to an edge or in no shot. */
export function splitAt(segments: ReelSegment[], t: number): ReelSegment[] {
  const list = [...segments];
  const i = shotAt(list, t);
  if (i < 0) return list;
  const s = list[i];
  if (t - s.start < MIN_SHOT || s.end - t < MIN_SHOT) return list;
  const cut = round(t);
  // a freeze frame stays at the end of the shot; a seamless join stays at its start
  list.splice(i, 1, { ...without(s, "hold"), end: cut }, { ...without(s, "join"), id: newId(list), start: cut });
  return list;
}

/** Remove shot `i`. The last remaining shot can't be removed: a reel needs footage. */
export function removeShot(segments: ReelSegment[], i: number): ReelSegment[] {
  const list = [...segments];
  if (list.length <= 1 || i < 0 || i >= list.length) return list;
  list.splice(i, 1);
  return list;
}

/** Move shot `i` to position `to` in the playing order. */
export function moveShot(segments: ReelSegment[], i: number, to: number): ReelSegment[] {
  const list = [...segments];
  if (i < 0 || i >= list.length) return list;
  const target = Math.min(list.length - 1, Math.max(0, to));
  const [s] = list.splice(i, 1);
  list.splice(target, 0, without(s, "join")); // moved away from its neighbour: it is a real cut now
  return list;
}

/**
 * Move one edge of shot `i` to source time `t`. The edge stops at whichever shot is next to it in the
 * footage (shots never overlap), at the ends of the footage, and before the shot gets shorter than MIN_SHOT.
 */
export function trimShot(segments: ReelSegment[], i: number, edge: "start" | "end", t: number, duration: number): ReelSegment[] {
  const list = [...segments];
  const s = list[i];
  if (!s) return list;
  const others = list.filter((_, j) => j !== i);
  if (edge === "start") {
    const lo = Math.max(0, ...others.filter((o) => o.end <= s.start + 1e-6).map((o) => o.end));
    list[i] = { ...s, start: round(Math.min(Math.max(t, lo), s.end - MIN_SHOT)) };
  } else {
    const hi = Math.min(duration, ...others.filter((o) => o.start >= s.end - 1e-6).map((o) => o.start));
    list[i] = { ...s, end: round(Math.max(Math.min(t, hi), s.start + MIN_SHOT)) };
  }
  return list;
}

/** Change fields of shot `i` (speed, zoom, hold…). A value of undefined removes the field. */
export function patchShot(segments: ReelSegment[], i: number, patch: Partial<ReelSegment>): ReelSegment[] {
  const list = [...segments];
  if (!list[i]) return list;
  const next: Record<string, unknown> = { ...list[i], ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  list[i] = next as unknown as ReelSegment;
  return list;
}

/**
 * Freeze frame: hold the picture at source time `t` for `seconds`. Splits the shot there (unless `t` is
 * at its end) and holds the first part's last frame. Does nothing outside a shot or at a shot's very start.
 */
export function freezeAt(segments: ReelSegment[], t: number, seconds: number): ReelSegment[] {
  const i = shotAt(segments, t);
  if (i < 0 || seconds <= 0) return [...segments];
  const s = segments[i];
  if (t - s.start < MIN_SHOT) return [...segments];
  if (s.end - t < MIN_SHOT) return patchShot(segments, i, { hold: seconds });
  const list = splitAt(segments, t);
  list[i] = { ...list[i], hold: seconds };
  list[i + 1] = { ...list[i + 1], join: true }; // the picture carries on from the frozen frame: no cut
  return list;
}

/** Speed ramps: the shot is divided into equal steps of footage, each played at one of these speeds. */
export const SPEED_RAMPS: Record<string, { name: string; speeds: number[] }> = {
  "speed-up": { name: "Speed up", speeds: [0.5, 0.75, 1, 1.5, 2.5] },
  "slow-down": { name: "Slow down", speeds: [2.5, 1.5, 1, 0.75, 0.5] },
  "slow-middle": { name: "Slow in the middle", speeds: [2, 1.25, 0.5, 1.25, 2] },
  "fast-middle": { name: "Fast in the middle", speeds: [0.6, 1.25, 2.5, 1.25, 0.6] },
  "slow-end": { name: "Slow-motion ending", speeds: [1, 1, 1, 0.6, 0.35] },
};

/** Apply a speed ramp to shot `i`: it becomes seamless steps. Returns the shots unchanged if it is too short. */
export function rampShot(segments: ReelSegment[], i: number, ramp: string): ReelSegment[] {
  const def = SPEED_RAMPS[ramp];
  const s = segments[i];
  if (!def || !s) return [...segments];
  const n = def.speeds.length;
  const len = (s.end - s.start) / n;
  if (len < MIN_SHOT) return [...segments];
  const list = [...segments];
  const steps = def.speeds.map((speed, k) => {
    const step: ReelSegment = { ...without(s, "hold", "join"), start: round(s.start + k * len), end: k === n - 1 ? s.end : round(s.start + (k + 1) * len), speed };
    if (k > 0) {
      step.id = newId([...list, ...[]]);
      step.join = true;
    } else if (s.join) step.join = true;
    if (k === n - 1 && s.hold) step.hold = s.hold;
    return step;
  });
  // ids must be unique among themselves too
  const seen = new Set(list.map((x) => x.id));
  for (const st of steps.slice(1)) {
    while (seen.has(st.id)) st.id = `c${++counter}`;
    seen.add(st.id);
  }
  list.splice(i, 1, ...steps);
  return list;
}

export const MIN_SPAN = 0.2;

/**
 * Move or resize something that sits on the timeline (an overlay, a b-roll clip). `start`/`end` are the
 * new SOURCE times the editor asks for; the result is kept inside the footage and at least MIN_SPAN long.
 * A move keeps the length; a resize moves one edge only.
 */
export function placeSpan<T extends { start: number; end: number }>(item: T, how: "move" | "start" | "end", t: number, duration: number): T {
  const len = item.end - item.start;
  if (how === "move") {
    const start = Math.min(Math.max(0, t), Math.max(0, duration - len));
    return { ...item, start: round(start), end: round(start + len) };
  }
  if (how === "start") return { ...item, start: round(Math.min(Math.max(0, t), item.end - MIN_SPAN)) };
  return { ...item, end: round(Math.max(Math.min(duration, t), item.start + MIN_SPAN)) };
}

/** Cut the shots at each of these source times (splits too close to an edge are skipped). */
export function splitMany(segments: ReelSegment[], times: number[]): ReelSegment[] {
  return [...times].sort((a, b) => a - b).reduce((list, t) => splitAt(list, t), [...segments]);
}
