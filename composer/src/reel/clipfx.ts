// Effects you stack on a clip (a shot or a media layer). Pure functions, no runtime imports.
//
// Each effect has a strength, `amount`, from 0 to 1. They are applied in list order, like layers of glass:
// "black & white" then "glow" is not the same picture as "glow" then "black & white".
// Three families, by how they are drawn:
//   css   - a CSS filter function (blur, black & white, contrast...)
//   svg   - an SVG filter the picture is passed through (glow, colour fringing, duotone)
//   over  - a layer drawn on top of the picture (film grain, vignette)

export interface ClipEffect {
  type: string;
  /** Strength, 0..1. Each effect has its own default. */
  amount?: number;
  /** Duotone: the colour for shadows and the colour for highlights. */
  color?: string;
  color2?: string;
}

export type FxFamily = "css" | "svg" | "over";

export interface FxDef {
  id: string;
  name: string;
  family: FxFamily;
  /** Strength used when the effect is first added. */
  amount: number;
}

export const CLIP_FX: FxDef[] = [
  { id: "blur", name: "Blur", family: "css", amount: 0.3 },
  { id: "bw", name: "Black & white", family: "css", amount: 1 },
  { id: "sepia", name: "Sepia", family: "css", amount: 0.7 },
  { id: "brighten", name: "Brighten", family: "css", amount: 0.3 },
  { id: "darken", name: "Darken", family: "css", amount: 0.3 },
  { id: "contrast", name: "More contrast", family: "css", amount: 0.4 },
  { id: "fade", name: "Faded", family: "css", amount: 0.4 },
  { id: "saturate", name: "More colour", family: "css", amount: 0.4 },
  { id: "hue", name: "Shift colours", family: "css", amount: 0.25 },
  { id: "invert", name: "Invert", family: "css", amount: 1 },
  { id: "glow", name: "Glow", family: "svg", amount: 0.5 },
  { id: "fringe", name: "Colour fringing", family: "svg", amount: 0.4 },
  { id: "duotone", name: "Duotone", family: "svg", amount: 1 },
  { id: "grain", name: "Film grain", family: "over", amount: 0.5 },
  { id: "vignette", name: "Vignette", family: "over", amount: 0.5 },
];

export const FX_MAP: Record<string, FxDef> = Object.fromEntries(CLIP_FX.map((f) => [f.id, f]));

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const n = (v: number, d = 3) => Number(v.toFixed(d));

/** Strength of an effect, 0..1 (its default when unset). Unknown effects have no strength. */
export function amountOf(e: ClipEffect): number {
  const def = FX_MAP[e.type];
  if (!def) return 0;
  return clamp01(typeof e.amount === "number" && Number.isFinite(e.amount) ? e.amount : def.amount);
}

/** The effects that actually do something, in order. */
export function activeFx(effects: ClipEffect[] | undefined): ClipEffect[] {
  return (effects || []).filter((e) => FX_MAP[e.type] && amountOf(e) > 0);
}

/** One CSS filter function for a css-family effect. `k` scales pixel sizes with the frame (1 at 1080 wide). */
export function cssFunction(e: ClipEffect, k: number): string {
  const a = amountOf(e);
  switch (e.type) {
    case "blur":
      return `blur(${n(a * 30 * k, 2)}px)`;
    case "bw":
      return `grayscale(${n(a)})`;
    case "sepia":
      return `sepia(${n(a)})`;
    case "brighten":
      return `brightness(${n(1 + a)})`;
    case "darken":
      return `brightness(${n(1 - a * 0.8)})`;
    case "contrast":
      return `contrast(${n(1 + a)})`;
    case "fade":
      return `contrast(${n(1 - a * 0.6)}) brightness(${n(1 + a * 0.12)})`;
    case "saturate":
      return `saturate(${n(1 + a * 1.5)})`;
    case "hue":
      return `hue-rotate(${n(a * 360, 1)}deg)`;
    case "invert":
      return `invert(${n(a)})`;
    default:
      return "";
  }
}

/** The id of the SVG filter for the effect at position `i` of a clip. */
export const fxId = (uid: string, i: number) => `fx-${uid}-${i}`;

/**
 * The CSS `filter` value for a clip: css effects as functions and svg effects as references, in list order.
 * `uid` must be unique to the clip, and match the one given to the component that defines the SVG filters.
 */
export function filterFor(effects: ClipEffect[] | undefined, k: number, uid: string): string {
  const parts: string[] = [];
  (effects || []).forEach((e, i) => {
    const def = FX_MAP[e.type];
    if (!def || amountOf(e) <= 0) return;
    if (def.family === "css") parts.push(cssFunction(e, k));
    else if (def.family === "svg") parts.push(`url(#${fxId(uid, i)})`);
  });
  return parts.filter(Boolean).join(" ");
}

/** "#RRGGBB" or "#RGB" as three 0..1 numbers; black for anything else. */
export function rgb01(hex: string | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return [0, 0, 0];
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => n(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
}

export const DUOTONE_DEFAULT: [string, string] = ["#1B1464", "#FFD23F"];

/** The numbers each svg-family effect needs, so the component that draws them stays trivial. */
export function svgSpec(e: ClipEffect, k: number) {
  const a = amountOf(e);
  if (e.type === "glow") return { type: "glow" as const, blur: n(4 + a * 28 * k, 2), gain: n(1 + a * 0.6) };
  if (e.type === "fringe") return { type: "fringe" as const, shift: n(a * 16 * k, 2) };
  if (e.type === "duotone") return { type: "duotone" as const, mix: n(a), dark: rgb01(e.color || DUOTONE_DEFAULT[0]), light: rgb01(e.color2 || DUOTONE_DEFAULT[1]) };
  return null;
}

/** Layers drawn over the picture, with their opacity. */
export function overlaysFor(effects: ClipEffect[] | undefined): { type: "grain" | "vignette"; amount: number }[] {
  return activeFx(effects)
    .filter((e) => FX_MAP[e.type].family === "over")
    .map((e) => ({ type: e.type as "grain" | "vignette", amount: amountOf(e) }));
}

// ---- editing ---------------------------------------------------------------------------

/** Add an effect at its default strength, on top of the others. */
export function addFx(effects: ClipEffect[] | undefined, type: string): ClipEffect[] {
  const def = FX_MAP[type];
  if (!def) return [...(effects || [])];
  const e: ClipEffect = { type, amount: def.amount };
  if (type === "duotone") [e.color, e.color2] = DUOTONE_DEFAULT;
  return [...(effects || []), e];
}

export function setFx(effects: ClipEffect[] | undefined, i: number, patch: Partial<ClipEffect>): ClipEffect[] {
  return (effects || []).map((e, j) => (j === i ? { ...e, ...patch, ...(patch.amount !== undefined ? { amount: n(clamp01(patch.amount)) } : {}) } : e));
}

export function removeFx(effects: ClipEffect[] | undefined, i: number): ClipEffect[] {
  return (effects || []).filter((_, j) => j !== i);
}
