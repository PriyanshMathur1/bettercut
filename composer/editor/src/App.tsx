import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Reel, reelDuration } from "../../src/reel/Reel";
import type { ReelSpec } from "../../src/reel/types";
import { placeSegments, toOutput, toSource, outputWords, cutTimes, rangeToOutput } from "../../src/reel/timeline";
import { api, forPlayer, watchJob, type Catalog, type CloudConfig, type Job, type ProjectRow } from "./api";
import { Panel, TABS, type Tab } from "./Panels";
import { initAuth, authError, signInWithGoogle, currentSession } from "./auth";
import { Settings } from "./Settings";
import { Timeline } from "./Timeline";
import { Recorder } from "./Recorder";
import { kindOf, newLayer, placeLayer } from "../../src/reel/layers";
import { LayerHandle } from "./LayerHandle";

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/** Loads the server config, handles sign-in (cloud), then shows the editor. */
export const App: React.FC = () => {
  const [cfg, setCfg] = useState<CloudConfig | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [err] = useState(() => authError());
  useEffect(() => {
    api.config().then((c) => {
      setSignedIn(c.auth !== "supabase" || !!initAuth(c));
      setCfg(c);
    });
  }, []);
  if (!cfg) return <div className="empty"><p>Loading…</p></div>;
  if (!signedIn)
    return (
      <div className="login">
        <div className="card">
          <div className="brand big">
            <span className="mark">◆</span> BetterCut
          </div>
          <h1>Raw clips in. Finished reel out.</h1>
          <p>Cuts your retakes and filler words, adds captions and motion, and edits from your notes using your own AI model.</p>
          <button className="google" onClick={signInWithGoogle}>
            <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.500-4.800 7.200l7.700 6c4.500-4.200 6.900-10.300 6.900-17.700z" />
              <path fill="#FBBC05" d="M10.500 28.600c-.5-1.500-.8-3-.8-4.600s.3-3.100.8-4.600l-7.900-6.200C.9 16.500 0 20.100 0 24s.9 7.500 2.600 10.800l7.900-6.200z" />
              <path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.700-6c-2.100 1.400-4.900 2.300-8.200 2.300-6.300 0-11.600-4.200-13.500-9.900l-7.900 6.200C6.500 42.600 14.600 48 24 48z" />
            </svg>
            Continue with Google
          </button>
          {err ? <p className="err">{err}</p> : null}
          <small className="hint">Sign-in is with a Google account only.</small>
        </div>
      </div>
    );
  return <Editor cfg={cfg} />;
};

const VOLUME_KEY = "bc.volumeBeforeTake"; // preview volume to restore after a voiceover take

const Editor: React.FC<{ cfg: CloudConfig }> = ({ cfg }) => {
  const cloud = cfg.mode === "cloud";
  const [settings, setSettings] = useState<null | "Connect" | "Model" | "Memory" | "Account">(null);
  const [hasModel, setHasModel] = useState(!cloud);
  const [aiReply, setAiReply] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [pid, setPid] = useState<string>(() => new URLSearchParams(location.search).get("reel") || localStorage.getItem("rs.pid") || "");
  const [spec, setSpec] = useState<ReelSpec | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("Looks");
  const [saving, setSaving] = useState<"saved" | "saving" | "dirty">("saved");
  const [job, setJob] = useState<Job | null>(null);
  const [frame, setFrame] = useState(0);
  const [safe, setSafe] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [recorder, setRecorder] = useState<null | "camera" | "voice">(null);
  const [layerSel, setLayerSel] = useState<number | null>(null); // layer selected on the timeline
  const volumeBefore = useRef(1); // preview volume to restore after a voiceover take
  const voiceAt = useRef(0); // where in the footage the playhead was when a voiceover started
  const [notes, setNotes] = useState<{ t: number; text: string }[]>([]);
  const [noteText, setNoteText] = useState("");
  const [mode, setMode] = useState<"seek" | "cut" | "emphasis" | "edit">("seek");
  const [aspects, setAspects] = useState<string[]>(["9x16"]);
  const [wholeReel, setWholeReel] = useState(false);
  const player = useRef<PlayerRef | null>(null);
  const [playerEl, setPlayerEl] = useState<PlayerRef | null>(null); // the mounted player, for effects that must follow it
  const setPlayer = useCallback((p: PlayerRef | null) => {
    player.current = p;
    setPlayerEl(p);
  }, []);
  const saveTimer = useRef<number>();
  const versionRef = useRef<number | null | undefined>(undefined); // spec version on screen (cloud)

  const refreshCatalog = useCallback(() => api.catalog().then(setCatalog), []);
  const refreshProjects = useCallback(() => api.projects().then(setProjects), []);
  const refreshMe = useCallback(() => (cloud ? api.me().then((m) => setHasModel(m.hasModel)).catch(() => {}) : Promise.resolve()), [cloud]);
  useEffect(() => {
    refreshCatalog();
    refreshProjects();
    refreshMe();
  }, []);

  const loadSpec = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const r = await api.spec(id);
      versionRef.current = r.version ?? null;
      setSpec(r.spec);
      setIssues(r.issues);
      setSaving("saved");
    } catch (e: any) {
      setSpec(null);
      setIssues([e.message]);
    }
  }, []);
  useEffect(() => {
    localStorage.setItem("rs.pid", pid);
    loadSpec(pid);
    setNotes([]);
  }, [pid]);

  /** Cloud: pick up edits made elsewhere (your AI app through the connector, or a finished bake) as they land. */
  const savingRef = useRef(saving);
  savingRef.current = saving;
  useEffect(() => {
    if (!cloud || !pid) return;
    const poll = async () => {
      if (savingRef.current !== "saved" || document.hidden || versionRef.current === undefined) return;
      try {
        const h = await api.head(pid);
        const changed = h.version !== versionRef.current;
        versionRef.current = h.version;
        if (changed && h.author !== "user") {
          await loadSpec(pid);
          if (h.author === "agent") setAiReply(`Edited from your AI app: ${h.summary || "change applied"}`);
        }
      } catch {}
    };
    const t = window.setInterval(poll, 2500);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [cloud, pid]);

  /** Edit the spec locally and autosave after a short pause. */
  const update = useCallback(
    (fn: (s: ReelSpec) => ReelSpec) => {
      setSpec((s) => {
        if (!s) return s;
        const next = fn(s);
        setSaving("dirty");
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(async () => {
          setSaving("saving");
          const r = await api.save(pid, next);
          setIssues(r.issues);
          setSaving("saved");
        }, 700);
        return next;
      });
    },
    [pid],
  );

  const placed = useMemo(() => (spec ? placeSegments(spec) : []), [spec?.segments, spec?.words]);
  const fps = spec?.fps || 30;
  const duration = spec ? reelDuration(spec) : 1;
  const tOut = frame / fps;
  const sourceNow = toSource(placed, tOut);
  const words = useMemo(() => (spec ? outputWords(placed, spec.words) : []), [placed, spec?.words]);
  const inputProps = useMemo(() => (spec ? (forPlayer({ ...spec, safeGuide: safe }) as any) : null), [spec, safe]);

  // A voiceover take silences the preview. If the page closed before the take ended, put the volume back.
  useEffect(() => {
    if (!playerEl) return;
    try {
      const saved = localStorage.getItem(VOLUME_KEY);
      if (saved === null) return;
      localStorage.removeItem(VOLUME_KEY);
      const v = Number(saved);
      playerEl.setVolume(Number.isFinite(v) && v > 0 ? Math.min(1, v) : 1);
    } catch {}
  }, [playerEl]);

  // Follow the player's frame. The player mounts only once the reel AND the catalog have loaded, in either
  // order, so the listener is tied to the player instance itself, not to the reel having loaded.
  useEffect(() => {
    if (!playerEl) return;
    setFrame(playerEl.getCurrentFrame());
    const on = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    playerEl.addEventListener("frameupdate", on);
    return () => playerEl.removeEventListener("frameupdate", on);
  }, [playerEl]);

  const seekOut = (t: number) => player.current?.seekTo(Math.max(0, Math.round(t * fps)));

  const onWord = (i: number, e: React.MouseEvent) => {
    if (!spec) return;
    const w = spec.words[i];
    const m = e.altKey ? "cut" : e.shiftKey ? "emphasis" : mode;
    if (m === "seek") {
      const o = toOutput(placed, w.start);
      if (o !== null) seekOut(o);
    } else if (m === "cut") {
      update((s) => ({ ...s, words: s.words.map((x, j) => (j === i ? { ...x, cut: !x.cut } : x)) }));
    } else if (m === "emphasis") {
      update((s) => ({ ...s, words: s.words.map((x, j) => (j === i ? { ...x, emphasis: !x.emphasis } : x)) }));
    } else if (m === "edit") {
      const text = window.prompt("Correct this word", w.text);
      if (text !== null && text.trim()) update((s) => ({ ...s, words: s.words.map((x, j) => (j === i ? { ...x, text: text.trim() } : x)) }));
    }
  };

  const applyLook = async (id: string) => {
    if (!pid) return;
    const r = await api.look(pid, id);
    setSpec(r.spec);
  };

  const run = (id: string, after?: (j: Job) => void) =>
    watchJob(id, (j) => {
      setJob(j);
      if (j.status !== "running") after?.(j);
    });

  /** An edit that needs server-made files (a reversed shot): save it, bake, then load the result. */
  const updateAndBake = async (fn: (s: ReelSpec) => ReelSpec) => {
    if (!spec) return;
    const next = fn(spec);
    window.clearTimeout(saveTimer.current);
    setSpec(next);
    try {
      await api.save(pid, next);
      setSaving("saved");
      const { job: id } = await api.bake(pid);
      run(id, (j) => {
        if (j.status === "done") loadSpec(pid);
      });
    } catch (e: any) {
      setJob({ id: "", kind: "colour", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  const addClips = async (files: File[]) => {
    window.clearTimeout(saveTimer.current);
    try {
      if (spec) await api.save(pid, spec);
      setSaving("saved");
      const { job: id } = await api.addClips(pid, files);
      run(id, (j) => {
        if (j.status === "done") loadSpec(pid);
      });
    } catch (e: any) {
      setJob({ id: "", kind: "clips", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  // the selected layer's drag handle in the preview, while the playhead is on that layer
  const handle = useMemo(() => {
    const layer = layerSel !== null ? spec?.layers?.[layerSel] : undefined;
    if (!layer || layer.kind === "audio") return null;
    const r = rangeToOutput(placed, layer.start, layer.end);
    if (!r || tOut < r.start - 0.001 || tOut > r.end + 0.001) return null;
    const at = Math.max(0, tOut - r.start);
    const i = layerSel as number;
    return { layer, at, move: (x: number, y: number) => update((s) => ({ ...s, layers: (s.layers || []).map((l, j) => (j === i ? placeLayer(l, at, x, y) : l)) })) };
  }, [layerSel, spec?.layers, placed, tOut, update]);

  /** Add a file as a media layer on its own track, starting where the playhead is. */
  const addMedia = async (file: File) => {
    const at = sourceNow;
    try {
      const r = await api.upload(pid, file);
      const kind = kindOf(file.name, file.type ? !file.type.startsWith("audio/") : undefined);
      update((s) => ({ ...s, layers: [...(s.layers || []), newLayer(s.layers, r.path, kind, at, r.seconds || 0)] }));
    } catch (e: any) {
      setJob({ id: "", kind: "media", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  /** A new reel is being made: follow its job, then open it. */
  const created = (id: string, jobId: string) => {
    refreshProjects();
    run(jobId, (j) => {
      refreshProjects();
      if (j.status === "done") {
        setPid(id);
        loadSpec(id);
      }
    });
  };

  /** A take from the camera: a new reel, or more footage for this one. */
  const recordedVideo = async (file: File, where: "new" | "add") => {
    setRecorder(null);
    if (where === "add" && pid) return addClips([file]);
    try {
      const f = new FormData();
      f.append("files", file);
      f.append("name", "recording");
      f.append("look", spec?.look || "bold-pop");
      const r = await api.create(f);
      created(r.project, r.job);
    } catch (e: any) {
      setJob({ id: "", kind: "make", project: "", status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  /** A take from the microphone: upload it and lay it over the reel where the playhead was. */
  const recordedVoice = async (file: File, seconds: number) => {
    setRecorder(null);
    try {
      const r = await api.upload(pid, file);
      const len = r.seconds && r.seconds > 0 ? r.seconds : seconds;
      const start = Math.round(voiceAt.current * 1000) / 1000;
      update((s) => ({ ...s, voiceovers: [...(s.voiceovers || []), { src: r.path, start, end: Math.round((start + len) * 1000) / 1000, volume: 1 }] }));
    } catch (e: any) {
      setJob({ id: "", kind: "voiceover", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  /** While a voiceover records, the reel plays silently so you can narrate to the picture. */
  const voiceRecording = (on: boolean) => {
    const p = player.current;
    if (!p) return;
    // The player remembers its volume across reloads, so the level to go back to is kept in storage too:
    // if the page closes mid-take, the next visit restores it (see the effect on the player below).
    if (on) {
      volumeBefore.current = p.getVolume();
      try {
        localStorage.setItem(VOLUME_KEY, String(volumeBefore.current));
      } catch {}
      p.setVolume(0);
      p.play();
    } else {
      p.pause();
      p.setVolume(volumeBefore.current);
      try {
        localStorage.removeItem(VOLUME_KEY);
      } catch {}
    }
  };

  const startRender = async (quality: string) => {
    window.clearTimeout(saveTimer.current);
    if (spec) await api.save(pid, spec);
    try {
      const { job: id } = await api.render(pid, quality, aspects);
      run(id, () => refreshProjects());
    } catch (e: any) {
      setJob({ id: "", kind: "render", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  const sendNotes = async () => {
    if (cloud && !hasModel) return setSettings("Connect");
    window.clearTimeout(saveTimer.current);
    if (spec) await api.save(pid, spec);
    setAiReply("");
    try {
      const { job: id } = await api.notes(pid, notes);
      run(id, (j) => {
        if (j.status === "done") {
          setNotes([]);
          setAiReply(j.result?.summary || "");
          loadSpec(pid);
        }
      });
    } catch (e: any) {
      setJob({ id: "", kind: "notes", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };
  const renderUrl = (r: string | { name: string; url: string }) => (typeof r === "string" ? `/api/projects/${pid}/renders/${r}` : r.url);
  const renderName = (r: string | { name: string }) => (typeof r === "string" ? r : r.name);
  const tabs = cloud ? TABS.filter((t) => t !== "Mimic") : TABS;

  const current = projects.find((p) => p.id === pid);
  const activeWord = words.find((w) => tOut >= w.outStart && tOut < w.outEnd)?.index;
  const cuts = useMemo(() => cutTimes(placed), [placed]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="mark">◆</span> BetterCut
        </div>
        <select value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">Choose a reel…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || p.id}
              {p.ready ? "" : p.status === "error" ? " (failed)" : " (processing)"}
            </option>
          ))}
        </select>
        <button onClick={() => setShowNew(true)}>+ New reel</button>
        <button onClick={() => setRecorder("camera")} title="Record yourself in the browser, with a teleprompter">
          Record
        </button>
        {cloud && pid ? (
          <button
            className="ghost"
            title="Delete this reel and its files"
            onClick={async () => {
              if (!window.confirm("Delete this reel and all its files? This can't be undone.")) return;
              await api.remove(pid).catch((e) => alert(e.message));
              setPid("");
              setSpec(null);
              refreshProjects();
            }}
          >
            Delete
          </button>
        ) : null}
        <div className="spacer" />
        {cloud ? (
          <button className="ghost" onClick={() => setSettings("Connect")}>
            {hasModel ? "Settings" : "Connect your AI"}
          </button>
        ) : null}
        {pid && spec ? (
          <>
            <span className={`save ${saving}`}>{saving === "saved" ? "Saved" : saving === "saving" ? "Saving…" : "Editing"}</span>
            <button className="ghost" onClick={async () => setSpec((await api.undo(pid)).spec)}>
              Undo
            </button>
            <label className="toggle">
              <input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} />
              <span>Safe zone</span>
            </label>
            <button className="ghost" onClick={() => startRender("draft")} disabled={job?.status === "running"}>
              Draft
            </button>
            <div className="aspects">
              {["9x16", "4x5", "1x1", "16x9"].map((a) => (
                <label key={a} className="toggle">
                  <input type="checkbox" checked={aspects.includes(a)} onChange={(e) => setAspects((x) => (e.target.checked ? [...x, a] : x.filter((y) => y !== a)))} />
                  <span>{a.replace("x", ":")}</span>
                </label>
              ))}
            </div>
            <button className="primary" onClick={() => startRender("high")} disabled={job?.status === "running" || !aspects.length}>
              Render
            </button>
            <button className="ghost" title="ProRes HQ master for further finishing" onClick={() => startRender("master")} disabled={job?.status === "running" || !aspects.length}>
              ProRes
            </button>
          </>
        ) : null}
      </header>

      {job ? (
        <div className={`jobbar ${job.status}`}>
          <b>{job.kind}</b> {job.queued ? `waiting in line${job.position ? ` (#${job.position})` : ""}` : job.status === "running" ? `${Math.round(job.progress * 100)}%` : job.status}
          <span className="last">{job.log[job.log.length - 1]}</span>
          {job.status === "done" && job.result?.render ? (
            (() => {
              const hit = cloud ? current?.renders.find((r) => renderName(r) === job.result.render) : job.result.render;
              return hit ? (
                <a href={renderUrl(hit)} target="_blank" rel="noreferrer">
                  Open {job.result.render}
                </a>
              ) : null;
            })()
          ) : null}
          {job.status !== "running" ? (
            <button className="x" onClick={() => setJob(null)}>
              ×
            </button>
          ) : null}
        </div>
      ) : null}

      {!spec || !catalog ? (
        <div className="empty">
          {pid && issues.length ? <p>{issues[0]}</p> : null}
          <h1>Raw clips in. Finished reel out.</h1>
          <p>Create a reel from your clips, pick a look, cut by editing text, leave notes on the video for {cloud ? "your AI model" : "Claude"}, render.</p>
          <button className="primary big" onClick={() => setShowNew(true)}>
            + New reel
          </button>
        </div>
      ) : (
        <main>
          <aside className="left">
            <nav>
              {tabs.map((t) => (
                <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </nav>
            <div className="panel">
              <Panel tab={tab} spec={spec} update={update} catalog={catalog} pid={pid} sourceNow={sourceNow} applyLook={applyLook} refreshCatalog={refreshCatalog} />
            </div>
          </aside>

          <section className="center">
            <div className="stage">
              {inputProps ? (
                <div className="stage-frame">
                <Player
                  ref={setPlayer}
                  component={Reel as any}
                  inputProps={inputProps}
                  durationInFrames={Math.max(1, Math.round(duration * fps))}
                  fps={fps}
                  compositionWidth={spec.width || 1080}
                  compositionHeight={spec.height || 1920}
                  style={{ width: "100%", height: "100%", borderRadius: 14, overflow: "hidden" }}
                  controls
                  clickToPlay
                  spaceKeyToPlayOrPause
                  acknowledgeRemotionLicense
                  numberOfSharedAudioTags={0}
                />
                {handle ? <LayerHandle layer={handle.layer} at={handle.at} onMove={handle.move} /> : null}
                </div>
              ) : null}
            </div>
            <Timeline
              spec={spec}
              placed={placed}
              duration={duration}
              t={tOut}
              notes={notes}
              onSeek={seekOut}
              update={update}
              updateAndBake={updateAndBake}
              onAddClips={addClips}
              onAddMedia={addMedia}
              onSelectLayer={setLayerSel}
              onVoiceover={() => {
                voiceAt.current = sourceNow;
                setRecorder("voice");
              }}
              busy={job?.status === "running"}
            />
            {issues.length ? (
              <div className="issues">
                {issues.map((i) => (
                  <div key={i}>⚠ {i}</div>
                ))}
              </div>
            ) : null}
            <div className="exportbar">
              Export:
              {(["srt", "vtt", "fcpxml"] as const).map((k) => (
                <button key={k} className="link" title={k === "fcpxml" ? "Open the cut in Final Cut / DaVinci Resolve" : undefined} onClick={() => api.exportFile(pid, k, current?.title || pid).catch((e) => alert(e.message))}>
                  {k === "fcpxml" ? "FCPXML timeline" : k.toUpperCase()}
                </button>
              ))}
            </div>
            {current?.renders.length ? (
              <div className="renders">
                Renders:{" "}
                {current.renders.map((r) => (
                  <a key={renderName(r)} href={renderUrl(r)} target="_blank" rel="noreferrer">
                    {renderName(r)}
                  </a>
                ))}
              </div>
            ) : null}
          </section>

          <aside className="right">
            <h3>Notes on the video</h3>
            <div className="row">
              <input
                value={noteText}
                placeholder={`Note at ${fmt(tOut)} — e.g. captions bigger here`}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && noteText.trim()) {
                    setNotes((n) => [...n, { t: wholeReel ? (null as any) : tOut, text: noteText.trim() }].sort((a, b) => (a.t ?? -1) - (b.t ?? -1)));
                    setNoteText("");
                  }
                }}
              />
            </div>
            <label className="toggle">
              <input type="checkbox" checked={wholeReel} onChange={(e) => setWholeReel(e.target.checked)} />
              <span>Note is about the whole reel</span>
            </label>
            <ul className="list notes">
              {notes.map((n, i) => (
                <li key={i}>
                  {n.t === null || n.t === undefined ? (
                    <span className="tag-inline">all</span>
                  ) : (
                    <button className="link" onClick={() => seekOut(n.t)}>
                      {fmt(n.t)}
                    </button>
                  )}
                  <span>{n.text}</span>
                  <button className="x" onClick={() => setNotes((ns) => ns.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button className="primary" disabled={(!notes.length && !(cloud && !hasModel)) || job?.status === "running"} onClick={sendNotes}>
              {cloud && !hasModel ? "Connect your AI model to send notes" : `Send ${notes.length || ""} note${notes.length === 1 ? "" : "s"} to ${cloud ? "your AI" : "Claude"}`}
            </button>
            {aiReply ? <div className="aireply">{aiReply}</div> : null}
            {job?.kind === "notes" ? (
              <div className="joblog">
                {job.log.slice(-8).map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            ) : null}

            <h3>
              Transcript <small>edit the reel by editing text</small>
            </h3>
            <div className="modes">
              {(["seek", "cut", "emphasis", "edit"] as const).map((m) => (
                <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                  {m === "seek" ? "Jump" : m === "cut" ? "Cut" : m === "emphasis" ? "Punch word" : "Fix spelling"}
                </button>
              ))}
            </div>
            <small className="hint">Option-click cuts, Shift-click punches, in any mode.</small>
            <div className="transcript">
              {spec.words.map((w, i) => (
                <span
                  key={i}
                  className={`w ${w.cut ? "cut" : ""} ${w.emphasis ? "em" : ""} ${activeWord === i ? "active" : ""}`}
                  title={`${w.start.toFixed(2)}s${(w as any).cutReason ? ` · ${(w as any).cutReason}` : ""}`}
                  onClick={(e) => onWord(i, e)}
                >
                  {w.text}
                  {w.emoji ? <sup>{w.emoji}</sup> : null}{" "}
                </span>
              ))}
            </div>
          </aside>
        </main>
      )}

      {settings ? (
        <Settings
          cfg={cfg}
          tab={settings}
          setTab={setSettings}
          email={currentSession()?.email || ""}
          onClose={() => {
            setSettings(null);
            refreshMe();
          }}
        />
      ) : null}
      {recorder ? (
        <Recorder
          mode={recorder}
          canAdd={!!pid && !!spec && !spec.source.matte}
          onClose={() => setRecorder(null)}
          onVideo={recordedVideo}
          onVoice={recordedVoice}
          onRecording={recorder === "voice" ? voiceRecording : undefined}
        />
      ) : null}
      {showNew && catalog ? (
        <NewReel
          cfg={cfg}
          catalog={catalog}
          onClose={() => setShowNew(false)}
          onCreated={(id, jobId) => {
            setShowNew(false);
            created(id, jobId);
          }}
        />
      ) : null}
    </div>
  );
};

const NewReel: React.FC<{ cfg: CloudConfig; catalog: Catalog; onClose: () => void; onCreated: (pid: string, job: string) => void }> = ({ cfg, catalog, onClose, onCreated }) => {
  const [files, setFiles] = useState<FileList | null>(null);
  const [name, setName] = useState("");
  const [look, setLook] = useState("bold-pop");
  const [names, setNames] = useState("");
  const [cutout, setCutout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>New reel</h2>
        <label className="drop">
          {files?.length ? `${files.length} clip${files.length > 1 ? "s" : ""} selected` : "Drop or choose your raw clips (takes in any order)"}
          <input type="file" multiple accept="video/*" hidden onChange={(e) => setFiles(e.target.files)} />
        </label>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="three-money-rules" />
        </label>
        <label className="field">
          <span>Look</span>
          <select value={look} onChange={(e) => setLook(e.target.value)}>
            {catalog.looks.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Names &amp; keywords to spell right</span>
          <input value={names} onChange={(e) => setNames(e.target.value)} placeholder="Claude, Acme, SIP" />
        </label>
        {cfg.cutout ? (
          <label className="toggle">
            <input type="checkbox" checked={cutout} onChange={(e) => setCutout(e.target.checked)} />
            <span>Cut me out of the background (words behind head, green screen; adds a few minutes)</span>
          </label>
        ) : null}
        {cfg.limits ? (
          <small className="hint">
            Up to {cfg.limits.uploadMb} MB in total, {Math.round(cfg.limits.clipSeconds / 60)} minutes per clip. Spellings saved in Memory are applied automatically.
          </small>
        ) : null}
        {err ? <p className="err">{err}</p> : null}
        <div className="row end">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!files?.length || busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                const f = new FormData();
                Array.from(files!).forEach((x) => f.append("files", x));
                f.append("name", name || files![0].name.replace(/\.\w+$/, ""));
                f.append("look", look);
                f.append("names", names);
                f.append("cutout", String(cutout));
                const r = await api.create(f);
                onCreated(r.project, r.job);
              } catch (e: any) {
                setErr(e.message);
                setBusy(false);
              }
            }}
          >
            {busy ? "Uploading…" : "Make my reel"}
          </button>
        </div>
      </div>
    </div>
  );
};
