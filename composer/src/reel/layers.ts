// Media layers: extra video, images and audio on their own tracks above the main footage.
// Pure functions, no runtime imports (editor, renderer, tests).
//
// A layer is timed like an overlay: `start`/`end` are SOURCE seconds of the main footage, so it follows
// cuts and reordering. `track` orders the picture (higher tracks are drawn on top). Position and size are
// fractions of the frame, so one layer looks the same in every aspect ratio.

import type { Key } from "./keyframes";

export type LayerKind = "video" | "image" | "audio";

export interface Layer {
  id?: string;
  kind: LayerKind;
  src: string;
  /** 1 = just above the footage; higher tracks are drawn on top. */
  track: number;
  start: number;
  end: number;
  /** Seconds into the layer's own file to start from (video and audio). */
  from?: number;
  /** Centre of the layer, 0..1 of the frame. Default: the middle. */
  x?: number;
  y?: number;
  /** Width as a fraction of the frame width. 1 = full width. */
  scale?: number;
  rotate?: number;
  opacity?: number;
  /** Corner radius as a fraction of the layer's width (0..0.5). */
  radius?: number;
  /** 0..2, for video and audio. Default 1 for audio, 0 for video (silent picture-in-picture). */
  volume?: number;
  /** Keyframes: `at` is seconds since the layer appeared; properties x, y, scale, rotate, opacity. */
  keys?: Key[];
}

const IMAGE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

/** What kind of layer a file makes, from its name (and whether it has a picture, when known). */
export function kindOf(name: string, hasPicture?: boolean): LayerKind {
  const clean = name.split("?")[0];
  if (IMAGE.test(clean)) return "image";
  if (AUDIO.test(clean) || hasPicture === false) return "audio";
  return "video";
}

/** Values a layer has before any keyframes. */
export function layerBase(l: Layer) {
  return { x: l.x ?? 0.5, y: l.y ?? 0.5, scale: l.scale ?? (l.kind === "audio" ? 1 : 0.6), rotate: l.rotate ?? 0, opacity: l.opacity ?? 1 };
}

export function layerVolume(l: Layer): number {
  const v = l.volume ?? (l.kind === "audio" ? 1 : 0);
  return Math.min(2, Math.max(0, v));
}

/** Track numbers in use, lowest first. */
export function tracksOf(layers: Layer[] | undefined): number[] {
  return [...new Set((layers || []).map((l) => l.track))].sort((a, b) => a - b);
}

/** The next free track on top of everything. */
export function topTrack(layers: Layer[] | undefined): number {
  return Math.max(0, ...tracksOf(layers)) + 1;
}

/** Layers in drawing order: lower tracks first, so higher tracks end up on top. */
export function drawOrder<T extends Layer>(layers: T[] | undefined): T[] {
  return [...(layers || [])].map((l, i) => ({ l, i })).sort((a, b) => a.l.track - b.l.track || a.i - b.i).map((x) => x.l);
}

/**
 * Move layer `i` one step up or down in the stacking order.
 * Alone on its track, it swaps places with the neighbouring track. Sharing a track, it is lifted onto a new
 * track of its own just above (or dropped just below) the layers it shared with. Tracks stay numbered 1..n.
 */
export function moveTrack<T extends Layer>(layers: T[], i: number, by: 1 | -1): T[] {
  const cur = layers[i];
  if (!cur) return layers;
  const used = tracksOf(layers);
  const t = cur.track;
  const pos = used.indexOf(t);
  const alone = layers.filter((l) => l.track === t).length === 1;
  let next: T[];
  if (alone) {
    const other = used[pos + by];
    if (other === undefined) return layers; // already at the top or the bottom
    next = layers.map((l) => (l.track === t ? { ...l, track: other } : l.track === other ? { ...l, track: t } : l));
  } else if (by === 1) {
    next = layers.map((l, j) => (j === i ? { ...l, track: t + 1 } : l.track > t ? { ...l, track: l.track + 1 } : l));
  } else {
    next = layers.map((l, j) => (j === i ? l : l.track >= t ? { ...l, track: l.track + 1 } : l));
  }
  const order = tracksOf(next); // close gaps so the timeline never shows empty lanes
  return next.map((l) => ({ ...l, track: order.indexOf(l.track) + 1 }));
}

/** A new layer for an added file, starting at source time `at` on a fresh top track. */
export function newLayer(layers: Layer[] | undefined, src: string, kind: LayerKind, at: number, seconds: number): Layer {
  const len = kind === "image" ? 3 : Math.max(0.5, seconds || 3);
  return { kind, src, track: topTrack(layers), start: Math.round(at * 1000) / 1000, end: Math.round((at + len) * 1000) / 1000 };
}
