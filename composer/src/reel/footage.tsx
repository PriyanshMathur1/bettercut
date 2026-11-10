import React from "react";
import { AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import { resolveAsset } from "./asset";
import type { PlacedSegment } from "./timeline";
import { cameraPieces, type Angle, type CamCut } from "./multicam";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  radius?: number;
  rotate?: number;
  circle?: boolean;
  border?: string;
  shadow?: string;
  fit?: "cover" | "contain";
}

/** Rect of a media of size (mw, mh) cover/contain-fitted into (bw, bh) around a focus point. */
export function fitRect(mw: number, mh: number, bw: number, bh: number, fit: "cover" | "contain", cx = 0.5, cy = 0.5) {
  const scale = fit === "cover" ? Math.max(bw / mw, bh / mh) : Math.min(bw / mw, bh / mh);
  const w = mw * scale;
  const h = mh * scale;
  // keep the focus point as close to the box centre as the crop allows
  const left = Math.min(0, Math.max(bw - w, bw / 2 - cx * w));
  const top = Math.min(0, Math.max(bh - h, bh / 2 - cy * h));
  return fit === "cover" ? { left, top, width: w, height: h } : { left: (bw - w) / 2, top: (bh - h) / 2, width: w, height: h };
}

const AUDIO_FADE = 2; // frames

/**
 * The cut footage: one Sequence per kept segment, each trimmed from the original file.
 * Renders at an explicit size so the colour footage and the alpha cut-out line up exactly.
 */
export const FootageTrack: React.FC<{
  placed: PlacedSegment[];
  src: string;
  srcW: number;
  srcH: number;
  boxW: number;
  boxH: number;
  fit: "cover" | "contain";
  muted?: boolean;
  volume?: number;
  transparent?: boolean;
  style?: React.CSSProperties;
  /** Multi-camera: other angles and when each is on. The sound always stays the main footage's. */
  angles?: Angle[];
  cams?: CamCut[];
}> = ({ placed, src, srcW, srcH, boxW, boxH, fit, muted, volume = 1, transparent, style, angles, cams }) => {
  const { fps } = useVideoConfig();
  const url = resolveAsset(src);
  // split shots where the camera changes; each piece knows which angle (if any) to show
  const pieces = cameraPieces(placed, cams, angles);
  return (
    <AbsoluteFill style={{ overflow: "visible" }}>
      {pieces.map((s) => {
        // the speaker cut-out exists only for the main footage: an angle has no cut-out to draw
        if (s.cam && transparent) return null;
        const from = Math.round(s.outStart * fps);
        const rate = s.speed && s.speed > 0 ? Math.min(4, Math.max(0.25, s.speed)) : 1;
        const hold = Math.min(10, Math.max(0, s.hold ?? 0));
        const holdFrom = Math.round((s.outEnd - hold) * fps);
        const dur = Math.max(1, holdFrom - from);
        const holdDur = Math.round(s.outEnd * fps) - holdFrom;
        const r = fitRect(srcW, srcH, boxW, boxH, fit, s.cx ?? 0.5, s.cy ?? 0.42);
        // A reversed shot plays its own backwards file. Source time x sits at (file end - x) in that file.
        const rev = s.reverse && s.reversed && s.reversed.start <= s.start + 0.002 && s.reversed.end >= s.end - 0.002 ? s.reversed : null;
        const shift = s.cam ? s.cam.offset : 0; // main-footage time t is t + offset in the angle's file
        const clipUrl = s.cam ? resolveAsset(s.cam.src) : rev ? resolveAsset(rev.src) : url;
        const trim = rev ? Math.max(0, Math.round((rev.end - s.end) * fps)) : Math.max(0, Math.round((s.start + shift) * fps));
        const lastFrame = rev ? Math.max(0, Math.round((rev.end - s.start) * fps) - 1) : Math.max(0, Math.round((s.end + shift) * fps) - 1);
        const fade = (f: number) => (muted ? 0 : volume * Math.min(1, (f + 1) / AUDIO_FADE, (dur - f) / AUDIO_FADE));
        const css: React.CSSProperties = { position: "absolute", left: r.left, top: r.top, width: r.width, height: r.height, maxWidth: "none", ...style };
        return (
          <React.Fragment key={`${s.index}-${s.start}`}>
          {holdDur > 0 ? (
            <Sequence from={holdFrom} durationInFrames={holdDur} layout="none">
              {/* freeze frame: the shot's last frame, silent */}
              <Freeze frame={0}>
                <OffthreadVideo src={clipUrl} trimBefore={lastFrame} muted transparent={transparent} style={css} />
              </Freeze>
            </Sequence>
          ) : null}
          <Sequence from={from} durationInFrames={dur} layout="none">
            <OffthreadVideo
              src={clipUrl}
              trimBefore={trim}
              playbackRate={rate}
              muted={muted || !!s.cam}
              transparent={transparent}
              volume={s.cam ? 0 : fade}
              style={css}
            />
            {/* an angle shows its picture; the sound keeps coming from the main footage */}
            {s.cam && !muted ? <Audio src={url} trimBefore={Math.round(s.start * fps)} playbackRate={rate} volume={fade} /> : null}
          </Sequence>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

/** A still or moving media file fitted into its parent. */
export const Media: React.FC<{ src: string; kind?: "video" | "image"; from?: number; fit?: "cover" | "contain"; muted?: boolean; style?: React.CSSProperties }> = ({
  src,
  kind,
  from = 0,
  fit = "cover",
  muted = true,
  style,
}) => {
  const { fps } = useVideoConfig();
  const isImage = kind === "image" || /\.(png|jpe?g|webp|gif|avif)$/i.test(src);
  const css: React.CSSProperties = { width: "100%", height: "100%", objectFit: fit, ...style };
  if (isImage) return <Img src={resolveAsset(src)} style={css} />;
  return <OffthreadVideo src={resolveAsset(src)} trimBefore={Math.round(from * fps)} muted={muted} style={css} />;
};
