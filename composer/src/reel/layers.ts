// Media layers: extra video, images and audio on their own tracks above the main footage.
// Pure functions (editor, renderer, tests); the only runtime import is the pure keyframes module.
//
// A layer is timed like an overlay: `start`/`end` are SOURCE seconds of the main footage, so it follows
// cuts and reordering. `track` orders the picture (higher tracks are drawn on top). Position and size are
// fractions of the frame, so one layer looks the same in every aspect ratio.

import type { ClipEffect } from "./clipfx";
import type { Mask } from "./masks";
import { setKey, type Key } from "./keyframes.ts"; // explicit extension: this file also runs under `node --test`

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
  /** Length of the layer's file in seconds (video and audio), when known. The layer never plays past it. */
  media?: number;
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
  /** Effects stacked on this layer, applied in order. */
  effects?: ClipEffect[];
  /** Show only part of the layer: a shape inside its box. */
  mask?: Mask;
}

const IMAGE = /\.(png|jpe?g|webp|gif|avif|svg|bmp)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
/** Image types a browser, and so the renderer, cannot draw. */
const UNSHOWABLE = /\.(heic|heif|tiff?|raw|cr2|nef|arw|dng|psd)$/i;

/**
 * What kind of layer a file makes. The file's own type (its MIME type, when the browser knows it) decides;
 * the name is the fallback. A recording with sound only (audio/webm) is audio even though .webm is a video name.
 */
export function kindOf(name: string, mime?: string): LayerKind {
  const type = (mime || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  const clean = name.split("?")[0];
  if (IMAGE.test(clean) || UNSHOWABLE.test(clean)) return "image";
  if (AUDIO.test(clean)) return "audio";
  return "video";
}

/** Why this file can't be a layer, or null when it can. */
export function layerProblem(name: string, mime?: string): string | null {
  const clean = name.split("?")[0];
  if (UNSHOWABLE.test(clean) || /^image\/(heic|heif|tiff)/i.test(mime || "")) return "This kind of image can't be shown in a browser. Save it as JPG or PNG and add that.";
  return null;
}

/** Values a layer has before any keyframes. */
export function layerBase(l: Layer) {
  return { x: l.x ?? 0.5, y: l.y ?? 0.5, scale: l.scale ?? (l.kind === "audio" ? 1 : 0.6), rotate: l.rotate ?? 0, opacity: l.opacity ?? 1 };
}

/** Seconds of its file a layer can still play from where it starts, or Infinity when unknown or an image. */
export function playable(l: Layer): number {
  if (l.kind === "image" || !l.media || l.media <= 0) return Infinity;
  return Math.max(0, l.media - (l.from ?? 0));
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
  const used = new Set((layers || []).map((l) => l.id));
  let n = (layers || []).length + 1;
  while (used.has(`m${n}`)) n++;
  const layer: Layer = { id: `m${n}`, kind, src, track: topTrack(layers), start: Math.round(at * 1000) / 1000, end: Math.round((at + len) * 1000) / 1000 };
  if (kind !== "image" && seconds > 0) layer.media = Math.round(seconds * 1000) / 1000;
  return layer;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * A clip from the footage, laid over the video as a layer on a fresh top track, starting at source time
 * `at`. It plays that clip's stretch of the footage file (`from` is where the clip begins in it) and never
 * past the clip's end. It fills the frame like a cutaway; resize it in the inspector.
 */
export function clipLayer(layers: Layer[] | undefined, src: string, clip: { start: number; seconds: number }, at: number): Layer {
  const layer = newLayer(layers, src, "video", at, clip.seconds);
  return { ...layer, from: r3(clip.start), media: r3(clip.start + clip.seconds), scale: 1 };
}

/**
 * Trim a layer's start the way an editor does: the layer now begins at `start` (SOURCE seconds of the
 * footage) and its own file is entered at `from` seconds, so the media keeps its place instead of
 * restarting. The caller works out `from`, because only it knows how much time on screen the trim removed
 * (footage under the layer may be sped up, slowed or cut). Images have no `from`.
 */
export function trimLayerStart<T extends Layer>(layer: T, start: number, from?: number, minLength = 0.2): T {
  const next = { ...layer, start: r3(Math.max(0, Math.min(start, layer.end - minLength))) };
  if (layer.kind === "image") return next;
  const f = r3(Math.max(0, from ?? layer.from ?? 0));
  if (f > 0) next.from = f;
  else delete next.from;
  return next;
}

/**
 * Put a layer's centre at (x, y) for the moment `at` seconds into its life. A layer whose position is
 * animated gets a keyframe there (or the nearby one is updated); otherwise its resting position changes.
 */
export function placeLayer<T extends Layer>(layer: T, at: number, x: number, y: number): T {
  const cx = r3(Math.min(1.5, Math.max(-0.5, x)));
  const cy = r3(Math.min(1.5, Math.max(-0.5, y)));
  const animated = (layer.keys || []).some((k) => typeof k.x === "number" || typeof k.y === "number");
  return animated ? { ...layer, keys: setKey(layer.keys, at, { x: cx, y: cy }) } : { ...layer, x: cx, y: cy };
}
