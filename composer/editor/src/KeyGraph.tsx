import React, { useRef, useState } from "react";
import { animatedProps, curve, moveKey, valueRange } from "../../src/reel/graph";
import type { Ease, Key } from "../../src/reel/keyframes";

const W = 1000;
const H = 220;
const EASES: { id: Ease; name: string }[] = [
  { id: "smooth", name: "Smooth" },
  { id: "linear", name: "Steady" },
  { id: "hold", name: "Jump" },
  { id: "back", name: "Overshoot" },
];

/**
 * The keyframe graph for the selection: one animated property at a time, drawn as a curve over time. Drag a
 * point sideways to change when that keyframe happens, up or down to change its value; the motion menu
 * sets how it travels to the next keyframe. Collapsed until opened.
 */
export const KeyGraph: React.FC<{
  keys: Key[] | undefined;
  /** Resting values, for properties before their first keyframe. */
  base: Record<string, number>;
  /** Property names, in the order to offer them. */
  order: readonly string[];
  labels: Record<string, string>;
  /** The span of time shown, in the same seconds the keys use. */
  range: [number, number];
  onChange: (keys: Key[]) => void;
}> = ({ keys, base, order, labels, range, onChange }) => {
  const [open, setOpen] = useState(false);
  const [prop, setProp] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const props = animatedProps(keys, order);
  if (!props.length || !(range[1] > range[0])) return null;
  const p = prop && props.includes(prop) ? prop : props[0];
  const sorted = [...(keys || [])].sort((a, b) => a.at - b.at);
  const pts = curve(sorted, p, base[p] ?? 0, range);
  const own = sorted.map((k, i) => ({ k, i })).filter(({ k }) => typeof k[p] === "number");
  const [lo, hi] = valueRange([...pts.map((q) => q.v), ...own.map(({ k }) => k[p] as number)]);
  const X = (t: number) => ((t - range[0]) / (range[1] - range[0])) * W;
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const path = pts.map((q, i) => `${i ? "L" : "M"}${X(q.t).toFixed(1)},${Y(q.v).toFixed(1)}`).join(" ");
  const chosen = sel !== null ? sorted[sel] : undefined;

  const drag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSel(i);
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const [l, h] = [lo, hi]; // keep the scale still while dragging
    const move = (ev: PointerEvent) => {
      const t = range[0] + ((ev.clientX - box.left) / box.width) * (range[1] - range[0]);
      const v = l + (1 - (ev.clientY - box.top) / box.height) * (h - l);
      onChange(moveKey(sorted, i, p, t, v, range));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="tl-graph">
      <div className="tl-keys">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} title="See and shape how the keyframes move">
          {open ? "Hide graph" : "Graph"}
        </button>
        {open
          ? props.map((q) => (
              <button key={q} className={q === p ? "on" : ""} aria-pressed={q === p} onClick={() => setProp(q)}>
                {labels[q] || q}
              </button>
            ))
          : null}
        {open && chosen ? (
          <>
            <span className="tl-info">
              Keyframe at {chosen.at.toFixed(2)}s · {labels[p] || p} {typeof chosen[p] === "number" ? (chosen[p] as number).toFixed(2) : "–"}
            </span>
            <label title="How the value travels from this keyframe to the next">
              Motion
              <select
                value={(chosen.ease as Ease) || "smooth"}
                onChange={(e) => onChange(sorted.map((k, j) => (j === sel ? { ...k, ease: e.target.value as Ease } : k)))}
              >
                {EASES.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>
      {open ? (
        <svg ref={svg} className="tl-graph-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${labels[p] || p} over time`}>
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          {own.map(({ k, i }) => (
            <circle
              key={i}
              cx={X(k.at)}
              cy={Y(k[p] as number)}
              r={i === sel ? 13 : 10}
              className={i === sel ? "sel" : ""}
              onPointerDown={drag(i)}
              style={{ cursor: "grab" }}
            >
              <title>{`${k.at.toFixed(2)}s: ${(k[p] as number).toFixed(2)}`}</title>
            </circle>
          ))}
        </svg>
      ) : null}
    </div>
  );
};
