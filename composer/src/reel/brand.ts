import type { BrandKit } from "./types";

export const DEFAULT_BRAND: BrandKit = {
  name: "Your Name",
  handle: "yourhandle",
  primary: "#3D5AFE",
  accent: "#FFD23F",
  text: "#FFFFFF",
  ink: "#0E0F13",
  background: "#F4F1EA",
  headingFont: "Montserrat",
  bodyFont: "Inter",
  serifFont: "Instrument Serif",
};

/** Resolve "$primary"-style brand tokens to colours. */
export function tok(value: string | undefined, brand: BrandKit, fallback = "#FFFFFF"): string {
  if (!value) return fallback;
  switch (value) {
    case "$primary":
      return brand.primary;
    case "$accent":
      return brand.accent;
    case "$text":
      return brand.text;
    case "$ink":
      return brand.ink;
    case "$bg":
      return brand.background;
    default:
      return value;
  }
}

export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Size factor relative to the 1080x1920 design frame, by area so square/landscape stay balanced. */
export const kOf = (w: number, h: number) => Math.sqrt((w * h) / (1080 * 1920));

/** Deterministic pseudo-random in [-1, 1] from an integer seed. */
export function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
