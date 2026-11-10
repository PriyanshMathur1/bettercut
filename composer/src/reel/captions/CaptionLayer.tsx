import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { BrandKit, CaptionSettings } from "../types";
import type { CaptionPage, OutWord } from "../timeline";
import { progress } from "../timeline";
import { font } from "../fonts";
import { jitter, kOf, tok, withAlpha } from "../brand";
import type { CaptionStyle, WordEnter } from "./styles";

export const POSITION_Y: Record<CaptionSettings["position"], number> = {
  top: 0.2,
  upper: 0.33,
  middle: 0.5,
  lower: 0.62,
  bottom: 0.71,
};

const easeOutBack = Easing.out(Easing.back(1.7));
const easeOut = Easing.out(Easing.cubic);

function shadowFor(kind: CaptionStyle["shadow"], glow: string): string {
  switch (kind) {
    case "hard":
      return "5px 5px 0 rgba(0,0,0,.95)";
    case "long":
      return "3px 3px 0 rgba(0,0,0,.9), 6px 6px 0 rgba(0,0,0,.8), 9px 9px 0 rgba(0,0,0,.6)";
    case "glow":
      return `0 0 12px ${withAlpha(glow, 0.9)}, 0 0 36px ${withAlpha(glow, 0.6)}`;
    case "none":
      return "none";
    default:
      return "0 6px 26px rgba(0,0,0,.6), 0 2px 4px rgba(0,0,0,.5)";
  }
}

/** Entrance transform for a word, e in 0..1. */
export function entrance(kind: WordEnter, e: number): { transform: string; opacity: number; filter?: string; clip?: boolean } {
  const b = easeOutBack(e);
  const o = easeOut(e);
  switch (kind) {
    case "pop":
      return { transform: `scale(${interpolate(b, [0, 1], [0.55, 1])})`, opacity: Math.min(1, e * 3) };
    case "slideUp":
      return { transform: `translateY(${(1 - o) * 45}px)`, opacity: o };
    case "blur":
      return { transform: `scale(${1.22 - 0.22 * o})`, opacity: Math.min(1, e * 2.5), filter: `blur(${(1 - o) * 18}px)` };
    case "drop":
      return { transform: `translateY(${-(1 - b) * 70}px)`, opacity: Math.min(1, e * 3) };
    case "flip":
      return { transform: `perspective(600px) rotateX(${(1 - o) * 90}deg)`, opacity: Math.min(1, e * 2) };
    case "stretch":
      return { transform: `scaleX(${1.5 - 0.5 * o}) scaleY(${0.2 + 0.8 * b})`, opacity: Math.min(1, e * 3) };
    case "bounce": {
      const d = Math.exp(-5 * e) * Math.cos(e * 14);
      return { transform: `scale(${1 - 0.45 * d}) translateY(${-18 * d}px)`, opacity: Math.min(1, e * 4) };
    }
    case "rise":
      return { transform: `translateY(${(1 - o) * 110}%)`, opacity: 1, clip: true };
    case "spin":
      return { transform: `rotate(${(1 - b) * -80}deg) scale(${0.5 + 0.5 * b})`, opacity: Math.min(1, e * 3) };
    case "zoomOut":
      return { transform: `scale(${2.2 - 1.2 * o})`, opacity: Math.min(1, e * 2.5) };
    default:
      return { transform: "none", opacity: 1 };
  }
}

interface Props {
  pages: CaptionPage[];
  style: CaptionStyle;
  settings: CaptionSettings;
  brand: BrandKit;
  /** Leave emphasis words out (rendered by the behind-head punch layer instead). */
  omitEmphasis?: boolean;
  /** Output seconds before which no captions show (the hook title owns the screen). */
  hideBefore?: number;
}

export const CaptionLayer: React.FC<Props> = ({ pages, style, settings, brand, omitEmphasis, hideBefore }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  if (hideBefore && t < hideBefore) return null;
  const pageIndex = pages.findIndex((p) => t >= p.start && t < p.end);
  if (pageIndex < 0 || !settings.enabled) return null;
  const page = pages[pageIndex];

  const k = kOf(width, height) * (settings.scale || 1);
  const size = style.size * k;
  const color = tok(settings.color || style.color, brand);
  const highlight = tok(settings.highlight || style.highlight, brand);
  const boxColor = tok(style.containerColor, brand, brand.primary);
  const emColor = tok(style.emColor, brand, highlight);
  const family = font(style.font);
  const emFamily = style.emFont ? font(style.emFont) : family;
  const upper = settings.uppercase ?? style.uppercase;
  const shadow = shadowFor(style.shadow, highlight);
  const y = POSITION_Y[settings.position] ?? POSITION_Y.lower;
  const tilt = style.tilt ? jitter(pageIndex + 1) * style.tilt : 0;
  const pageIn = easeOut(progress(t, page.start, page.start + 0.18));

  // which words are visible
  const words = page.words.filter((w) => !(omitEmphasis && w.emphasis));
  let visible: OutWord[] = words;
  if (style.reveal === "word") visible = words.filter((w) => t >= w.outStart - 0.02);
  if (style.reveal === "single") {
    const started = words.filter((w) => t >= w.outStart - 0.02);
    visible = started.length ? [started[started.length - 1]] : [];
  }
  if (!visible.length) return null;

  const activeEmoji = style.emoji ? [...visible].reverse().find((w) => w.emoji && t >= w.outStart) : undefined;

  const container: React.CSSProperties = {};
  switch (style.container) {
    case "pill":
      Object.assign(container, { background: boxColor, borderRadius: 999, padding: `${0.22 * size}px ${0.5 * size}px` });
      break;
    case "bubble":
      Object.assign(container, { background: boxColor, borderRadius: 0.5 * size, borderBottomLeftRadius: 0.12 * size, padding: `${0.3 * size}px ${0.45 * size}px`, boxShadow: "0 10px 30px rgba(0,0,0,.35)" });
      break;
    case "bar":
      Object.assign(container, { background: boxColor, borderRadius: 0.12 * size, padding: `${0.2 * size}px ${0.4 * size}px` });
      break;
    case "card":
      Object.assign(container, { background: boxColor, borderRadius: 0.3 * size, padding: `${0.35 * size}px ${0.5 * size}px`, boxShadow: "0 18px 50px rgba(0,0,0,.35)" });
      break;
    case "glass":
      Object.assign(container, { background: "rgba(255,255,255,.14)", border: "2px solid rgba(255,255,255,.35)", borderRadius: 0.35 * size, padding: `${0.25 * size}px ${0.45 * size}px`, backdropFilter: "blur(14px)" });
      break;
  }

  const stacked = style.layout === "stack" || style.layout === "kinetic";

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 60 * k,
          right: 60 * k,
          top: `${y * 100}%`,
          transform: `translateY(-50%) rotate(${tilt}deg) scale(${style.reveal === "page" ? 0.94 + 0.06 * pageIn : 1})`,
          opacity: style.reveal === "page" ? pageIn : 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {activeEmoji ? (
          <div style={{ fontSize: size * 1.3, marginBottom: size * 0.1, ...entranceStyle(entrance("pop", progress(t, activeEmoji.outStart, activeEmoji.outStart + 0.3))) }}>
            {activeEmoji.emoji}
          </div>
        ) : null}
        <div
          style={{
            ...container,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "baseline",
            columnGap: size * 0.26,
            rowGap: size * (style.container === "wordBox" ? 0.18 : 0.02),
            maxWidth: "100%",
            textAlign: "center",
          }}
        >
          {visible.map((w, i) => {
            const isActive = t >= w.outStart && t < w.outEnd + 0.04;
            const isPast = t >= w.outEnd;
            const p = progress(t, w.outStart, w.outEnd);
            const e = progress(t, w.outStart, w.outStart + 0.22);
            const ent = style.reveal === "page" ? { transform: "none", opacity: 1 } : entrance(style.enter, e);
            const em = !!w.emphasis;
            const fs = size * (em ? style.emScale || 1.12 : 1) * (style.reveal === "single" ? 1 : 1);
            let wordColor = color;
            let bg: string | undefined;
            let extraShadow: string | undefined;
            let scale = 1;
            let opacity = 1;
            let fillBg: string | undefined;
            switch (style.active) {
              case "color":
                if (isActive) wordColor = highlight;
                break;
              case "box":
                if (isActive) bg = boxColor;
                if (isActive) wordColor = highlight;
                break;
              case "fill":
                // drawn as a clipped highlight copy on top of the word (see `fillCopy` below)
                fillBg = String(isPast ? 1 : isActive ? p : 0);
                break;
              case "scale":
                if (isActive) {
                  wordColor = highlight;
                  scale = 1 + 0.16 * easeOutBack(Math.min(1, e * 1.5));
                }
                break;
              case "glow":
                if (isActive) {
                  wordColor = highlight;
                  extraShadow = `0 0 14px ${withAlpha(highlight, 1)}, 0 0 40px ${withAlpha(highlight, 0.7)}`;
                }
                break;
              case "outlineFill":
                if (isActive || isPast) wordColor = highlight;
                break;
              case "dim":
                opacity = isActive ? 1 : isPast ? 0.75 : 0.4;
                break;
              case "marker":
                if (isActive || isPast) wordColor = highlight;
                break;
            }
            if (em && style.emColor && !isActive) wordColor = emColor;
            if (style.container === "wordBox" || style.container === "tape") bg = bg || boxColor;

            const chars = style.enter === "type" && style.reveal !== "page" ? Math.ceil(w.text.length * Math.min(1, e * 1.6)) : w.text.length;
            // captions read cleaner without trailing commas / full stops (? and ! stay)
            const display = w.text.replace(/[,.;:]+$/, "");
            const text = (upper ? display.toUpperCase() : display).slice(0, chars);
            const wordStyle: React.CSSProperties = {
              fontFamily: em ? emFamily : family,
              fontWeight: em && style.emFont ? 400 : style.weight,
              fontStyle: (em ? style.emItalic : false) || style.italic ? "italic" : "normal",
              fontSize: fs,
              lineHeight: style.lineHeight ?? 1.08,
              letterSpacing: (style.letterSpacing ?? 0) * k,
              color: wordColor,
              WebkitTextStroke: style.stroke ? `${style.stroke * k}px ${tok(style.strokeColor, brand, "#000")}` : undefined,
              paintOrder: "stroke fill",
              textShadow: extraShadow || shadow,
              display: "inline-block",
              whiteSpace: "nowrap",
              position: "relative",
              opacity: opacity * ent.opacity,
              transform: `${ent.clip ? "" : ent.transform} scale(${scale}) rotate(${style.container === "tape" ? jitter(w.index) * 3 : 0}deg)`,
              filter: ent.filter,
              flexBasis: stacked && em ? "100%" : undefined,
              textAlign: "center",
            };
            const boxed: React.CSSProperties | undefined = bg
              ? { background: bg, borderRadius: 0.16 * fs, padding: `${0.04 * fs}px ${0.2 * fs}px`, boxShadow: style.shadow === "hard" ? "5px 5px 0 #000" : undefined }
              : undefined;
            const marker =
              style.active === "marker" && (isActive || isPast) ? (
                <span
                  style={{
                    position: "absolute",
                    left: -0.08 * fs,
                    right: -0.08 * fs,
                    top: "18%",
                    bottom: "8%",
                    background: boxColor,
                    transformOrigin: "left center",
                    transform: `scaleX(${isPast ? 1 : easeOut(p)}) skewX(-8deg)`,
                    zIndex: -1,
                    borderRadius: 6 * k,
                  }}
                />
              ) : null;
            const underline =
              style.active === "underline" && (isActive || isPast) ? (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    bottom: -0.06 * fs,
                    height: Math.max(4, 0.09 * fs),
                    width: `${(isPast ? 1 : easeOut(p)) * 100}%`,
                    background: highlight,
                    borderRadius: 99,
                  }}
                />
              ) : null;
            const fillP = fillBg !== undefined ? parseFloat(fillBg) : 0;
            const fillCopy =
              fillP > 0 ? (
                <span
                  aria-hidden
                  style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, color: highlight, textShadow: "none", clipPath: `inset(-20% ${(1 - fillP) * 100}% -20% -5%)`, whiteSpace: "nowrap" }}
                >
                  {text}
                </span>
              ) : null;
            const inner = (
              <span style={{ ...wordStyle, ...(boxed || {}), isolation: "isolate" }}>
                {marker}
                {text}
                {fillCopy}
                {underline}
              </span>
            );
            return (
              <span
                key={`${w.index}-${i}`}
                style={{
                  display: "inline-block",
                  overflow: ent.clip ? "hidden" : "visible",
                  flexBasis: stacked && em ? "100%" : undefined,
                  textAlign: "center",
                  paddingBottom: ent.clip ? 0.08 * fs : 0,
                }}
              >
                <span style={{ display: "inline-block", transform: ent.clip ? ent.transform : undefined }}>{inner}</span>
              </span>
            );
          })}
        </div>
        {style.container === "bubble" ? (
          <div style={{ alignSelf: "flex-start", marginLeft: 0.6 * size, width: 0, height: 0, borderLeft: `${0.35 * size}px solid ${boxColor}`, borderBottom: `${0.3 * size}px solid transparent` }} />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const entranceStyle = (e: ReturnType<typeof entrance>): React.CSSProperties => ({
  transform: e.transform,
  opacity: e.opacity,
  filter: e.filter,
  display: "inline-block",
});

/**
 * Behind-the-head punch words: emphasis words shown big in the top band, rendered BELOW the
 * speaker cut-out so the head overlaps the bottom of the letters.
 */
export const PunchLayer: React.FC<{
  words: OutWord[];
  brand: BrandKit;
  style: CaptionStyle;
  settings: CaptionSettings & { punchY?: number };
}> = ({ words, brand, style, settings }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const w = [...words].reverse().find((x) => x.emphasis && t >= x.outStart && t < x.outEnd + 0.7);
  if (!w || !settings.enabled) return null;
  const k = kOf(width, height);
  const e = progress(t, w.outStart, w.outStart + 0.25);
  const out = progress(t, w.outEnd + 0.55, w.outEnd + 0.7);
  const text = (settings.uppercase ?? style.uppercase) ? w.text.toUpperCase() : w.text.toLowerCase();
  const clean = text.replace(/[.,!?;:]+$/, "");
  const fs = Math.min(300, (1000 / Math.max(3, clean.length)) * 1.6) * k * (settings.scale || 1);
  const ent = entrance("blur", e);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${(settings.punchY ?? 0.24) * 100}%`,
          textAlign: "center",
          transform: `translateY(-50%) ${ent.transform}`,
          filter: ent.filter,
          opacity: ent.opacity * (1 - out),
          fontFamily: font(style.emFont || brand.headingFont || style.font),
          fontStyle: style.emItalic ? "italic" : "normal",
          fontWeight: 900,
          fontSize: fs,
          lineHeight: 0.9,
          letterSpacing: -0.04 * fs,
          color: tok(style.emColor || style.highlight, brand),
          textShadow: "0 10px 40px rgba(0,0,0,.45)",
          whiteSpace: "nowrap",
        }}
      >
        {clean}
      </div>
    </AbsoluteFill>
  );
};
