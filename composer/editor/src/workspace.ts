// Simple and Pro workspaces. Kept free of React so it runs under `node --test`.
//
// Both workspaces have every feature. Pro is the dense layout: a tab list on the left and every
// render control in the header. Simple is the easy-to-reach layout: an icon rail that groups the
// same panels, a big preview with an Ask AI bar under it, a Project card on the right and one
// Export menu. Switching never changes the edit.

export type Workspace = "simple" | "pro";

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

/** Simple's icon rail. Every tab in TABS sits in exactly one group. */
export const RAIL: readonly RailGroup[] = [
  { id: "looks", label: "Looks", hint: "One-click styles: captions, grade, motion and titles together", tabs: ["Looks"] },
  { id: "captions", label: "Captions", hint: "Caption style, size, position and translated captions", tabs: ["Captions"] },
  { id: "graphics", label: "Graphics", hint: "Opening titles and animated overlays", tabs: ["Titles", "Overlays"] },
  { id: "media", label: "Media", hint: "B-roll cutaways over your footage", tabs: ["B-roll"] },
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

export const STORAGE_KEY = "bc.workspace";

/** Minimal Storage, so tests can pass a fake and a blocked localStorage doesn't break the editor. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The saved workspace. New users start in Simple; anything unreadable also means Simple. */
export function readWorkspace(store: KeyStore | undefined): Workspace {
  try {
    return store?.getItem(STORAGE_KEY) === "pro" ? "pro" : "simple";
  } catch {
    return "simple";
  }
}

export function writeWorkspace(store: KeyStore | undefined, ws: Workspace): void {
  try {
    store?.setItem(STORAGE_KEY, ws);
  } catch {
    // private window or blocked storage: the choice just isn't remembered
  }
}
