// Hook titles (first seconds) and end cards (CTA after the last word).
import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { BrandKit } from "./types";
import { font } from "./fonts";
import { kOf, withAlpha } from "./brand";
import { progress } from "./timeline";

const outBack = Easing.out(Easing.back(1.6));
const outC = Easing.out(Easing.cubic);
const outExpo = Easing.out(Easing.exp);

export interface TitleRenderProps {
  /** CSS top for centred titles. */
  top?: string;
  text: string;
  subtitle?: string;
  brand: BrandKit;
  /** Seconds since the title started. */
  t: number;
  /** Total on-screen seconds. */
  dur: number;
  k: number;
}

type TitleFn = (p: TitleRenderProps) => React.ReactNode;

const exitOpacity = (t: number, dur: number) => 1 - progress(t, dur - 0.25, dur);

const words = (s: string) => s.split(/\s+/).filter(Boolean);

const TitleTop = React.createContext("26%");
const Center: React.FC<{ top?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ top, children, style }) => {
  const ctxTop = React.useContext(TitleTop);
  return <div style={{ position: "absolute", left: "6%", right: "6%", top: top || ctxTop, transform: "translateY(-50%)", textAlign: "center", ...style }}>{children}</div>;
};

export const TITLE_STYLES: { id: string; name: string; render: TitleFn }[] = [
  {
    id: "slam",
    name: "Slam",
    render: ({ text, brand, t, dur, k }) => (
      <Center style={{ opacity: exitOpacity(t, dur) }}>
        {words(text).map((w, i) => {
          const e = progress(t, i * 0.09, i * 0.09 + 0.22);
          return (
            <span key={i} style={{ display: "inline-block", margin: `0 ${12 * k}px`, transform: `scale(${3 - 2 * outExpo(e)})`, opacity: Math.min(1, e * 3), fontFamily: font("Anton"), fontSize: 150 * k, lineHeight: 1, color: i % 3 === 1 ? brand.accent : "#FFF", textTransform: "uppercase", textShadow: "6px 6px 0 rgba(0,0,0,.9)" }}>
              {w}
            </span>
          );
        })}
      </Center>
    ),
  },
  {
    id: "stamp",
    name: "Stamp",
    render: ({ text, brand, t, dur, k }) => {
      const e = outBack(progress(t, 0, 0.3));
      return (
        <Center style={{ opacity: exitOpacity(t, dur) }}>
          <span style={{ display: "inline-block", transform: `rotate(-6deg) scale(${e})`, border: `${10 * k}px solid ${brand.accent}`, borderRadius: 18 * k, padding: `${14 * k}px ${36 * k}px`, fontFamily: font("Archivo Black"), fontSize: 92 * k, color: brand.accent, textTransform: "uppercase", lineHeight: 1.05, background: "rgba(0,0,0,.35)" }}>
            {text}
          </span>
        </Center>
      );
    },
  },
  {
    id: "marker",
    name: "Highlighter",
    render: ({ text, brand, t, dur, k }) => {
      const e = outC(progress(t, 0.1, 0.6));
      return (
        <Center style={{ opacity: exitOpacity(t, dur) }}>
          <span style={{ position: "relative", display: "inline", fontFamily: font(brand.headingFont), fontWeight: 900, fontSize: 96 * k, lineHeight: 1.25, color: brand.ink, backgroundImage: `linear-gradient(${brand.accent}, ${brand.accent})`, backgroundRepeat: "no-repeat", backgroundSize: `${e * 100}% 100%`, padding: `0 ${14 * k}px`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
            {text}
          </span>
        </Center>
      );
    },
  },
  {
    id: "stacked",
    name: "Stacked Bold",
    render: ({ text, brand, t, dur, k }) => (
      <Center style={{ opacity: exitOpacity(t, dur) }}>
        {words(text).map((w, i) => {
          const e = outC(progress(t, i * 0.08, i * 0.08 + 0.35));
          return (
            <div key={i} style={{ overflow: "hidden", lineHeight: 0.92 }}>
              <div style={{ transform: `translateY(${(1 - e) * 110}%)`, fontFamily: font("Montserrat"), fontWeight: 900, fontSize: (i % 2 ? 130 : 96) * k, color: i % 2 ? brand.accent : "#FFF", textTransform: "uppercase", letterSpacing: -3 * k, textShadow: "0 10px 30px rgba(0,0,0,.5)" }}>{w}</div>
            </div>
          );
        })}
      </Center>
    ),
  },
  {
    id: "serif-elegant",
    name: "Elegant Serif",
    render: ({ text, subtitle, brand, t, dur, k }) => {
      const e = outC(progress(t, 0, 0.7));
      return (
        <Center style={{ opacity: exitOpacity(t, dur) * e, filter: `blur(${(1 - e) * 12}px)` }}>
          {subtitle ? <div style={{ fontFamily: font("Inter"), fontWeight: 500, fontSize: 30 * k, letterSpacing: 12 * k, color: "#FFF", textTransform: "uppercase", marginBottom: 18 * k }}>{subtitle}</div> : null}
          <div style={{ fontFamily: font(brand.serifFont), fontStyle: "italic", fontSize: 130 * k, lineHeight: 0.95, color: "#FFF", textShadow: "0 10px 40px rgba(0,0,0,.45)" }}>{text}</div>
        </Center>
      );
    },
  },
  {
    id: "glitch",
    name: "Glitch",
    render: ({ text, brand, t, dur, k }) => {
      const j = t < 0.4 || t > dur - 0.3 ? Math.sin(t * 90) * 10 * k : 0;
      const base: React.CSSProperties = { position: "absolute", left: 0, right: 0, fontFamily: font("Rubik Mono One"), fontSize: 84 * k, lineHeight: 1.05, textTransform: "uppercase" };
      return (
        <Center style={{ height: 300 * k, opacity: exitOpacity(t, dur) }}>
          <div style={{ ...base, color: "#FF2D55", transform: `translateX(${j}px)`, mixBlendMode: "screen" }}>{text}</div>
          <div style={{ ...base, color: "#00E5FF", transform: `translateX(${-j}px)`, mixBlendMode: "screen" }}>{text}</div>
          <div style={{ ...base, color: "#FFF", opacity: j ? 0.6 : 1 }}>{text}</div>
        </Center>
      );
    },
  },
  {
    id: "typewriter",
    name: "Typewriter",
    render: ({ text, t, dur, k }) => {
      const n = Math.floor(text.length * Math.min(1, t / Math.max(0.4, Math.min(1.2, dur * 0.5))));
      return (
        <Center style={{ opacity: exitOpacity(t, dur) }}>
          <span style={{ background: "rgba(0,0,0,.75)", padding: `${16 * k}px ${26 * k}px`, borderRadius: 14 * k, fontFamily: font("JetBrains Mono"), fontWeight: 800, fontSize: 60 * k, color: "#FFF", lineHeight: 1.4, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
            {text.slice(0, n)}
            <span style={{ opacity: Math.floor(t * 3) % 2 ? 0 : 1 }}>▍</span>
          </span>
        </Center>
      );
    },
  },
  {
    id: "neon",
    name: "Neon Sign",
    render: ({ text, brand, t, dur, k }) => {
      const flick = t < 0.5 ? (Math.sin(t * 70) > 0 ? 1 : 0.3) : 1;
      return (
        <Center style={{ opacity: exitOpacity(t, dur) * flick }}>
          <span style={{ fontFamily: font("Sora"), fontWeight: 800, fontSize: 100 * k, color: "#FFF", textShadow: `0 0 10px ${brand.accent}, 0 0 30px ${brand.accent}, 0 0 60px ${brand.accent}` }}>{text}</span>
        </Center>
      );
    },
  },
  {
    id: "ticker",
    name: "Ticker Tape",
    render: ({ text, brand, t, dur, k }) => {
      const e = outC(progress(t, 0, 0.35));
      const scroll = (t * 220 * k) % (1400 * k);
      return (
        <div style={{ position: "absolute", top: "24%", left: -50, right: -50, transform: `rotate(-4deg) scaleY(${e})`, background: brand.accent, padding: `${18 * k}px 0`, overflow: "hidden", opacity: exitOpacity(t, dur), whiteSpace: "nowrap" }}>
          <div style={{ transform: `translateX(${-scroll}px)`, fontFamily: font("Archivo Black"), fontSize: 70 * k, color: brand.ink, textTransform: "uppercase" }}>
            {Array.from({ length: 6 }, () => `${text} ✦ `).join("")}
          </div>
        </div>
      );
    },
  },
  {
    id: "question",
    name: "Question Bubble",
    render: ({ text, brand, t, dur, k }) => {
      const e = outBack(progress(t, 0, 0.4));
      return (
        <Center style={{ opacity: exitOpacity(t, dur) }}>
          <div style={{ display: "inline-block", transform: `scale(${e})`, transformOrigin: "bottom left", background: "#FFF", borderRadius: 40 * k, borderBottomLeftRadius: 8 * k, padding: `${30 * k}px ${40 * k}px`, boxShadow: "0 20px 60px rgba(0,0,0,.35)", textAlign: "left" }}>
            <div style={{ fontFamily: font("Inter"), fontWeight: 700, fontSize: 28 * k, color: brand.primary, marginBottom: 8 * k }}>@{brand.handle}</div>
            <div style={{ fontFamily: font("Inter"), fontWeight: 800, fontSize: 64 * k, color: "#111", lineHeight: 1.1 }}>{text}</div>
          </div>
        </Center>
      );
    },
  },
  {
    id: "big-number",
    name: "Big Number",
    render: ({ text, subtitle, brand, t, dur, k }) => {
      const m = /([\d.,]+)/.exec(text);
      const target = m ? parseFloat(m[1].replace(/,/g, "")) : 0;
      const e = outExpo(progress(t, 0, 0.9));
      const shown = m ? text.replace(m[1], Math.round(target * e).toLocaleString()) : text;
      return (
        <Center style={{ opacity: exitOpacity(t, dur) }}>
          <div style={{ fontFamily: font("Unbounded"), fontWeight: 900, fontSize: 160 * k, color: brand.accent, lineHeight: 1, textShadow: "0 12px 40px rgba(0,0,0,.4)" }}>{shown}</div>
          {subtitle ? <div style={{ fontFamily: font("Inter"), fontWeight: 700, fontSize: 48 * k, color: "#FFF", marginTop: 12 * k }}>{subtitle}</div> : null}
        </Center>
      );
    },
  },
  {
    id: "split-headline",
    name: "Split Headline",
    render: ({ text, brand, t, dur, k }) => {
      const parts = words(text);
      const half = Math.ceil(parts.length / 2);
      const e = outC(progress(t, 0, 0.45));
      const line = (s: string, dir: 1 | -1, color: string): React.ReactNode => (
        <div style={{ transform: `translateX(${(1 - e) * 120 * dir}%)`, fontFamily: font("Montserrat"), fontWeight: 900, fontSize: 104 * k, lineHeight: 1, color, textTransform: "uppercase", textShadow: "0 10px 30px rgba(0,0,0,.5)" }}>{s}</div>
      );
      return (
        <Center style={{ opacity: exitOpacity(t, dur) }}>
          {line(parts.slice(0, half).join(" "), -1, "#FFF")}
          {line(parts.slice(half).join(" "), 1, brand.accent)}
        </Center>
      );
    },
  },
  {
    id: "label",
    name: "Label Chip",
    render: ({ text, subtitle, brand, t, dur, k }) => {
      const e = outBack(progress(t, 0, 0.35));
      return (
        <div style={{ position: "absolute", top: "13%", left: "7%", opacity: exitOpacity(t, dur), transform: `translateX(${(1 - e) * -120}%)` }}>
          {subtitle ? <div style={{ display: "inline-block", background: brand.accent, color: brand.ink, fontFamily: font("Inter"), fontWeight: 800, fontSize: 30 * k, padding: `${8 * k}px ${18 * k}px`, borderRadius: 10 * k, marginBottom: 12 * k }}>{subtitle}</div> : null}
          <div style={{ background: brand.primary, color: "#FFF", fontFamily: font(brand.headingFont), fontWeight: 900, fontSize: 66 * k, padding: `${16 * k}px ${26 * k}px`, borderRadius: 18 * k, maxWidth: 860 * k, lineHeight: 1.1 }}>{text}</div>
        </div>
      );
    },
  },
];

export const TITLE_MAP: Record<string, (typeof TITLE_STYLES)[number]> = Object.fromEntries(TITLE_STYLES.map((s) => [s.id, s]));

/** Hook title at the start of the reel. */
export const HookLayer: React.FC<{ text: string; subtitle?: string; style: string; duration: number; brand: BrandKit; top?: string }> = ({ text, subtitle, style, duration, brand, top = "26%" }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  if (t > duration) return null;
  const def = TITLE_MAP[style] || TITLE_MAP.slam;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <TitleTop.Provider value={top}>{def.render({ text, subtitle, brand, t, dur: duration, k: kOf(width, height), top })}</TitleTop.Provider>
    </AbsoluteFill>
  );
};

export const END_CARD_STYLES = ["follow", "subscribe-glow", "comment-keyword", "minimal-handle"] as const;

/** End card after the last word. `t` is seconds since the card started. */
export const EndCardLayer: React.FC<{ style: string; text: string; subtitle?: string; brand: BrandKit; start: number; duration: number }> = ({ style, text, subtitle, brand, start, duration }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps - start;
  if (t < 0 || t > duration) return null;
  const k = kOf(width, height);
  const e = outBack(progress(t, 0, 0.45));
  const bg = interpolate(progress(t, 0, 0.3), [0, 1], [0, 0.75]);
  const card = (() => {
    switch (style) {
      case "comment-keyword":
        return (
          <div style={{ background: "#FFF", borderRadius: 40 * k, padding: 50 * k, width: 820 * k, textAlign: "left", boxShadow: "0 30px 80px rgba(0,0,0,.4)" }}>
            <div style={{ fontFamily: font("Inter"), fontWeight: 600, fontSize: 34 * k, color: "#777" }}>Comment</div>
            <div style={{ fontFamily: font(brand.headingFont), fontWeight: 900, fontSize: 120 * k, color: brand.primary, lineHeight: 1 }}>{text}</div>
            <div style={{ fontFamily: font("Inter"), fontWeight: 600, fontSize: 38 * k, color: "#222", marginTop: 16 * k }}>{subtitle || "and I'll send it to you"}</div>
          </div>
        );
      case "minimal-handle":
        return (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: font(brand.serifFont), fontStyle: "italic", fontSize: 110 * k, color: "#FFF" }}>{text}</div>
            <div style={{ fontFamily: font("Inter"), fontWeight: 500, fontSize: 36 * k, letterSpacing: 10 * k, color: "#FFF", opacity: 0.8 }}>@{brand.handle.toUpperCase()}</div>
          </div>
        );
      case "subscribe-glow":
        return (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: font(brand.headingFont), fontWeight: 900, fontSize: 84 * k, color: "#FFF", marginBottom: 30 * k }}>{text}</div>
            <div style={{ display: "inline-block", background: brand.accent, color: brand.ink, fontFamily: font("Inter"), fontWeight: 900, fontSize: 54 * k, padding: `${22 * k}px ${60 * k}px`, borderRadius: 999, boxShadow: `0 0 ${40 + 20 * Math.sin(t * 6)}px ${withAlpha(brand.accent, 0.8)}` }}>
              {subtitle || "Follow"}
            </div>
          </div>
        );
      default: {
        const tapped = t > duration * 0.45;
        return (
          <div style={{ background: "#FFF", borderRadius: 44 * k, padding: 46 * k, width: 800 * k, boxShadow: "0 30px 80px rgba(0,0,0,.4)", textAlign: "center" }}>
            <div style={{ width: 170 * k, height: 170 * k, borderRadius: "50%", margin: "0 auto", background: `linear-gradient(135deg, ${brand.primary}, ${brand.accent})`, padding: 8 * k }}>
              <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: brand.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font(brand.headingFont), fontWeight: 900, color: "#FFF", fontSize: 70 * k }}>
                {brand.name.slice(0, 1)}
              </div>
            </div>
            <div style={{ fontFamily: font("Inter"), fontWeight: 800, fontSize: 48 * k, color: "#111", marginTop: 20 * k }}>{brand.name}</div>
            <div style={{ fontFamily: font("Inter"), fontWeight: 500, fontSize: 32 * k, color: "#777" }}>@{brand.handle}</div>
            <div style={{ fontFamily: font("Inter"), fontWeight: 600, fontSize: 36 * k, color: "#333", margin: `${22 * k}px 0` }}>{text}</div>
            <div style={{ background: tapped ? "#EFEFEF" : brand.primary, color: tapped ? "#111" : "#FFF", fontFamily: font("Inter"), fontWeight: 800, fontSize: 40 * k, padding: `${20 * k}px 0`, borderRadius: 18 * k, transform: `scale(${tapped && t < duration * 0.45 + 0.15 ? 0.94 : 1})` }}>
              {tapped ? "Following" : subtitle || "Follow"}
            </div>
          </div>
        );
      }
    }
  })();
  return (
    <AbsoluteFill style={{ background: `rgba(0,0,0,${bg})`, alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ transform: `scale(${e})`, marginTop: -160 * k }}>{card}</div>
    </AbsoluteFill>
  );
};
