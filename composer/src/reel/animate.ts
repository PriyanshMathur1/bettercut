// One-click animation presets for media layers and overlays. Pure functions (editor, tests).
//
// A preset writes ordinary keyframes, so whatever it does stays visible on the timeline and editable
// afterwards in the keyframe row. "In" presets animate the first moments of the item, "out" presets the
// last moments, and "loop" presets run for its whole life. Applying a preset replaces only what that
// phase animated before; keyframes elsewhere are kept.

import { setKey, type Ease, type Key } from "./keyframes.ts";

export type Phase = "in" | "out" | "loop";

/** The values an item has when it is not animating: x, y (0..1 of the frame), scale, rotate, opacity. */
export interface Rest {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
}

type Props = Partial<Rest>;

export interface AnimPreset {
  id: string;
  name: string;
  phase: Phase;
  /** Seconds the move takes (in and out). Shortened to fit items under twice this long. */
  dur: number;
  /** Ease from the first state to the second. */
  ease: Ease;
  /** The state the item is in away from rest: where it starts (in) or ends up (out). */
  away?: (r: Rest) => Props;
  /** Loop only: the state it swings to and back from, and how long one swing takes. */
  swing?: (r: Rest) => Props;
  period?: number;
}

const SLIDE = 0.12; // fraction of the frame a slide travels

export const ANIM_PRESETS: AnimPreset[] = [
  // in
  { id: "fade-in", name: "Fade in", phase: "in", dur: 0.4, ease: "smooth", away: () => ({ opacity: 0 }) },
  { id: "slide-up", name: "Slide up", phase: "in", dur: 0.5, ease: "smooth", away: (r) => ({ y: r.y + SLIDE, opacity: 0 }) },
  { id: "slide-down", name: "Slide down", phase: "in", dur: 0.5, ease: "smooth", away: (r) => ({ y: r.y - SLIDE, opacity: 0 }) },
  { id: "slide-left", name: "Slide in from left", phase: "in", dur: 0.5, ease: "smooth", away: (r) => ({ x: r.x - SLIDE * 2, opacity: 0 }) },
  { id: "slide-right", name: "Slide in from right", phase: "in", dur: 0.5, ease: "smooth", away: (r) => ({ x: r.x + SLIDE * 2, opacity: 0 }) },
  { id: "zoom-in", name: "Zoom in", phase: "in", dur: 0.5, ease: "smooth", away: (r) => ({ scale: r.scale * 0.4, opacity: 0 }) },
  { id: "pop", name: "Pop", phase: "in", dur: 0.45, ease: "back", away: (r) => ({ scale: r.scale * 0.2, opacity: 0 }) },
  { id: "drop", name: "Drop in", phase: "in", dur: 0.55, ease: "back", away: (r) => ({ y: r.y - SLIDE * 2, opacity: 0 }) },
  { id: "spin-in", name: "Spin in", phase: "in", dur: 0.6, ease: "back", away: (r) => ({ rotate: r.rotate - 180, scale: r.scale * 0.3, opacity: 0 }) },
  // out
  { id: "fade-out", name: "Fade out", phase: "out", dur: 0.4, ease: "smooth", away: () => ({ opacity: 0 }) },
  { id: "slide-out-down", name: "Slide down and out", phase: "out", dur: 0.5, ease: "smooth", away: (r) => ({ y: r.y + SLIDE, opacity: 0 }) },
  { id: "slide-out-right", name: "Slide out to the right", phase: "out", dur: 0.5, ease: "smooth", away: (r) => ({ x: r.x + SLIDE * 2, opacity: 0 }) },
  { id: "zoom-out", name: "Zoom out", phase: "out", dur: 0.5, ease: "smooth", away: (r) => ({ scale: r.scale * 0.4, opacity: 0 }) },
  { id: "shrink", name: "Shrink away", phase: "out", dur: 0.4, ease: "smooth", away: () => ({ scale: 0, opacity: 0 }) },
  // loop
  { id: "pulse", name: "Pulse", phase: "loop", dur: 0, ease: "smooth", swing: (r) => ({ scale: r.scale * 1.08 }), period: 0.6 },
  { id: "float", name: "Float", phase: "loop", dur: 0, ease: "smooth", swing: (r) => ({ y: r.y - 0.015 }), period: 1.2 },
  { id: "sway", name: "Sway", phase: "loop", dur: 0, ease: "smooth", swing: (r) => ({ rotate: r.rotate + 4 }), period: 0.9 },
];

export const PRESET_MAP: Record<string, AnimPreset> = Object.fromEntries(ANIM_PRESETS.map((p) => [p.id, p]));

const ANIM_PROPS = ["x", "y", "scale", "rotate", "opacity"] as const;
const MAX_LOOP_KEYS = 120;
const EPS = 1e-3;

/**
 * The span of the item's life (seconds since it appeared) that a phase animates. In and out each take at
 * most a little under half the item, so on a short item the in move lands before the out move starts and
 * changing one never touches the other.
 */
export function phaseWindow(phase: Phase, len: number, dur: number): [number, number] {
  const d = Math.max(0, Math.min(dur, len / 2 - 0.01));
  if (phase === "in") return [0, d];
  if (phase === "out") return [Math.max(0, len - d), len];
  return [0, len];
}

/** Which properties a preset animates. */
export function propsOf(preset: AnimPreset): string[] {
  const probe: Rest = { x: 0.5, y: 0.5, scale: 1, rotate: 0, opacity: 1 };
  return Object.keys({ ...(preset.away?.(probe) || {}), ...(preset.swing?.(probe) || {}) });
}

/**
 * Remove a phase's animation: inside its window, the given properties are taken out of every keyframe,
 * and keyframes left with nothing to animate are dropped. Keyframes outside the window are untouched.
 */
export function clearPhase(keys: Key[] | undefined, phase: Phase, len: number, props: readonly string[] = ANIM_PROPS, dur = 0.6): Key[] {
  const [a, b] = phase === "loop" ? [0, len] : phaseWindow(phase, len, dur);
  const out: Key[] = [];
  for (const k of keys || []) {
    if (k.at < a - EPS || k.at > b + EPS) {
      out.push({ ...k });
      continue;
    }
    const kept: Key = { ...k };
    for (const p of props) delete kept[p];
    if (ANIM_PROPS.some((p) => typeof kept[p] === "number")) out.push(kept);
  }
  return out;
}

const pick = (r: Rest, props: readonly string[]): Props => Object.fromEntries(props.map((p) => [p, (r as unknown as Record<string, number>)[p]]));

/**
 * Apply a preset to an item `len` seconds long whose resting values are `rest`. Returns the new keyframes.
 * Unknown presets, and items too short to animate, return the keyframes unchanged.
 */
export function applyPreset(keys: Key[] | undefined, presetId: string, rest: Rest, len: number): Key[] {
  const p = PRESET_MAP[presetId];
  const current = (keys || []).map((k) => ({ ...k }));
  if (!p || !(len > 0.05)) return current;
  const props = propsOf(p);
  // a new in/out preset replaces whatever that phase animated before, for every property it moves
  let next = clearPhase(current, p.phase, len, p.phase === "loop" ? props : ANIM_PROPS, Math.max(p.dur, 0.6));
  const restOf = pick(rest, props);
  if (p.phase === "loop") {
    const half = Math.max(0.1, (p.period || 1) / 2);
    const n = Math.min(MAX_LOOP_KEYS, Math.floor(len / half));
    for (let i = 0; i <= n; i++) next = setKey(next, i * half, { ...(i % 2 ? p.swing!(rest) : restOf), ease: p.ease }, 0.01);
    return next;
  }
  const [a, b] = phaseWindow(p.phase, len, p.dur);
  if (b - a < 0.05) return current;
  const away = p.away!(rest);
  if (p.phase === "in") {
    next = setKey(next, a, { ...away, ease: p.ease }, 0.01);
    next = setKey(next, b, { ...restOf }, 0.01);
  } else {
    next = setKey(next, a, { ...restOf, ease: p.ease }, 0.01);
    next = setKey(next, b, { ...away }, 0.01);
  }
  return next;
}
