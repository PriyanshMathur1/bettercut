import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { BrandKit, CaptionSettings } from "../types";
import { font } from "../fonts";
import { kOf } from "../brand";
import { POSITION_Y } from "./CaptionLayer";

/**
 * One translated sentence as a clean subtitle. In bilingual mode it sits under the word-by-word captions;
 * on its own it takes their place.
 */
export const TranslationLine: React.FC<{ text: string; settings: CaptionSettings; brand: BrandKit; below: boolean }> = ({ text, settings, brand, below }) => {
  const { width, height } = useVideoConfig();
  const k = kOf(width, height) * (settings.scale || 1);
  const y = (POSITION_Y[settings.position] ?? POSITION_Y.lower) + (below ? 0.085 : 0);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: "8%", right: "8%", top: `${y * 100}%`, transform: "translateY(-50%)", display: "flex", justifyContent: "center" }}>
        <div
          dir="auto"
          style={{
            fontFamily: font(brand.bodyFont),
            fontWeight: 700,
            fontSize: (below ? 40 : 54) * k,
            lineHeight: 1.25,
            color: "#FFFFFF",
            textAlign: "center",
            background: "rgba(0,0,0,.62)",
            padding: `${10 * k}px ${22 * k}px`,
            borderRadius: 16 * k,
            textWrap: "balance" as any,
          }}
        >
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
