// Multi-camera on the reel's timeline. Pure functions (renderer, editor, tests).
//
// `angles` are extra recordings of the same moments, each with an `offset`: main-footage time t is time
// t + offset in the angle's file. `cams` says which camera is on from when: [{at, angle}], `at` in main-
// footage (source) seconds, "main" for the main footage. The reel's sound is always the main footage's.

import { speedOf } from "./timeline.ts";

export interface Angle {
  id: string;
  name?: string;
  src: string;
  offset: number;
  /** Length of the angle's file, when known: outside it the angle has nothing to show. */
  duration?: number;
  /** How clearly it synced (from the pipeline). */
  match?: number;
}

export interface CamCut {
  at: number;
  angle: string;
}

export const MAIN = "main";
const EPS = 1e-3;

/** The camera on at source time `t`. */
export function angleAt(cams: readonly CamCut[] | undefined, t: number): string {
  let on = MAIN;
  let best = -Infinity;
  for (const c of cams || []) if (c.at <= t + EPS && c.at >= best) [best, on] = [c.at, c.angle];
  return on;
}

/** Whether an angle recorded the whole stretch [start, end] of main-footage time. */
export function covers(a: Angle, start: number, end: number): boolean {
  return start + a.offset >= -0.02 && (a.duration === undefined || end + a.offset <= a.duration + 0.02);
}

interface Seg {
  start: number;
  end: number;
  outStart: number;
  outEnd: number;
  speed?: number;
  hold?: number;
  reverse?: boolean;
}

/**
 * Split placed shots where the camera changes. Each piece carries `cam` (the angle to show, or undefined
 * for the main footage). A shot's freeze frame stays on its last piece. Reversed shots always use the main
 * footage, and a stretch an angle didn't record falls back to it too. Pieces on the same camera are merged.
 */
export function cameraPieces<T extends Seg>(placed: readonly T[], cams: readonly CamCut[] | undefined, angles: readonly Angle[] | undefined): (T & { cam?: Angle })[] {
  if (!cams?.length || !angles?.length) return placed.map((s) => ({ ...s }));
  const byId = new Map(angles.map((a) => [a.id, a]));
  const out: (T & { cam?: Angle })[] = [];
  for (const s of placed) {
    if (s.reverse) {
      out.push({ ...s });
      continue;
    }
    const cuts = cams.map((c) => c.at).filter((t) => t > s.start + 0.02 && t < s.end - 0.02).sort((a, b) => a - b);
    const edges = [s.start, ...cuts, s.end];
    const speed = speedOf(s);
    const hold = Math.max(0, s.hold ?? 0);
    const pieces: (T & { cam?: Angle })[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const [a, b] = [edges[i], edges[i + 1]];
      const id = angleAt(cams, a);
      const ang = id === MAIN ? undefined : byId.get(id);
      const cam = ang && covers(ang, a, b) ? ang : undefined;
      const prev = pieces[pieces.length - 1];
      if (prev && prev.cam?.id === cam?.id) {
        prev.end = b;
        continue;
      }
      const { hold: _h, ...rest } = s;
      pieces.push({ ...(rest as unknown as T), start: a, end: b, cam });
    }
    pieces.forEach((p, i) => {
      p.outStart = s.outStart + (p.start - s.start) / speed;
      p.outEnd = s.outStart + (p.end - s.start) / speed;
      if (i === pieces.length - 1) {
        p.outEnd += hold;
        if (hold) p.hold = s.hold;
      }
      if (!p.cam) delete p.cam;
    });
    out.push(...pieces);
  }
  return out;
}

/** Turn a camera on from source time `t` until the next switch (merging switches that would do nothing). */
export function setCamAt(cams: readonly CamCut[] | undefined, t: number, angle: string): CamCut[] {
  const at = Math.round(Math.max(0, t) * 1000) / 1000;
  const list = (cams || []).filter((c) => Math.abs(c.at - at) > 0.05).concat({ at, angle }).sort((a, b) => a.at - b.at);
  const out: CamCut[] = [];
  for (const c of list) if ((out.length ? out[out.length - 1].angle : MAIN) !== c.angle || (!out.length && c.angle !== MAIN)) out.push(c);
  return out;
}
