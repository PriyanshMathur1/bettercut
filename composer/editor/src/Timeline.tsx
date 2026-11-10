import React, { useEffect, useRef, useState } from "react";
import type { ReelSpec } from "../../src/reel/types";
import { placeSegments, rangeToOutput, speedOf, toSource, totalOutDuration } from "../../src/reel/timeline";
import { baseOf, patchShot, removeShot, splitAt, trimShot } from "../../src/reel/edit";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** Seconds between ruler labels, so there are roughly 8 across the visible width. */
const tickStep = (duration: number, zoom: number) => {
  const want = duration / (8 * zoom);
  return [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s >= want) || 300;
};

export const Timeline: React.FC<{
  spec: ReelSpec;
  placed: ReturnType<typeof placeSegments>;
  duration: number;
  t: number;
  notes: { t: number; text: string }[];
  onSeek: (t: number) => void;
  update: (fn: (s: ReelSpec) => ReelSpec) => void;
}> = ({ spec, placed, duration, t, notes, onSeek, update }) => {
  const [sel, setSel] = useState<number | null>(null); // selected shot, in source order
  const [zoom, setZoom] = useState(1);
  const lane = useRef<HTMLDivElement>(null);

  const shots = [...spec.segments].sort((a, b) => a.start - b.start);
  const body = totalOutDuration(placed);
  const pct = (x: number) => `${(x / duration) * 100}%`;
  const pieces = placed.map((p) => ({ p, base: baseOf(shots, p) }));
  const selected = sel !== null && shots[sel] ? shots[sel] : null;
  const mine = pieces.filter((x) => x.base === sel);
  const overlays = spec.overlays.map((o) => ({ o, r: rangeToOutput(placed, o.start, o.end) })).filter((x) => x.r) as { o: ReelSpec["overlays"][number]; r: { start: number; end: number } }[];
  const broll = spec.broll.map((b) => ({ b, r: rangeToOutput(placed, b.start, b.end) })).filter((x) => x.r) as { b: ReelSpec["broll"][number]; r: { start: number; end: number } }[];

  const canSplit = t < body - 0.01;
  const split = () => {
    if (!canSplit) return;
    const at = toSource(placed, t);
    update((s) => ({ ...s, segments: splitAt(s.segments, at) }));
    setSel(null);
  };
  const remove = () => {
    if (sel === null || shots.length <= 1) return;
    update((s) => ({ ...s, segments: removeShot(s.segments, sel) }));
    setSel(null);
  };

  // keyboard: S splits at the playhead, Delete removes the selected shot, Esc clears the selection
  const keys = useRef({ split, remove });
  keys.current = { split, remove };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "s" || e.key === "S") keys.current.split();
      else if (e.key === "Delete" || e.key === "Backspace") keys.current.remove();
      else if (e.key === "Escape") setSel(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const outAt = (clientX: number) => {
    const r = lane.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };

  /** Drag on the ruler or empty lane: scrub the playhead. */
  const scrub = (e: React.PointerEvent) => {
    onSeek(outAt(e.clientX));
    const move = (ev: PointerEvent) => onSeek(outAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Drag a handle of the selected shot: trim that edge. Everything after it moves along (ripple). */
  const trim = (edge: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (sel === null || !selected) return;
    const i = sel;
    const from = edge === "start" ? selected.start : selected.end;
    const perPx = (duration / lane.current!.getBoundingClientRect().width) * speedOf(selected); // source seconds per pixel
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => {
      const to = from + (ev.clientX - x0) * perPx;
      update((s) => ({ ...s, segments: trimShot(s.segments, i, edge, to, s.source.duration) }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const step = tickStep(duration, zoom);
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);

  return (
    <div className="tl">
      <div className="tl-bar">
        <button onClick={split} disabled={!canSplit} title="Cut the shot at the playhead (S)">
          Split
        </button>
        <button onClick={remove} disabled={sel === null || shots.length <= 1} title="Remove the selected shot (Delete)">
          Delete shot
        </button>
        {selected ? (
          <>
            <label title="Playback speed of this shot">
              Speed
              <select
                value={speedOf(selected)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  update((s) => ({ ...s, segments: patchShot(s.segments, sel!, { speed: v === 1 ? undefined : v }) }));
                }}
              >
                {SPEEDS.map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
            <span className="tl-info">
              Shot {sel! + 1} of {shots.length} · {((selected.end - selected.start) / speedOf(selected)).toFixed(1)}s · drag its edges to trim
            </span>
          </>
        ) : (
          <span className="tl-info">Click a shot to select it</span>
        )}
        <div className="spacer" />
        <span className="tl-info">
          {clock(t)} / {clock(duration)}
        </span>
        <button onClick={() => setZoom((z) => Math.max(1, z / 2))} disabled={zoom <= 1} title="Zoom the timeline out" aria-label="Zoom timeline out">
          −
        </button>
        <button onClick={() => setZoom((z) => Math.min(16, z * 2))} disabled={zoom >= 16} title="Zoom the timeline in" aria-label="Zoom timeline in">
          +
        </button>
      </div>
      <div className="tl-scroll">
        <div className="tl-lane" ref={lane} style={{ width: `${zoom * 100}%` }} onPointerDown={scrub}>
          <div className="tl-ruler">
            {ticks.map((x) => (
              <span key={x} style={{ left: pct(x) }}>
                {clock(x)}
              </span>
            ))}
          </div>
          <div className="tl-track shots">
            {pieces.map(({ p, base }) => (
              <div
                key={p.index}
                className={`shot ${base % 2 ? "b" : ""} ${base === sel ? "sel" : ""}`}
                style={{ left: pct(p.outStart), width: pct(p.outEnd - p.outStart) }}
                title={`Shot ${base + 1}: ${p.start.toFixed(2)}–${p.end.toFixed(2)}s of the footage${speedOf(p) !== 1 ? `, ${speedOf(p)}×` : ""}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSel(base);
                  onSeek(outAt(e.clientX));
                }}
              >
                {speedOf(p) !== 1 ? <i>{speedOf(p)}×</i> : null}
              </div>
            ))}
            {spec.endCard?.enabled ? <div className="shot end" style={{ left: pct(duration - spec.endCard.duration), width: pct(spec.endCard.duration) }} title="End card" /> : null}
            {mine.length ? (
              <>
                <div className="handle" style={{ left: pct(mine[0].p.outStart) }} onPointerDown={trim("start")} title="Drag to trim the start" />
                <div className="handle right" style={{ left: pct(mine[mine.length - 1].p.outEnd) }} onPointerDown={trim("end")} title="Drag to trim the end" />
              </>
            ) : null}
          </div>
          <div className="tl-track extras">
            {overlays.map(({ o, r }, i) => (
              <div key={i} className="ov" style={{ left: pct(r.start), width: pct(r.end - r.start) }} title={o.kind}>
                {o.kind}
              </div>
            ))}
            {broll.map(({ b, r }, i) => (
              <div key={`b${i}`} className="ov broll" style={{ left: pct(r.start), width: pct(r.end - r.start) }} title={b.src}>
                b-roll
              </div>
            ))}
          </div>
          {notes
            .filter((n) => n.t !== null && n.t !== undefined)
            .map((n, i) => (
              <div key={i} className="note-pin" style={{ left: pct(n.t) }} title={n.text} />
            ))}
          <div className="playhead" style={{ left: pct(t) }} />
        </div>
      </div>
    </div>
  );
};
