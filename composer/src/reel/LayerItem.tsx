import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveAsset } from "./asset";
import { sampleKeys } from "./keyframes";
import { layerBase, layerVolume, playable, type Layer } from "./layers";

/**
 * One media layer on the output timeline. `start`/`end` are OUTPUT seconds.
 * Pictures are sized as a fraction of the frame width and placed by their centre, so a layer looks the
 * same in every aspect ratio. Keyframes move, resize, turn and fade it over its life.
 */
export const LayerItem: React.FC<{ layer: Layer; start: number; end: number }> = ({ layer, start, end }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const from = Math.round(start * fps);
  // never play past the end of the layer's own file: the footage under it may be slowed, or the layer stretched
  const dur = Math.max(1, Math.min(Math.round(end * fps) - from, Math.floor(playable(layer) * fps)));
  const trim = Math.max(0, Math.round((layer.from ?? 0) * fps));
  const volume = layerVolume(layer);
  const src = resolveAsset(layer.src);

  if (layer.kind === "audio") {
    return (
      <Sequence from={from} durationInFrames={dur} layout="none">
        <Audio src={src} trimBefore={trim} volume={volume} />
      </Sequence>
    );
  }

  const v = sampleKeys(layer.keys, frame / fps - start, layerBase(layer));
  const w = Math.max(1, v.scale * width);
  const box: React.CSSProperties = {
    position: "absolute",
    left: v.x * width,
    top: v.y * height,
    width: w,
    transform: `translate(-50%, -50%) rotate(${v.rotate}deg)`,
    opacity: Math.min(1, Math.max(0, v.opacity)),
    borderRadius: Math.min(0.5, Math.max(0, layer.radius ?? 0)) * w,
    overflow: "hidden",
  };
  const media: React.CSSProperties = { display: "block", width: "100%", height: "auto" };
  return (
    <Sequence from={from} durationInFrames={dur} layout="none">
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={box}>
          {layer.kind === "image" ? <Img src={src} style={media} /> : <OffthreadVideo src={src} trimBefore={trim} muted={volume === 0} volume={volume} style={media} />}
        </div>
      </AbsoluteFill>
    </Sequence>
  );
};
