import React from "react";
import type { ReelSpec } from "../../src/reel/types";
import { rangeToOutput, type PlacedSegment } from "../../src/reel/timeline";
import { removeZoomAt, setZoomAt, sortZooms, zoomAt } from "../../src/reel/zooms";

/**
 * Zooms on the footage, for screen recordings: find them from what changes on screen, add one at the
 * playhead, and set how close it goes and where it points. The strip shows where the zooms are.
 */
export const ZoomRow: React.FC<{
  spec: ReelSpec;
  placed: PlacedSegment[];
  /** The playhead, in reel (output) seconds and in footage (source) seconds. */
  tOut: number;
  sourceNow: number;
  duration: number;
  busy: boolean;
  update: (fn: (s: ReelSpec) => ReelSpec) => void;
  onAuto: () => void;
}> = ({ spec, placed, tOut, sourceNow, duration, busy, update, onAuto }) => {
  const zooms = sortZooms(spec.zooms);
  const here = zoomAt(zooms, sourceNow);
  const pct = (x: number) => `${(Math.max(0, Math.min(duration, x)) / Math.max(0.001, duration)) * 100}%`;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const change = (patch: { zoom?: number; x?: number; y?: number }) =>
    update((s) => ({ ...s, zooms: sortZooms(s.zooms).map((z) => (here && z.start === here.start ? { ...z, ...patch } : z)) }));
  const aspect = (spec.width || 1080) / (spec.height || 1920);
  return (
    <div className="cam-row zoom-row">
      <div className="tl-keys">
        <span className="tl-info" title="Move in on part of the picture: made for screen recordings">
          Zooms
        </span>
        <button onClick={onAuto} disabled={busy} title="Zoom in wherever something changes on screen: a click, a menu, new text (replaces the current zooms)">
          Zoom on clicks
        </button>
        <button onClick={() => update((s) => ({ ...s, zooms: setZoomAt(s.zooms, sourceNow, 0.5, 0.5) }))} disabled={!!here} title="Add a zoom from the playhead">
          Add zoom here
        </button>
        {here ? (
          <>
            <label className="tl-info" title="How close the zoom goes">
              Zoom {here.zoom.toFixed(1)}×
              <input type="range" min={1.2} max={3} step={0.1} value={here.zoom} onChange={(e) => change({ zoom: Number(e.target.value) })} />
            </label>
            <span
              className="zoom-pad"
              role="button"
              tabIndex={0}
              title="Click where the zoom should point"
              style={{ aspectRatio: String(aspect) }}
              onClick={(e) => {
                const b = e.currentTarget.getBoundingClientRect();
                change({ x: r3((e.clientX - b.left) / b.width), y: r3((e.clientY - b.top) / b.height) });
              }}
            >
              <i style={{ left: `${here.x * 100}%`, top: `${here.y * 100}%` }} />
            </span>
            <button onClick={() => update((s) => ({ ...s, zooms: removeZoomAt(s.zooms, sourceNow) }))}>Remove zoom</button>
          </>
        ) : zooms.length ? null : (
          <span className="tl-info">Recorded your screen? Zoom on clicks moves in wherever something happens.</span>
        )}
      </div>
      {zooms.length ? (
        <div className="cam-strip" aria-label="Where the zooms are across the reel">
          {zooms.map((z, i) => {
            const span = rangeToOutput(placed, z.start, z.end);
            if (!span) return null;
            return <div key={i} className={here && z.start === here.start ? "on" : ""} style={{ left: pct(span.start), width: pct(span.end - span.start) }} title={`${z.zoom.toFixed(1)}× zoom`} />;
          })}
          <div className="cam-head" style={{ left: pct(tOut) }} />
        </div>
      ) : null}
    </div>
  );
};
