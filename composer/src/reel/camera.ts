// Named camera moves for a shot. Pure functions (editor, tests).
//
// A move writes ordinary keyframes on the shot (`zoom`, `cx`, `cy`; `at` is SOURCE seconds), so it shows
// on the timeline and stays editable in the keyframe row. Applying a move replaces the shot's camera
// keyframes; "none" removes them.

import type { Ease, Key } from "./keyframes.ts"; // explicit extension: this file also runs under `node --test`

/** The framing a shot has with no keyframes. */
export interface Framing {
  zoom: number;
  cx: number;
  cy: number;
}

export interface CameraMove {
  id: string;
  name: string;
  /** What it looks like, for the menu's tooltip. */
  hint: string;
  /** Framing at the start and end of the move. */
  from: (f: Framing) => Framing;
  to: (f: Framing) => Framing;
  ease: Ease;
  /** Seconds the move takes, from the shot's start. Unset: the whole shot. */
  seconds?: number;
}

const PUSH = 0.22; // how much a push or pull changes the zoom
const TRAVEL = 0.05; // how far a slide moves the focus, as a fraction of the frame
const ROOM = 1.15; // a slide needs the picture bigger than the frame to have somewhere to go

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const roomy = (f: Framing): Framing => ({ ...f, zoom: Math.max(f.zoom, ROOM) });

export const CAMERA_MOVES: CameraMove[] = [
  { id: "push-in", name: "Push in", hint: "Moves slowly closer for the whole shot", from: (f) => f, to: (f) => ({ ...f, zoom: f.zoom + PUSH }), ease: "smooth" },
  { id: "pull-back", name: "Pull back", hint: "Starts close and eases out to the shot's framing", from: (f) => ({ ...f, zoom: f.zoom + PUSH }), to: (f) => f, ease: "smooth" },
  { id: "settle", name: "Settle", hint: "Lands on the shot with a quick ease in from close", from: (f) => ({ ...f, zoom: f.zoom + PUSH }), to: (f) => f, ease: "back", seconds: 0.6 },
  { id: "glide", name: "Glide", hint: "A steady drift across at one speed", from: (f) => ({ ...roomy(f), cx: f.cx - TRAVEL }), to: (f) => ({ ...roomy(f), cx: f.cx + TRAVEL }), ease: "linear" },
  { id: "slide-left", name: "Slide left", hint: "Travels left and eases to a stop", from: (f) => ({ ...roomy(f), cx: f.cx + TRAVEL }), to: (f) => ({ ...roomy(f), cx: f.cx - TRAVEL }), ease: "smooth" },
  { id: "slide-right", name: "Slide right", hint: "Travels right and eases to a stop", from: (f) => ({ ...roomy(f), cx: f.cx - TRAVEL }), to: (f) => ({ ...roomy(f), cx: f.cx + TRAVEL }), ease: "smooth" },
  { id: "rise", name: "Rise", hint: "Tilts up through the shot", from: (f) => ({ ...roomy(f), cy: f.cy + TRAVEL }), to: (f) => ({ ...roomy(f), cy: f.cy - TRAVEL }), ease: "smooth" },
];

const tidy = (f: Framing): Framing => ({ zoom: r3(clamp(f.zoom, 1, 4)), cx: r3(clamp(f.cx, 0, 1)), cy: r3(clamp(f.cy, 0, 1)) });

/** The framing of a shot before any keyframes (the editor's defaults). */
export function framingOf(shot: { zoom?: number; cx?: number; cy?: number }): Framing {
  return { zoom: shot.zoom ?? 1, cx: shot.cx ?? 0.5, cy: shot.cy ?? 0.4 };
}

/**
 * Keyframes for a move on a shot, or undefined for "none" or an unknown move (which clears the camera).
 * The move runs from the shot's start to its end, or for `seconds` if the move is a short one.
 */
export function cameraKeys(shot: { start: number; end: number; zoom?: number; cx?: number; cy?: number }, moveId: string): Key[] | undefined {
  const move = CAMERA_MOVES.find((m) => m.id === moveId);
  if (!move || shot.end - shot.start <= 0) return undefined;
  const rest = framingOf(shot);
  const until = move.seconds ? Math.min(shot.end, shot.start + move.seconds) : shot.end;
  return [
    { at: r3(shot.start), ease: move.ease, ...tidy(move.from(rest)) },
    { at: r3(until), ...tidy(move.to(rest)) },
  ];
}

/** Which named move a shot's keyframes are, so the menu can show it; "" for none, "custom" for hand-made ones. */
export function moveOf(shot: { start: number; end: number; zoom?: number; cx?: number; cy?: number; keys?: Key[] }): string {
  if (!shot.keys?.length) return "";
  const same = (a: Key[], b: Key[]) => a.length === b.length && a.every((k, i) => ["at", "zoom", "cx", "cy"].every((p) => Math.abs(((k[p] as number) ?? 0) - ((b[i][p] as number) ?? 0)) < 0.002) && (k.ease ?? "smooth") === (b[i].ease ?? "smooth"));
  for (const m of CAMERA_MOVES) {
    const want = cameraKeys(shot, m.id);
    if (want && same(shot.keys, want)) return m.id;
  }
  return "custom";
}
