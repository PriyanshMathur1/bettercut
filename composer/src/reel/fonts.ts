// Font registry for reels. Fonts load on demand (only the ones a spec uses), latin subset,
// through @remotion/google-fonts (SIL OFL / Apache fonts served by Google Fonts).
import * as Anton from "@remotion/google-fonts/Anton";
import * as ArchivoBlack from "@remotion/google-fonts/ArchivoBlack";
import * as Bangers from "@remotion/google-fonts/Bangers";
import * as BarlowCondensed from "@remotion/google-fonts/BarlowCondensed";
import * as BebasNeue from "@remotion/google-fonts/BebasNeue";
import * as BricolageGrotesque from "@remotion/google-fonts/BricolageGrotesque";
import * as Bungee from "@remotion/google-fonts/Bungee";
import * as Caveat from "@remotion/google-fonts/Caveat";
import * as DMSans from "@remotion/google-fonts/DMSans";
import * as DMSerifDisplay from "@remotion/google-fonts/DMSerifDisplay";
import * as Figtree from "@remotion/google-fonts/Figtree";
import * as Fraunces from "@remotion/google-fonts/Fraunces";
import * as Fredoka from "@remotion/google-fonts/Fredoka";
import * as InstrumentSerif from "@remotion/google-fonts/InstrumentSerif";
import * as Inter from "@remotion/google-fonts/Inter";
import * as JetBrainsMono from "@remotion/google-fonts/JetBrainsMono";
import * as Kanit from "@remotion/google-fonts/Kanit";
import * as LilitaOne from "@remotion/google-fonts/LilitaOne";
import * as Lobster from "@remotion/google-fonts/Lobster";
import * as Manrope from "@remotion/google-fonts/Manrope";
import * as Montserrat from "@remotion/google-fonts/Montserrat";
import * as Outfit from "@remotion/google-fonts/Outfit";
import * as Pacifico from "@remotion/google-fonts/Pacifico";
import * as PermanentMarker from "@remotion/google-fonts/PermanentMarker";
import * as PlusJakartaSans from "@remotion/google-fonts/PlusJakartaSans";
import * as Poppins from "@remotion/google-fonts/Poppins";
import * as PressStart2P from "@remotion/google-fonts/PressStart2P";
import * as Righteous from "@remotion/google-fonts/Righteous";
import * as RubikMonoOne from "@remotion/google-fonts/RubikMonoOne";
import * as Shrikhand from "@remotion/google-fonts/Shrikhand";
import * as Sora from "@remotion/google-fonts/Sora";
import * as SpaceMono from "@remotion/google-fonts/SpaceMono";
import * as Syne from "@remotion/google-fonts/Syne";
import * as Unbounded from "@remotion/google-fonts/Unbounded";
import * as PlayfairDisplay from "@remotion/google-fonts/PlayfairDisplay";
import * as SpaceGrotesk from "@remotion/google-fonts/SpaceGrotesk";

type Loader = { loadFont: (style?: any, options?: any) => { fontFamily: string } };

interface FontDef {
  mod?: Loader;
  weights: string[];
  italic?: boolean;
  /** Fallback stack appended after the family. */
  fallback: string;
  local?: () => { fontFamily: string };
}

const SANS = "system-ui, -apple-system, Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

export const FONTS: Record<string, FontDef> = {
  Inter: { mod: Inter, weights: ["500", "700", "800", "900"], fallback: SANS },
  Montserrat: { mod: Montserrat, weights: ["600", "800", "900"], fallback: SANS },
  Poppins: { mod: Poppins, weights: ["600", "800", "900"], fallback: SANS },
  Outfit: { mod: Outfit, weights: ["500", "800", "900"], fallback: SANS },
  Sora: { mod: Sora, weights: ["600", "800"], fallback: SANS },
  Manrope: { mod: Manrope, weights: ["600", "800"], fallback: SANS },
  "Plus Jakarta Sans": { mod: PlusJakartaSans, weights: ["600", "800"], fallback: SANS },
  "DM Sans": { mod: DMSans, weights: ["500", "700", "900"], fallback: SANS },
  Figtree: { mod: Figtree, weights: ["600", "800", "900"], fallback: SANS },
  "Bricolage Grotesque": { mod: BricolageGrotesque, weights: ["600", "800"], fallback: SANS },
  Syne: { mod: Syne, weights: ["700", "800"], fallback: SANS },
  Unbounded: { mod: Unbounded, weights: ["700", "900"], fallback: SANS },
  Kanit: { mod: Kanit, weights: ["700", "900"], italic: true, fallback: SANS },
  Anton: { mod: Anton, weights: ["400"], fallback: SANS },
  "Bebas Neue": { mod: BebasNeue, weights: ["400"], fallback: SANS },
  "Barlow Condensed": { mod: BarlowCondensed, weights: ["700", "900"], italic: true, fallback: SANS },
  "Archivo Black": { mod: ArchivoBlack, weights: ["400"], fallback: SANS },
  "Rubik Mono One": { mod: RubikMonoOne, weights: ["400"], fallback: SANS },
  Bungee: { mod: Bungee, weights: ["400"], fallback: SANS },
  Bangers: { mod: Bangers, weights: ["400"], fallback: SANS },
  "Lilita One": { mod: LilitaOne, weights: ["400"], fallback: SANS },
  Fredoka: { mod: Fredoka, weights: ["600", "700"], fallback: SANS },
  Righteous: { mod: Righteous, weights: ["400"], fallback: SANS },
  "Permanent Marker": { mod: PermanentMarker, weights: ["400"], fallback: SANS },
  Caveat: { mod: Caveat, weights: ["600", "700"], fallback: SANS },
  Pacifico: { mod: Pacifico, weights: ["400"], fallback: SERIF },
  Lobster: { mod: Lobster, weights: ["400"], fallback: SERIF },
  Shrikhand: { mod: Shrikhand, weights: ["400"], fallback: SERIF },
  "DM Serif Display": { mod: DMSerifDisplay, weights: ["400"], italic: true, fallback: SERIF },
  "Instrument Serif": { mod: InstrumentSerif, weights: ["400"], italic: true, fallback: SERIF },
  Fraunces: { mod: Fraunces, weights: ["600", "900"], italic: true, fallback: SERIF },
  "JetBrains Mono": { mod: JetBrainsMono, weights: ["500", "800"], fallback: "monospace" },
  "Space Mono": { mod: SpaceMono, weights: ["400", "700"], fallback: "monospace" },
  "Press Start 2P": { mod: PressStart2P, weights: ["400"], fallback: "monospace" },
  "Space Grotesk": { mod: SpaceGrotesk, weights: ["500", "700"], fallback: SANS },
  "Playfair Display": { mod: PlayfairDisplay, weights: ["400", "700"], italic: true, fallback: SERIF },
};

export const FONT_NAMES = Object.keys(FONTS);

const loaded = new Map<string, string>();

/** Load a font (once) and return a CSS font-family stack. Unknown names fall back to Inter. */
export function font(name: string | undefined): string {
  const key = name && FONTS[name] ? name : "Inter";
  const cached = loaded.get(key);
  if (cached) return cached;
  const def = FONTS[key];
  let family = key;
  try {
    if (def.local) {
      family = def.local().fontFamily;
    } else if (def.mod) {
      family = def.mod.loadFont("normal", { weights: def.weights, subsets: ["latin"] }).fontFamily;
      if (def.italic) def.mod.loadFont("italic", { weights: def.weights, subsets: ["latin"] });
    }
  } catch {
    // A missing weight/style must not kill the render: fall back to the declared stack.
  }
  const stack = `"${family}", ${def.fallback}`;
  loaded.set(key, stack);
  return stack;
}
