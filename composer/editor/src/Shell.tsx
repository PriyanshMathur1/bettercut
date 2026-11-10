// Pieces of the editor's shell: the icon rail, the media bin, the transport bar, the Ask AI bar,
// the Project card and the Export menu. The rules behind them live in workspace.ts.
import React, { useEffect, useRef, useState } from "react";
import { fmtClock, timecode, type BinItem, type RailGroup, type RailIcon } from "./workspace";

const PATHS: Record<RailIcon, React.ReactNode> = {
  looks: <path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 18.5 12 15.6 7 18.5l1.4-5.7L4 9l5.8-.7z" />,
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 12h4M13 12h4M7 15.5h7" />
    </>
  ),
  graphics: (
    <>
      <path d="M5 6h14M12 6v12M9 18h6" />
    </>
  ),
  media: (
    <>
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </>
  ),
  audio: (
    <>
      <path d="M9 18V6l11-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  effects: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />,
  format: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M3 8v8M21 8v8" />
    </>
  ),
  mimic: (
    <>
      <rect x="3" y="3" width="11" height="11" rx="2" />
      <rect x="10" y="10" width="11" height="11" rx="2" />
    </>
  ),
};

export const Icon: React.FC<{ name: RailIcon }> = ({ name }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {PATHS[name]}
  </svg>
);

/** The left rail: one button per group, then the open group's sub-tabs and panel. */
export const Rail: React.FC<{
  rail: RailGroup[];
  open: RailIcon | null;
  /** Sub-tabs of the open group; one entry shows no tab strip. */
  tabs: string[];
  tab: string;
  onOpen: (g: RailGroup) => void;
  onTab: (t: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ rail, open, tabs, tab, onOpen, onTab, onClose, children }) => {
  const group = rail.find((g) => g.id === open);
  return (
    <aside className={`s-left ${group ? "" : "shut"}`}>
      <nav className="s-rail" aria-label="Tools">
        {rail.map((g) => (
          <button key={g.id} className={open === g.id ? "on" : ""} aria-pressed={open === g.id} title={g.hint} onClick={() => (open === g.id ? onClose() : onOpen(g))}>
            <Icon name={g.id} />
            <span>{g.label}</span>
          </button>
        ))}
      </nav>
      {group ? (
        <section className="s-drawer" aria-label={group.label}>
          <div className="s-drawer-head">
            <b>{group.label}</b>
            <button className="x" onClick={onClose} aria-label={`Close ${group.label}`}>
              ×
            </button>
          </div>
          {tabs.length > 1 ? (
            <div className="s-seg" role="tablist">
              {tabs.map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => onTab(t)}>
                  {t}
                </button>
              ))}
            </div>
          ) : null}
          <div className="panel">{children}</div>
        </section>
      ) : null}
    </aside>
  );
};

const len = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `0:${String(Math.round(s)).padStart(2, "0")}`);
const KIND_LABEL: Record<BinItem["kind"], string> = { clip: "Clip", video: "Video layer", image: "Image layer", audio: "Sound", voice: "Voiceover", music: "Music" };

/** A still from a video at a moment, drawn by the browser from the file itself (no thumbnails to make). */
const Thumb: React.FC<{ item: BinItem; url: (src: string) => string }> = ({ item, url }) => {
  const src = item.src ? url(item.src) : "";
  if (src && (item.kind === "clip" || item.kind === "video"))
    return <video src={`${src}#t=${(item.kind === "clip" ? (item.start ?? 0) : 0) + Math.min(0.5, item.seconds / 2)}`} preload="metadata" muted playsInline tabIndex={-1} />;
  if (src && item.kind === "image") return <img src={src} alt="" loading="lazy" />;
  return <span className="s-bin-wave">{item.kind === "music" ? "♫" : item.kind === "voice" ? "●" : "♪"}</span>;
};

/**
 * The media bin: every clip the footage was built from, then layers, voiceovers and music.
 * Click an item to jump to where it sits on the timeline.
 */
export const MediaBin: React.FC<{
  items: BinItem[];
  url: (src: string) => string;
  /** Where an item sits in the finished video, or null if that footage was cut. */
  placeOf: (item: BinItem) => number | null;
  onGo: (t: number) => void;
  onAddClips: () => void;
  onAddMedia: () => void;
  onRecord: () => void;
  busy: boolean;
}> = ({ items, url, placeOf, onGo, onAddClips, onAddMedia, onRecord, busy }) => {
  const [filter, setFilter] = useState<"all" | "video" | "audio" | "image">("all");
  const [q, setQ] = useState("");
  const group = (k: BinItem["kind"]) => (k === "clip" || k === "video" ? "video" : k === "image" ? "image" : "audio");
  const shown = items.filter((i) => (filter === "all" || group(i.kind) === filter) && i.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="s-bin">
      <div className="s-bin-add">
        <button onClick={onAddClips} disabled={busy} title="Add more video clips to the end of this video">
          + Clips
        </button>
        <button onClick={onAddMedia} disabled={busy} title="Add a video, image or sound on its own track, starting at the playhead">
          + Layer
        </button>
        <button onClick={onRecord} title="Record yourself with a teleprompter">
          Record
        </button>
      </div>
      <input className="s-bin-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search media…" aria-label="Search media" />
      <div className="s-bin-filter" role="tablist" aria-label="Kind of media">
        {(["all", "video", "audio", "image"] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "video" ? "Video" : f === "audio" ? "Audio" : "Image"}
          </button>
        ))}
      </div>
      {shown.length ? (
        <div className="s-bin-grid">
          {shown.map((item, i) => {
            const at = placeOf(item);
            return (
              <button key={`${item.kind}-${item.name}-${i}`} className={`s-bin-item ${at === null && item.kind !== "music" ? "off" : ""}`} disabled={at === null} onClick={() => at !== null && onGo(at)} title={at === null ? (item.kind === "music" ? "Plays under the whole video" : "This footage was cut from the video") : `${KIND_LABEL[item.kind]}: jump to it on the timeline`}>
                <span className="s-bin-thumb">
                  <Thumb item={item} url={url} />
                  {item.seconds ? <em>{len(item.seconds)}</em> : null}
                </span>
                <span className="s-bin-name">
                  <i className={`dot ${group(item.kind)}`} />
                  {item.name}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="hint">{items.length ? "Nothing matches." : "No media yet."}</p>
      )}
    </div>
  );
};

/** The transport bar under the preview: timecode, cut-to-cut and frame-by-frame stepping, play. */
export const Transport: React.FC<{
  t: number;
  duration: number;
  fps: number;
  playing: boolean;
  onToggle: () => void;
  onStep: (frames: number) => void;
  onPrevCut: () => void;
  onNextCut: () => void;
  onUndo: () => void;
}> = ({ t, duration, fps, playing, onToggle, onStep, onPrevCut, onNextCut, onUndo }) => (
  <div className="s-transport">
    <span className="s-tc" title="Hours : minutes : seconds : frames">
      {timecode(t, fps)}
    </span>
    <div className="s-keys">
      <button onClick={onUndo} title="Undo the last change" aria-label="Undo">
        ↶
      </button>
      <button onClick={onPrevCut} title="Go to the previous cut" aria-label="Previous cut">
        ⏮
      </button>
      <button onClick={() => onStep(-1)} title="Back one frame" aria-label="Back one frame">
        ◂
      </button>
      <button className="play" onClick={onToggle} title={playing ? "Pause (Space)" : "Play (Space)"} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <button onClick={() => onStep(1)} title="Forward one frame" aria-label="Forward one frame">
        ▸
      </button>
      <button onClick={onNextCut} title="Go to the next cut" aria-label="Next cut">
        ⏭
      </button>
    </div>
    <span className="s-tc dim" title="Length of the video">
      {timecode(duration, fps)} · {Math.round(fps)} fps
    </span>
  </div>
);

const EXAMPLES = ["cut the pauses", "bigger captions on the hook", "add music that fits"];

/**
 * The Ask AI bar under the preview. Enter or Ask sends what you typed (about the whole reel) together with
 * any notes pinned to moments; Pin keeps the text as a note at the playhead to send with the next Ask.
 */
export const AskBar: React.FC<{
  value: string;
  onChange: (v: string) => void;
  at: string;
  queued: { t: number | null; text: string }[];
  onPin: () => void;
  onUnpin: (i: number) => void;
  onSeek: (t: number) => void;
  onAsk: () => void;
  busy: boolean;
  needsModel: boolean;
  who: string;
}> = ({ value, onChange, at, queued, onPin, onUnpin, onSeek, onAsk, busy, needsModel, who }) => {
  const can = !busy && (needsModel || !!value.trim() || queued.length > 0);
  return (
    <div className="s-ask">
      {queued.length ? (
        <div className="s-pins">
          {queued.map((n, i) => (
            <span key={i} className="s-pin">
              {n.t === null ? <em>all</em> : <button className="link" onClick={() => onSeek(n.t!)}>{fmtClock(n.t)}</button>}
              {n.text}
              <button className="x" aria-label="Remove note" onClick={() => onUnpin(i)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="s-ask-row">
        <span className="s-spark" aria-hidden="true">
          ✦
        </span>
        <input
          value={value}
          aria-label={`Ask ${who} to edit`}
          placeholder={`Ask ${who} to edit: “${EXAMPLES.join("”, “")}”`}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // the Enter that confirms a word in Hindi, Japanese or Chinese typing is not a send
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && can) onAsk();
          }}
        />
        <button className="ghost" disabled={!value.trim()} onClick={onPin} title={`Keep this as a note at ${at}, sent with your next Ask`}>
          Pin to {at}
        </button>
        <button className="primary" disabled={!can} onClick={onAsk}>
          {needsModel ? "Connect AI" : busy ? "Working…" : queued.length ? `Ask (${queued.length + (value.trim() ? 1 : 0)})` : "Ask"}
        </button>
      </div>
    </div>
  );
};

export const SHAPES = [
  { id: "9x16", name: "Vertical", sub: "Reels, Shorts", w: 9, h: 16 },
  { id: "4x5", name: "Portrait", sub: "Feed posts", w: 4, h: 5 },
  { id: "1x1", name: "Square", sub: "Feed, carousel", w: 1, h: 1 },
  { id: "16x9", name: "Landscape", sub: "YouTube", w: 16, h: 9 },
];

/** The right-hand Project card: shapes to render, a few numbers, and quick ways to add things. */
export const ProjectCard: React.FC<{
  shapes: string[];
  /** The shape the project was made in; the others are reframed from it at render. */
  native: string;
  onShape: (id: string) => void;
  length: string;
  shots: number;
  cut: number;
  onAdd: (what: "text" | "music" | "captions" | "broll" | "voice" | "clips") => void;
  /** A job is running: adding footage or recording now could clash with it. */
  busy: boolean;
  /** The playhead is on footage, so a voiceover has somewhere to start. */
  canVoice: boolean;
}> = ({ shapes, native, onShape, length, shots, cut, onAdd, busy, canVoice }) => (
  <div className="s-card">
    <h3>Video shape</h3>
    <div className="s-shapes">
      {SHAPES.map((s) => (
        <button key={s.id} className={shapes.includes(s.id) ? "on" : ""} aria-pressed={shapes.includes(s.id)} onClick={() => onShape(s.id)} title={s.id === native ? "This video's own shape" : "Also render this shape, reframed from the video"}>
          <i style={{ aspectRatio: `${s.w} / ${s.h}` }} />
          <b>{s.name}</b>
          <small>{s.id === native ? "This video" : s.sub}</small>
        </button>
      ))}
    </div>
    <div className="s-stats">
      <div>
        <small>Length</small>
        <b>{length}</b>
      </div>
      <div>
        <small>Shots</small>
        <b>{shots}</b>
      </div>
      <div>
        <small>Words cut</small>
        <b>{cut}</b>
      </div>
    </div>
    <h3>Add to your video</h3>
    <div className="s-adds">
      <button onClick={() => onAdd("text")}>T&nbsp; Title</button>
      <button onClick={() => onAdd("music")}>♫&nbsp; Music</button>
      <button onClick={() => onAdd("captions")}>▭&nbsp; Captions</button>
      <button onClick={() => onAdd("broll")}>▶&nbsp; B-roll</button>
      <button
        onClick={() => onAdd("voice")}
        disabled={busy || !canVoice}
        title={busy ? "Wait for the current job to finish" : canVoice ? "Record narration from your microphone, starting at the playhead" : "Move the playhead onto the footage first"}
      >
        ●&nbsp; Voiceover
      </button>
      <button onClick={() => onAdd("clips")} disabled={busy} title={busy ? "Wait for the current job to finish" : "Add more video clips to the end of this reel"}>
        ＋&nbsp; Clips
      </button>
    </div>
  </div>
);

/** One Export button holding every way out: final render, quick draft, ProRes master and the files. */
export const ExportMenu: React.FC<{
  busy: boolean;
  shapes: number;
  onRender: (quality: "high" | "draft" | "master") => void;
  onFile: (kind: "srt" | "vtt" | "fcpxml") => void;
}> = ({ busy, shapes, onRender, onFile }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const n = `${shapes} shape${shapes === 1 ? "" : "s"}`;
  return (
    <div className="s-export" ref={box}>
      <button className="primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={busy}>
        {busy ? "Working…" : "Export ▾"}
      </button>
      {open ? (
        <div className="s-menu" role="menu">
          <button role="menuitem" onClick={pick(() => onRender("high"))} disabled={!shapes}>
            <b>Render</b>
            <small>{shapes ? `Full quality, ${n}` : "Choose a video shape in the Project card first"}</small>
          </button>
          <button role="menuitem" onClick={pick(() => onRender("draft"))}>
            <b>Quick draft</b>
            <small>Fast, lower quality, to check the cut</small>
          </button>
          <button role="menuitem" onClick={pick(() => onRender("master"))} disabled={!shapes}>
            <b>ProRes master</b>
            <small>For finishing in another editor</small>
          </button>
          <hr />
          <button role="menuitem" onClick={pick(() => onFile("srt"))}>
            <b>Captions (SRT)</b>
          </button>
          <button role="menuitem" onClick={pick(() => onFile("vtt"))}>
            <b>Captions (VTT)</b>
          </button>
          <button role="menuitem" onClick={pick(() => onFile("fcpxml"))}>
            <b>FCPXML timeline</b>
            <small>Open the cut in Final Cut or DaVinci Resolve</small>
          </button>
        </div>
      ) : null}
    </div>
  );
};

export { fmtClock }; // shared with the rest of the editor; it lives in workspace.ts
