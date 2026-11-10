// Animated overlays (stickers, lists, counters, UI cards...). Each renders at a centre point
// (x, y in 0..1 of the frame), with an entrance from the motion library and a short exit.
import React from "react";
import { AbsoluteFill, Easing, Img, useCurrentFrame, useVideoConfig } from "remotion";
import type { BrandKit, OverlayKind, ReelOverlay } from "./types";
import { EFFECT_MAP } from "./motion/effects";
import { font } from "./fonts";
import { progress } from "./timeline";
import { resolveAsset } from "./asset";
import { kOf, withAlpha } from "./brand";

const outBack = Easing.out(Easing.back(1.7));
const outC = Easing.out(Easing.cubic);

export interface OverlayRender {
  o: ReelOverlay;
  brand: BrandKit;
  /** Seconds since the overlay started (output time). */
  t: number;
  dur: number;
  k: number;
  /** Item reveal times in overlay-local seconds. */
  itemT: number[];
}

const card = (k: number): React.CSSProperties => ({ background: "#FFF", borderRadius: 32 * k, boxShadow: "0 24px 60px rgba(0,0,0,.35)", padding: 36 * k });

const Items: React.FC<OverlayRender & { numbered?: boolean; check?: boolean }> = ({ o, brand, t, k, itemT, numbered, check }) => (
  <div style={{ ...card(k), width: 820 * k }}>
    {o.text ? <div style={{ fontFamily: font(brand.headingFont), fontWeight: 900, fontSize: 52 * k, color: brand.ink, marginBottom: 20 * k }}>{o.text}</div> : null}
    {(o.items || []).map((it, i) => {
      const at = itemT[i] ?? 0.25 + i * 0.5;
      const e = progress(t, at, at + 0.3);
      const done = check && t > at + 0.15;
      return (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 22 * k, margin: `${12 * k}px 0`, opacity: Math.min(1, e * 2), transform: `translateX(${(1 - outC(e)) * 60}px)` }}>
          <div style={{ width: 56 * k, height: 56 * k, flex: "none", borderRadius: numbered ? "50%" : 14 * k, background: done || numbered ? brand.primary : "#E8E8E8", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font("Inter"), fontWeight: 900, fontSize: 32 * k, transform: `scale(${done ? outBack(progress(t, at + 0.15, at + 0.4)) : 1})` }}>
            {numbered ? i + 1 : done ? "✓" : ""}
          </div>
          <div style={{ fontFamily: font("Inter"), fontWeight: 700, fontSize: 44 * k, color: "#111", textDecoration: "none" }}>{it}</div>
        </div>
      );
    })}
  </div>
);

const RENDERERS: Record<OverlayKind, (p: OverlayRender) => React.ReactNode> = {
  emoji: ({ o, t, k }) => <div style={{ fontSize: 180 * k * (1 + 0.05 * Math.sin(t * 8)) }}>{o.emoji || o.text || "🔥"}</div>,
  sticker: ({ o, brand, k }) => (
    <div style={{ background: o.color || brand.accent, color: brand.ink, fontFamily: font("Lilita One"), fontSize: 70 * k, padding: `${14 * k}px ${34 * k}px`, borderRadius: 22 * k, border: `${6 * k}px solid #FFF`, boxShadow: "6px 6px 0 rgba(0,0,0,.85)", whiteSpace: "nowrap" }}>
      {o.emoji ? `${o.emoji} ` : ""}
      {o.text}
    </div>
  ),
  lowerThird: ({ o, brand, t, k }) => {
    const e = outC(progress(t, 0, 0.4));
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <div style={{ background: brand.primary, color: "#FFF", fontFamily: font(brand.headingFont), fontWeight: 900, fontSize: 54 * k, padding: `${10 * k}px ${24 * k}px`, clipPath: `inset(0 ${(1 - e) * 100}% 0 0)` }}>{o.text || brand.name}</div>
        <div style={{ background: "#FFF", color: "#111", fontFamily: font("Inter"), fontWeight: 600, fontSize: 34 * k, padding: `${8 * k}px ${24 * k}px`, clipPath: `inset(0 ${(1 - outC(progress(t, 0.15, 0.55))) * 100}% 0 0)` }}>{o.subtitle || `@${brand.handle}`}</div>
      </div>
    );
  },
  checklist: (p) => <Items {...p} check />,
  numberedList: (p) => <Items {...p} numbered />,
  progressSteps: ({ o, brand, t, k, itemT }) => {
    const items = o.items || [];
    return (
      <div style={{ display: "flex", gap: 14 * k, alignItems: "center" }}>
        {items.map((it, i) => {
          const at = itemT[i] ?? i * 0.6;
          const on = t >= at;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 * k }}>
              <div style={{ padding: `${14 * k}px ${22 * k}px`, borderRadius: 999, background: on ? brand.primary : "rgba(255,255,255,.85)", color: on ? "#FFF" : "#333", fontFamily: font("Inter"), fontWeight: 800, fontSize: 34 * k, transform: `scale(${on ? 1 + 0.12 * (1 - outC(progress(t, at, at + 0.3))) : 0.92})` }}>{it}</div>
              {i < items.length - 1 ? <div style={{ width: 30 * k, height: 6 * k, background: on ? brand.primary : "rgba(255,255,255,.6)", borderRadius: 3 }} /> : null}
            </div>
          );
        })}
      </div>
    );
  },
  counter: ({ o, brand, t, dur, k }) => {
    const e = Easing.out(Easing.exp)(progress(t, 0, Math.min(1.4, dur * 0.7)));
    const v = (o.value ?? 100) * e;
    const whole = Number.isInteger(o.value ?? 100); // 17 counts up as 1, 2 … 17, not 16.9, 17.0
    const shown = whole ? Math.round(v).toLocaleString() : v.toFixed(1);
    return (
      <div style={{ ...card(k), textAlign: "center", padding: `${30 * k}px ${50 * k}px` }}>
        <div style={{ fontFamily: font("Unbounded"), fontWeight: 900, fontSize: 120 * k, color: brand.primary, lineHeight: 1 }}>
          {o.prefix}
          {shown}
          {o.suffix}
        </div>
        {o.text ? <div style={{ fontFamily: font("Inter"), fontWeight: 700, fontSize: 38 * k, color: "#333", marginTop: 10 * k }}>{o.text}</div> : null}
      </div>
    );
  },
  keyword: ({ o, brand, k }) => (
    <div style={{ fontFamily: font(brand.headingFont), fontWeight: 900, fontSize: 150 * k * Math.min(1, 9 / Math.max(1, (o.text || "").length)), color: o.color || brand.accent, textTransform: "uppercase", letterSpacing: -4 * k, textShadow: "0 12px 40px rgba(0,0,0,.5)", whiteSpace: "nowrap" }}>{o.text}</div>
  ),
  image: ({ o, k }) => (o.src ? <Img src={resolveAsset(o.src)} style={{ width: 640 * k, borderRadius: 28 * k, border: `${10 * k}px solid #FFF`, boxShadow: "0 24px 60px rgba(0,0,0,.4)" }} /> : null),
  arrow: ({ o, brand, t, k }) => {
    const e = outC(progress(t, 0, 0.45));
    return (
      <svg width={300 * k} height={220 * k} viewBox="0 0 300 220" style={{ overflow: "visible" }}>
        <path d="M20 200 C 60 60, 180 40, 260 60" fill="none" stroke={o.color || brand.accent} strokeWidth={14} strokeLinecap="round" strokeDasharray={400} strokeDashoffset={400 * (1 - e)} />
        <path d="M225 30 L 265 60 L 225 95" fill="none" stroke={o.color || brand.accent} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" opacity={e > 0.9 ? 1 : 0} />
        {o.text ? (
          <text x="0" y="200" dy="50" fill="#FFF" fontFamily={font("Caveat")} fontWeight={700} fontSize={56}>
            {o.text}
          </text>
        ) : null}
      </svg>
    );
  },
  circle: ({ o, brand, t, k }) => {
    const e = outC(progress(t, 0, 0.5));
    return (
      <svg width={420 * k} height={260 * k} viewBox="0 0 420 260" style={{ overflow: "visible" }}>
        <ellipse cx="210" cy="130" rx="195" ry="110" fill="none" stroke={o.color || brand.accent} strokeWidth={12} strokeDasharray={1000} strokeDashoffset={1000 * (1 - e)} transform="rotate(-6 210 130)" />
      </svg>
    );
  },
  followButton: ({ o, brand, t, dur, k }) => {
    const tapAt = Math.min(0.9, dur * 0.5);
    const tapped = t > tapAt;
    const press = 1 - 0.08 * Math.sin(Math.PI * progress(t, tapAt - 0.1, tapAt + 0.1));
    return (
      <div style={{ position: "relative", transform: `scale(${press})` }}>
        <div style={{ background: tapped ? "#EDEDED" : brand.primary, color: tapped ? "#111" : "#FFF", fontFamily: font("Inter"), fontWeight: 800, fontSize: 48 * k, padding: `${20 * k}px ${70 * k}px`, borderRadius: 18 * k, boxShadow: "0 16px 40px rgba(0,0,0,.35)" }}>
          {tapped ? "Following" : o.text || "Follow"}
        </div>
        <div style={{ position: "absolute", right: -20 * k, bottom: -50 * k, fontSize: 80 * k, transform: `translate(${(1 - outC(progress(t, 0, tapAt))) * 120}px, ${(1 - outC(progress(t, 0, tapAt))) * 120}px)` }}>👆</div>
      </div>
    );
  },
  notification: ({ o, brand, k }) => (
    <div style={{ width: 900 * k, background: "rgba(245,245,247,.96)", borderRadius: 36 * k, padding: `${26 * k}px ${30 * k}px`, display: "flex", gap: 24 * k, alignItems: "center", boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}>
      <div style={{ width: 84 * k, height: 84 * k, borderRadius: 20 * k, background: brand.primary, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48 * k }}>{o.emoji || "💬"}</div>
      <div>
        <div style={{ fontFamily: font("Inter"), fontWeight: 800, fontSize: 34 * k, color: "#111" }}>{o.text}</div>
        <div style={{ fontFamily: font("Inter"), fontWeight: 500, fontSize: 30 * k, color: "#555", marginTop: 4 * k }}>{o.subtitle}</div>
      </div>
    </div>
  ),
  quote: ({ o, brand, k }) => (
    <div style={{ ...card(k), width: 860 * k, background: brand.ink, color: "#FFF" }}>
      <div style={{ fontFamily: font(brand.serifFont), fontSize: 160 * k, lineHeight: 0.6, color: brand.accent }}>“</div>
      <div style={{ fontFamily: font(brand.serifFont), fontStyle: "italic", fontSize: 62 * k, lineHeight: 1.15 }}>{o.text}</div>
      {o.subtitle ? <div style={{ fontFamily: font("Inter"), fontWeight: 600, fontSize: 32 * k, opacity: 0.7, marginTop: 18 * k }}>— {o.subtitle}</div> : null}
    </div>
  ),
  commentReply: ({ o, brand, k }) => (
    <div style={{ background: "#FFF", borderRadius: 28 * k, padding: `${22 * k}px ${28 * k}px`, width: 760 * k, boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}>
      <div style={{ fontFamily: font("Inter"), fontWeight: 600, fontSize: 28 * k, color: "#888" }}>Reply to {o.subtitle ? `@${o.subtitle}` : "a viewer"}'s comment</div>
      <div style={{ fontFamily: font("Inter"), fontWeight: 800, fontSize: 44 * k, color: "#111", marginTop: 8 * k }}>{o.text}</div>
      <div style={{ width: 120 * k, height: 8 * k, borderRadius: 4, background: brand.primary, marginTop: 14 * k }} />
    </div>
  ),
  poll: ({ o, brand, t, k, itemT }) => {
    const items = o.items || ["Yes", "No"];
    const e = outC(progress(t, itemT[0] ?? 0.4, (itemT[0] ?? 0.4) + 0.8));
    const pct = items.map((_, i) => (i === 0 ? 68 : Math.round(32 / Math.max(1, items.length - 1))));
    return (
      <div style={{ ...card(k), width: 760 * k }}>
        <div style={{ fontFamily: font("Inter"), fontWeight: 900, fontSize: 48 * k, color: "#111", marginBottom: 20 * k, textAlign: "center" }}>{o.text}</div>
        {items.map((it, i) => (
          <div key={i} style={{ position: "relative", height: 84 * k, borderRadius: 999, background: "#EEE", margin: `${12 * k}px 0`, overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0, width: `${pct[i] * e}%`, background: i === 0 ? brand.primary : withAlpha(brand.primary, 0.35) }} />
            <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", height: "100%", padding: `0 ${32 * k}px`, fontFamily: font("Inter"), fontWeight: 800, fontSize: 38 * k, color: "#111" }}>
              <span>{it}</span>
              <span>{Math.round(pct[i] * e)}%</span>
            </div>
          </div>
        ))}
      </div>
    );
  },
  tierList: ({ o, t, k, itemT }) => {
    const tiers = o.tiers || [];
    const colors = ["#FF6B6B", "#FFB86B", "#FFE66B", "#9BE66B", "#6BC5FF"];
    let n = 0;
    return (
      <div style={{ width: 960 * k, borderRadius: 20 * k, overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,.35)", background: "#1A1A1A" }}>
        {tiers.map((tier, ti) => (
          <div key={ti} style={{ display: "flex", minHeight: 120 * k, borderBottom: `${3 * k}px solid #000` }}>
            <div style={{ width: 130 * k, flex: "none", background: tier.color || colors[ti % colors.length], display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font("Archivo Black"), fontSize: 64 * k, color: "#111" }}>{tier.label}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 * k, padding: 12 * k, alignItems: "center" }}>
              {tier.items.map((it, ii) => {
                const at = itemT[n] ?? 0.3 + n * 0.5;
                n++;
                const e = progress(t, at, at + 0.35);
                if (e <= 0) return null;
                return (
                  <div key={ii} style={{ background: "#FFF", borderRadius: 12 * k, padding: `${12 * k}px ${18 * k}px`, fontFamily: font("Inter"), fontWeight: 800, fontSize: 34 * k, color: "#111", transform: `translateY(${(1 - Easing.bounce(e)) * -200}px)` }}>
                    {it}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  },
  splitHeadline: ({ o, brand, t, k }) => {
    const e = outC(progress(t, 0, 0.4));
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ transform: `translateX(${(1 - e) * -100}%)`, fontFamily: font(brand.headingFont), fontWeight: 900, fontSize: 96 * k, color: "#FFF", textTransform: "uppercase", lineHeight: 1 }}>{o.text}</div>
        <div style={{ transform: `translateX(${(1 - e) * 100}%)`, fontFamily: font(brand.serifFont), fontStyle: "italic", fontSize: 110 * k, color: brand.accent, lineHeight: 1 }}>{o.subtitle}</div>
      </div>
    );
  },
  postCard: ({ o, brand, k }) => (
    <div style={{ ...card(k), width: 860 * k, textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 * k }}>
        <div style={{ width: 70 * k, height: 70 * k, borderRadius: "50%", background: brand.primary }} />
        <div>
          <div style={{ fontFamily: font("Inter"), fontWeight: 800, fontSize: 32 * k, color: "#111" }}>{o.subtitle || brand.name}</div>
          <div style={{ fontFamily: font("Inter"), fontWeight: 500, fontSize: 26 * k, color: "#888" }}>@{brand.handle}</div>
        </div>
      </div>
      <div style={{ fontFamily: font("Inter"), fontWeight: 600, fontSize: 42 * k, lineHeight: 1.3, color: "#111", marginTop: 20 * k }}>{o.text}</div>
    </div>
  ),
};

export const OVERLAY_KINDS = Object.keys(RENDERERS) as OverlayKind[];

const DEFAULT_ENTER: Partial<Record<OverlayKind, string>> = {
  emoji: "pop",
  sticker: "spin-pop",
  lowerThird: "fade",
  keyword: "scale-down",
  arrow: "fade",
  circle: "fade",
  notification: "slide-down",
  commentReply: "pop",
  followButton: "pop",
  tierList: "slide-down",
};

const DEFAULT_POS: Partial<Record<OverlayKind, [number, number]>> = {
  lowerThird: [0.36, 0.66],
  notification: [0.5, 0.17],
  emoji: [0.78, 0.3],
  sticker: [0.5, 0.2],
  tierList: [0.5, 0.3],
  progressSteps: [0.5, 0.17],
};

/** One overlay placed on the reel. `start`/`end` are OUTPUT seconds. */
export const OverlayItem: React.FC<{ o: ReelOverlay; brand: BrandKit; start: number; end: number; itemTimes: number[] }> = ({ o, brand, start, end, itemTimes }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tg = frame / fps;
  if (tg < start || tg > end) return null;
  const t = tg - start;
  const dur = end - start;
  const k = kOf(width, height);
  const enterId = o.enter || DEFAULT_ENTER[o.kind] || "pop";
  const enter = EFFECT_MAP[enterId];
  const fx = enter ? enter.fn(progress(t, 0, enter.duration), 1) : {};
  const exit = 1 - progress(t, dur - 0.2, dur);
  const [dx, dy] = DEFAULT_POS[o.kind] || [0.5, 0.36];
  const x = (o.x ?? dx) * width;
  const y = (o.y ?? dy) * height;
  const render = RENDERERS[o.kind];
  if (!render) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          transform: `translate(-50%, -50%) rotate(${o.rotate ?? 0}deg) scale(${(o.scale ?? 1) * (0.9 + 0.1 * exit)})`,
          opacity: exit,
        }}
      >
        <div style={{ transform: fx.transform, opacity: fx.opacity ?? 1, filter: fx.filter, clipPath: fx.clipPath }}>
          {render({ o, brand, t, dur, k, itemT: itemTimes.map((it) => it - start) })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
