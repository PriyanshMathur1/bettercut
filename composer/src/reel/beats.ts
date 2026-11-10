// Music beats on the timeline. Pure functions, no runtime imports (editor, tests).
// Beat times are OUTPUT seconds: the music starts with the reel, so a beat is a moment in the finished video.

/** The beat nearest to `t` when it is within `tol` seconds, else `t` unchanged. */
export function snapTo(beats: number[] | undefined, t: number, tol = 0.12): number {
  let best = t;
  let gap = tol;
  for (const b of beats || []) {
    const d = Math.abs(b - t);
    if (d <= gap) {
      gap = d;
      best = b;
    }
  }
  return best;
}

/** Every `n`th beat that falls strictly inside (from, to), leaving `margin` seconds clear at both ends. */
export function beatsBetween(beats: number[] | undefined, from: number, to: number, n = 1, margin = 0.15): number[] {
  const inside = (beats || []).filter((b) => b > from + margin && b < to - margin);
  return inside.filter((_, i) => i % Math.max(1, n) === 0);
}
