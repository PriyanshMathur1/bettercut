// Editing formats: where the speaker sits, what surrounds them and what fills the rest of the frame.
// A format returns geometry; the Reel composition renders the footage (and the matte) into it.
import React from "react";
import { AbsoluteFill } from "remotion";
import type { BrandKit, FormatSettings } from "./types";
import type { Box } from "./footage";
import { Media } from "./footage";
import { font } from "./fonts";
import { withAlpha } from "./brand";

export interface FormatLayout {
  /** Where the speaker footage goes. */
  box: Box;
  /** Drawn below the footage. */
  background?: React.ReactNode;
  /** Drawn above footage + captions-behind but below captions. */
  decor?: React.ReactNode;
  /** Second media slot (reaction, b-roll split...). `null` = slot exists but is empty. */
  mediaBox?: Box | null;
  /** Fill the frame with a blurred copy of the footage behind the box. */
  blurFill?: boolean;
  /** Extra filter for the footage (mono pop...). */
  footageFilter?: string;
  /** Show only the matte (greenscreen). */
  matteOnly?: boolean;
  /** Matte drawn unclipped above the box, clipped to y < clipBelow (head breakout). */
  breakoutAbove?: number;
  /** Matte shown in colour above a graded/mono footage. */
  colourPop?: boolean;
  /** Caption position override. */
  captionY?: "top" | "upper" | "middle" | "lower" | "bottom";
  /** Where the hook title sits (CSS top). Framed formats move it off their headline. */
  hookTop?: string;
}

export interface FormatDef {
  id: string;
  name: string;
  description: string;
  /** Designed for 9:16 only; other aspects fall back to an aspect-safe layout. */
  verticalOnly?: boolean;
  needsMatte?: boolean;
  needsMedia?: boolean;
  layout: (p: { W: number; H: number; brand: BrandKit; f: FormatSettings; hasMatte: boolean; hasMedia: boolean; srcAspect: number }) => FormatLayout;
}

const Headline: React.FC<{ text?: string; brand: BrandKit; color: string; top: number; size: number; serif?: boolean; align?: "center" | "left"; W: number }> = ({
  text,
  brand,
  color,
  top,
  size,
  serif,
  align = "center",
  W,
}) =>
  text ? (
    <div
      style={{
        position: "absolute",
        top,
        left: 70 * (W / 1080),
        right: 70 * (W / 1080),
        textAlign: align,
        fontFamily: font(serif ? brand.serifFont : brand.headingFont),
        fontWeight: serif ? 400 : 900,
        fontSize: size,
        lineHeight: 1.02,
        letterSpacing: serif ? 0 : -0.02 * size,
        color,
      }}
    >
      {text}
    </div>
  ) : null;

const Handle: React.FC<{ brand: BrandKit; color: string; top: number; W: number }> = ({ brand, color, top, W }) => (
  <div style={{ position: "absolute", top, left: 0, right: 0, textAlign: "center", fontFamily: font(brand.bodyFont), fontWeight: 600, fontSize: 30 * (W / 1080), color, letterSpacing: 2 }}>
    @{brand.handle}
  </div>
);

const bgFill = (f: FormatSettings, fallback: string) =>
  f.background && !/\.(mp4|mov|webm|png|jpe?g|webp)$/i.test(f.background) ? f.background : fallback;
const bgMedia = (f: FormatSettings) => (f.background && /\.(mp4|mov|webm|png|jpe?g|webp)$/i.test(f.background) ? f.background : undefined);

export const FORMATS: FormatDef[] = [
  {
    id: "full",
    name: "Full Frame",
    description: "Speaker fills the 9:16 frame. The classic talking-head reel.",
    layout: ({ W, H }) => ({ box: { x: 0, y: 0, w: W, h: H, fit: "cover" } }),
  },
  {
    id: "blur-fit",
    name: "Blur Fit",
    description: "Horizontal footage fitted into 9:16 over a blurred copy of itself.",
    layout: ({ W, H, srcAspect }) => {
      const h = Math.min(H * 0.62, W / Math.max(srcAspect, 0.3));
      return { box: { x: 0, y: (H - h) / 2 - H * 0.04, w: W, h, fit: "cover" }, blurFill: true, captionY: "lower" };
    },
  },
  {
    id: "white-frame",
    verticalOnly: true,
    name: "Clean Frame",
    description: "Speaker in a rounded window on a solid brand background with a headline above.",
    layout: ({ W, H, brand, f }) => {
      const k = W / 1080;
      const bg = bgFill(f, brand.background);
      return {
        box: { x: 60 * k, y: 500 * k, w: W - 120 * k, h: H - 500 * k - 360 * k, radius: 44 * k, fit: "cover", shadow: "0 30px 80px rgba(0,0,0,.25)" },
        background: <AbsoluteFill style={{ background: bg }} />,
        decor: (
          <>
            <Headline text={f.headline} brand={brand} color={brand.ink} top={250 * k} size={78 * k} W={W} />
            <Handle brand={brand} color={withAlpha(brand.ink, 0.6)} top={H - 330 * k} W={W} />
          </>
        ),
        hookTop: "50%",
        captionY: "lower",
      };
    },
  },
  {
    id: "polaroid",
    verticalOnly: true,
    name: "Polaroid",
    description: "A tilted instant-photo card with a handwritten line under the picture.",
    layout: ({ W, H, brand, f }) => {
      const k = W / 1080;
      return {
        box: { x: 110 * k, y: 330 * k, w: W - 220 * k, h: 1020 * k, rotate: -2.5, fit: "cover", border: `${26 * k}px solid #FFFFFF`, shadow: "0 30px 70px rgba(0,0,0,.35)" },
        background: (
          <AbsoluteFill style={{ background: `radial-gradient(circle at 30% 20%, ${withAlpha(brand.primary, 0.9)}, ${brand.ink})` }} />
        ),
        decor: f.headline ? (
          <div style={{ position: "absolute", top: 1360 * k, left: 0, right: 0, textAlign: "center", transform: "rotate(-2.5deg)", fontFamily: font("Caveat"), fontWeight: 700, fontSize: 84 * k, color: "#FFFFFF" }}>
            {f.headline}
          </div>
        ) : null,
        hookTop: "50%",
        captionY: "upper",
      };
    },
  },
  {
    id: "cinema",
    verticalOnly: true,
    name: "Cinema Bars",
    description: "Letterboxed widescreen band with the headline in the top bar.",
    layout: ({ W, H, brand, f }) => {
      const k = W / 1080;
      const h = W * 1.05;
      const y = (H - h) / 2 - 40 * k;
      return {
        box: { x: 0, y, w: W, h, fit: "cover" },
        background: <AbsoluteFill style={{ background: "#050505" }} />,
        decor: (
          <>
            <Headline text={f.headline} brand={brand} color="#F5F5F5" top={y - 260 * k} size={64 * k} serif W={W} />
            <Handle brand={brand} color="rgba(255,255,255,.55)" top={y + h + 40 * k} W={W} />
          </>
        ),
        hookTop: "50%",
        captionY: "lower",
      };
    },
  },
  {
    id: "split-top",
    name: "Split: Media Top",
    description: "Reaction / b-roll on top, speaker below. Without media the speaker fills the frame.",
    needsMedia: true,
    layout: ({ W, H, hasMedia }) =>
      hasMedia
        ? { box: { x: 0, y: H / 2, w: W, h: H / 2, fit: "cover" }, mediaBox: { x: 0, y: 0, w: W, h: H / 2, fit: "cover" }, captionY: "middle" }
        : { box: { x: 0, y: 0, w: W, h: H, fit: "cover" }, mediaBox: null },
  },
  {
    id: "split-bottom",
    name: "Split: Media Bottom",
    description: "Speaker on top, reaction / b-roll below.",
    needsMedia: true,
    layout: ({ W, H, hasMedia }) =>
      hasMedia
        ? { box: { x: 0, y: 0, w: W, h: H / 2, fit: "cover" }, mediaBox: { x: 0, y: H / 2, w: W, h: H / 2, fit: "cover" }, captionY: "middle" }
        : { box: { x: 0, y: 0, w: W, h: H, fit: "cover" }, mediaBox: null },
  },
  {
    id: "side-by-side",
    verticalOnly: true,
    name: "Side by Side",
    description: "Speaker and media in two tall columns with a gutter.",
    needsMedia: true,
    layout: ({ W, H, brand, hasMedia }) => {
      const k = W / 1080;
      if (!hasMedia) return { box: { x: 0, y: 0, w: W, h: H, fit: "cover" }, mediaBox: null };
      const colW = (W - 3 * 24 * k) / 2;
      return {
        box: { x: 24 * k, y: 300 * k, w: colW, h: 1100 * k, radius: 28 * k, fit: "cover" },
        mediaBox: { x: 48 * k + colW, y: 300 * k, w: colW, h: 1100 * k, radius: 28 * k, fit: "cover" },
        background: <AbsoluteFill style={{ background: brand.ink }} />,
        captionY: "bottom",
      };
    },
  },
  {
    id: "pip",
    name: "Picture in Picture",
    description: "Media fills the frame, speaker in a round bubble above the caption zone.",
    needsMedia: true,
    layout: ({ W, H, hasMedia }) => {
      const k = W / 1080;
      if (!hasMedia) return { box: { x: 0, y: 0, w: W, h: H, fit: "cover" }, mediaBox: null };
      const d = 380 * k;
      return {
        box: { x: 60 * k, y: 1080 * k, w: d, h: d, circle: true, fit: "cover", border: `${8 * k}px solid #FFFFFF`, shadow: "0 20px 50px rgba(0,0,0,.45)" },
        mediaBox: { x: 0, y: 0, w: W, h: H, fit: "cover" },
        captionY: "upper",
      };
    },
  },
  {
    id: "greenscreen",
    name: "Green Screen",
    description: "Speaker cut out over any background image, video or colour.",
    needsMatte: true,
    layout: ({ W, H, brand, f, hasMatte }) => {
      const media = bgMedia(f);
      return {
        box: { x: 0, y: 0, w: W, h: H, fit: "cover" },
        matteOnly: hasMatte,
        background: media ? (
          <AbsoluteFill>
            <Media src={media} fit="cover" />
          </AbsoluteFill>
        ) : (
          <AbsoluteFill style={{ background: bgFill(f, `linear-gradient(160deg, ${brand.primary}, ${brand.ink})`) }} />
        ),
      };
    },
  },
  {
    id: "head-breakout",
    verticalOnly: true,
    name: "Head Breakout",
    description: "Speaker inside a card while their head breaks out over the top edge.",
    needsMatte: true,
    layout: ({ W, H, brand, f, hasMatte }) => {
      const k = W / 1080;
      const top = 560 * k;
      return {
        box: { x: 70 * k, y: top, w: W - 140 * k, h: 860 * k, radius: 40 * k, fit: "cover", shadow: "0 30px 80px rgba(0,0,0,.35)" },
        breakoutAbove: hasMatte ? top : undefined,
        background: <AbsoluteFill style={{ background: bgFill(f, brand.primary) }} />,
        decor: <Headline text={f.headline} brand={brand} color="#FFFFFF" top={240 * k} size={70 * k} W={W} />,
        hookTop: "50%",
        captionY: "lower",
      };
    },
  },
  {
    id: "colour-pop",
    name: "Colour Pop",
    description: "Room in black and white, speaker stays in full colour with a brand shape behind.",
    needsMatte: true,
    layout: ({ W, H, brand, hasMatte }) => ({
      box: { x: 0, y: 0, w: W, h: H, fit: "cover" },
      footageFilter: "grayscale(1) contrast(1.15) brightness(.9)",
      colourPop: hasMatte,
      decor: undefined,
      background: undefined,
      // a soft brand disc sits between the mono room and the colour subject
      mediaBox: undefined,
      captionY: "lower",
      ...(hasMatte
        ? {
            decor: (
              <div
                style={{
                  position: "absolute",
                  left: W * 0.12,
                  top: H * 0.16,
                  width: W * 0.76,
                  height: W * 0.76,
                  borderRadius: "50%",
                  background: withAlpha(brand.primary, 0.85),
                }}
              />
            ),
          }
        : {}),
    }),
  },
  {
    id: "magazine",
    verticalOnly: true,
    name: "Magazine Cover",
    description: "Big masthead behind the speaker's head, cover lines and an issue tag.",
    layout: ({ W, H, brand, f }) => {
      const k = W / 1080;
      return {
        box: { x: 0, y: 0, w: W, h: H, fit: "cover" },
        decor: (
          <>
            <div style={{ position: "absolute", top: 230 * k, left: 0, right: 0, textAlign: "center", fontFamily: font(brand.serifFont), fontSize: 250 * k, lineHeight: 0.85, color: "#FFFFFF", letterSpacing: -6 * k, textShadow: "0 10px 40px rgba(0,0,0,.35)" }}>
              {(f.headline || brand.name).split(" ")[0]}
            </div>
            <div style={{ position: "absolute", top: 470 * k, left: 60 * k, fontFamily: font(brand.bodyFont), fontWeight: 800, fontSize: 30 * k, color: brand.accent, letterSpacing: 4 }}>
              ISSUE {new Date().getFullYear()} · @{brand.handle.toUpperCase()}
            </div>
          </>
        ),
        hookTop: "50%",
        captionY: "lower",
      };
    },
  },
  {
    id: "panel-top",
    verticalOnly: true,
    name: "Board on Top",
    description: "A solid panel in the top half for lists, tier lists and charts; speaker below.",
    layout: ({ W, H, brand, f }) => {
      const k = W / 1080;
      return {
        box: { x: 0, y: H * 0.46, w: W, h: H * 0.54, fit: "cover" },
        background: <AbsoluteFill style={{ background: bgFill(f, brand.background) }} />,
        decor: <Headline text={f.headline} brand={brand} color={brand.ink} top={240 * k} size={58 * k} W={W} />,
        hookTop: "50%",
        captionY: "bottom",
      };
    },
  },
  {
    id: "post-card",
    verticalOnly: true,
    name: "Post Card",
    description: "A social-post style card with your name and text on top, speaker below.",
    layout: ({ W, H, brand, f }) => {
      const k = W / 1080;
      return {
        box: { x: 60 * k, y: 760 * k, w: W - 120 * k, h: 700 * k, radius: 36 * k, fit: "cover" },
        background: <AbsoluteFill style={{ background: bgFill(f, "#F2F2F2") }} />,
        decor: (
          <div style={{ position: "absolute", top: 250 * k, left: 60 * k, right: 60 * k, background: "#FFFFFF", borderRadius: 36 * k, padding: 40 * k, boxShadow: "0 10px 40px rgba(0,0,0,.08)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 * k }}>
              <div style={{ width: 80 * k, height: 80 * k, borderRadius: "50%", background: brand.primary }} />
              <div>
                <div style={{ fontFamily: font(brand.bodyFont), fontWeight: 800, fontSize: 34 * k, color: "#111" }}>{brand.name}</div>
                <div style={{ fontFamily: font(brand.bodyFont), fontWeight: 500, fontSize: 28 * k, color: "#777" }}>@{brand.handle}</div>
              </div>
            </div>
            <div style={{ marginTop: 26 * k, fontFamily: font(brand.bodyFont), fontWeight: 600, fontSize: 44 * k, lineHeight: 1.25, color: "#111" }}>{f.headline}</div>
          </div>
        ),
        hookTop: "50%",
        captionY: "bottom",
      };
    },
  },
  {
    id: "zoom-frame",
    verticalOnly: true,
    name: "Floating Frame",
    description: "Speaker in a large floating window over a blurred, darkened copy of the shot.",
    layout: ({ W, H }) => {
      const k = W / 1080;
      return { box: { x: 70 * k, y: 260 * k, w: W - 140 * k, h: 1240 * k, radius: 48 * k, fit: "cover", shadow: "0 40px 100px rgba(0,0,0,.5)", border: `${4 * k}px solid rgba(255,255,255,.6)` }, blurFill: true, captionY: "lower" };
    },
  },
];

export const FORMAT_MAP: Record<string, FormatDef> = Object.fromEntries(FORMATS.map((f) => [f.id, f]));
