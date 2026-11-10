import React, { useRef } from "react";
import type { ReelSpec } from "../../src/reel/types";
import type { PlacedSegment } from "../../src/reel/timeline";
import { angleAt, cameraPieces, MAIN, setCamAt } from "../../src/reel/multicam";

const COLOURS = ["#4c5c8a", "#2f7a6b", "#8a5a2c", "#6a4a8a", "#2c6f8a", "#8a2c4f"];
const MATCH_OK = 10; // same cut-off as bettercut/multicam.py

/**
 * Multi-camera for the open reel: add other angles of the same shoot, cut to whoever is talking, or switch
 * camera at the playhead. The strip shows which camera is on across the reel.
 */
export const CamRow: React.FC<{
  spec: ReelSpec;
  placed: PlacedSegment[];
  /** The playhead, in reel (output) seconds and in footage (source) seconds. */
  tOut: number;
  sourceNow: number;
  duration: number;
  busy: boolean;
  update: (fn: (s: ReelSpec) => ReelSpec) => void;
  onAddAngles: (files: File[]) => void;
  onAuto: () => void;
}> = ({ spec, placed, tOut, sourceNow, duration, busy, update, onAddAngles, onAuto }) => {
  const picker = useRef<HTMLInputElement>(null);
  const angles = spec.angles || [];
  const cams = [{ id: MAIN, name: "Main" }, ...angles.map((a) => ({ id: a.id, name: a.name || a.id }))];
  const colour = (id: string) => COLOURS[Math.max(0, cams.findIndex((c) => c.id === id)) % COLOURS.length];
  const on = angleAt(spec.cams, sourceNow);
  const pieces = angles.length ? cameraPieces(placed, spec.cams, angles) : [];
  const weak = angles.filter((a) => (a.match ?? MATCH_OK) < MATCH_OK);
  const pct = (x: number) => `${(Math.max(0, Math.min(duration, x)) / Math.max(0.001, duration)) * 100}%`;
  return (
    <div className="cam-row">
      <div className="tl-keys">
        <span className="tl-info" title="Other cameras of the same shoot, lined up by their sound">
          Cameras
        </span>
        {angles.length ? (
          <>
            {cams.map((c) => (
              <button
                key={c.id}
                className={c.id === on ? "on" : ""}
                aria-pressed={c.id === on}
                title={c.id === on ? `${c.name} is on here` : `Switch to ${c.name} from the playhead`}
                onClick={() => update((s) => ({ ...s, cams: setCamAt(s.cams, sourceNow, c.id) }))}
              >
                <i style={{ background: colour(c.id) }} />
                {c.name}
              </button>
            ))}
            <button onClick={onAuto} disabled={busy} title="Switch to whoever is talking, all the way through (replaces your switches)">
              Cut to speaker
            </button>
          </>
        ) : (
          <span className="tl-info">Filmed with more than one camera? Add the other angles and they line up by sound.</span>
        )}
        <button onClick={() => picker.current?.click()} disabled={busy} title="Add other cameras of the same shoot (with sound on)">
          Add angles
        </button>
        <input
          ref={picker}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length && !busy) onAddAngles(files);
          }}
        />
        {weak.length ? (
          <span className="tl-info warn">
            {weak.map((a) => a.name || a.id).join(", ")} synced weakly: check {weak.length === 1 ? "it lines" : "they line"} up.
          </span>
        ) : null}
      </div>
      {angles.length ? (
        <div className="cam-strip" aria-label="Which camera is on across the reel">
          {pieces.map((p, i) => {
            const id = p.cam?.id ?? MAIN;
            return <div key={i} style={{ left: pct(p.outStart), width: pct(p.outEnd - p.outStart), background: colour(id) }} title={cams.find((c) => c.id === id)?.name} />;
          })}
          <div className="cam-head" style={{ left: pct(tOut) }} />
        </div>
      ) : null}
    </div>
  );
};
