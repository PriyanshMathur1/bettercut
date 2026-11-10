// Motion effect library. Three families:
//  - camera:     moves applied to the footage across a time range (punch-in, shake, push...)
//  - transition: short effects centred on a moment, usually a cut (flash, whip, glitch...)
//  - entrance:   how an overlay / title / sticker arrives (pop, slide, drop...)
// Every effect is a pure function of normalised progress p (0..1) and intensity,
// returning CSS transform/filter/opacity plus an optional full-frame layer.

import { Easing } from "remotion";

export interface FX {
  transform?: string;
  filter?: string;
  opacity?: number;
  /** Full-frame layer drawn above the footage. */
  layer?: { background: string; opacity: number; mixBlendMode?: string; transform?: string };
  /** Horizontal / vertical bars (shutter, cinema) as fraction of frame each. */
  bars?: { v?: number; h?: number; color: string };
  /** Chromatic split offset in px. */
  rgb?: number;
  clipPath?: string;
}

export type EffectFamily = "camera" | "transition" | "entrance";

export interface EffectDef {
  id: string;
  name: string;
  family: EffectFamily;
  /** Default duration in seconds. */
  duration: number;
  fn: (p: number, intensity: number) => FX;
}

const outC = Easing.out(Easing.cubic);
const inOut = Easing.inOut(Easing.cubic);
const outBack = Easing.out(Easing.back(1.6));
const outExpo = Easing.out(Easing.exp);
const bell = (p: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
const noise = (p: number, f: number, seed = 1) =>
  Math.sin(p * f * 6.283 + seed) * 0.6 + Math.sin(p * f * 2.7 * 6.283 + seed * 3) * 0.4;

const E = (id: string, name: string, family: EffectFamily, duration: number, fn: EffectDef["fn"]): EffectDef => ({ id, name, family, duration, fn });

export const EFFECTS: EffectDef[] = [
  // ---- camera (range effects) ---------------------------------------------
  E("punch-in", "Punch In", "camera", 0.35, (p, i) => ({ transform: `scale(${1 + 0.12 * i * (1 - outC(p)) + 0.0})` })),
  E("punch-hold", "Punch & Hold", "camera", 1.2, (p, i) => ({ transform: `scale(${1 + 0.18 * i * outBack(Math.min(1, p * 4))})` })),
  E("punch-out", "Punch Out", "camera", 0.4, (p, i) => ({ transform: `scale(${1 + 0.2 * i * (1 - outC(p))})` })),
  E("slow-push", "Slow Push", "camera", 3, (p, i) => ({ transform: `scale(${1 + 0.07 * i * inOut(p)})` })),
  E("slow-pull", "Slow Pull", "camera", 3, (p, i) => ({ transform: `scale(${1.08 + 0.0 - 0.07 * i * inOut(p)})` })),
  E("ken-burns-left", "Pan Left", "camera", 3, (p, i) => ({ transform: `scale(1.12) translateX(${(0.5 - p) * 60 * i}px)` })),
  E("ken-burns-right", "Pan Right", "camera", 3, (p, i) => ({ transform: `scale(1.12) translateX(${(p - 0.5) * 60 * i}px)` })),
  E("drift-up", "Drift Up", "camera", 3, (p, i) => ({ transform: `scale(1.08) translateY(${(0.5 - p) * 50 * i}px)` })),
  E("drift-down", "Drift Down", "camera", 3, (p, i) => ({ transform: `scale(1.08) translateY(${(p - 0.5) * 50 * i}px)` })),
  E("shake-light", "Shake Light", "camera", 0.5, (p, i) => ({ transform: `translate(${noise(p, 9, 1) * 8 * i * (1 - p)}px, ${noise(p, 11, 2) * 8 * i * (1 - p)}px) scale(1.03)` })),
  E("shake-hard", "Shake Hard", "camera", 0.45, (p, i) => ({ transform: `translate(${noise(p, 14, 1) * 26 * i * (1 - p)}px, ${noise(p, 17, 2) * 22 * i * (1 - p)}px) rotate(${noise(p, 9, 3) * 2 * i * (1 - p)}deg) scale(1.08)` })),
  E("handheld", "Handheld", "camera", 4, (p, i) => ({ transform: `translate(${noise(p, 1.3, 1) * 7 * i}px, ${noise(p, 1.1, 4) * 6 * i}px) rotate(${noise(p, 0.9, 7) * 0.5 * i}deg) scale(1.04)` })),
  E("dutch-left", "Dutch Tilt Left", "camera", 1.5, (p, i) => ({ transform: `rotate(${-5 * i * outC(Math.min(1, p * 3))}deg) scale(${1 + 0.12 * i})` })),
  E("dutch-right", "Dutch Tilt Right", "camera", 1.5, (p, i) => ({ transform: `rotate(${5 * i * outC(Math.min(1, p * 3))}deg) scale(${1 + 0.12 * i})` })),
  E("heartbeat", "Heartbeat", "camera", 0.6, (p, i) => ({ transform: `scale(${1 + 0.08 * i * (bell(p * 2) * (p < 0.5 ? 1 : 0.6))})` })),
  E("bounce-zoom", "Bounce Zoom", "camera", 0.7, (p, i) => ({ transform: `scale(${1 + 0.15 * i * Math.exp(-5 * p) * Math.cos(p * 18)})` })),
  E("spin-in", "Spin In", "camera", 0.5, (p, i) => ({ transform: `rotate(${(1 - outExpo(p)) * 25 * i}deg) scale(${1 + (1 - outExpo(p)) * 0.4 * i})` })),
  E("zoom-face", "Zoom To Face", "camera", 1.2, (p, i) => ({ transform: `scale(${1 + 0.35 * i * outC(Math.min(1, p * 2))}) translateY(${8 * i * outC(Math.min(1, p * 2))}%)` })),
  E("crash-zoom", "Crash Zoom", "camera", 0.5, (p, i) => ({ transform: `scale(${1 + 0.45 * i * outExpo(Math.min(1, p * 3))})`, filter: `blur(${bell(Math.min(1, p * 3)) * 6 * i}px)` })),
  E("breathe", "Breathe", "camera", 4, (p, i) => ({ transform: `scale(${1.03 + 0.03 * i * Math.sin(p * 6.283)})` })),
  E("mirror", "Mirror Flip", "camera", 1, () => ({ transform: "scaleX(-1)" })),

  // ---- transitions (centred on a moment) -----------------------------------
  E("flash-white", "Flash White", "transition", 0.3, (p, i) => ({ layer: { background: "#FFFFFF", opacity: bell(p) * 0.95 * i } })),
  E("flash-black", "Dip To Black", "transition", 0.35, (p, i) => ({ layer: { background: "#000000", opacity: bell(p) * i } })),
  E("flash-brand", "Brand Flash", "transition", 0.3, (p, i) => ({ layer: { background: "var(--brand-primary)", opacity: bell(p) * 0.9 * i } })),
  E("zoom-blur", "Zoom Blur", "transition", 0.35, (p, i) => ({ transform: `scale(${1 + bell(p) * 0.35 * i})`, filter: `blur(${bell(p) * 14 * i}px)` })),
  E("whip-left", "Whip Left", "transition", 0.3, (p, i) => ({ transform: `translateX(${(p < 0.5 ? -p : 1 - p) * 2 * 60 * i}%) skewX(${bell(p) * 12 * i}deg)`, filter: `blur(${bell(p) * 22 * i}px)` })),
  E("whip-right", "Whip Right", "transition", 0.3, (p, i) => ({ transform: `translateX(${(p < 0.5 ? p : p - 1) * 2 * 60 * i}%) skewX(${-bell(p) * 12 * i}deg)`, filter: `blur(${bell(p) * 22 * i}px)` })),
  E("whip-up", "Whip Up", "transition", 0.3, (p, i) => ({ transform: `translateY(${(p < 0.5 ? -p : 1 - p) * 2 * 50 * i}%)`, filter: `blur(${bell(p) * 22 * i}px)` })),
  E("whip-down", "Whip Down", "transition", 0.3, (p, i) => ({ transform: `translateY(${(p < 0.5 ? p : p - 1) * 2 * 50 * i}%)`, filter: `blur(${bell(p) * 22 * i}px)` })),
  E("glitch", "Glitch", "transition", 0.35, (p, i) => {
    const on = bell(p) > 0.2;
    return { transform: on ? `translate(${noise(p, 23, 1) * 30 * i}px, ${noise(p, 19, 5) * 6 * i}px) skewX(${noise(p, 13, 2) * 8 * i}deg)` : undefined, rgb: on ? 14 * i * bell(p) : 0, filter: on ? `contrast(${1 + 0.4 * bell(p)}) saturate(${1 + bell(p)})` : undefined };
  }),
  E("rgb-split", "RGB Split", "transition", 0.4, (p, i) => ({ rgb: bell(p) * 18 * i })),
  E("blur-cross", "Blur Cross", "transition", 0.4, (p, i) => ({ filter: `blur(${bell(p) * 18 * i}px) brightness(${1 + bell(p) * 0.2})` })),
  E("light-leak", "Light Leak", "transition", 0.7, (p, i) => ({
    layer: { background: "radial-gradient(circle at 20% 30%, rgba(255,170,60,.95), rgba(255,80,60,.6) 35%, transparent 70%)", opacity: bell(p) * i, mixBlendMode: "screen", transform: `translateX(${(p - 0.5) * 40}%)` },
  })),
  E("film-burn", "Film Burn", "transition", 0.6, (p, i) => ({
    layer: { background: "radial-gradient(ellipse at 70% 60%, rgba(255,240,200,1), rgba(255,120,30,.85) 30%, rgba(120,0,0,.4) 60%, transparent 80%)", opacity: bell(p) * i, mixBlendMode: "screen" },
    filter: `saturate(${1 + bell(p)})`,
  })),
  E("iris", "Iris", "transition", 0.45, (p, i) => ({ layer: { background: `radial-gradient(circle, transparent ${Math.max(0, 70 - bell(p) * 70 * i)}%, #000 ${Math.max(1, 71 - bell(p) * 70 * i)}%)`, opacity: 1 } })),
  E("shutter", "Shutter", "transition", 0.35, (p, i) => ({ bars: { h: bell(p) * 0.5 * i, color: "#000" } })),
  E("barn-doors", "Barn Doors", "transition", 0.35, (p, i) => ({ bars: { v: bell(p) * 0.5 * i, color: "#000" } })),
  E("strobe", "Strobe", "transition", 0.4, (p, i) => ({ layer: { background: "#FFF", opacity: Math.floor(p * 8) % 2 === 0 ? 0.7 * i * (1 - p) : 0 } })),
  E("invert-flash", "Invert Flash", "transition", 0.2, (p) => ({ filter: bell(p) > 0.4 ? "invert(1)" : undefined })),
  E("mono-flash", "Mono Hit", "transition", 0.4, (p) => ({ filter: `grayscale(${bell(p)}) contrast(${1 + 0.5 * bell(p)})` })),
  E("vhs", "VHS", "transition", 0.5, (p, i) => ({ rgb: bell(p) * 8 * i, filter: `saturate(${1 + bell(p)}) contrast(${1 + 0.2 * bell(p)})`, transform: `translateY(${Math.floor(p * 10) % 2 ? 4 * i : 0}px)` })),
  E("zoom-through", "Zoom Through", "transition", 0.4, (p, i) => ({ transform: `scale(${p < 0.5 ? 1 + p * 1.6 * i : 1 + (1 - p) * 0.6 * i})`, opacity: 1 - bell(p) * 0.4 })),
  E("spin-cut", "Spin Cut", "transition", 0.4, (p, i) => ({ transform: `rotate(${(p < 0.5 ? p : p - 1) * 2 * 30 * i}deg) scale(${1 + bell(p) * 0.3})`, filter: `blur(${bell(p) * 10 * i}px)` })),

  // ---- entrances (overlays, titles, stickers) -------------------------------
  E("pop", "Pop", "entrance", 0.35, (p) => ({ transform: `scale(${outBack(p)})`, opacity: Math.min(1, p * 3) })),
  E("fade", "Fade", "entrance", 0.3, (p) => ({ opacity: outC(p) })),
  E("slide-up", "Slide Up", "entrance", 0.4, (p) => ({ transform: `translateY(${(1 - outC(p)) * 120}px)`, opacity: outC(p) })),
  E("slide-down", "Slide Down", "entrance", 0.4, (p) => ({ transform: `translateY(${-(1 - outC(p)) * 120}px)`, opacity: outC(p) })),
  E("slide-left", "Slide In Left", "entrance", 0.4, (p) => ({ transform: `translateX(${-(1 - outC(p)) * 140}%)` })),
  E("slide-right", "Slide In Right", "entrance", 0.4, (p) => ({ transform: `translateX(${(1 - outC(p)) * 140}%)` })),
  E("drop-bounce", "Drop Bounce", "entrance", 0.6, (p) => ({ transform: `translateY(${-(1 - Easing.bounce(p)) * 300}px)`, opacity: Math.min(1, p * 4) })),
  E("spin-pop", "Spin Pop", "entrance", 0.45, (p) => ({ transform: `rotate(${(1 - outBack(p)) * -180}deg) scale(${outBack(p)})` })),
  E("stretch-in", "Stretch", "entrance", 0.4, (p) => ({ transform: `scaleX(${1.6 - 0.6 * outBack(p)}) scaleY(${outBack(p)})` })),
  E("blur-in", "Blur In", "entrance", 0.4, (p) => ({ filter: `blur(${(1 - outC(p)) * 24}px)`, transform: `scale(${1.2 - 0.2 * outC(p)})`, opacity: outC(p) })),
  E("flip-x", "Flip X", "entrance", 0.45, (p) => ({ transform: `perspective(900px) rotateX(${(1 - outBack(p)) * 90}deg)`, opacity: Math.min(1, p * 2) })),
  E("flip-y", "Flip Y", "entrance", 0.45, (p) => ({ transform: `perspective(900px) rotateY(${(1 - outBack(p)) * 90}deg)`, opacity: Math.min(1, p * 2) })),
  E("scale-down", "Slam", "entrance", 0.3, (p) => ({ transform: `scale(${3 - 2 * outExpo(p)})`, opacity: Math.min(1, p * 2.5) })),
  E("elastic", "Elastic", "entrance", 0.8, (p) => ({ transform: `scale(${1 - Math.exp(-6 * p) * Math.cos(p * 20)})` })),
  E("wiggle", "Wiggle", "entrance", 0.6, (p) => ({ transform: `rotate(${Math.exp(-4 * p) * Math.sin(p * 30) * 12}deg) scale(${outBack(Math.min(1, p * 2))})` })),
  E("swing", "Swing", "entrance", 0.7, (p) => ({ transform: `perspective(800px) rotateX(${Math.exp(-4 * p) * Math.cos(p * 14) * 70}deg)`, opacity: Math.min(1, p * 3) })),
  E("wipe-in", "Wipe In", "entrance", 0.5, (p) => ({ clipPath: `inset(0 ${(1 - outC(p)) * 100}% 0 0)` })),
  E("reveal-up", "Mask Reveal", "entrance", 0.5, (p) => ({ clipPath: `inset(${(1 - outC(p)) * 100}% 0 0 0)`, transform: `translateY(${(1 - outC(p)) * 30}px)` })),
];

export const EFFECT_MAP: Record<string, EffectDef> = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));
export const effectsByFamily = (f: EffectFamily) => EFFECTS.filter((e) => e.family === f);

/** Compose several FX results into one. */
export function combineFX(list: FX[]): FX {
  const out: FX = {};
  const transforms: string[] = [];
  const filters: string[] = [];
  let opacity = 1;
  let rgb = 0;
  for (const f of list) {
    if (f.transform) transforms.push(f.transform);
    if (f.filter) filters.push(f.filter);
    if (f.opacity !== undefined) opacity *= f.opacity;
    if (f.rgb) rgb = Math.max(rgb, f.rgb);
    if (f.layer) out.layer = f.layer;
    if (f.bars) out.bars = f.bars;
    if (f.clipPath) out.clipPath = f.clipPath;
  }
  if (transforms.length) out.transform = transforms.join(" ");
  if (filters.length) out.filter = filters.join(" ");
  out.opacity = opacity;
  if (rgb) out.rgb = rgb;
  return out;
}
