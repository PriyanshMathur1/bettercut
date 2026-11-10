import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReelSpec } from "../../src/reel/types";
import { placeSegments, rangeToOutput, speedOf, toSource, totalOutDuration } from "../../src/reel/timeline";
import { baseOf, freezeAt, moveShot, patchShot, placeSpan, rampShot, removeShot, SPEED_RAMPS, splitAt, splitMany, trimShot } from "../../src/reel/edit";
import { beatsBetween, snapTo } from "../../src/reel/beats";
import { effectsByFamily } from "../../src/reel/motion/effects";

import { nearestKey, removeKey, sampleKeys, setKey, type Ease, type Key } from "../../src/reel/keyframes";
import { overlayBase } from "../../src/reel/overlays";
import { layerBase, layerVolume, moveTrack, playable, tracksOf, trimLayerStart, type Layer } from "../../src/reel/layers";
import { snapToOutput, toOutput } from "../../src/reel/timeline";

const TRANSITIONS = effectsByFamily("transition");

type Field = { id: string; label: string; step: number; min?: number; max?: number };
const OVERLAY_FIELDS: Field[] = [
  { id: "x", label: "X", step: 0.02, min: 0, max: 1 },
  { id: "y", label: "Y", step: 0.02, min: 0, max: 1 },
  { id: "scale", label: "Size", step: 0.05, min: 0.1, max: 5 },
  { id: "rotate", label: "Turn", step: 5, min: -360, max: 360 },
  { id: "opacity", label: "Opacity", step: 0.1, min: 0, max: 1 },
];
const SHOT_FIELDS: Field[] = [
  { id: "zoom", label: "Zoom", step: 0.05, min: 1, max: 4 },
  { id: "cx", label: "Focus X", step: 0.02, min: 0, max: 1 },
  { id: "cy", label: "Focus Y", step: 0.02, min: 0, max: 1 },
];

/**
 * A number field you can type in freely. While it has focus it shows what you typed, even when that is
 * empty or half a number ("0."); a value is only sent on when it is a real number, kept inside min..max.
 */
const NumField: React.FC<{ value: number; onChange: (v: number) => void; step: number; min?: number; max?: number; disabled?: boolean }> = ({ value, onChange, step, min, max, disabled }) => {
  const [text, setText] = useState<string | null>(null); // what is being typed; null = show the value
  return (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      value={text ?? String(Number(value.toFixed(3)))}
      onFocus={(e) => setText(e.target.value)}
      onBlur={() => setText(null)}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === "") return; // cleared to retype: keep the old value until there is a new one
        const v = Number(e.target.value);
        if (!Number.isFinite(v)) return;
        onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
      }}
    />
  );
};

/** Keyframe controls for whatever is selected: add a keyframe at the playhead, edit its values, step between keyframes. */
const KeyRow: React.FC<{
  what: string;
  keys: Key[] | undefined;
  at: number | null;
  base: Record<string, number>;
  fields: Field[];
  onChange: (keys: Key[] | undefined) => void;
  onGo: (at: number) => void;
}> = ({ what, keys, at, base, fields, onChange, onGo }) => {
  const list = keys || [];
  if (at === null)
    return (
      <div className="tl-keys">
        <span className="tl-info">
          Keyframes: move the playhead onto this {what} to add one{list.length ? ` (${list.length} so far)` : ""}
        </span>
      </div>
    );
  const i = nearestKey(list, at);
  const now = sampleKeys(list, at, base);
  const prev = [...list].reverse().find((k) => k.at < at - 0.05);
  const next = list.find((k) => k.at > at + 0.05);
  return (
    <div className="tl-keys">
      <span className="tl-info">Keyframes</span>
      <button onClick={() => prev && onGo(prev.at)} disabled={!prev} title="Go to the previous keyframe" aria-label="Previous keyframe">
        ◀
      </button>
      <button onClick={() => next && onGo(next.at)} disabled={!next} title="Go to the next keyframe" aria-label="Next keyframe">
        ▶
      </button>
      {i < 0 ? (
        <button onClick={() => onChange(setKey(list, at, now))} title={`Record how this ${what} looks at the playhead. Add another one elsewhere and it animates between them.`}>
          Add keyframe here
        </button>
      ) : (
        <>
          {fields.map((f) => (
            <label key={f.id}>
              {f.label}
              <NumField step={f.step} min={f.min} max={f.max} value={(list[i][f.id] as number | undefined) ?? now[f.id]} onChange={(v) => onChange(setKey(list, list[i].at, { [f.id]: v }))} />
            </label>
          ))}
          <label title="How the values travel from this keyframe to the next">
            Motion
            <select value={(list[i].ease as Ease) || "smooth"} onChange={(e) => onChange(setKey(list, list[i].at, { ease: e.target.value as Ease }))}>
              <option value="smooth">Smooth</option>
              <option value="linear">Steady</option>
              <option value="hold">Jump</option>
            </select>
          </label>
          <button
            onClick={() => {
              const rest = removeKey(list, i);
              onChange(rest.length ? rest : undefined);
            }}
          >
            Remove keyframe
          </button>
        </>
      )}
      <span className="tl-info">{list.length ? `${list.length} keyframe${list.length === 1 ? "" : "s"}` : "none yet"}</span>
    </div>
  );
};
type Extra = { kind: "overlays" | "broll" | "voiceovers" | "layers"; i: number; id?: string };
const LAYER_FIELDS: Field[] = [
  { id: "x", label: "X", step: 0.02, min: -0.5, max: 1.5 },
  { id: "y", label: "Y", step: 0.02, min: -0.5, max: 1.5 },
  { id: "scale", label: "Width", step: 0.05, min: 0.05, max: 4 },
  { id: "rotate", label: "Turn", step: 5, min: -360, max: 360 },
  { id: "opacity", label: "Opacity", step: 0.1, min: 0, max: 1 },
];
const LANE = 22; // height of one layer track on the timeline

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
  /** Apply an edit, then have the server prepare the files it needs (a reversed shot). */
  updateAndBake: (fn: (s: ReelSpec) => ReelSpec) => void;
  onAddClips: (files: File[]) => void;
  /** Open the microphone recorder; the take is laid over the reel at the playhead. */
  onVoiceover: () => void;
  /** Add a video, image or audio file as a layer on its own track, starting at the playhead. */
  onAddMedia: (file: File) => void;
  /** Tells the editor which layer is selected, so it can be dragged in the preview. */
  onSelectLayer?: (index: number | null) => void;
  busy?: boolean;
  /** Where the selected item's properties are drawn: the inspector panel on the right. */
  inspector?: HTMLElement | null;
  /** Tells the editor whether anything is selected, so the inspector can show the project instead. */
  onSelection?: (has: boolean) => void;
}> = ({ spec, placed, duration, t, notes, onSeek, update, updateAndBake, onAddClips, onVoiceover, onAddMedia, onSelectLayer, busy, inspector, onSelection }) => {
  const [tool, setTool] = useState<"select" | "razor">("select");
  const [sel, setSel] = useState<number | null>(null); // selected shot, in playing order
  const [zoom, setZoom] = useState(1);
  const [extra, setExtra] = useState<Extra | null>(null); // selected overlay or b-roll clip
  const lane = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const mediaPicker = useRef<HTMLInputElement>(null);
  const [snap, setSnap] = useState(true); // land the playhead and trimmed cuts on music beats

  // music beats (OUTPUT seconds), found by the server when the music is set
  const music = spec.audio?.music;
  const beatsReady = !!music && spec.audio?.beatsFor === music && !!spec.audio?.beats?.length;
  const beats = beatsReady ? (spec.audio!.beats as number[]).filter((b) => b <= duration) : [];
  /** Snap an output time to a beat when one is within about 8 pixels. */
  const onBeat = (out: number) => {
    if (!snap || !beats.length || !lane.current) return out;
    return snapTo(beats, out, (8 * duration) / lane.current.getBoundingClientRect().width);
  };

  const shots = spec.segments;
  const body = totalOutDuration(placed);
  const pct = (x: number) => `${(x / duration) * 100}%`;
  const pieces = placed.map((p) => ({ p, base: baseOf(shots, p) }));
  const selected = sel !== null && shots[sel] ? shots[sel] : null;
  const mine = pieces.filter((x) => x.base === sel);
  const overlays = spec.overlays.map((o, i) => ({ o, i, r: rangeToOutput(placed, o.start, o.end) })).filter((x) => x.r) as { o: ReelSpec["overlays"][number]; i: number; r: { start: number; end: number } }[];
  const broll = spec.broll.map((b, i) => ({ b, i, r: rangeToOutput(placed, b.start, b.end) })).filter((x) => x.r) as { b: ReelSpec["broll"][number]; i: number; r: { start: number; end: number } }[];
  // a voiceover plays for its whole length from where its start lands, whatever is cut underneath
  const voices = (spec.voiceovers || [])
    .map((v, i) => {
      const at = snapToOutput(placed, v.start);
      return at === null ? null : { v, i, r: { start: at, end: Math.min(duration, at + (v.end - v.start)) } };
    })
    .filter((x): x is { v: NonNullable<ReelSpec["voiceovers"]>[number]; i: number; r: { start: number; end: number } } => !!x);
  // media layers: one lane per track, the highest track at the top like the picture stacks
  const lays = (spec.layers || []).map((l, i) => ({ l, i, r: rangeToOutput(placed, l.start, l.end) })).filter((x) => x.r) as { l: Layer; i: number; r: { start: number; end: number } }[];
  const tracks = tracksOf(lays.map((x) => x.l)); // lanes only for layers that are on the timeline
  // layers whose whole time range sits in footage that was removed: not drawn, so they need another way out
  const hidden = (spec.layers || []).map((_, i) => i).filter((i) => !lays.some((x) => x.i === i));
  const allOnTrack = (track: number) => (spec.layers || []).filter((l) => l.track === track).length;
  const allTracks = tracksOf(spec.layers);
  const layersTop = 55 + LANE + (voices.length ? LANE : 0);
  const laneHeight = layersTop + tracks.length * LANE + 1;
  const selLayer = extra?.kind === "layers" ? lays.find((x) => x.i === extra.i) : undefined;
  const setLayer = (patch: Partial<Layer>) =>
    selLayer &&
    update((s) => ({
      ...s,
      layers: (s.layers || []).map((l, j) => {
        if (j !== selLayer.i) return l;
        const next: Record<string, unknown> = { ...l, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        return next as unknown as Layer;
      }),
    }));
  const extraItem = extra ? ((spec[extra.kind] || []) as { start: number; end: number }[])[extra.i] : null;

  const canSplit = t < body - 0.01;
  const split = () => {
    if (!canSplit) return;
    const at = toSource(placed, t);
    update((s) => ({ ...s, segments: splitAt(s.segments, at) }));
    setSel(null);
  };
  const remove = () => {
    if (extra && extraItem) {
      const { kind, i } = extra;
      update((s) => ({ ...s, [kind]: ((s[kind] || []) as unknown[]).filter((_, j) => j !== i) }));
      setExtra(null);
      return;
    }
    if (sel === null || shots.length <= 1) return;
    update((s) => ({ ...s, segments: removeShot(s.segments, sel) }));
    setSel(null);
  };

  const move = (by: number) => {
    if (sel === null) return;
    const to = sel + by;
    if (to < 0 || to >= shots.length) return;
    update((s) => ({ ...s, segments: moveShot(s.segments, sel, to) }));
    setSel(to);
  };
  const freeze = () => {
    if (!canSplit) return;
    const at = toSource(placed, t);
    update((s) => ({ ...s, segments: freezeAt(s.segments, at, 1) }));
    setSel(null);
  };

  // The selection is an index into a list. If that list changed under it (undo, an edit from the AI,
  // another reel), the index may now be gone or point at a different item: drop the selection.
  const selectedItem = extra ? ((spec[extra.kind] || []) as { id?: string }[])[extra.i] : undefined;
  const staleSelection = !!extra && (!selectedItem || (extra.id !== undefined && selectedItem.id !== extra.id));
  useEffect(() => {
    if (staleSelection) setExtra(null);
  }, [staleSelection]);
  useEffect(() => {
    if (sel !== null && sel >= spec.segments.length) setSel(null);
  }, [sel, spec.segments.length]);

  useEffect(() => {
    onSelectLayer?.(extra?.kind === "layers" && !staleSelection ? extra.i : null);
  }, [extra?.kind, extra?.i, staleSelection]);

  // keyboard: S splits at the playhead, Delete removes the selected shot, Esc clears the selection
  const keys = useRef({ split, remove });
  keys.current = { split, remove };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "s" || e.key === "S") keys.current.split();
      else if (e.key === "v" || e.key === "V") setTool("select");
      else if (e.key === "c" || e.key === "C") setTool("razor");
      else if (e.key === "Delete" || e.key === "Backspace") keys.current.remove();
      else if (e.key === "Escape") {
        setSel(null);
        setExtra(null);
      }
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
    onSeek(onBeat(outAt(e.clientX)));
    const move = (ev: PointerEvent) => onSeek(onBeat(outAt(ev.clientX)));
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
    const speed = speedOf(selected);
    // where this shot's footage ends in the reel right now: the cut that moves as either edge is trimmed
    const cut0 = mine.length ? mine[mine.length - 1].p.outEnd - (selected.hold || 0) : null;
    const move = (ev: PointerEvent) => {
      let to = from + (ev.clientX - x0) * perPx;
      if (cut0 !== null) {
        const sign = edge === "end" ? 1 : -1;
        const cut = cut0 + (sign * (to - from)) / speed;
        const snapped = onBeat(cut);
        if (snapped !== cut) to = from + sign * (snapped - cut0) * speed;
      }
      update((s) => ({ ...s, segments: trimShot(s.segments, i, edge, to, s.source.duration) }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Drag an overlay or b-roll clip: its middle moves it, its edges resize it. */
  const dragExtra = (kind: Extra["kind"], i: number, r: { start: number; end: number }) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setExtra({ kind, i, id: ((spec[kind] || []) as { id?: string }[])[i]?.id });
    setSel(null);
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const grabbed = kind === "layers" ? (spec.layers || [])[i] : undefined; // the layer as it was when grabbed
    // a voiceover is a fixed recording: it can be moved, not stretched
    const how = kind === "voiceovers" ? "move" : e.clientX - box.left < 7 ? "start" : box.right - e.clientX < 7 ? "end" : "move";
    const perPx = duration / lane.current!.getBoundingClientRect().width; // output seconds per pixel
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) * perPx;
      if (Math.abs(ev.clientX - x0) < 3) return; // a click, not a drag
      let out = Math.min(body - 0.01, Math.max(0, (how === "end" ? r.end : r.start) + d));
      // A layer's own file sets two limits, both measured in time on screen (the footage under it may be
      // sped up, slowed or cut): its start can't be pulled back past the file's beginning, and its end
      // can't be pushed past the file's end.
      let from: number | undefined;
      if (grabbed && grabbed.kind !== "image") {
        const from0 = grabbed.from ?? 0;
        if (how === "start") {
          out = Math.max(out, r.start - from0);
          from = from0 + (out - r.start); // trimming skips into the media; it doesn't restart it
        } else if (how === "end") {
          out = Math.min(out, r.start + playable(grabbed));
        }
      }
      const at = toSource(placed, out);
      update((s) => ({
        ...s,
        [kind]: ((s[kind] || []) as { start: number; end: number }[]).map((x, j) => {
          if (j !== i) return x;
          if (kind === "layers" && how === "start") return trimLayerStart(x as Layer, at, from);
          return placeSpan(x, how, at, kind === "voiceovers" ? Infinity : s.source.duration);
        }),
      }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---- keyframes for the selection ------------------------------------------------
  const selOv = extra?.kind === "overlays" ? overlays.find((x) => x.i === extra.i) : undefined;
  const ovAt = selOv && t >= selOv.r.start - 0.001 && t <= selOv.r.end + 0.001 ? Math.max(0, t - selOv.r.start) : null;
  const srcNow = t < body ? toSource(placed, t) : null;
  const shotAtPlayhead = selected && srcNow !== null && srcNow >= selected.start - 0.001 && srcNow <= selected.end + 0.001 ? srcNow : null;
  const setOverlayKeys = (keys: Key[] | undefined) =>
    selOv && update((s) => ({ ...s, overlays: s.overlays.map((o, j) => (j === selOv.i ? (keys ? { ...o, keys } : (({ keys: _drop, ...rest }) => rest)(o)) : o)) }));
  const setShotKeys = (keys: Key[] | undefined) => sel !== null && update((s) => ({ ...s, segments: patchShot(s.segments, sel, { keys }) }));

  const step = tickStep(duration, zoom);
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);

  const selControls = selected ? (
          <>
            <button onClick={() => move(-1)} disabled={sel === 0} title="Play this shot earlier" aria-label="Move shot earlier">
              ◀
            </button>
            <button onClick={() => move(1)} disabled={sel === shots.length - 1} title="Play this shot later" aria-label="Move shot later">
              ▶
            </button>
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
            {sel! > 0 && !selected.join ? (
              <label title="How the reel moves from the previous shot into this one">
                Transition
                <select
                  value={selected.transition ?? ""}
                  onChange={(e) => update((s) => ({ ...s, segments: patchShot(s.segments, sel!, { transition: e.target.value || undefined }) }))}
                >
                  <option value="">Reel default</option>
                  <option value="none">None (hard cut)</option>
                  {TRANSITIONS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {beats.length && mine.length ? (
              <label title="Cut this shot on the music's beats, for a montage that moves with the song">
                Split on beats
                <select
                  value=""
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!n) return;
                    const times = beatsBetween(beats, mine[0].p.outStart, mine[mine.length - 1].p.outEnd - (selected.hold || 0), n).map((b) => toSource(placed, b));
                    if (times.length) update((s) => ({ ...s, segments: splitMany(s.segments, times) }));
                    setSel(null);
                  }}
                >
                  <option value="">Choose…</option>
                  <option value="1">Every beat</option>
                  <option value="2">Every 2nd beat</option>
                  <option value="4">Every 4th beat</option>
                </select>
              </label>
            ) : null}
            <label title="Change speed gradually across this shot">
              Ramp
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  update((s) => ({ ...s, segments: rampShot(s.segments, sel!, id) }));
                  setSel(null);
                }}
              >
                <option value="">Choose…</option>
                {Object.entries(SPEED_RAMPS).map(([id, r]) => (
                  <option key={id} value={id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label title="Play this shot backwards. The first time takes a moment while the footage is prepared.">
              <input
                type="checkbox"
                checked={!!selected.reverse}
                disabled={busy}
                onChange={(e) => {
                  const on = e.target.checked;
                  (on ? updateAndBake : update)((s) => ({ ...s, segments: patchShot(s.segments, sel!, { reverse: on || undefined, ...(on ? {} : { reversed: undefined }) }) }));
                }}
              />
              Reverse
            </label>
            {selected.hold ? (
              <label title="How long this shot holds its last frame">
                Freeze
                <select
                  value={selected.hold}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    update((s) => ({ ...s, segments: patchShot(s.segments, sel!, { hold: v || undefined }) }));
                  }}
                >
                  {[0, 0.5, 1, 1.5, 2, 3, 5].concat([0, 0.5, 1, 1.5, 2, 3, 5].includes(selected.hold) ? [] : [selected.hold]).map((v) => (
                    <option key={v} value={v}>
                      {v ? `${v}s` : "Off"}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="tl-info">
              Shot {sel! + 1} of {shots.length} · {(selected.end - selected.start) / speedOf(selected) + (selected.hold || 0) < 10 ? ((selected.end - selected.start) / speedOf(selected) + (selected.hold || 0)).toFixed(1) : Math.round((selected.end - selected.start) / speedOf(selected) + (selected.hold || 0))}s
            </span>
          </>
        ) : selLayer ? (
          <>
            <button
              onClick={() => update((s) => ({ ...s, layers: moveTrack(s.layers || [], selLayer.i, 1) }))}
              disabled={allTracks.indexOf(selLayer.l.track) === allTracks.length - 1 && allOnTrack(selLayer.l.track) === 1}
              title="Bring this layer forward, over the layer above it"
            >
              Forward
            </button>
            <button
              onClick={() => update((s) => ({ ...s, layers: moveTrack(s.layers || [], selLayer.i, -1) }))}
              disabled={allTracks.indexOf(selLayer.l.track) === 0 && allOnTrack(selLayer.l.track) === 1}
              title="Send this layer back, under the layer below it"
            >
              Back
            </button>
            {selLayer.l.kind !== "image" ? (
              <label title={selLayer.l.kind === "video" ? "Sound of this video layer (off by default)" : "Loudness of this sound"}>
                Volume
                <select value={layerVolume(selLayer.l)} onChange={(e) => setLayer({ volume: Number(e.target.value) })}>
                  {[0, 0.25, 0.5, 0.75, 1, 1.5, 2].map((v) => (
                    <option key={v} value={v}>
                      {v === 0 ? "Off" : `${Math.round(v * 100)}%`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="tl-info">Track {selLayer.l.track} · drag to move, drag an edge to resize</span>
          </>
        ) : extraItem ? (
          <span className="tl-info">{extra?.kind === "voiceovers" ? "Drag to move" : "Drag to move · drag an edge to resize"}</span>
        ) : (
          <span className="tl-info">Click a shot to select it</span>
        );
  const keyControls = selLayer && selLayer.l.kind !== "audio" ? (
        <>
          <div className="tl-keys">
            <span className="tl-info">Layer</span>
            {LAYER_FIELDS.map((f) => (
              <label key={f.id} title={selLayer.l.keys?.some((k) => typeof k[f.id] === "number") ? "Animated by keyframes: edit the keyframes below" : undefined}>
                {f.label}
                <NumField
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  disabled={!!selLayer.l.keys?.some((k) => typeof k[f.id] === "number")}
                  value={(layerBase(selLayer.l) as Record<string, number>)[f.id]}
                  onChange={(v) => setLayer({ [f.id]: v } as Partial<Layer>)}
                />
              </label>
            ))}
            <label title="Round the corners">
              Corners
              <NumField step={0.02} min={0} max={0.5} value={selLayer.l.radius ?? 0} onChange={(v) => setLayer({ radius: v || undefined })} />
            </label>
          </div>
          <KeyRow
            what="layer"
            keys={selLayer.l.keys}
            at={t >= selLayer.r.start - 0.001 && t <= selLayer.r.end + 0.001 ? Math.max(0, t - selLayer.r.start) : null}
            base={layerBase(selLayer.l)}
            fields={LAYER_FIELDS}
            onChange={(keys) => setLayer({ keys })}
            onGo={(at) => onSeek(selLayer.r.start + at)}
          />
        </>
      ) : selOv ? (
        <KeyRow what="overlay" keys={selOv.o.keys} at={ovAt} base={overlayBase(selOv.o)} fields={OVERLAY_FIELDS} onChange={setOverlayKeys} onGo={(at) => onSeek(selOv.r.start + at)} />
      ) : selected ? (
        <KeyRow
          what="shot"
          keys={selected.keys}
          at={shotAtPlayhead}
          base={{ zoom: selected.zoom ?? 1, cx: selected.cx ?? 0.5, cy: selected.cy ?? 0.4 }}
          fields={SHOT_FIELDS}
          onChange={setShotKeys}
          onGo={(at) => {
            const o = toOutput(placed, at);
            if (o !== null) onSeek(o);
          }}
        />
      ) : null;
  const selTitle = selected
    ? `Shot ${sel! + 1} of ${shots.length}`
    : selLayer
      ? `${selLayer.l.kind === "image" ? "Image" : selLayer.l.kind === "audio" ? "Sound" : "Video"} layer`
      : extra?.kind === "voiceovers"
        ? "Voiceover"
        : extra?.kind === "broll"
          ? "B-roll"
          : extra?.kind === "overlays"
            ? "Overlay"
            : "";
  const hasSel = !!(selected || extraItem);
  useEffect(() => {
    onSelection?.(hasSel);
  }, [hasSel]);

  return (
    <div className="tl">
      {inspector && hasSel
        ? createPortal(
            <div className="insp">
              <h3>{selTitle}</h3>
              <div className="insp-rows">{selControls}</div>
              {keyControls}
            </div>,
            inspector,
          )
        : null}
      <div className="tl-bar">
        <div className="tl-tools" role="group" aria-label="Timeline tool">
          <button className={tool === "select" ? "on" : ""} aria-pressed={tool === "select"} onClick={() => setTool("select")} title="Select: click to select, drag to move or trim (V)">
            Select
          </button>
          <button className={tool === "razor" ? "on" : ""} aria-pressed={tool === "razor"} onClick={() => setTool("razor")} title="Razor: click a shot to cut it at that point (C)">
            Razor
          </button>
        </div>
        <button onClick={split} disabled={!canSplit} title="Cut the shot at the playhead (S)">
          Split
        </button>
        <button onClick={remove} disabled={extraItem ? false : sel === null || shots.length <= 1} title={extraItem ? "Remove the selected overlay (Delete)" : "Remove the selected shot (Delete)"}>
          {extraItem ? (extra?.kind === "voiceovers" ? "Delete voiceover" : extra?.kind === "layers" ? "Delete layer" : "Delete overlay") : "Delete shot"}
        </button>
        <button onClick={freeze} disabled={!canSplit} title="Hold the picture at the playhead for one second">
          Freeze 1s
        </button>
        <span className="tl-info">{selected || extraItem ? "Properties are in the panel on the right" : tool === "razor" ? "Click a shot to cut it there" : "Click a shot to select it"}</span>
        <div className="spacer" />
        {music && !beatsReady ? (
          <button onClick={() => updateAndBake((s) => s)} disabled={busy} title="Find the beats in this reel's music, to show them here and snap cuts to them">
            Find beats
          </button>
        ) : beats.length ? (
          <label title="Land the playhead and trimmed cuts on the music's beats">
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            Snap to beat
          </label>
        ) : null}
        <button onClick={() => mediaPicker.current?.click()} disabled={busy || !canSplit} title="Add a video, image or sound on its own track, starting at the playhead">
          Add media
        </button>
        <input
          ref={mediaPicker}
          type="file"
          accept="video/*,image/*,audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onAddMedia(f);
          }}
        />
        <button onClick={onVoiceover} disabled={busy || !canSplit} title="Record narration from your microphone, starting at the playhead">
          Voiceover
        </button>
        <button onClick={() => picker.current?.click()} disabled={busy} title="Add more video clips to the end of this reel">
          Add clips
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
            if (files.length) onAddClips(files);
          }}
        />
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
      {hidden.length ? (
        <div className="tl-keys">
          <span className="tl-info">
            {hidden.length === 1 ? "1 layer sits" : `${hidden.length} layers sit`} over footage you removed, so {hidden.length === 1 ? "it isn't" : "they aren't"} shown.
          </span>
          <button onClick={() => update((s) => ({ ...s, layers: (s.layers || []).filter((_, i) => !hidden.includes(i)) }))}>{hidden.length === 1 ? "Delete it" : "Delete them"}</button>
        </div>
      ) : null}
      <div className="tl-body">
      <div className="tl-heads" style={{ height: laneHeight }} aria-hidden="true">
        <span style={{ top: 22, height: 28 }} title="Your footage">V1</span>
        <span style={{ top: 55, height: 18 }} title="Overlays and b-roll">FX</span>
        {voices.length ? <span style={{ top: 77, height: 18 }} title="Voiceovers">VO</span> : null}
        {tracks.map((tr, row) => (
          <span key={tr} style={{ top: layersTop + (tracks.length - 1 - row) * LANE, height: LANE - 4 }} title={`Layer track ${tr}`}>
            L{tr}
          </span>
        ))}
      </div>
      <div className="tl-scroll">
        <div className={`tl-lane ${tool}`} ref={lane} style={{ width: `${zoom * 100}%`, height: laneHeight }} onPointerDown={scrub}>
          <div className="tl-ruler">
            {beats.map((b) => (
              <em key={b} style={{ left: pct(b) }} />
            ))}
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
                  if (tool === "razor") {
                    // cut where you clicked, not at the playhead
                    const at = toSource(placed, outAt(e.clientX));
                    update((x) => ({ ...x, segments: splitAt(x.segments, at) }));
                    setSel(null);
                    onSeek(outAt(e.clientX));
                    return;
                  }
                  setSel(base);
                  setExtra(null);
                  onSeek(outAt(e.clientX));
                }}
              >
                {speedOf(p) !== 1 || p.reverse ? (
                  <i>
                    {p.reverse ? "◀ " : ""}
                    {speedOf(p) !== 1 ? `${speedOf(p)}×` : ""}
                  </i>
                ) : null}
                {(p.keys || [])
                  .filter((k) => k.at >= p.start && k.at <= p.end)
                  .map((k) => (
                    <u key={k.at} style={{ left: `${(((k.at - p.start) / speedOf(p)) / (p.outEnd - p.outStart)) * 100}%` }} />
                  ))}
                {p.hold ? <b style={{ width: `${(Math.min(10, p.hold) / (p.outEnd - p.outStart)) * 100}%` }} title={`Freeze frame, ${p.hold}s`} /> : null}
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
            {overlays.map(({ o, i, r }) => (
              <div
                key={i}
                className={`ov ${extra?.kind === "overlays" && extra.i === i ? "sel" : ""}`}
                style={{ left: pct(r.start), width: pct(r.end - r.start) }}
                title={`${o.kind}${o.text ? `: ${o.text}` : ""}`}
                onPointerDown={dragExtra("overlays", i, r)}
              >
                {o.kind}
                {(o.keys || []).map((k) => (
                  <u key={k.at} style={{ left: `${Math.min(100, (k.at / (r.end - r.start)) * 100)}%` }} />
                ))}
              </div>
            ))}
            {broll.map(({ b, i, r }) => (
              <div
                key={`b${i}`}
                className={`ov broll ${extra?.kind === "broll" && extra.i === i ? "sel" : ""}`}
                style={{ left: pct(r.start), width: pct(r.end - r.start) }}
                title="B-roll"
                onPointerDown={dragExtra("broll", i, r)}
              >
                b-roll
              </div>
            ))}
          </div>
          {voices.length ? (
            <div className="tl-track voices">
              {voices.map(({ v, i, r }) => (
                <div
                  key={`v${i}`}
                  className={`ov voice ${extra?.kind === "voiceovers" && extra.i === i ? "sel" : ""}`}
                  style={{ left: pct(r.start), width: pct(Math.max(0.1, r.end - r.start)) }}
                  title={`Voiceover, ${(v.end - v.start).toFixed(1)}s`}
                  onPointerDown={dragExtra("voiceovers", i, r)}
                >
                  voiceover
                </div>
              ))}
            </div>
          ) : null}
          {tracks.map((tr, row) => (
            <div key={`t${tr}`} className="tl-track layers" style={{ top: layersTop + (tracks.length - 1 - row) * LANE, height: LANE - 4 }}>
              {lays
                .filter((x) => x.l.track === tr)
                .map(({ l, i, r }) => (
                  <div
                    key={`l${i}`}
                    className={`ov layer ${l.kind} ${extra?.kind === "layers" && extra.i === i ? "sel" : ""}`}
                    style={{ left: pct(r.start), width: pct(Math.max(0.1, r.end - r.start)) }}
                    title={`${l.kind === "image" ? "Image" : l.kind === "audio" ? "Sound" : "Video"} layer on track ${l.track}`}
                    onPointerDown={dragExtra("layers", i, r)}
                  >
                    {l.kind}
                    {(l.keys || []).map((k) => (
                      <u key={k.at} style={{ left: `${Math.min(100, (k.at / (r.end - r.start)) * 100)}%` }} />
                    ))}
                  </div>
                ))}
            </div>
          ))}
          {notes
            .filter((n) => n.t !== null && n.t !== undefined)
            .map((n, i) => (
              <div key={i} className="note-pin" style={{ left: pct(n.t) }} title={n.text} />
            ))}
          <div className="playhead" style={{ left: pct(t) }} />
        </div>
      </div>
      </div>
    </div>
  );
};
