import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { GradeSettings } from "./types";

export interface GradeDef {
  id: string;
  name: string;
  /** CSS filter on the footage. */
  filter: string;
  /** Optional colour wash (soft-light). */
  tint?: string;
  tintOpacity?: number;
}

export const GRADES: GradeDef[] = [
  { id: "none", name: "Natural", filter: "" },
  { id: "clean", name: "Clean Pop", filter: "contrast(1.06) saturate(1.08) brightness(1.02)" },
  { id: "punchy", name: "Punchy", filter: "contrast(1.18) saturate(1.25)" },
  { id: "warm", name: "Warm", filter: "sepia(.16) saturate(.95) contrast(.95) brightness(1.05) hue-rotate(-5deg)", tint: "#FF9A3C", tintOpacity: 0.14 },
  { id: "golden", name: "Golden Hour", filter: "sepia(.25) saturate(1.15) brightness(1.04)", tint: "#FFB347", tintOpacity: 0.2 },
  { id: "cool", name: "Cool", filter: "saturate(.92) contrast(1.05) hue-rotate(6deg)", tint: "#3C8DFF", tintOpacity: 0.12 },
  { id: "teal-orange", name: "Teal & Orange", filter: "contrast(1.1) saturate(1.1)", tint: "#008C9E", tintOpacity: 0.16 },
  { id: "moody", name: "Moody", filter: "contrast(1.12) saturate(.82) brightness(.86)", tint: "#1C3A4A", tintOpacity: 0.22 },
  { id: "editorial-dark", name: "Editorial Dark", filter: "contrast(1.1) saturate(.84) brightness(.82) hue-rotate(-4deg)", tint: "#0E3B43", tintOpacity: 0.2 },
  { id: "film", name: "Film", filter: "contrast(.94) saturate(.88) sepia(.08) brightness(1.03)", tint: "#C8A27A", tintOpacity: 0.1 },
  { id: "vintage", name: "Vintage", filter: "sepia(.35) contrast(.9) saturate(.8) brightness(1.06)" },
  { id: "pastel", name: "Pastel", filter: "saturate(.75) brightness(1.1) contrast(.88)", tint: "#FFC4E1", tintOpacity: 0.12 },
  { id: "high-key", name: "High Key", filter: "brightness(1.15) contrast(.9) saturate(.95)" },
  { id: "mono", name: "Monochrome", filter: "grayscale(1) contrast(1.15)" },
  { id: "noir", name: "Noir", filter: "grayscale(1) contrast(1.45) brightness(.88)" },
  { id: "matrix", name: "Matrix", filter: "saturate(.6) contrast(1.15) hue-rotate(40deg)", tint: "#00FF66", tintOpacity: 0.1 },
  { id: "duotone-brand", name: "Brand Duotone", filter: "grayscale(1) contrast(1.2)", tint: "var(--brand-primary)", tintOpacity: 0.45 },
];

export const GRADE_MAP: Record<string, GradeDef> = Object.fromEntries(GRADES.map((g) => [g.id, g]));

export const gradeFilter = (g: GradeSettings) => GRADE_MAP[g.preset]?.filter || "";

/** CSS approximation of the baked primary correction, for live preview before the ffmpeg bake. */
export function primaryApprox(g: GradeSettings): string {
  const f: string[] = [];
  if (g.exposure) f.push(`brightness(${Math.pow(2, g.exposure * 0.7).toFixed(3)})`);
  if (g.contrast) f.push(`contrast(${(1 + g.contrast / 200).toFixed(3)})`);
  const sat = 1 + (g.saturation || 0) / 100 + (g.vibrance || 0) / 250;
  if (sat !== 1) f.push(`saturate(${Math.max(0, sat).toFixed(3)})`);
  if (g.temperature) {
    if (g.temperature > 0) f.push(`sepia(${(g.temperature / 400).toFixed(3)})`);
    else f.push(`hue-rotate(${(g.temperature / 12).toFixed(1)}deg) saturate(${(1 + g.temperature / 800).toFixed(3)})`);
  }
  if (g.tint) f.push(`hue-rotate(${(g.tint / 15).toFixed(1)}deg)`);
  return f.join(" ");
}

const FILL: React.CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

/** Darkened edges, filling the box it is placed in. `amount` is 0..1. */
export const Vignette: React.FC<{ amount: number }> = ({ amount }) => (
  <div style={{ ...FILL, background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${(0.85 * amount).toFixed(3)}) 100%)` }} />
);

/**
 * Film grain, filling the box it is placed in. `amount` is 0..1. The pattern changes a few times a second
 * from the frame number, so every render of the same frame matches. `uid` keeps filter ids apart when
 * several grains are on screen.
 */
export const Grain: React.FC<{ amount: number; uid: string }> = ({ amount, uid }) => {
  const frame = useCurrentFrame();
  const id = `grain-${uid}-${frame % 4}`;
  return (
    <div style={{ ...FILL, opacity: amount * 0.5, mixBlendMode: "overlay" }}>
      <svg width="100%" height="100%">
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 4} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id})`} />
      </svg>
    </div>
  );
};

/** Tint, vignette and grain drawn above the footage. */
export const GradeOverlay: React.FC<{ grade: GradeSettings }> = ({ grade }) => {
  const def = GRADE_MAP[grade.preset];
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {def?.tint ? <AbsoluteFill style={{ background: def.tint, opacity: def.tintOpacity, mixBlendMode: "soft-light" }} /> : null}
      {grade.vignette > 0 ? <Vignette amount={grade.vignette} /> : null}
      {grade.grain > 0 ? <Grain amount={grade.grain} uid="reel" /> : null}
    </AbsoluteFill>
  );
};
