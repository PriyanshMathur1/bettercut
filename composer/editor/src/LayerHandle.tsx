import React, { useRef } from "react";
import { sampleKeys } from "../../src/reel/keyframes";
import { layerBase, type Layer } from "../../src/reel/layers";

/**
 * A handle over the preview for the selected layer: drag it to move the layer in the frame.
 * It sits at the layer's centre and only shows while the playhead is on the layer.
 */
export const LayerHandle: React.FC<{ layer: Layer; at: number; onMove: (x: number, y: number) => void }> = ({ layer, at, onMove }) => {
  const dot = useRef<HTMLDivElement>(null);
  const v = sampleKeys(layer.keys, at, layerBase(layer));

  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const frame = dot.current?.parentElement?.getBoundingClientRect();
    if (!frame || !frame.width || !frame.height) return;
    const move = (ev: PointerEvent) => onMove((ev.clientX - frame.left) / frame.width, (ev.clientY - frame.top) / frame.height);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={dot}
      className="layer-handle"
      style={{ left: `${v.x * 100}%`, top: `${v.y * 100}%` }}
      onPointerDown={drag}
      onClick={(e) => e.stopPropagation()}
      title="Drag to move this layer"
      role="slider"
      aria-label="Layer position"
      aria-valuetext={`${Math.round(v.x * 100)}% across, ${Math.round(v.y * 100)}% down`}
    />
  );
};
