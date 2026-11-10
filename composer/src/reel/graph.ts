// The keyframe graph: each animated property drawn as a curve over time, with points you can drag.
// Pure functions (editor, tests). Times are in whatever seconds the keys use (seconds since an overlay or
// layer appeared, or source seconds for a shot); `range` is the span shown.

import { sampleKeys, type Key } from "./keyframes.ts";

/** Properties that some keyframe sets, in a stable order. */
export function animatedProps(keys: Key[] | undefined, order: readonly string[]): string[] {
  const used = new Set<string>();
  for (const k of keys || []) for (const [p, v] of Object.entries(k)) if (typeof v === "number" && p !== "at") used.add(p);
  return [...order.filter((p) => used.has(p)), ...[...used].filter((p) => !order.includes(p)).sort()];
}

/** The property's value along the range, as (time, value) points. */
export function curve(keys: Key[] | undefined, prop: string, base: number, range: [number, number], samples = 80): { t: number; v: number }[] {
  const [a, b] = range;
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = a + ((b - a) * i) / samples;
    out.push({ t, v: sampleKeys(keys, t, { [prop]: base } as Record<string, number>)[prop] });
  }
  return out;
}

/** The value range to draw, padded so points never sit on the edge; a flat curve gets a small band. */
export function valueRange(values: readonly number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi - lo < 1e-6) {
    const pad = Math.max(0.05, Math.abs(hi) * 0.1);
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  return [lo, hi];
}

/**
 * Move one keyframe of a property to time `at` and value `v`. A keyframe can't pass its neighbours in time
 * (it stops 0.02 s short of them) or leave the range. Other properties on the same keyframe move with it in time.
 */
export function moveKey(keys: Key[], i: number, prop: string, at: number, v: number, range: [number, number]): Key[] {
  const sorted = [...keys].sort((x, y) => x.at - y.at);
  const k = sorted[i];
  if (!k) return sorted;
  const lo = i > 0 ? sorted[i - 1].at + 0.02 : range[0];
  const hi = i < sorted.length - 1 ? sorted[i + 1].at - 0.02 : range[1];
  const t = Math.round(Math.min(Math.max(at, lo), Math.max(lo, hi)) * 1000) / 1000;
  sorted[i] = { ...k, at: t, [prop]: Math.round(v * 1000) / 1000 };
  return sorted;
}
