// Caption style library. One rendering engine, many presets: each preset picks a reveal mode,
// an active-word treatment, a word entrance, a container and typography.
// Colours may be literal or brand tokens: "$primary", "$accent", "$text", "$ink", "$bg".

export type Reveal = "page" | "word" | "single";
export type Active =
  | "none"
  | "color"
  | "box"
  | "fill"
  | "underline"
  | "scale"
  | "glow"
  | "outlineFill"
  | "dim"
  | "marker";
export type WordEnter =
  | "none"
  | "pop"
  | "slideUp"
  | "blur"
  | "drop"
  | "type"
  | "flip"
  | "stretch"
  | "bounce"
  | "rise"
  | "spin"
  | "zoomOut";
export type Container = "none" | "pill" | "bubble" | "wordBox" | "bar" | "tape" | "card" | "glass";
export type Layout = "inline" | "stack" | "kinetic";

export interface CaptionStyle {
  id: string;
  name: string;
  group: "Karaoke" | "Pop" | "Box" | "Minimal" | "Kinetic" | "Editorial" | "Fun" | "Retro" | "Neon";
  font: string;
  weight: number;
  size: number;
  uppercase?: boolean;
  italic?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
  color: string;
  highlight: string;
  /** Text stroke (px) and colour. */
  stroke?: number;
  strokeColor?: string;
  shadow?: "none" | "soft" | "hard" | "long" | "glow";
  reveal: Reveal;
  active: Active;
  enter: WordEnter;
  container: Container;
  containerColor?: string;
  layout?: Layout;
  wordsPerPage?: number;
  /** Emphasis words: font, colour and size multiplier. */
  emFont?: string;
  emItalic?: boolean;
  emColor?: string;
  emScale?: number;
  emoji?: boolean;
  /** Random-ish rotation per page in degrees (deterministic). */
  tilt?: number;
}

const s = (id: string, name: string, group: CaptionStyle["group"], p: Omit<CaptionStyle, "id" | "name" | "group">): CaptionStyle => ({
  id,
  name,
  group,
  ...p,
});

const base = { color: "#FFFFFF", shadow: "soft" as const };

export const CAPTION_STYLES: CaptionStyle[] = [
  // ---- Karaoke ------------------------------------------------------------
  s("karaoke-fill", "Karaoke Fill", "Karaoke", { ...base, font: "Montserrat", weight: 900, size: 76, uppercase: true, highlight: "$accent", reveal: "page", active: "fill", enter: "none", container: "none", stroke: 6, strokeColor: "#000" }),
  s("karaoke-sweep", "Sweep", "Karaoke", { ...base, font: "Poppins", weight: 800, size: 72, highlight: "$primary", reveal: "page", active: "fill", enter: "none", container: "pill", containerColor: "rgba(0,0,0,.55)" }),
  s("karaoke-yellow", "Classic Yellow", "Karaoke", { ...base, font: "Inter", weight: 900, size: 74, uppercase: true, highlight: "#FFE14D", reveal: "page", active: "color", enter: "none", container: "none", stroke: 7, strokeColor: "#000" }),
  s("karaoke-green", "Lime Active", "Karaoke", { ...base, font: "Figtree", weight: 900, size: 78, uppercase: true, highlight: "#7CFF6B", reveal: "page", active: "scale", enter: "pop", container: "none", stroke: 6, strokeColor: "#000" }),
  s("karaoke-dim", "Spotlight", "Karaoke", { ...base, font: "Outfit", weight: 800, size: 74, highlight: "#FFFFFF", reveal: "page", active: "dim", enter: "none", container: "none" }),
  s("karaoke-underline", "Underline Run", "Karaoke", { ...base, font: "Sora", weight: 800, size: 70, highlight: "$accent", reveal: "page", active: "underline", enter: "none", container: "none" }),
  s("karaoke-outline", "Outline Fill", "Karaoke", { color: "transparent", font: "Archivo Black", weight: 400, size: 84, uppercase: true, highlight: "#FFFFFF", stroke: 3, strokeColor: "#FFFFFF", reveal: "page", active: "outlineFill", enter: "none", container: "none", shadow: "none" }),
  s("karaoke-glow", "Glow Run", "Karaoke", { ...base, font: "Manrope", weight: 800, size: 70, highlight: "$accent", reveal: "page", active: "glow", enter: "none", container: "none" }),

  // ---- Pop ----------------------------------------------------------------
  s("bold-pop", "Bold Pop", "Pop", { ...base, font: "Montserrat", weight: 900, size: 84, uppercase: true, highlight: "$accent", reveal: "word", active: "color", enter: "pop", container: "none", stroke: 7, strokeColor: "#000", emScale: 1.25 }),
  s("pop-bounce", "Bounce", "Pop", { ...base, font: "Poppins", weight: 900, size: 80, highlight: "#FFD23F", reveal: "word", active: "scale", enter: "bounce", container: "none", stroke: 6, strokeColor: "#000" }),
  s("pop-emoji", "Emoji Pop", "Pop", { ...base, font: "Figtree", weight: 900, size: 78, uppercase: true, highlight: "$accent", reveal: "word", active: "color", enter: "pop", container: "none", stroke: 6, strokeColor: "#000", emoji: true }),
  s("pop-single", "One Word", "Pop", { ...base, font: "Anton", weight: 400, size: 150, uppercase: true, highlight: "$accent", reveal: "single", active: "none", enter: "zoomOut", container: "none", shadow: "hard" }),
  s("pop-single-box", "One Word Box", "Pop", { color: "$ink", font: "Inter", weight: 900, size: 120, uppercase: true, highlight: "$ink", reveal: "single", active: "none", enter: "pop", container: "wordBox", containerColor: "$accent", shadow: "none" }),
  s("pop-blur", "Blur Pop", "Pop", { ...base, font: "Inter", weight: 800, size: 78, highlight: "$accent", reveal: "word", active: "color", enter: "blur", container: "none", emScale: 1.3 }),
  s("pop-drop", "Drop In", "Pop", { ...base, font: "Outfit", weight: 900, size: 80, uppercase: true, highlight: "$primary", reveal: "word", active: "color", enter: "drop", container: "none", stroke: 5, strokeColor: "#000" }),
  s("pop-stretch", "Stretch", "Pop", { ...base, font: "Bebas Neue", weight: 400, size: 120, uppercase: true, highlight: "$accent", reveal: "word", active: "color", enter: "stretch", container: "none", shadow: "hard", letterSpacing: 1 }),
  s("pop-spin", "Spin", "Pop", { ...base, font: "Lilita One", weight: 400, size: 92, highlight: "#FF6BD6", reveal: "word", active: "scale", enter: "spin", container: "none", stroke: 6, strokeColor: "#000" }),

  // ---- Box ----------------------------------------------------------------
  s("highlight-box", "Highlight Box", "Box", { ...base, font: "Inter", weight: 800, size: 72, highlight: "#FFFFFF", reveal: "page", active: "box", containerColor: "$primary", enter: "none", container: "none" }),
  s("box-accent", "Accent Box", "Box", { ...base, font: "Montserrat", weight: 900, size: 72, uppercase: true, highlight: "$ink", reveal: "page", active: "box", containerColor: "$accent", enter: "pop", container: "none" }),
  s("box-pill", "Pill", "Box", { color: "$ink", font: "DM Sans", weight: 700, size: 64, highlight: "$primary", reveal: "page", active: "color", enter: "none", container: "pill", containerColor: "#FFFFFF", shadow: "none" }),
  s("box-black-bar", "Black Bar", "Box", { color: "#FFFFFF", font: "Inter", weight: 700, size: 60, highlight: "$accent", reveal: "page", active: "color", enter: "none", container: "bar", containerColor: "rgba(0,0,0,.82)", shadow: "none" }),
  s("box-word-tiles", "Word Tiles", "Box", { color: "$ink", font: "Figtree", weight: 900, size: 66, uppercase: true, highlight: "$ink", reveal: "word", active: "none", enter: "pop", container: "wordBox", containerColor: "#FFFFFF", shadow: "none" }),
  s("box-tape", "Tape", "Box", { color: "$ink", font: "Permanent Marker", weight: 400, size: 70, highlight: "$primary", reveal: "page", active: "color", enter: "none", container: "tape", containerColor: "#FFF3A8", shadow: "none", tilt: 3 }),
  s("box-glass", "Glass", "Box", { color: "#FFFFFF", font: "Plus Jakarta Sans", weight: 800, size: 64, highlight: "$accent", reveal: "page", active: "color", enter: "none", container: "glass", shadow: "none" }),
  s("box-bubble", "Chat Bubble", "Box", { color: "#111", font: "Inter", weight: 700, size: 58, highlight: "$primary", reveal: "word", active: "none", enter: "slideUp", container: "bubble", containerColor: "#FFFFFF", shadow: "none" }),
  s("box-card", "Note Card", "Box", { color: "$ink", font: "Manrope", weight: 800, size: 60, highlight: "$primary", reveal: "page", active: "underline", enter: "none", container: "card", containerColor: "#FFFFFF", shadow: "none" }),
  s("box-marker", "Marker", "Box", { ...base, font: "Inter", weight: 800, size: 72, highlight: "$ink", reveal: "page", active: "marker", containerColor: "$accent", enter: "none", container: "none" }),

  // ---- Minimal ------------------------------------------------------------
  s("minimal-clean", "Clean", "Minimal", { ...base, font: "Inter", weight: 600, size: 58, highlight: "#FFFFFF", reveal: "page", active: "none", enter: "none", container: "none" }),
  s("minimal-dot", "Minimal Dot", "Minimal", { ...base, font: "DM Sans", weight: 500, size: 56, highlight: "$accent", reveal: "page", active: "color", enter: "none", container: "none", shadow: "soft" }),
  s("minimal-lower", "Lowercase Soft", "Minimal", { ...base, font: "Outfit", weight: 500, size: 64, highlight: "$accent", reveal: "word", active: "none", enter: "blur", container: "none" }),
  s("minimal-tracked", "Tracked Caps", "Minimal", { ...base, font: "Inter", weight: 500, size: 36, uppercase: true, letterSpacing: 10, highlight: "$accent", reveal: "page", active: "color", enter: "none", container: "none" }),
  s("minimal-mono", "Mono", "Minimal", { ...base, font: "JetBrains Mono", weight: 500, size: 50, highlight: "$accent", reveal: "word", active: "color", enter: "type", container: "none" }),
  s("minimal-subtitle", "Subtitle", "Minimal", { color: "#FFFFFF", font: "Inter", weight: 500, size: 46, highlight: "#FFFFFF", reveal: "page", active: "none", enter: "none", container: "bar", containerColor: "rgba(0,0,0,.6)", shadow: "none", wordsPerPage: 8 }),

  // ---- Kinetic ------------------------------------------------------------
  s("kinetic-stack", "Stack", "Kinetic", { ...base, font: "Montserrat", weight: 900, size: 82, uppercase: true, highlight: "$accent", reveal: "word", active: "none", enter: "slideUp", container: "none", layout: "stack", emScale: 1.6, emColor: "$accent" }),
  s("kinetic-mix", "Kinetic Mix", "Kinetic", { ...base, font: "Inter", weight: 900, size: 72, highlight: "$accent", reveal: "word", active: "none", enter: "pop", container: "none", layout: "kinetic", emFont: "Instrument Serif", emItalic: true, emScale: 1.9, emColor: "$accent" }),
  s("kinetic-poster", "Poster", "Kinetic", { ...base, font: "Anton", weight: 400, size: 96, uppercase: true, highlight: "$accent", reveal: "word", active: "none", enter: "rise", container: "none", layout: "stack", emScale: 1.7, emColor: "$accent", shadow: "hard" }),
  s("kinetic-lower", "Lowercase Kinetic", "Kinetic", { ...base, font: "Bricolage Grotesque", weight: 800, size: 84, letterSpacing: -3, highlight: "$accent", reveal: "word", active: "none", enter: "blur", container: "none", layout: "kinetic", emScale: 2, emColor: "$accent" }),
  s("kinetic-impact", "Impact Slam", "Kinetic", { ...base, font: "Archivo Black", weight: 400, size: 90, uppercase: true, highlight: "#FF3B3B", reveal: "single", active: "none", enter: "zoomOut", container: "none", emColor: "#FF3B3B", emScale: 1.4, shadow: "long" }),
  s("kinetic-condensed", "Condensed Run", "Kinetic", { ...base, font: "Barlow Condensed", weight: 900, size: 110, uppercase: true, italic: true, highlight: "$accent", reveal: "word", active: "color", enter: "slideUp", container: "none", layout: "stack", emScale: 1.35 }),
  s("kinetic-flip", "Flip Cards", "Kinetic", { color: "#FFFFFF", font: "Unbounded", weight: 900, size: 70, uppercase: true, highlight: "$accent", reveal: "word", active: "none", enter: "flip", container: "wordBox", containerColor: "#111", shadow: "none" }),

  // ---- Editorial ----------------------------------------------------------
  s("editorial-serif", "Editorial Serif", "Editorial", { ...base, font: "Instrument Serif", weight: 400, size: 92, highlight: "$accent", reveal: "page", active: "color", enter: "rise", container: "none", emItalic: true, emColor: "$accent", emScale: 1.15 }),
  s("editorial-mix", "Sans + Italic", "Editorial", { ...base, font: "Inter", weight: 600, size: 62, highlight: "$accent", reveal: "page", active: "none", enter: "rise", container: "none", emFont: "Instrument Serif", emItalic: true, emScale: 1.55, emColor: "$accent" }),
  s("editorial-classic", "Classic Serif", "Editorial", { ...base, font: "DM Serif Display", weight: 400, size: 84, highlight: "$accent", reveal: "word", active: "none", enter: "rise", container: "none", emItalic: true, emColor: "$accent" }),
  s("editorial-fraunces", "Magazine", "Editorial", { ...base, font: "Fraunces", weight: 600, size: 78, highlight: "$accent", reveal: "page", active: "color", enter: "blur", container: "none", emItalic: true, emScale: 1.2 }),
  s("editorial-quiet", "Quiet Caps + Serif", "Editorial", { ...base, font: "Inter", weight: 500, size: 34, uppercase: true, letterSpacing: 12, highlight: "$accent", reveal: "page", active: "none", enter: "blur", container: "none", emFont: "DM Serif Display", emScale: 3.4, emColor: "#FFFFFF", layout: "kinetic" }),
  s("editorial-playfair", "Playfair Italic", "Editorial", { ...base, font: "Playfair Display", weight: 400, italic: true, size: 80, highlight: "$accent", reveal: "page", active: "color", enter: "rise", container: "none" }),

  // ---- Fun ----------------------------------------------------------------
  s("fun-comic", "Comic", "Fun", { color: "#FFFFFF", font: "Bangers", weight: 400, size: 104, letterSpacing: 2, highlight: "#FFE14D", reveal: "word", active: "color", enter: "bounce", container: "none", stroke: 8, strokeColor: "#000", shadow: "hard", tilt: 4 }),
  s("fun-marker", "Handwritten", "Fun", { ...base, font: "Permanent Marker", weight: 400, size: 80, highlight: "$accent", reveal: "word", active: "color", enter: "pop", container: "none", tilt: 3 }),
  s("fun-caveat", "Notebook", "Fun", { ...base, font: "Caveat", weight: 700, size: 96, highlight: "$accent", reveal: "word", active: "underline", enter: "type", container: "none" }),
  s("fun-bubble", "Bubbly", "Fun", { color: "#FFFFFF", font: "Fredoka", weight: 700, size: 86, highlight: "#FF8AD8", reveal: "word", active: "scale", enter: "bounce", container: "none", stroke: 7, strokeColor: "#5B2BFF", shadow: "none" }),
  s("fun-sticker", "Sticker", "Fun", { color: "$ink", font: "Lilita One", weight: 400, size: 84, highlight: "$primary", reveal: "word", active: "none", enter: "pop", container: "wordBox", containerColor: "#FFFFFF", shadow: "hard", tilt: 5 }),
  s("fun-script", "Script", "Fun", { ...base, font: "Pacifico", weight: 400, size: 78, highlight: "$accent", reveal: "page", active: "color", enter: "rise", container: "none" }),
  s("fun-shrikhand", "Retro Fat", "Fun", { color: "#FFF4E0", font: "Shrikhand", weight: 400, size: 86, highlight: "#FF6A3D", reveal: "word", active: "color", enter: "pop", container: "none", shadow: "long" }),

  // ---- Retro --------------------------------------------------------------
  s("retro-pixel", "Pixel", "Retro", { color: "#FFFFFF", font: "Press Start 2P", weight: 400, size: 44, highlight: "#7CFF6B", reveal: "word", active: "color", enter: "type", container: "bar", containerColor: "rgba(0,0,0,.75)", shadow: "none" }),
  s("retro-vhs", "VHS", "Retro", { color: "#F2F2F2", font: "Space Mono", weight: 700, size: 56, uppercase: true, highlight: "#FF3BD4", reveal: "page", active: "color", enter: "none", container: "none", shadow: "glow" }),
  s("retro-arcade", "Arcade", "Retro", { color: "#FFE14D", font: "Bungee", weight: 400, size: 80, highlight: "#FF3B3B", reveal: "word", active: "color", enter: "drop", container: "none", shadow: "long" }),
  s("retro-70s", "Seventies", "Retro", { color: "#FFE3B0", font: "Righteous", weight: 400, size: 84, highlight: "#FF7A3D", reveal: "page", active: "color", enter: "rise", container: "none", shadow: "long" }),
  s("retro-mono-caps", "Rubik Mono", "Retro", { color: "#FFFFFF", font: "Rubik Mono One", weight: 400, size: 64, highlight: "$accent", reveal: "word", active: "color", enter: "stretch", container: "none", shadow: "hard" }),
  s("retro-lobster", "Diner", "Retro", { color: "#FFFFFF", font: "Lobster", weight: 400, size: 88, highlight: "#FF4D6D", reveal: "page", active: "color", enter: "pop", container: "none", stroke: 4, strokeColor: "#000" }),

  // ---- Neon ---------------------------------------------------------------
  s("neon-cyan", "Neon Cyan", "Neon", { color: "#E8FFFF", font: "Sora", weight: 800, size: 74, highlight: "#22E5FF", reveal: "page", active: "glow", enter: "none", container: "none", shadow: "glow" }),
  s("neon-pink", "Neon Pink", "Neon", { color: "#FFE8F7", font: "Syne", weight: 800, size: 76, uppercase: true, highlight: "#FF3BD4", reveal: "word", active: "glow", enter: "blur", container: "none", shadow: "glow" }),
  s("neon-gradient", "Gradient", "Neon", { color: "#FFFFFF", font: "Unbounded", weight: 900, size: 68, uppercase: true, highlight: "$accent", reveal: "page", active: "fill", enter: "none", container: "none", shadow: "glow" }),
  s("neon-kanit", "Speed Italic", "Neon", { color: "#FFFFFF", font: "Kanit", weight: 900, italic: true, size: 86, uppercase: true, highlight: "#B6FF3B", reveal: "word", active: "color", enter: "slideUp", container: "none", shadow: "glow" }),
];

export const CAPTION_STYLE_MAP: Record<string, CaptionStyle> = Object.fromEntries(CAPTION_STYLES.map((c) => [c.id, c]));

export function getCaptionStyle(id: string | undefined): CaptionStyle {
  return (id && CAPTION_STYLE_MAP[id]) || CAPTION_STYLE_MAP["bold-pop"];
}
