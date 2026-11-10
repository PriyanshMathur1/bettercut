// Keyframes: a property that changes over time. Pure functions, no runtime imports (editor, renderer, tests).
//
// A key holds a time and any number of property values, e.g. { at: 1.5, x: 0.3, scale: 1.4 }. Each property
// is animated on its own, from the keys that mention it, so a key that only sets `scale` leaves `x` alone.
// `at` means: for an overlay, seconds since it appeared; for a shot, SOURCE seconds in the footage.

export type Ease = "smooth" | "linear" | "hold";

export interface Key {
  at: number;
  /** How the value travels from this key to the next one. Default: smooth. */
  ease?: Ease;
  [prop: string]: number | string | undefined;
}

const smooth = (p: number) => p * p * (3 - 2 * p);
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Value of every property in `base` at time `at`. With no keys for a property, its base value is kept. */
export function sampleKeys<T extends Record<string, number>>(keys: Key[] | undefined, at: number, base: T): T {
  if (!keys || !keys.length) return base;
  const out: Record<string, number> = { ...base };
  for (const prop of Object.keys(base)) {
    const ks = keys.filter((k) => typeof k[prop] === "number").sort((a, b) => a.at - b.at);
    if (!ks.length) continue;
    if (at <= ks[0].at) out[prop] = ks[0][prop] as number;
    else if (at >= ks[ks.length - 1].at) out[prop] = ks[ks.length - 1][prop] as number;
    else {
      const i = ks.findIndex((k, j) => at >= k.at && at < ks[j + 1].at);
      const a = ks[i];
      const b = ks[i + 1];
      const p = (at - a.at) / (b.at - a.at);
      const e = a.ease === "hold" ? 0 : a.ease === "linear" ? p : smooth(p);
      out[prop] = (a[prop] as number) + ((b[prop] as number) - (a[prop] as number)) * e;
    }
  }
  return out as T;
}

/** Index of the key within `tol` seconds of `at`, or -1. */
export function nearestKey(keys: Key[] | undefined, at: number, tol = 0.12): number {
  let best = -1;
  (keys || []).forEach((k, i) => {
    if (Math.abs(k.at - at) <= tol && (best < 0 || Math.abs(k.at - at) < Math.abs(keys![best].at - at))) best = i;
  });
  return best;
}

/** Set values at time `at`: merged into the key already there (within `tol`), else a new key. Keys stay sorted. */
export function setKey(keys: Key[] | undefined, at: number, values: Partial<Key>, tol = 0.12): Key[] {
  const list = (keys || []).map((k) => ({ ...k }));
  const i = nearestKey(list, at, tol);
  const clean: Record<string, number | string | undefined> = {};
  for (const [k, v] of Object.entries(values)) clean[k] = typeof v === "number" ? round(v) : v;
  if (i >= 0) list[i] = { ...list[i], ...clean, at: list[i].at };
  else list.push({ ...clean, at: round(Math.max(0, at)) } as Key);
  return list.sort((a, b) => a.at - b.at);
}

export function removeKey(keys: Key[] | undefined, i: number): Key[] {
  return (keys || []).filter((_, j) => j !== i);
}
