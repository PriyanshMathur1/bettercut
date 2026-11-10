import React from "react";
import { useCurrentFrame } from "remotion";
import { FX_MAP, amountOf, fxId, overlaysFor, svgSpec, type ClipEffect } from "./clipfx";

/**
 * The SVG filters a clip's effect stack refers to. Render once per clip, with the same `uid` and `k` as
 * the `filterFor` call that builds the clip's CSS filter. Draws nothing itself.
 */
export const FxDefs: React.FC<{ effects?: ClipEffect[]; k: number; uid: string }> = ({ effects, k, uid }) => {
  const defs = (effects || [])
    .map((e, i) => ({ e, i, s: FX_MAP[e.type]?.family === "svg" && amountOf(e) > 0 ? svgSpec(e, k) : null }))
    .filter((x) => x.s);
  if (!defs.length) return null;
  return (
    <svg width="0" height="0" style={{ position: "absolute", pointerEvents: "none" }} aria-hidden="true">
      <defs>
        {defs.map(({ i, s }) => {
          const id = fxId(uid, i);
          if (s!.type === "glow")
            return (
              // bloom: a blurred, brightened copy screened over the picture
              <filter key={id} id={id} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
                <feGaussianBlur in="SourceGraphic" stdDeviation={s!.blur} result="b" />
                <feColorMatrix in="b" type="matrix" values={`${s!.gain} 0 0 0 0  0 ${s!.gain} 0 0 0  0 0 ${s!.gain} 0 0  0 0 0 1 0`} result="bb" />
                <feBlend in="SourceGraphic" in2="bb" mode="screen" />
              </filter>
            );
          if (s!.type === "fringe")
            return (
              // red pushed one way and blue the other, like a cheap lens
              <filter key={id} id={id} x="-5%" y="0%" width="110%" height="100%" colorInterpolationFilters="sRGB">
                <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
                <feOffset in="r" dx={s!.shift} result="ro" />
                <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
                <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
                <feOffset in="b" dx={-s!.shift} result="bo" />
                <feBlend in="ro" in2="g" mode="screen" result="rg" />
                <feBlend in="rg" in2="bo" mode="screen" />
              </filter>
            );
          const d = s as { type: "duotone"; mix: number; dark: number[]; light: number[] };
          return (
            // brightness mapped onto a two-colour ramp, mixed back over the original
            <filter key={id} id={id} colorInterpolationFilters="sRGB">
              <feColorMatrix in="SourceGraphic" type="matrix" values=".2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  0 0 0 1 0" result="grey" />
              <feComponentTransfer in="grey" result="duo">
                <feFuncR type="table" tableValues={`${d.dark[0]} ${d.light[0]}`} />
                <feFuncG type="table" tableValues={`${d.dark[1]} ${d.light[1]}`} />
                <feFuncB type="table" tableValues={`${d.dark[2]} ${d.light[2]}`} />
              </feComponentTransfer>
              <feComposite in="duo" in2="SourceGraphic" operator="arithmetic" k1="0" k2={d.mix} k3={1 - d.mix} k4="0" />
            </filter>
          );
        })}
      </defs>
    </svg>
  );
};

/** Film grain and vignette, filling whatever box they are placed in (the clip's own box). */
export const FxOverlays: React.FC<{ effects?: ClipEffect[]; uid: string }> = ({ effects, uid }) => {
  const frame = useCurrentFrame();
  const over = overlaysFor(effects);
  if (!over.length) return null;
  const fill: React.CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };
  return (
    <>
      {over.map((o, i) =>
        o.type === "vignette" ? (
          <div key={i} style={{ ...fill, background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${(0.9 * o.amount).toFixed(3)}) 100%)` }} />
        ) : (
          // the noise pattern changes a few times a second, from the frame number, so every render matches
          <div key={i} style={{ ...fill, opacity: o.amount * 0.6, mixBlendMode: "overlay" }}>
            <svg width="100%" height="100%">
              <filter id={`grain-${uid}-${frame % 4}`}>
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 4} stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <rect width="100%" height="100%" filter={`url(#grain-${uid}-${frame % 4})`} />
            </svg>
          </div>
        ),
      )}
    </>
  );
};
