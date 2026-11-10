import { setTranslation, translationRows } from "../../src/reel/translate";
import React, { useState } from "react";
import type { ReelSpec, ReelOverlay, OverlayKind, BrollClip } from "../../src/reel/types";
import { CAPTION_STYLES, type CaptionStyle } from "../../src/reel/captions/styles";
import { tok } from "../../src/reel/brand";
import { api, watchJob, type Catalog, type Job } from "./api";

type Update = (fn: (s: ReelSpec) => ReelSpec) => void;

export { TABS, type Tab } from "./workspace"; // the list lives with the workspaces so Simple's rail can be checked against it
import type { Tab } from "./workspace";

interface PanelProps {
  tab: Tab;
  spec: ReelSpec;
  update: Update;
  catalog: Catalog;
  pid: string;
  /** Current playhead in SOURCE seconds. */
  sourceNow: number;
  applyLook: (id: string) => void;
  refreshCatalog: () => void;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }> = ({ label, value, min, max, step, onChange }) => (
  <Field label={`${label} · ${value}`}>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
  </Field>
);

const Toggle: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }> = ({ label, value, onChange, disabled, hint }) => (
  <label className={`toggle ${disabled ? "disabled" : ""}`} title={hint}>
    <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

function captionPreviewStyle(c: CaptionStyle, spec: ReelSpec): React.CSSProperties {
  const color = tok(c.color, spec.brand);
  return {
    fontFamily: `"${c.font}", Inter, sans-serif`,
    fontWeight: c.weight,
    fontStyle: c.italic ? "italic" : "normal",
    textTransform: c.uppercase ? "uppercase" : "none",
    color: color === "transparent" ? "transparent" : color,
    WebkitTextStroke: c.stroke ? `1.5px ${tok(c.strokeColor, spec.brand, "#000")}` : undefined,
    letterSpacing: (c.letterSpacing ?? 0) / 3,
    background:
      c.container === "pill" || c.container === "bar" || c.container === "card" || c.container === "bubble" || c.container === "wordBox" || c.container === "tape"
        ? tok(c.containerColor, spec.brand, "#000")
        : undefined,
    padding: c.container !== "none" ? "2px 8px" : undefined,
    borderRadius: c.container === "pill" ? 99 : 6,
    textShadow: c.shadow === "glow" ? `0 0 8px ${tok(c.highlight, spec.brand)}` : c.shadow === "hard" || c.shadow === "long" ? "2px 2px 0 #000" : "0 2px 6px rgba(0,0,0,.6)",
  };
}

const groupBy = <T, K extends string>(xs: T[], f: (x: T) => K) =>
  xs.reduce((m, x) => ((m[f(x)] = m[f(x)] || []).push(x), m), {} as Record<K, T[]>);

const DEFAULT_OVERLAY: Record<string, Partial<ReelOverlay>> = {
  emoji: { emoji: "🔥" },
  sticker: { text: "NEW" },
  lowerThird: {},
  checklist: { text: "Checklist", items: ["First thing", "Second thing", "Third thing"] },
  numberedList: { text: "3 steps", items: ["Step one", "Step two", "Step three"] },
  progressSteps: { items: ["Film", "Drop", "Post"] },
  counter: { value: 10000, prefix: "$", text: "in 30 days" },
  keyword: { text: "KEYWORD" },
  image: {},
  arrow: { text: "look" },
  circle: {},
  followButton: { text: "Follow" },
  notification: { text: "New message", subtitle: "You have to see this", emoji: "💬" },
  quote: { text: "A quote that matters.", subtitle: "Someone" },
  commentReply: { text: "How did you do that?", subtitle: "viewer" },
  poll: { text: "Would you try it?", items: ["Yes", "No"] },
  tierList: { tiers: [{ label: "S", items: ["Best"] }, { label: "A", items: ["Great"] }, { label: "B", items: ["Okay"] }] },
  splitHeadline: { text: "Before", subtitle: "after" },
  postCard: { text: "Something worth saying in a post." },
  donut: { value: 68, text: "Finish the video", subtitle: "of viewers" },
  bars: { text: "Where views come from", items: ["Reels: 62", "Explore: 24", "Profile: 9", "Shares: 5"] },
  metrics: { text: "In 30 days", items: ["+38% Watch time", "12.4k Followers", "3.1x Shares"] },
  chapter: { value: 1, text: "The setup", subtitle: "What you need before you start" },
  gradientWord: { text: "Game changer" },
  compare: { text: "Editing time", items: ["Before: 2 hrs", "After: 10 min"] },
};

const CAMERA_PROFILES: [string, string][] = [
  ["", "Normal footage"],
  ["apple-log", "Apple Log (iPhone 15 Pro and later)"],
  ["slog3", "Sony S-Log3 / S-Gamut3.Cine"],
  ["vlog", "Panasonic V-Log / V-Gamut"],
];

/** Green screen: key a flat backdrop out of the footage so it becomes the reel's cut-out. */
const GreenScreen: React.FC<{ spec: ReelSpec; update: Update; pid: string }> = ({ spec, update, pid }) => {
  const k = spec.source.key;
  const [job, setJob] = useState<Job | null>(null);
  const busy = job?.status === "running";
  const setKey = (patch: Partial<NonNullable<ReelSpec["source"]["key"]>> | null) =>
    update((s) => {
      const { key: _old, ...rest } = s.source;
      return { ...s, source: patch === null ? rest : { ...rest, key: { color: "auto", similarity: 0.28, blend: 0.08, ...s.source.key, ...patch } } };
    });
  const apply = async () => {
    await new Promise((r) => setTimeout(r, 800)); // let autosave land
    const r = await api.bake(pid);
    watchJob(r.job, async (j) => {
      setJob(j);
      if (j.status !== "done") return;
      const baked = j.result?.spec || (await api.spec(pid)).spec;
      update(() => baked);
    });
  };
  const cutoutFromSpeaker = !!spec.source.matte && !spec.source.keyed && !k;
  if (cutoutFromSpeaker) return null; // this reel already has a speaker cutout
  return (
    <div className="greenscreen">
      <h4>
        Green screen <small>{spec.source.keyed && k ? `backdrop ${spec.source.keyColor || ""} removed` : "shot against a flat colour?"}</small>
      </h4>
      {!k ? (
        <button onClick={() => setKey({})}>Remove the backdrop</button>
      ) : (
        <>
          <div className="controls">
            <Field label="Backdrop colour">
              <select value={k.color === "auto" || !k.color ? "auto" : "pick"} onChange={(e) => setKey({ color: e.target.value === "auto" ? "auto" : spec.source.keyColor || "#00B140" })}>
                <option value="auto">Find it for me</option>
                <option value="pick">Choose</option>
              </select>
            </Field>
            {k.color && k.color !== "auto" ? (
              <Field label="Colour">
                <input type="color" value={k.color} onChange={(e) => setKey({ color: e.target.value.toUpperCase() })} />
              </Field>
            ) : null}
            <Slider label="How much to remove" value={k.similarity ?? 0.28} min={0.05} max={0.6} step={0.01} onChange={(v) => setKey({ similarity: v })} />
            <Slider label="Edge softness" value={k.blend ?? 0.08} min={0} max={0.4} step={0.01} onChange={(v) => setKey({ blend: v })} />
          </div>
          <div className="row">
            <button className="primary" disabled={busy} onClick={apply}>
              {busy ? "Removing the backdrop…" : spec.source.keyed ? "Apply changes" : "Remove the backdrop"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setKey(null);
                apply();
              }}
            >
              Turn off
            </button>
          </div>
          <small className="hint">Then pick the Green Screen layout below and set a background. Layouts that need a cutout work too.</small>
        </>
      )}
    </div>
  );
};

/** Captions in a second language: one line per sentence, typed here or filled in by the user's AI. */
const Translation: React.FC<{ spec: ReelSpec; update: (fn: (s: ReelSpec) => ReelSpec) => void }> = ({ spec, update }) => {
  const tr = spec.captions.translation;
  const [open, setOpen] = useState(!!tr);
  const rows = translationRows(spec.words, tr?.lines);
  const patch = (p: Partial<NonNullable<ReelSpec["captions"]["translation"]>>) =>
    update((s) => ({ ...s, captions: { ...s.captions, translation: { language: "", mode: "below", lines: [], ...s.captions.translation, ...p } } }));
  const done = rows.filter((r) => r.translated).length;
  if (!rows.length) return null;
  return (
    <div className="translation">
      <h4>
        Translation{" "}
        <small>
          {tr ? `${done} of ${rows.length} sentences` : "captions in a second language"}
        </small>
      </h4>
      {!open ? (
        <button onClick={() => setOpen(true)}>Add a translation</button>
      ) : (
        <>
          <div className="controls">
            <Field label="Language">
              <input value={tr?.language || ""} placeholder="Spanish" onChange={(e) => patch({ language: e.target.value })} />
            </Field>
            <Field label="Show">
              <select value={tr?.mode || "below"} onChange={(e) => patch({ mode: e.target.value as "below" | "replace" })}>
                <option value="below">Both languages</option>
                <option value="replace">Translation only</option>
              </select>
            </Field>
          </div>
          <small className="hint">
            Type each line, or ask your AI: "Translate the captions of this reel into {tr?.language || "Spanish"}." It fills these in for you.
          </small>
          <ul className="tr-rows">
            {rows.map((r, i) => (
              <li key={r.start}>
                <span>{r.text}</span>
                <input
                  dir="auto"
                  value={r.translated}
                  placeholder="Translation"
                  onChange={(e) => patch({ lines: setTranslation(spec.words, tr?.lines, i, e.target.value) })}
                />
              </li>
            ))}
          </ul>
          <button
            onClick={() => {
              if (!done || window.confirm("Remove the translation from this reel?")) {
                update((s) => ({ ...s, captions: (({ translation: _drop, ...rest }) => rest)(s.captions) as ReelSpec["captions"] }));
                setOpen(false);
              }
            }}
          >
            Remove translation
          </button>
        </>
      )}
    </div>
  );
};

export const Panel: React.FC<PanelProps> = ({ tab, spec, update, catalog, pid, sourceNow, applyLook, refreshCatalog }) => {
  const hasMatte = !!spec.source.matte;
  const set = <K extends keyof ReelSpec>(k: K, patch: Partial<ReelSpec[K]>) => update((s) => ({ ...s, [k]: { ...(s[k] as any), ...patch } }));

  if (tab === "Looks") {
    return (
      <div className="cards">
        {catalog.looks.map((l) => (
          <button key={l.id} className={`card ${spec.look === l.id ? "on" : ""}`} onClick={() => applyLook(l.id)}>
            <b>{l.name}</b>
            <small>{l.description}</small>
            {l.user ? <em className="tag">yours</em> : null}
          </button>
        ))}
      </div>
    );
  }

  if (tab === "Captions") {
    const groups = groupBy(CAPTION_STYLES, (c) => c.group);
    const c = spec.captions;
    return (
      <>
        <div className="controls">
          <Toggle label="Captions on" value={c.enabled} onChange={(v) => set("captions", { enabled: v })} />
          <Toggle label="Big words behind head" value={!!c.behindHead} disabled={!hasMatte} hint={hasMatte ? "" : "Needs the cutout: create the reel with 'Cut me out'"} onChange={(v) => set("captions", { behindHead: v })} />
          <Field label="Position">
            <select value={c.position} onChange={(e) => set("captions", { position: e.target.value as any })}>
              {["top", "upper", "middle", "lower", "bottom"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Slider label="Size" value={c.scale} min={0.5} max={1.8} step={0.05} onChange={(v) => set("captions", { scale: v })} />
          <Slider label="Words per line" value={c.wordsPerPage} min={1} max={8} step={1} onChange={(v) => set("captions", { wordsPerPage: v })} />
          <Toggle label="ALL CAPS" value={!!c.uppercase} onChange={(v) => set("captions", { uppercase: v })} />
        </div>
        <Translation spec={spec} update={update} />
        {Object.entries(groups).map(([g, list]) => (
          <div key={g}>
            <h4>{g}</h4>
            <div className="cards small">
              {list.map((st) => (
                <button key={st.id} className={`card cap ${c.style === st.id ? "on" : ""}`} onClick={() => set("captions", { style: st.id })} title={st.name}>
                  <span style={captionPreviewStyle(st, spec)}>{st.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </>
    );
  }

  if (tab === "Format") {
    const f = spec.format;
    return (
      <>
        <GreenScreen spec={spec} update={update} pid={pid} />
        <div className="controls">
          <Field label="Headline">
            <input value={f.headline || ""} placeholder="Shown by framed formats" onChange={(e) => set("format", { headline: e.target.value })} />
          </Field>
          <Field label="Background (colour or file)">
            <input value={f.background || ""} placeholder="#111111 or upload" onChange={(e) => set("format", { background: e.target.value })} />
          </Field>
          <Upload pid={pid} label="Upload background" onDone={(p) => set("format", { background: p })} />
          <Upload pid={pid} label="Upload reaction / split media" onDone={(p) => set("format", { media: p })} />
          {f.media ? <button className="link" onClick={() => set("format", { media: undefined })}>Remove media</button> : null}
        </div>
        <div className="cards">
          {catalog.formats.map((fm) => {
            const needsMatte = /cutout|cut out|breaks out|full colour/i.test(fm.description);
            return (
              <button key={fm.id} className={`card ${f.id === fm.id ? "on" : ""}`} onClick={() => set("format", { id: fm.id })}>
                <b>{fm.name}</b>
                <small>{fm.description}</small>
                {needsMatte && !hasMatte ? <em className="tag warn">needs cutout</em> : null}
              </button>
            );
          })}
        </div>
      </>
    );
  }

  if (tab === "Motion") return <MotionPanel spec={spec} update={update} catalog={catalog} sourceNow={sourceNow} />;

  if (tab === "Titles") {
    const h = spec.hook || { text: "", style: "slam", duration: 2.2 };
    const ec = spec.endCard || { enabled: false, style: "follow", text: "Follow for more", duration: 2.5 };
    return (
      <>
        <h4>Hook title</h4>
        <div className="controls">
          <Field label="Text">
            <input value={h.text} onChange={(e) => update((s) => ({ ...s, hook: { ...h, text: e.target.value } }))} />
          </Field>
          <Field label="Subtitle">
            <input value={h.subtitle || ""} onChange={(e) => update((s) => ({ ...s, hook: { ...h, subtitle: e.target.value } }))} />
          </Field>
          <Slider label="Seconds" value={h.duration} min={0.8} max={5} step={0.1} onChange={(v) => update((s) => ({ ...s, hook: { ...h, duration: v } }))} />
        </div>
        <div className="cards small">
          {catalog.titles.map((t) => (
            <button key={t.id} className={`card ${h.style === t.id ? "on" : ""}`} onClick={() => update((s) => ({ ...s, hook: { ...h, style: t.id } }))}>
              {t.name}
            </button>
          ))}
        </div>
        <h4>End card</h4>
        <div className="controls">
          <Toggle label="Show end card" value={ec.enabled} onChange={(v) => update((s) => ({ ...s, endCard: { ...ec, enabled: v } }))} />
          <Field label="Style">
            <select value={ec.style} onChange={(e) => update((s) => ({ ...s, endCard: { ...ec, style: e.target.value } }))}>
              {catalog.endCards.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Text">
            <input value={ec.text} onChange={(e) => update((s) => ({ ...s, endCard: { ...ec, text: e.target.value } }))} />
          </Field>
          <Field label="Button / subtitle">
            <input value={ec.subtitle || ""} onChange={(e) => update((s) => ({ ...s, endCard: { ...ec, subtitle: e.target.value } }))} />
          </Field>
          <Slider label="Seconds" value={ec.duration} min={1} max={5} step={0.1} onChange={(v) => update((s) => ({ ...s, endCard: { ...ec, duration: v } }))} />
          <Toggle label="Progress bar" value={spec.progressBar} onChange={(v) => update((s) => ({ ...s, progressBar: v }))} />
        </div>
      </>
    );
  }

  if (tab === "Colour") return <ColourPanel spec={spec} update={update} catalog={catalog} pid={pid} sourceNow={sourceNow} />;
  if (tab === "Overlays") return <OverlaysPanel spec={spec} update={update} catalog={catalog} pid={pid} sourceNow={sourceNow} />;
  if (tab === "B-roll") return <BrollPanel spec={spec} update={update} pid={pid} sourceNow={sourceNow} />;

  if (tab === "Audio") {
    const a = spec.audio;
    return (
      <div className="controls">
        <Upload pid={pid} label="Upload music" accept="audio/*" onDone={(p) => set("audio", { music: p })} />
        {a.music ? (
          <div className="row">
            <small className="path">{a.music.split("/").pop()}</small>
            <button className="link" onClick={() => set("audio", { music: undefined })}>
              remove
            </button>
          </div>
        ) : null}
        <Slider label="Music volume" value={a.musicVolume} min={0} max={1} step={0.02} onChange={(v) => set("audio", { musicVolume: v })} />
        <Toggle label="Duck music under voice" value={a.duck} onChange={(v) => set("audio", { duck: v })} />
        <Slider label="Voice volume" value={a.voiceVolume} min={0} max={2} step={0.05} onChange={(v) => set("audio", { voiceVolume: v })} />
        <Toggle label="Enhance voice (denoise, EQ, compression)" value={!!a.enhanceVoice} onChange={(v) => set("audio", { enhanceVoice: v })} />
        <Slider label="Loudness target LUFS" value={a.loudness ?? -14} min={-18} max={-9} step={1} onChange={(v) => set("audio", { loudness: v })} />
        <Toggle label="Pulse to the music beat" value={!!spec.motion.beatPulse} disabled={!a.music} onChange={(v) => update((s) => ({ ...s, motion: { ...s.motion, beatPulse: v }, audio: { ...s.audio, beats: undefined } }))} />
        <Toggle label="Sound effects" value={a.sfx} onChange={(v) => set("audio", { sfx: v })} />
        <Slider label="SFX volume" value={a.sfxVolume} min={0} max={1} step={0.05} onChange={(v) => set("audio", { sfxVolume: v })} />
        <h4>Sound at the playhead</h4>
        <div className="cards small">
          {catalog.sfx.map((s) => (
            <button key={s} className="card" onClick={() => set("audio", { sfxEvents: [...(a.sfxEvents || []), { at: +sourceNow.toFixed(2), sound: s }] })}>
              {s}
            </button>
          ))}
        </div>
        <ul className="list">
          {(a.sfxEvents || []).map((ev, i) => (
            <li key={i}>
              <span>
                {ev.sound} @ {ev.at.toFixed(2)}s
              </span>
              <button className="x" onClick={() => set("audio", { sfxEvents: (a.sfxEvents || []).filter((_, j) => j !== i) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (tab === "Brand") return <BrandPanel spec={spec} update={update} catalog={catalog} />;
  if (tab === "Mimic") return <MimicPanel onLook={(id) => { refreshCatalog(); applyLook(id); }} />;
  return null;
};


const MotionPanel: React.FC<{ spec: ReelSpec; update: Update; catalog: Catalog; sourceNow: number }> = ({ spec, update, catalog, sourceNow }) => {
  const set = <K extends keyof ReelSpec>(k: K, patch: Partial<ReelSpec[K]>) => update((s) => ({ ...s, [k]: { ...(s[k] as any), ...patch } }));

    const m = spec.motion;
    const fam = groupBy(catalog.effects, (e) => e.family);
    const [pick, setPick] = useState(fam.camera?.[0]?.id || "");
    return (
      <>
        <div className="controls">
          <Field label="Auto punch-in">
            <select value={m.autoZoom} onChange={(e) => set("motion", { autoZoom: e.target.value as any })}>
              {["off", "subtle", "alternate", "punchy"].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </Field>
          <Field label="Camera move on every shot">
            <select value={m.camera} onChange={(e) => set("motion", { camera: e.target.value })}>
              <option value="none">none</option>
              {fam.camera?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ShotControls spec={spec} update={update} sourceNow={sourceNow} />
        <h4>Transition at every cut</h4>
        <div className="cards small">
          <button className={`card ${m.cutTransition === "none" ? "on" : ""}`} onClick={() => set("motion", { cutTransition: "none" })}>
            Hard cut
          </button>
          {[...(fam.transition || []), ...(fam.camera || []).filter((e) => /punch|crash|bounce|spin/.test(e.id))].map((e) => (
            <button key={e.id} className={`card ${m.cutTransition === e.id ? "on" : ""}`} onClick={() => set("motion", { cutTransition: e.id })}>
              {e.name}
            </button>
          ))}
        </div>
        <h4>Effect at the playhead</h4>
        <div className="row">
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            {(["camera", "transition"] as const).map((f) => (
              <optgroup key={f} label={f}>
                {fam[f]?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button onClick={() => set("motion", { events: [...m.events, { effect: pick, at: +sourceNow.toFixed(2) }] })}>Add at {sourceNow.toFixed(1)}s</button>
        </div>
        <ul className="list">
          {m.events.map((ev, i) => (
            <li key={i}>
              <span>
                {ev.effect} @ {ev.at.toFixed(2)}s
              </span>
              <input type="number" step={0.1} value={ev.intensity ?? 1} title="intensity" onChange={(e) => set("motion", { events: m.events.map((x, j) => (j === i ? { ...x, intensity: parseFloat(e.target.value) } : x)) })} />
              <button className="x" onClick={() => set("motion", { events: m.events.filter((_, j) => j !== i) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  };

const ShotControls: React.FC<{ spec: ReelSpec; update: Update; sourceNow: number }> = ({ spec, update, sourceNow }) => {
  const i = spec.segments.findIndex((s) => sourceNow >= s.start - 0.01 && sourceNow <= s.end + 0.01);
  if (i < 0) return null;
  const seg = spec.segments[i];
  const setSeg = (patch: Partial<typeof seg>) => update((s) => ({ ...s, segments: s.segments.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  return (
    <>
      <h4>This shot (#{i + 1})</h4>
      <div className="controls">
        <Slider label="Speed" value={seg.speed ?? 1} min={0.5} max={2.5} step={0.05} onChange={(v) => setSeg({ speed: v })} />
        <Slider label="Punch-in" value={seg.zoom ?? 1} min={1} max={2} step={0.02} onChange={(v) => setSeg({ zoom: v })} />
        <Slider label="Focus X" value={seg.cx ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => setSeg({ cx: v })} />
        <Slider label="Focus Y" value={seg.cy ?? 0.42} min={0} max={1} step={0.01} onChange={(v) => setSeg({ cy: v })} />
      </div>
    </>
  );
};

const LUT_SLIDERS: [keyof ReelSpec["grade"], string, number, number][] = [
  ["exposure", "Exposure (EV)", -2, 2],
  ["temperature", "Temperature", -100, 100],
  ["tint", "Tint", -100, 100],
  ["contrast", "Contrast", -100, 100],
  ["highlights", "Highlights", -100, 100],
  ["shadows", "Shadows", -100, 100],
  ["saturation", "Saturation", -100, 100],
  ["vibrance", "Vibrance", -100, 100],
  ["sharpen", "Sharpen", 0, 100],
  ["denoise", "Denoise", 0, 100],
];

const ColourPanel: React.FC<{ spec: ReelSpec; update: Update; catalog: Catalog; pid: string; sourceNow: number }> = ({ spec, update, catalog, pid, sourceNow }) => {
  const g = spec.grade;
  const [luts, setLuts] = useState<{ id: string; img: string }[] | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [shotOnly, setShotOnly] = useState(false);
  React.useEffect(() => {
    api.luts(pid).then(setLuts).catch(() => setLuts([]));
  }, [pid]);
  const segI = spec.segments.findIndex((s) => sourceNow >= s.start - 0.01 && sourceNow <= s.end + 0.01);
  const setG = (patch: Record<string, any>) => {
    if (shotOnly && segI >= 0) {
      update((s) => ({ ...s, segments: s.segments.map((x, j) => (j === segI ? { ...x, grade: { ...(x.grade || {}), ...patch } } : x)) }));
    } else {
      update((s) => ({ ...s, grade: { ...s.grade, ...patch } }));
    }
  };
  const cur: Record<string, any> = shotOnly && segI >= 0 ? spec.segments[segI].grade || {} : g;
  const stale = !!spec.source.graded && g.baked !== undefined;
  return (
    <>
      <div className="controls">
        <Field label="Camera profile">
          <select value={g.log || ""} onChange={(e) => update((s) => ({ ...s, grade: (({ log: _old, ...rest }) => (e.target.value ? { ...rest, log: e.target.value } : rest))(s.grade) as ReelSpec["grade"] }))}>
            {CAMERA_PROFILES.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {g.log ? <small className="hint">Log footage is converted to normal colour when you bake. The preview stays flat until then.</small> : null}
      <div className="row">
        <button
          className="primary"
          disabled={job?.status === "running"}
          onClick={async () => {
            await new Promise((r) => setTimeout(r, 800)); // let autosave land
            const r = await api.bake(pid);
            watchJob(r.job, async (j) => {
              setJob(j);
              if (j.status !== "done") return;
              const baked = j.result?.spec || (await api.spec(pid)).spec; // cloud: the job stores it, fetch it back
              update(() => baked);
            });
          }}
        >
          {job?.status === "running" ? "Baking…" : "Bake & preview true colour"}
        </button>
      </div>
      <small className="hint">
        {spec.source.graded ? "Preview shows the baked grade. Re-bake after changes (renders re-bake automatically)." : "Live preview is an approximation; LUTs show after baking."}
        {stale ? "" : ""}
      </small>
      {job ? <div className="joblog">{job.log.slice(-4).map((l, i) => <div key={i}>{l}</div>)}</div> : null}
      <div className="controls">
        <Toggle label={`Apply to this shot only${segI >= 0 ? ` (#${segI + 1})` : ""}`} value={shotOnly} onChange={setShotOnly} />
        <Toggle label="Auto white balance" value={!!g.autoWhiteBalance} onChange={(v) => update((s) => ({ ...s, grade: { ...s.grade, autoWhiteBalance: v } }))} />
        <Toggle label="Auto exposure" value={!!g.autoExposure} onChange={(v) => update((s) => ({ ...s, grade: { ...s.grade, autoExposure: v } }))} />
        <Toggle label="Match colour across clips" value={!!g.matchClips} onChange={(v) => update((s) => ({ ...s, grade: { ...s.grade, matchClips: v } }))} />
        {LUT_SLIDERS.map(([k, label, min, max]) => (
          <Slider key={k} label={label} value={Number(cur[k] ?? 0)} min={min} max={max} step={k === "exposure" ? 0.05 : 1} onChange={(v) => setG({ [k]: v })} />
        ))}
        <button className="link" onClick={() => setG(Object.fromEntries(LUT_SLIDERS.map(([k]) => [k, 0])))}>
          Reset sliders
        </button>
      </div>
      <h4>LUT</h4>
      <Slider label="LUT strength" value={g.lutStrength ?? 1} min={0} max={1} step={0.05} onChange={(v) => update((s) => ({ ...s, grade: { ...s.grade, lutStrength: v } }))} />
      <div className="cards lut">
        {(luts || []).map((l) => (
          <button key={l.id} className={`card ${(g.lut || "none") === l.id ? "on" : ""}`} onClick={() => update((s) => ({ ...s, grade: { ...s.grade, lut: l.id === "none" ? undefined : l.id } }))}>
            <img src={l.img} alt="" />
            <small>{l.id}</small>
          </button>
        ))}
        {luts === null ? <small>Rendering LUT previews…</small> : null}
      </div>
      <small className="hint">Your own .cube files: drop them in ~/.bettercut/luts</small>
      <h4>Creative look on top</h4>
      <div className="controls">
        <Slider label="Vignette" value={g.vignette} min={0} max={1} step={0.05} onChange={(v) => update((s) => ({ ...s, grade: { ...s.grade, vignette: v } }))} />
        <Slider label="Grain" value={g.grain} min={0} max={1} step={0.05} onChange={(v) => update((s) => ({ ...s, grade: { ...s.grade, grain: v } }))} />
      </div>
      <div className="cards small">
        {catalog.grades.map((gr) => (
          <button key={gr.id} className={`card ${g.preset === gr.id ? "on" : ""}`} onClick={() => update((s) => ({ ...s, grade: { ...s.grade, preset: gr.id } }))}>
            {gr.name}
          </button>
        ))}
      </div>
    </>
  );
};

const Upload: React.FC<{ pid: string; label: string; accept?: string; onDone: (path: string) => void }> = ({ pid, label, accept, onDone }) => {
  const [busy, setBusy] = useState(false);
  return (
    <label className="upload">
      {busy ? "Uploading…" : label}
      <input
        type="file"
        accept={accept}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            onDone((await api.upload(pid, f)).path);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
};

const OverlaysPanel: React.FC<{ spec: ReelSpec; update: Update; catalog: Catalog; pid: string; sourceNow: number }> = ({ spec, update, catalog, pid, sourceNow }) => {
  const [kind, setKind] = useState<OverlayKind>("sticker");
  const entrances = catalog.effects.filter((e) => e.family === "entrance");
  const setO = (i: number, patch: Partial<ReelOverlay>) => update((s) => ({ ...s, overlays: s.overlays.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));
  return (
    <>
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value as OverlayKind)}>
          {catalog.overlays.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button
          onClick={() =>
            update((s) => ({
              ...s,
              overlays: [...s.overlays, { kind, start: +sourceNow.toFixed(2), end: +(sourceNow + 2.5).toFixed(2), ...DEFAULT_OVERLAY[kind] } as ReelOverlay],
            }))
          }
        >
          Add at {sourceNow.toFixed(1)}s
        </button>
      </div>
      {spec.overlays.map((o, i) => (
        <details key={i} className="item" open={i === spec.overlays.length - 1}>
          <summary>
            {o.kind} · {o.start.toFixed(1)}–{o.end.toFixed(1)}s {o.text ? `· ${o.text.slice(0, 18)}` : ""}
            <button className="x" onClick={() => update((s) => ({ ...s, overlays: s.overlays.filter((_, j) => j !== i) }))}>
              ×
            </button>
          </summary>
          <div className="controls">
            <Field label="Text">
              <input value={o.text || ""} onChange={(e) => setO(i, { text: e.target.value })} />
            </Field>
            <Field label="Subtitle">
              <input value={o.subtitle || ""} onChange={(e) => setO(i, { subtitle: e.target.value })} />
            </Field>
            {["checklist", "numberedList", "progressSteps", "poll", "bars", "metrics", "compare"].includes(o.kind) ? (
              <Field
                label={
                  o.kind === "bars"
                    ? "Bars (one per line, like Reels: 62)"
                    : o.kind === "metrics"
                      ? "Numbers (one per line, like +38% Watch time)"
                      : o.kind === "compare"
                        ? "Before and after (two lines, like Before: 2 hrs)"
                        : "Items (one per line)"
                }
              >
                <textarea value={(o.items || []).join("\n")} onChange={(e) => setO(i, { items: e.target.value.split("\n") })} />
              </Field>
            ) : null}
            {o.kind === "tierList" ? (
              <Field label="Tiers (S: a, b)">
                <textarea
                  value={(o.tiers || []).map((t) => `${t.label}: ${t.items.join(", ")}`).join("\n")}
                  onChange={(e) =>
                    setO(i, {
                      tiers: e.target.value.split("\n").map((ln) => {
                        const [label, rest = ""] = ln.split(":");
                        return { label: label.trim(), items: rest.split(",").map((x) => x.trim()).filter(Boolean) };
                      }),
                    })
                  }
                />
              </Field>
            ) : null}
            {o.kind === "emoji" || o.kind === "notification" || o.kind === "sticker" ? (
              <Field label="Emoji">
                <input value={o.emoji || ""} onChange={(e) => setO(i, { emoji: e.target.value })} />
              </Field>
            ) : null}
            {o.kind === "donut" || o.kind === "chapter" ? (
              <Field label={o.kind === "donut" ? "Percent" : "Chapter number"}>
                <input type="number" value={o.value ?? 0} onChange={(e) => setO(i, { value: parseFloat(e.target.value) || 0 })} />
              </Field>
            ) : null}
            {o.kind === "counter" ? (
              <Field label="Value / prefix / suffix">
                <div className="row">
                  <input type="number" value={o.value ?? 0} onChange={(e) => setO(i, { value: parseFloat(e.target.value) })} />
                  <input value={o.prefix || ""} placeholder="$" onChange={(e) => setO(i, { prefix: e.target.value })} />
                  <input value={o.suffix || ""} placeholder="%" onChange={(e) => setO(i, { suffix: e.target.value })} />
                </div>
              </Field>
            ) : null}
            {o.kind === "image" ? <Upload pid={pid} label="Upload image" accept="image/*" onDone={(p) => setO(i, { src: p })} /> : null}
            <div className="row">
              <Field label="Start">
                <input type="number" step={0.1} value={o.start} onChange={(e) => setO(i, { start: parseFloat(e.target.value) })} />
              </Field>
              <Field label="End">
                <input type="number" step={0.1} value={o.end} onChange={(e) => setO(i, { end: parseFloat(e.target.value) })} />
              </Field>
            </div>
            <Slider label="X" value={o.x ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => setO(i, { x: v })} />
            <Slider label="Y" value={o.y ?? 0.36} min={0.1} max={0.77} step={0.01} onChange={(v) => setO(i, { y: v })} />
            <Slider label="Scale" value={o.scale ?? 1} min={0.3} max={2} step={0.05} onChange={(v) => setO(i, { scale: v })} />
            <Slider label="Tilt" value={o.rotate ?? 0} min={-20} max={20} step={1} onChange={(v) => setO(i, { rotate: v })} />
            <Field label="Entrance">
              <select value={o.enter || ""} onChange={(e) => setO(i, { enter: e.target.value || undefined })}>
                <option value="">default</option>
                {entrances.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </details>
      ))}
    </>
  );
};

const BrollPanel: React.FC<{ spec: ReelSpec; update: Update; pid: string; sourceNow: number }> = ({ spec, update, pid, sourceNow }) => {
  const [mode, setMode] = useState<BrollClip["mode"]>("full");
  const [job, setJob] = useState<Job | null>(null);
  const setB = (i: number, patch: Partial<BrollClip>) => update((s) => ({ ...s, broll: s.broll.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  return (
    <>
      <div className="row">
        <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
          <option value="full">Full screen cutaway</option>
          <option value="split">Split (media on top)</option>
          <option value="pip">Corner window</option>
          <option value="card">Tilted card</option>
          <option value="behind">Behind me (needs cutout)</option>
        </select>
        <Upload
          pid={pid}
          label={`Add clip at ${sourceNow.toFixed(1)}s`}
          accept="video/*,image/*"
          onDone={(p) => update((s) => ({ ...s, broll: [...s.broll, { src: p, start: +sourceNow.toFixed(2), end: +(sourceNow + 2).toFixed(2), mode }] }))}
        />
      </div>
      <button
        disabled={job?.status === "running"}
        onClick={async () => {
          const r = await api.broll(pid);
          watchJob(r.job, (j) => {
            setJob(j);
            if (j.status === "done") location.reload();
          });
        }}
      >
        {job?.status === "running" ? "Finding clips…" : "Auto b-roll for punch words (Pexels)"}
      </button>
      {job ? <div className="joblog">{job.log.slice(-4).map((l, i) => <div key={i}>{l}</div>)}</div> : null}
      <ul className="list">
        {spec.broll.map((b, i) => (
          <li key={i}>
            <span className="path">{b.src.split("/").pop()}</span>
            <select value={b.mode} onChange={(e) => setB(i, { mode: e.target.value as any })}>
              {["full", "split", "pip", "card", "behind"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input type="number" step={0.1} value={b.start} onChange={(e) => setB(i, { start: parseFloat(e.target.value) })} />
            <input type="number" step={0.1} value={b.end} onChange={(e) => setB(i, { end: parseFloat(e.target.value) })} />
            <button className="x" onClick={() => update((s) => ({ ...s, broll: s.broll.filter((_, j) => j !== i) }))}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};

const BrandPanel: React.FC<{ spec: ReelSpec; update: Update; catalog: Catalog }> = ({ spec, update, catalog }) => {
  const b = spec.brand;
  const [saved, setSaved] = useState("");
  const setBrand = (patch: Partial<typeof b>) => update((s) => ({ ...s, brand: { ...s.brand, ...patch } }));
  return (
    <div className="controls">
      <Field label="Name">
        <input value={b.name} onChange={(e) => setBrand({ name: e.target.value })} />
      </Field>
      <Field label="Handle">
        <input value={b.handle} onChange={(e) => setBrand({ handle: e.target.value.replace(/^@/, "") })} />
      </Field>
      {(["primary", "accent", "text", "ink", "background"] as const).map((k) => (
        <Field key={k} label={k}>
          <div className="row">
            <input type="color" value={b[k]} onChange={(e) => setBrand({ [k]: e.target.value } as any)} />
            <input value={b[k]} onChange={(e) => setBrand({ [k]: e.target.value } as any)} />
          </div>
        </Field>
      ))}
      {(["headingFont", "bodyFont", "serifFont"] as const).map((k) => (
        <Field key={k} label={k}>
          <select value={b[k]} onChange={(e) => setBrand({ [k]: e.target.value } as any)}>
            {catalog.fonts.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Field>
      ))}
      <button
        onClick={async () => {
          await api.saveBrand(b as any);
          setSaved("Saved as your default brand");
        }}
      >
        Use for every new reel
      </button>
      <small>{saved}</small>
    </div>
  );
};

const MimicPanel: React.FC<{ onLook: (id: string) => void }> = ({ onLook }) => {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  return (
    <div className="controls">
      <p className="hint">
        Show it a reel you love. BetterCut measures its cut rhythm, colour and pace and saves a Look you can reuse. It learns the style, never the footage.
      </p>
      <Field label="Reference file">
        <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </Field>
      <Field label="…or link (needs yt-dlp)">
        <input value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Field label="Name this look">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <button
        disabled={(!file && !url) || job?.status === "running"}
        onClick={async () => {
          const f = new FormData();
          if (file) f.append("file", file);
          f.append("url", url);
          f.append("name", name);
          const { job: id } = await api.mimic(f);
          watchJob(id, setJob);
        }}
      >
        {job?.status === "running" ? "Analysing…" : "Mimic this style"}
      </button>
      {job ? (
        <div className="joblog">
          {job.log.slice(-6).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
          {job.status === "done" ? (
            <>
              <div>
                {job.result.shots.cutsPerMin} cuts/min · avg shot {job.result.shots.avgShot}s
              </div>
              <div className="swatches">
                {(job.result.colour.palette || []).map((c: string) => (
                  <span key={c} style={{ background: c }} />
                ))}
              </div>
              <button onClick={() => onLook(job.result.look)}>Apply “{job.result.look}”</button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
