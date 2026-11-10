import React from "react";
import { ANIM_PRESETS, applyPreset, clearPhase, type Phase, type Rest } from "../../src/reel/animate";
import type { Key } from "../../src/reel/keyframes";

const PHASES: { phase: Phase; label: string; hint: string }[] = [
  { phase: "in", label: "In", hint: "How it arrives" },
  { phase: "out", label: "Out", hint: "How it leaves" },
  { phase: "loop", label: "Loop", hint: "A movement for its whole time on screen" },
];

/**
 * One-click animation for the selected layer or overlay. Each choice writes ordinary keyframes, which then
 * show on the timeline and can be edited in the keyframe row below. "None" removes that part again.
 */
export const AnimateRow: React.FC<{
  what: string;
  keys: Key[] | undefined;
  rest: Rest;
  /** Seconds the item is on screen. */
  len: number;
  /** New keyframes; `applied` is false when a phase was removed. */
  onChange: (keys: Key[] | undefined, phase: Phase, applied: boolean) => void;
}> = ({ what, keys, rest, len, onChange }) => (
  <div className="tl-keys">
    <span className="tl-info" title={`Animate this ${what} in one click; fine-tune the result with the keyframes below`}>
      Animate
    </span>
    {PHASES.map(({ phase, label, hint }) => (
      <label key={phase} title={hint}>
        {label}
        <select
          value=""
          aria-label={`${hint} (${what})`}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            if (id === "none") {
              const next = clearPhase(keys, phase, len);
              onChange(next.length ? next : undefined, phase, false);
            } else onChange(applyPreset(keys, id, rest, len), phase, true);
          }}
        >
          <option value="">Choose…</option>
          {ANIM_PRESETS.filter((p) => p.phase === phase).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="none">None (remove)</option>
        </select>
      </label>
    ))}
  </div>
);
