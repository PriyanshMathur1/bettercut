import React from "react";
import { MASK_SHAPES, maskOf, type Mask, type MaskShape } from "../../src/reel/masks";
import { NumField } from "./Timeline";

const FIELDS: { id: "x" | "y" | "w" | "h" | "feather"; label: string; step: number; min: number; max: number }[] = [
  { id: "x", label: "X", step: 0.02, min: 0, max: 1 },
  { id: "y", label: "Y", step: 0.02, min: 0, max: 1 },
  { id: "w", label: "Width", step: 0.02, min: 0.02, max: 2 },
  { id: "h", label: "Height", step: 0.02, min: 0.02, max: 2 },
  { id: "feather", label: "Feather", step: 0.05, min: 0, max: 1 },
];

/** Show only part of the selected layer: pick a shape, place and size it in the layer's box, soften its edge. */
export const MaskRow: React.FC<{ mask: Mask | undefined; onChange: (mask: Mask | undefined) => void }> = ({ mask, onChange }) => {
  const m = mask ? maskOf(mask) : null;
  return (
    <div className="tl-keys">
      <span className="tl-info" title="Show only part of this layer">
        Mask
      </span>
      <label>
        Shape
        <select
          value={m ? m.shape : ""}
          aria-label="Mask shape"
          onChange={(e) => {
            const shape = e.target.value as MaskShape | "";
            onChange(shape ? { ...(mask || {}), shape } : undefined);
          }}
        >
          <option value="">None</option>
          {MASK_SHAPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {m ? (
        <>
          {FIELDS.map((f) => (
            <label key={f.id} title={f.id === "feather" ? "How soft the edge is" : "As a fraction of the layer's size"}>
              {f.label}
              <NumField step={f.step} min={f.min} max={f.max} value={m[f.id]} onChange={(v) => onChange({ ...(mask as Mask), [f.id]: v })} />
            </label>
          ))}
          <label title="Show everything except the shape">
            <input type="checkbox" checked={m.invert} onChange={(e) => onChange({ ...(mask as Mask), invert: e.target.checked || undefined })} />
            Invert
          </label>
        </>
      ) : null}
    </div>
  );
};
