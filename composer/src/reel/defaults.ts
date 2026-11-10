import type { ReelSpec } from "./types";
import { DEFAULT_BRAND } from "./brand";

/** A complete spec with every setting at its default; the pipeline fills source/segments/words. */
export const DEFAULT_SPEC: ReelSpec = {
  version: 1,
  title: "Untitled reel",
  look: "bold-pop",
  source: { src: "", width: 1080, height: 1920, duration: 0, fps: 30 },
  segments: [],
  words: [],
  brand: DEFAULT_BRAND,
  format: { id: "full" },
  captions: { enabled: true, style: "bold-pop", position: "lower", scale: 1, wordsPerPage: 3, behindHead: false },
  overlays: [],
  broll: [],
  motion: { autoZoom: "alternate", cutTransition: "punch-in", camera: "none", events: [] },
  grade: { preset: "clean", vignette: 0.25, grain: 0 },
  audio: { musicVolume: 0.22, duck: true, sfx: true, sfxVolume: 0.45, voiceVolume: 1 },
  progressBar: false,
  safeGuide: false,
  fps: 30,
  width: 1080,
  height: 1920,
};

/** Deep-ish merge: objects merge one level down, arrays and scalars replace. */
export function mergeSpec<T extends Record<string, any>>(base: T, patch: Partial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      out[k] = { ...base[k], ...v };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}
