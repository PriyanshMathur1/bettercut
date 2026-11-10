// The editor's layout rules, kept free of React so they run under `node --test`.
//
// There is one editor with every feature in it: an icon rail on the left that opens the media bin and
// the style panels, the preview with a transport bar and an Ask AI bar, an inspector on the right, and
// the timeline along the bottom.

/** Every left-panel tab, in Pro's order. */
export const TABS = ["Looks", "Captions", "Format", "Motion", "Titles", "Colour", "Overlays", "B-roll", "Audio", "Brand", "Mimic"] as const;
export type Tab = (typeof TABS)[number];

export type RailIcon = "looks" | "captions" | "graphics" | "media" | "audio" | "effects" | "format" | "mimic";

export interface RailGroup {
  id: RailIcon;
  label: string;
  /** One-line description, shown as the button's tooltip. */
  hint: string;
  /** The panels this button opens; more than one shows as sub-tabs. */
  tabs: Tab[];
}

/** The icon rail. Every tab in TABS sits in exactly one group; Media also holds the clip bin. */
export const RAIL: readonly RailGroup[] = [
  { id: "media", label: "Media", hint: "Your clips, layers and sound, and b-roll cutaways", tabs: ["B-roll"] },
  { id: "looks", label: "Looks", hint: "One-click styles: captions, grade, motion and titles together", tabs: ["Looks"] },
  { id: "captions", label: "Captions", hint: "Caption style, size, position and translated captions", tabs: ["Captions"] },
  { id: "graphics", label: "Graphics", hint: "Opening titles and animated overlays", tabs: ["Titles", "Overlays"] },
  { id: "audio", label: "Audio", hint: "Music, voice clean-up, loudness and sound effects", tabs: ["Audio"] },
  { id: "effects", label: "Effects", hint: "Camera motion, colour grades and LUTs", tabs: ["Motion", "Colour"] },
  { id: "format", label: "Format", hint: "Layout, framing, green screen and your brand", tabs: ["Format", "Brand"] },
  { id: "mimic", label: "Mimic", hint: "Copy the look of a reference reel", tabs: ["Mimic"] },
];

/** The rail with only the tabs this editor offers (the cloud has no Mimic); empty groups drop out. */
export function railFor(available: readonly string[], rail: readonly RailGroup[] = RAIL): RailGroup[] {
  return rail.map((g) => ({ ...g, tabs: g.tabs.filter((t) => available.includes(t)) })).filter((g) => g.tabs.length);
}

/** The rail group a tab belongs to, so switching from Pro opens the right button. */
export function groupOf(tab: string, rail: readonly RailGroup[]): RailGroup | undefined {
  return rail.find((g) => (g.tabs as string[]).includes(tab));
}

/** The tab to keep open: the current one if it is shown, else the first shown. */
export function keepTab<T extends string>(current: T, shown: readonly T[]): T {
  return shown.includes(current) ? current : shown[0] ?? current;
}

/** Frame sizes of the standard shapes (the twin of bettercut/shape.py). */
export const SHAPE_SIZES: Record<string, [number, number]> = { "9x16": [1080, 1920], "4x5": [1080, 1350], "1x1": [1080, 1080], "16x9": [1920, 1080] };

/** The standard shape closest to a frame of this size; a project with no size is a 9:16 reel. */
export function shapeOf(width?: number, height?: number): string {
  if (!width || !height || width <= 0 || height <= 0) return "9x16";
  const ratio = width / height;
  let best = "9x16";
  let gap = Infinity;
  for (const [id, [w, h]] of Object.entries(SHAPE_SIZES)) {
    const d = Math.abs(w / h - ratio);
    if (d < gap) [best, gap] = [id, d];
  }
  return best;
}

/** Toggle one render shape, never leaving none chosen. */
export function toggleShape(chosen: readonly string[], shape: string): string[] {
  if (!chosen.includes(shape)) return [...chosen, shape];
  return chosen.length > 1 ? chosen.filter((s) => s !== shape) : [...chosen];
}

/** Notes to send when you press Ask: everything queued, plus what is in the bar (about the whole reel). */
export function askNotes<N extends { t: number | null; text: string }>(queued: readonly N[], typed: string): { t: number | null; text: string }[] {
  const text = typed.trim();
  return text ? [...queued, { t: null, text }] : [...queued];
}

/** The sub-tab that shows the clip bin inside the Media rail button. */
export const BIN = "Clips";

/** Sub-tabs of a rail button: its panels, with the clip bin first under Media. One entry means no tab strip. */
export function subTabs(group: RailGroup): string[] {
  return group.id === "media" ? [BIN, ...group.tabs] : [...group.tabs];
}

export type BinKind = "clip" | "video" | "image" | "audio" | "voice" | "music";

export interface BinItem {
  kind: BinKind;
  name: string;
  /** File to preview (thumbnails), when there is one. */
  src?: string;
  /** Where it sits in the footage, in SOURCE seconds; null for music, which plays under everything. */
  start: number | null;
  seconds: number;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

interface BinSpec {
  source: { src: string; duration: number };
  layers?: { kind: string; src: string; start: number; end: number }[];
  voiceovers?: { src: string; start: number; end: number }[];
  audio?: { music?: string };
}

/**
 * Everything in a project, for the media bin: the clips its footage was built from, then layers,
 * voiceovers and music. A project with no clip list (made by an older version) shows its footage as one clip.
 */
export function binItems(clips: readonly { name: string; start: number; seconds: number }[] | undefined, spec: BinSpec): BinItem[] {
  const footage: BinItem[] = clips?.length
    ? clips.map((c) => ({ kind: "clip", name: c.name, src: spec.source.src, start: c.start, seconds: c.seconds }))
    : [{ kind: "clip", name: "Footage", src: spec.source.src, start: 0, seconds: spec.source.duration }];
  const layers: BinItem[] = (spec.layers || []).map((l) => ({
    kind: l.kind === "image" ? "image" : l.kind === "audio" ? "audio" : "video",
    name: baseName(l.src),
    src: l.src,
    start: l.start,
    seconds: Math.max(0, l.end - l.start),
  }));
  const voices: BinItem[] = (spec.voiceovers || []).map((v, i) => ({ kind: "voice", name: `Voiceover ${i + 1}`, src: v.src, start: v.start, seconds: Math.max(0, v.end - v.start) }));
  const music: BinItem[] = spec.audio?.music ? [{ kind: "music", name: baseName(spec.audio.music), src: spec.audio.music, start: null, seconds: 0 }] : [];
  return [...footage, ...layers, ...voices, ...music];
}

/** Timecode as editors read it: hours, minutes, seconds and frames. */
export function timecode(t: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps));
  const frames = Math.max(0, Math.round(t * rate));
  const two = (n: number) => String(n).padStart(2, "0");
  const secs = Math.floor(frames / rate);
  return `${two(Math.floor(secs / 3600))}:${two(Math.floor(secs / 60) % 60)}:${two(secs % 60)}:${two(frames % rate)}`;
}

/** The nearest cut before `t` (or the start), for the transport's previous-cut button. */
export function cutBefore(cuts: readonly number[], t: number, slack = 0.05): number {
  let best = 0;
  for (const c of cuts) if (c < t - slack && c > best) best = c;
  return best;
}

/** The nearest cut after `t` (or the end). */
export function cutAfter(cuts: readonly number[], t: number, end: number, slack = 0.05): number {
  let best = end;
  for (const c of cuts) if (c > t + slack && c < best) best = c;
  return best;
}
