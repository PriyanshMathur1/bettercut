import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Reel, reelDuration } from "../../src/reel/Reel";
import type { ReelSpec } from "../../src/reel/types";
import { placeSegments, toOutput, toSource, outputWords, cutTimes, rangeToOutput, totalOutDuration } from "../../src/reel/timeline";
import { api, forPlayer, mediaUrl, watchJob, type Catalog, type CloudConfig, type Job, type ProjectRow } from "./api";
import { Panel, TABS, type Tab } from "./Panels";
import { initAuth, authError, signInWithGoogle, currentSession } from "./auth";
import { Settings } from "./Settings";
import { Timeline } from "./Timeline";
import { Recorder } from "./Recorder";
import { kindOf, layerProblem, newLayer, placeLayer } from "../../src/reel/layers";
import { LayerHandle } from "./LayerHandle";
import { CamRow } from "./CamRow";
import { ZoomRow } from "./ZoomRow";
import { ReviewPanel } from "./ReviewPanel";
import { newNotes } from "./review";
import { createSaver, type SaveState } from "./saver";
import { Guard } from "./Guard";
import { playbackAction, SHORTCUTS, shuttle, stepFrame, typingIn } from "./keys";
import { followPlayer, volumeToRestore } from "./preview";
import { askNotes, BIN, binItems, cutAfter, cutBefore, fmtClock, groupOf, keepTab, railFor, shapeOf, subTabs, toggleShape, withoutSent, type BinItem, type RailIcon } from "./workspace";
import { AskBar, ExportMenu, MediaBin, ProjectCard, Rail, Transport } from "./Shell";

const fmt = fmtClock;

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
  return (
    <Guard name="The editor">
      <Editor cfg={cfg} />
    </Guard>
  );
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
  const [saving, setSaving] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [steps, setSteps] = useState<{ canUndo?: boolean; canRedo?: boolean }>({}); // what Undo and Redo can do now
  const [job, setJob] = useState<Job | null>(null);
  const [frame, setFrame] = useState(0);
  const [safe, setSafe] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [recorder, setRecorder] = useState<null | "camera" | "screen" | "voice">(null);
  const [layerSel, setLayerSel] = useState<number | null>(null); // layer selected on the timeline
  const volumeBefore = useRef(1); // preview volume to restore after a voiceover take
  const voiceAt = useRef(0); // where in the footage the playhead was when a voiceover started
  const [notes, setNotes] = useState<{ t: number | null; text: string }[]>([]); // t: reel seconds, or null for the whole reel
  const [noteText, setNoteText] = useState("");
  const [mode, setMode] = useState<"seek" | "cut" | "emphasis" | "edit">("seek");
  const [aspects, setAspects] = useState<string[]>(["9x16"]);
  const nativeShape = shapeOf(spec?.width, spec?.height); // the shape this project was made in
  useEffect(() => {
    if (spec) setAspects([nativeShape]); // a project renders in its own shape unless you pick others
  }, [pid, nativeShape, !!spec]);
  const [railOpen, setRailOpen] = useState<RailIcon | null>("media"); // the open rail button
  const [bin, setBin] = useState(true); // Media shows the clip bin (true) or its b-roll panel
  const [clips, setClips] = useState<{ name: string; start: number; seconds: number }[]>([]);
  const clipPicker = useRef<HTMLInputElement>(null);
  const layerPicker = useRef<HTMLInputElement>(null);
  const [side, setSide] = useState<"Properties" | "Transcript" | "Notes">("Properties"); // the inspector's tab
  const [inspector, setInspector] = useState<HTMLElement | null>(null); // where the timeline draws the selection's properties
  const [hasSel, setHasSel] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // playback rate: negative plays backwards (J), up to 4x either way
  const [showKeys, setShowKeys] = useState(false); // the shortcut sheet
  const [textTool, setTextTool] = useState(false); // clicking the preview places text
  const [draft, setDraft] = useState<{ x: number; y: number; text: string } | null>(null); // text being typed on the preview
  const [wholeReel, setWholeReel] = useState(false);
  const player = useRef<PlayerRef | null>(null);
  const [playerEl, setPlayerEl] = useState<PlayerRef | null>(null); // the mounted player, for effects that must follow it
  const setPlayer = useCallback((p: PlayerRef | null) => {
    player.current = p;
    setPlayerEl(p);
  }, []);
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
      setClips(r.clips || []);
      setSpec(r.spec);
      setIssues(r.issues);
      setSteps({ canUndo: r.canUndo, canRedo: r.canRedo });
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

  // Autosave for this project. A save that fails is shown, kept and retried: see saver.ts.
  const saver = useMemo(
    () =>
      createSaver<ReelSpec>({
        save: async (next) => {
          const r = await api.save(pid, next);
          setIssues(r.issues);
          setSteps({ canUndo: r.canUndo ?? true, canRedo: r.canRedo });
        },
        onState: (state, error) => {
          setSaving(state);
          // the browser's own wording for "no answer" means nothing to most people
          setSaveError(!error ? "" : /failed to fetch|networkerror|load failed/i.test(error) ? "Can't reach BetterCut. Your edit is kept and will be saved when it is back." : error);
        },
      }),
    [pid],
  );
  useEffect(() => {
    setSaving("saved");
    setSaveError("");
    return () => void saver.flush(); // leaving this project: save what is still pending
  }, [saver]);

  /** Edit the spec locally and autosave after a short pause. */
  const update = useCallback(
    (fn: (s: ReelSpec) => ReelSpec) => {
      setSpec((s) => {
        if (!s) return s;
        const next = fn(s);
        saver.push(next);
        return next;
      });
    },
    [saver],
  );

  /** Save what is pending before something that reads the project on the server. Throws if it can't. */
  const saved = async () => {
    if (!(await saver.flush())) throw new Error("Your last edit couldn't be saved, so this was not started. Check the connection and press Retry.");
  };

  // closing the tab with an edit not yet saved: ask first
  useEffect(() => {
    if (saving === "saved") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving === "saved"]);

  /** Undo or redo one step. Pending edits are saved first, so the step is taken from what you see. */
  const step = async (way: "undo" | "redo") => {
    try {
      await saved();
      const r = await api[way](pid);
      saver.cancel();
      setSpec(r.spec);
      setSteps({ canUndo: r.canUndo, canRedo: r.canRedo });
    } catch (e: any) {
      setJob({ id: "", kind: way, project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return; // typing: the field's own undo
      const k = e.key.toLowerCase();
      if (k === "z") stepRef.current(e.shiftKey ? "redo" : "undo");
      else if (k === "y") stepRef.current("redo");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const placed = useMemo(() => (spec ? placeSegments(spec) : []), [spec?.segments, spec?.words]);
  const fps = spec?.fps || 30;
  const duration = spec ? reelDuration(spec) : 1;
  const tOut = frame / fps;
  const sourceNow = toSource(placed, tOut);
  const words = useMemo(() => (spec ? outputWords(placed, spec.words) : []), [placed, spec?.words]);
  const cutCount = useMemo(() => (spec ? spec.words.filter((w) => w.cut).length : 0), [spec?.words]); // the editor re-renders every frame
  // the safe-zone guide shows where Reels and Shorts put their buttons, so it only fits a vertical frame
  const inputProps = useMemo(() => (spec ? (forPlayer({ ...spec, safeGuide: safe && nativeShape === "9x16" }) as any) : null), [spec, safe, nativeShape]);

  // A voiceover take silences the preview. If the page closed before the take ended, put the volume back.
  useEffect(() => {
    if (!playerEl) return;
    try {
      const v = volumeToRestore(localStorage.getItem(VOLUME_KEY));
      if (v === null) return;
      localStorage.removeItem(VOLUME_KEY);
      playerEl.setVolume(v);
    } catch {}
  }, [playerEl]);

  // Follow the player's frame. The player mounts only once the reel AND the catalog have loaded, in either
  // order, so the listener is tied to the player instance itself, not to the reel having loaded.
  useEffect(() => {
    if (!playerEl) return;
    return followPlayer(playerEl, setFrame);
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
    setSpec(next);
    saver.push(next);
    try {
      await saved();
      const { job: id } = await api.bake(pid);
      run(id, (j) => {
        if (j.status === "done") loadSpec(pid);
      });
    } catch (e: any) {
      setJob({ id: "", kind: "colour", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  const addClips = async (files: File[]) => {
    try {
      await saved();
      const { job: id } = await api.addClips(pid, files);
      run(id, (j) => {
        if (j.status === "done") loadSpec(pid);
      });
    } catch (e: any) {
      setJob({ id: "", kind: "clips", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  /** Other cameras of the same shoot: synced by sound on the server, then cut to whoever is talking. */
  const addAngles = async (files: File[]) => {
    try {
      await saved();
      const { job: id } = await api.addAngles(pid, files);
      run(id, (j) => {
        if (j.status === "done") loadSpec(pid);
      });
    } catch (e: any) {
      setJob({ id: "", kind: "angles", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  const autoZoom = async () => {
    try {
      await saved();
      const { job: id } = await api.autoZoom(pid);
      run(id, (j) => {
        if (j.status === "done") loadSpec(pid);
      });
    } catch (e: any) {
      setJob({ id: "", kind: "autozoom", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  const autoCams = async () => {
    try {
      await saved();
      const { job: id } = await api.autoCams(pid);
      run(id, (j) => {
        if (j.status === "done") loadSpec(pid);
      });
    } catch (e: any) {
      setJob({ id: "", kind: "autocam", project: pid, status: "error", progress: 0, log: [e.message], result: null });
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
      const problem = layerProblem(file.name, file.type);
      if (problem) throw new Error(problem);
      const r = await api.upload(pid, file);
      const kind = kindOf(file.name, file.type);
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
    const screen = recorder === "screen";
    setRecorder(null);
    if (where === "add" && pid) return addClips([file]);
    try {
      const f = new FormData();
      f.append("files", file);
      f.append("name", screen ? "screen" : "recording");
      f.append("shape", screen ? "auto" : "9x16"); // the camera films a vertical frame; a screen keeps its own shape
      if (screen) f.append("zoom", "true");
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

  const startRender = async (quality: string, uhd = false) => {
    try {
      await saved();
      const { job: id } = await api.render(pid, quality, aspects, uhd);
      run(id, () => refreshProjects());
    } catch (e: any) {
      setJob({ id: "", kind: "render", project: pid, status: "error", progress: 0, log: [e.message], result: null });
    }
  };

  const sendNotes = async (list: typeof notes = notes) => {
    if (cloud && !hasModel) return setSettings("Connect");
    setAiReply("");
    try {
      await saved();
      const { job: id } = await api.notes(pid, list);
      run(id, (j) => {
        if (j.status === "done") {
          setNotes((cur) => withoutSent(cur, list)); // keep notes pinned while the AI was working
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
  const tabs: Tab[] = cloud ? TABS.filter((t) => t !== "Mimic") : [...TABS];
  const rail = railFor(tabs);
  const group = rail.find((g) => g.id === railOpen);
  const shownTab = group ? keepTab(tab, group.tabs) : keepTab(tab, tabs);
  const subs = group ? subTabs(group) : [];
  const showBin = group?.id === "media" && bin;
  /** Open a panel from anywhere (the Project card's quick-add buttons). */
  const openTab = (t: Tab) => {
    setTab(t);
    setBin(false);
    setRailOpen(groupOf(t, rail)?.id ?? null);
  };
  const items = useMemo(() => (spec ? binItems(clips, spec as any) : []), [clips, spec?.source, spec?.layers, spec?.voiceovers, spec?.audio?.music]);
  /** Where a bin item starts in the finished video; null if that footage was cut (or it is the music bed). */
  const placeOf = (item: BinItem) => (item.start === null ? null : (rangeToOutput(placed, item.start, item.start + Math.max(0.05, item.seconds))?.start ?? null));
  const exportFile = (k: "srt" | "vtt" | "fcpxml") => api.exportFile(pid, k, projects.find((p) => p.id === pid)?.title || pid).catch((e) => alert(e.message));
  const pinNote = () => {
    if (!noteText.trim()) return;
    setNotes((n) => [...n, { t: tOut, text: noteText.trim() }].sort((a, b) => (a.t ?? -1) - (b.t ?? -1)));
    setNoteText("");
  };
  /** Ask from the bar: what is typed (about the whole reel) plus any pinned notes. */
  const ask = () => {
    const all = askNotes(notes, noteText);
    setNoteText("");
    setNotes(all);
    sendNotes(all);
  };

  const current = projects.find((p) => p.id === pid);
  const activeWord = words.find((w) => tOut >= w.outStart && tOut < w.outEnd)?.index;
  const cuts = useMemo(() => cutTimes(placed), [placed]);
  // a selection on the timeline brings its properties forward
  useEffect(() => {
    if (hasSel) setSide("Properties");
  }, [hasSel]);
  useEffect(() => {
    if (!playerEl) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    setPlaying(playerEl.isPlaying());
    playerEl.addEventListener("play", on);
    playerEl.addEventListener("pause", off);
    playerEl.addEventListener("ended", off);
    return () => {
      playerEl.removeEventListener("play", on);
      playerEl.removeEventListener("pause", off);
      playerEl.removeEventListener("ended", off);
    };
  }, [playerEl]);
  // a voiceover needs the playhead on footage, and must not start while a job is changing the reel
  const busy = job?.status === "running";
  const canVoice = tOut < totalOutDuration(placed) - 0.01;
  /** Put the typed text on the video where it was clicked, starting at the playhead. */
  const placeText = () => {
    const d = draft;
    setDraft(null);
    setTextTool(false);
    if (!d || !d.text.trim() || !spec) return;
    const start = +sourceNow.toFixed(2);
    const end = +Math.min(spec.source.duration || start + 3, start + 3).toFixed(2);
    if (end - start < 0.2) return;
    update((s) => ({ ...s, overlays: [...s.overlays, { kind: "text", text: d.text.trim(), x: +d.x.toFixed(3), y: +d.y.toFixed(3), start, end }] }));
  };

  // Keyboard: J K L, Space, arrows, Home/End, T for the text tool, ? for the list. Ignored while typing.
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keysRef.current = (e) => {
    const el = e.target as HTMLElement | null;
    if (typingIn(el) || !spec) return;
    const p = player.current;
    if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "t" || e.key === "T")) {
      setTextTool((on) => !on);
      setDraft(null);
      return e.preventDefault();
    }
    if (e.key === "Escape" && (textTool || showKeys)) {
      setTextTool(false);
      setDraft(null);
      setShowKeys(false);
      return;
    }
    const a = playbackAction(e);
    if (!a) return;
    // Space on a focused button presses that button; don't also toggle playback
    if (a.do === "toggle" && el && /^(BUTTON|A|SUMMARY)$/.test(el.tagName)) return;
    e.preventDefault();
    if (a.do === "help") return setShowKeys((on) => !on);
    if (!p) return;
    const total = Math.max(1, Math.round(duration * fps));
    if (a.do === "toggle") {
      setSpeed(1);
      p.toggle();
    } else if (a.do === "shuttle") {
      const rate = shuttle(p.isPlaying() ? speed : 0, a.key);
      if (rate === 0) {
        p.pause();
        setSpeed(1);
      } else {
        setSpeed(rate);
        p.play();
      }
    } else if (a.do === "step") {
      p.pause();
      p.seekTo(stepFrame(p.getCurrentFrame(), a.by, total)); // the player's own frame: a held key repeats faster than the screen redraws
    } else if (a.do === "cut") seekOut(a.way === "prev" ? cutBefore(cuts, tOut) : cutAfter(cuts, tOut, duration));
    else if (a.do === "edge") p.seekTo(a.way === "start" ? 0 : total - 1);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const voiceover = () => {
    if (busy || !canVoice) return;
    voiceAt.current = sourceNow;
    setRecorder("voice");
  };

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="mark">◆</span> BetterCut
        </div>
        <select value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">Choose a video…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || p.id}
              {p.ready ? "" : p.status === "error" ? " (failed)" : " (processing)"}
            </option>
          ))}
        </select>
        <button onClick={() => setShowNew(true)}>+ New video</button>
        <button onClick={() => setRecorder("camera")} title="Record yourself in the browser, with a teleprompter">
          Record
        </button>
        <button onClick={() => setRecorder("screen")} title="Record your screen; the reel zooms in where things happen">
          Record screen
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
            {saving === "failed" ? (
              <span className="save failed" role="alert" title={saveError}>
                Not saved
                <button className="link" onClick={() => saver.retry()}>
                  Retry
                </button>
              </span>
            ) : (
              <span className={`save ${saving}`} aria-live="polite">
                {saving === "saved" ? "Saved" : saving === "saving" ? "Saving…" : "Editing"}
              </span>
            )}
            <button className="ghost" onClick={() => step("undo")} disabled={steps.canUndo === false} title="Undo the last change (⌘Z)">
              Undo
            </button>
            <button className="ghost" onClick={() => step("redo")} disabled={!steps.canRedo} title="Redo what you undid (⇧⌘Z)">
              Redo
            </button>
            {nativeShape === "9x16" ? (
              <label className="toggle" title="Show where Reels and Shorts put their buttons and captions">
                <input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} />
                <span>Safe zone</span>
              </label>
            ) : null}
            <ExportMenu busy={job?.status === "running"} shapes={aspects.length} onRender={startRender} onFile={exportFile} uhd={!cloud} />
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
          <h1>Raw clips in. Finished video out.</h1>
          <p>Create a video from your clips in any shape, pick a look, cut by editing text, leave notes on the video for {cloud ? "your AI model" : "Claude"}, render.</p>
          <button className="primary big" onClick={() => setShowNew(true)}>
            + New video
          </button>
        </div>
      ) : (
        <main className={`simple ${group ? "" : "shut"}`}>
          <Rail
            rail={rail}
            open={group ? railOpen : null}
            tabs={subs}
            tab={showBin ? BIN : shownTab}
            onOpen={(g) => setRailOpen(g.id)}
            onTab={(t) => {
              setBin(t === BIN);
              if (t !== BIN) setTab(t as Tab);
            }}
            onClose={() => setRailOpen(null)}
          >
            <Guard name="This panel" key={showBin ? "bin" : shownTab}>
            {showBin ? (
              <MediaBin
                items={items}
                url={mediaUrl}
                placeOf={placeOf}
                onGo={seekOut}
                onAddClips={() => clipPicker.current?.click()}
                onAddMedia={() => layerPicker.current?.click()}
                onRecord={() => setRecorder("camera")}
                busy={job?.status === "running"}
              />
            ) : (
              <Panel tab={shownTab} spec={spec} update={update} catalog={catalog} pid={pid} sourceNow={sourceNow} applyLook={applyLook} refreshCatalog={refreshCatalog} />
            )}
            </Guard>
          </Rail>
          <input
            ref={clipPicker}
            type="file"
            accept="video/*"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              if (files.length && !busy) addClips(files); // never while another job is changing the reel
            }}
          />
          <input
            ref={layerPicker}
            type="file"
            accept="video/*,image/*,audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) addMedia(f);
            }}
          />

          <section className="center">
            <div className="stage">
              <Guard name="The preview" key={`pv-${pid}`}>
              {inputProps ? (
                <div className="stage-frame" style={{ "--ar": (spec.width || 1080) / (spec.height || 1920) } as React.CSSProperties}>
                  <Player
                    ref={setPlayer}
                    component={Reel as any}
                    inputProps={inputProps}
                    durationInFrames={Math.max(1, Math.round(duration * fps))}
                    fps={fps}
                    compositionWidth={spec.width || 1080}
                    compositionHeight={spec.height || 1920}
                    style={{ width: "100%", height: "100%", borderRadius: 10, overflow: "hidden" }}
                    playbackRate={speed}
                    controls
                    clickToPlay={!textTool}
                    spaceKeyToPlayOrPause={false}
                    acknowledgeRemotionLicense
                    numberOfSharedAudioTags={0}
                  />
                  {handle ? <LayerHandle layer={handle.layer} at={handle.at} onMove={handle.move} /> : null}
                  {textTool ? (
                    <div
                      className="text-tool"
                      title="Click where the text should go"
                      onPointerDown={(e) => {
                        if (e.target !== e.currentTarget) return; // a click in the box being typed in
                        const r = e.currentTarget.getBoundingClientRect();
                        if (draft?.text.trim()) return placeText(); // clicking away places what was typed
                        e.preventDefault();
                        setDraft({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, text: "" });
                      }}
                    >
                      {draft ? (
                        <div className="text-draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}>
                          <textarea
                            autoFocus
                            rows={1}
                            value={draft.text}
                            placeholder="Type something"
                            aria-label="Text to put on the video"
                            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                placeText();
                              } else if (e.key === "Escape") {
                                setDraft(null);
                                setTextTool(false);
                              }
                            }}
                          />
                          <small>
                            <kbd>↵</kbd> add · <kbd>⇧↵</kbd> new line · <kbd>Esc</kbd> cancel
                          </small>
                        </div>
                      ) : (
                        <span className="text-hint">Click where the text should go</span>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
              </Guard>
            </div>
            <Transport
              speed={playing ? speed : 0}
              textTool={textTool}
              onText={() => {
                setTextTool((on) => !on);
                setDraft(null);
              }}
              onKeys={() => setShowKeys(true)}
              t={tOut}
              duration={duration}
              fps={fps}
              playing={playing}
              onToggle={() => {
                setSpeed(1);
                player.current?.toggle();
              }}
              onStep={(n) => {
                player.current?.pause();
                const p = player.current;
                if (p) p.seekTo(stepFrame(p.getCurrentFrame(), n, Math.max(1, Math.round(duration * fps))));
              }}
              onPrevCut={() => seekOut(cutBefore(cuts, tOut))}
              onNextCut={() => seekOut(cutAfter(cuts, tOut, duration))}
              onUndo={() => step("undo")}
              onRedo={() => step("redo")}
              canUndo={steps.canUndo !== false}
              canRedo={!!steps.canRedo}
            />
            <AskBar
              value={noteText}
              onChange={setNoteText}
              at={fmt(tOut)}
              queued={notes}
              onPin={pinNote}
              onUnpin={(i) => setNotes((ns) => ns.filter((_, j) => j !== i))}
              onSeek={seekOut}
              onAsk={ask}
              busy={job?.status === "running"}
              needsModel={cloud && !hasModel}
              who={cloud ? "your AI" : "Claude"}
            />
            <Guard name="The timeline" key={`tl-${pid}`}>
            <Timeline
              key={pid} // a different video starts with nothing selected
              spec={spec}
              placed={placed}
              duration={duration}
              t={tOut}
              notes={notes.filter((n): n is { t: number; text: string } => n.t !== null)} // whole-reel notes have no place on the timeline
              onSeek={seekOut}
              update={update}
              updateAndBake={updateAndBake}
              onAddClips={addClips}
              onAddMedia={addMedia}
              onSelectLayer={setLayerSel}
              onVoiceover={voiceover}
              busy={job?.status === "running"}
              inspector={inspector}
              onSelection={setHasSel}
              clips={clips}
            />
            <CamRow
              spec={spec}
              placed={placed}
              tOut={tOut}
              sourceNow={sourceNow}
              duration={duration}
              busy={job?.status === "running"}
              update={update}
              onAddAngles={addAngles}
              onAuto={autoCams}
            />
            <ZoomRow spec={spec} placed={placed} tOut={tOut} sourceNow={sourceNow} duration={duration} busy={job?.status === "running"} update={update} onAuto={autoZoom} />
            </Guard>
            {issues.length ? (
              <div className="issues">
                {issues.map((i) => (
                  <div key={i}>⚠ {i}</div>
                ))}
              </div>
            ) : null}
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
            <div className="s-tabs" role="tablist" aria-label="Inspector">
              {(["Properties", "Transcript", "Notes"] as const).map((x) => (
                <button key={x} role="tab" aria-selected={side === x} className={side === x ? "on" : ""} onClick={() => setSide(x)}>
                  {x}
                  {x === "Notes" && notes.length ? ` (${notes.length})` : ""}
                </button>
              ))}
            </div>
            {/* the timeline draws the selected item's properties in here; it stays mounted so they keep their place */}
            <div ref={setInspector} hidden={side !== "Properties"} />
            {side === "Properties" && !hasSel ? (
              <ProjectCard
                shapes={aspects}
                native={nativeShape}
                onShape={(id) => setAspects((x) => toggleShape(x, id))}
                length={fmt(duration)}
                shots={spec.segments.length}
                cut={cutCount}
                busy={busy}
                canVoice={canVoice}
                onAdd={(what) => {
                  if (what === "text") openTab("Titles");
                  else if (what === "music") openTab("Audio");
                  else if (what === "captions") openTab("Captions");
                  else if (what === "broll") openTab("B-roll");
                  else if (what === "voice") voiceover();
                  else clipPicker.current?.click();
                }}
              />
            ) : null}
            {side === "Notes" ? (
              <>
                <h3>Notes on the video</h3>
                <p className="hint">Type in the Ask bar under the preview. Pin a note to a moment, or press Ask to send everything to {cloud ? "your AI" : "Claude"}.</p>
                <ul className="list notes">
                  {notes.map((n, i) => {
                    const at = n.t; // a note about the whole reel has no time
                    return (
                    <li key={i}>
                      {at === null ? (
                        <span className="tag-inline">all</span>
                      ) : (
                        <button className="link" onClick={() => seekOut(at)}>
                          {fmt(at)}
                        </button>
                      )}
                      <span>{n.text}</span>
                      <button className="x" aria-label="Remove note" onClick={() => setNotes((ns) => ns.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    </li>
                    );
                  })}
                </ul>
                {aiReply ? <div className="aireply">{aiReply}</div> : null}
                {job?.kind === "notes" ? (
                  <div className="joblog">
                    {job.log.slice(-8).map((l, i) => (
                      <div key={i}>{l}</div>
                    ))}
                  </div>
                ) : null}
                {!cloud ? (
                  <ReviewPanel
                    pid={pid}
                    seek={seekOut}
                    renderKey={current?.renders.length}
                    onNotes={(add) => setNotes((ns) => [...ns, ...newNotes(ns, add)].sort((a, b) => (a.t ?? -1) - (b.t ?? -1)))}
                  />
                ) : null}
              </>
            ) : null}
            {side === "Transcript" ? (
              <>
                <h3>
                  Transcript <small>edit the video by editing text</small>
                </h3>
                {spec.words.length ? (
                  <>
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
                  </>
                ) : (
                  <p className="hint">No speech was found in this footage, so there is nothing to edit by text. Cut it on the timeline instead.</p>
                )}
              </>
            ) : null}
          </aside>
        </main>
      )}

      {showKeys ? (
        <div className="modal" onClick={() => setShowKeys(false)}>
          <div className="sheet wide keys" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
            <h2>Keyboard shortcuts</h2>
            <div className="keys-grid">
              {SHORTCUTS.map((g) => (
                <section key={g.group}>
                  <h3>{g.group}</h3>
                  <dl>
                    {g.items.map((i) => (
                      <div key={i.keys}>
                        <dt>
                          {i.keys.split(" / ").map((k, n) => (
                            <React.Fragment key={k}>
                              {n ? <span> / </span> : null}
                              <kbd>{k}</kbd>
                            </React.Fragment>
                          ))}
                        </dt>
                        <dd>{i.does}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
            <div className="row end">
              <button className="primary" onClick={() => setShowKeys(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  const [shape, setShape] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>New video</h2>
        <label className="drop">
          {files?.length ? `${files.length} clip${files.length > 1 ? "s" : ""} selected` : "Drop or choose your raw clips (takes in any order)"}
          <input type="file" multiple accept="video/*" hidden onChange={(e) => setFiles(e.target.files)} />
        </label>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="three-money-rules" />
        </label>
        <label className="field">
          <span>Shape</span>
          <select value={shape} onChange={(e) => setShape(e.target.value)}>
            <option value="auto">Match my clips (landscape stays landscape)</option>
            <option value="9x16">Vertical 9:16 · Reels, Shorts, TikTok</option>
            <option value="16x9">Landscape 16:9 · YouTube</option>
            <option value="1x1">Square 1:1 · Feed</option>
            <option value="4x5">Portrait 4:5 · Feed</option>
          </select>
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
                f.append("shape", shape);
                const r = await api.create(f);
                onCreated(r.project, r.job);
              } catch (e: any) {
                setErr(e.message);
                setBusy(false);
              }
            }}
          >
            {busy ? "Uploading…" : "Make my video"}
          </button>
        </div>
      </div>
    </div>
  );
};
