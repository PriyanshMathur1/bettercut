import React, { useEffect, useRef, useState } from "react";
import { pickFormat, readProgress, readSeconds, wordCount } from "./prompter";

type Phase = "starting" | "ready" | "countdown" | "recording" | "review" | "error";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Record in the browser.
 * - camera: yourself, with a teleprompter that scrolls your script. The take becomes a new reel or is added to this one.
 * - voice: narration from the microphone while the reel plays. The take is laid over the reel at the playhead.
 * Nothing is uploaded until you choose what to do with the take.
 */
export const Recorder: React.FC<{
  mode: "camera" | "voice";
  canAdd: boolean;
  onClose: () => void;
  onVideo: (file: File, where: "new" | "add") => void;
  onVoice: (file: File, seconds: number) => void;
  /** Voice mode: the reel starts and stops playing with the recording. */
  onRecording?: (on: boolean) => void;
}> = ({ mode, canAdd, onClose, onVideo, onVoice, onRecording }) => {
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState("");
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [script, setScript] = useState(() => {
    try {
      return localStorage.getItem("bc.script") || "";
    } catch {
      return "";
    }
  });
  const [wpm, setWpm] = useState(140);
  const [mirror, setMirror] = useState(true);
  const [take, setTake] = useState<{ file: File; url: string; seconds: number } | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const live = useRef<HTMLVideoElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const started = useRef(0);
  const timers = useRef<number[]>([]);

  const stopStream = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearInterval(t));
    timers.current = [];
  };

  const open = async () => {
    setPhase("starting");
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't record. Try a current version of Chrome, Edge, Safari or Firefox.");
      const s = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === "camera" ? { width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 }, facingMode: "user" } : false,
      });
      stream.current = s;
      if (live.current) {
        live.current.srcObject = s;
        live.current.play().catch(() => {});
      }
      setPhase("ready");
    } catch (e: any) {
      const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
      const missing = e?.name === "NotFoundError" || e?.name === "OverconstrainedError";
      setError(
        denied
          ? `Allow ${mode === "camera" ? "camera and microphone" : "microphone"} access for this page in your browser, then try again.`
          : missing
            ? `No ${mode === "camera" ? "camera or microphone" : "microphone"} was found on this device.`
            : e?.message || "Couldn't start recording.",
      );
      setPhase("error");
    }
  };

  useEffect(() => {
    open();
    return () => {
      clearTimers();
      try {
        if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      } catch {}
      stopStream();
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("bc.script", script);
    } catch {}
  }, [script]);

  const begin = () => {
    if (!stream.current) return;
    const fmt = pickFormat(mode, (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream.current, fmt.mime ? { mimeType: fmt.mime } : undefined);
    } catch (e: any) {
      setError(e?.message || "This browser can't record in a format BetterCut can use.");
      setPhase("error");
      return;
    }
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const seconds = (performance.now() - started.current) / 1000;
      const type = rec.mimeType || fmt.mime || (mode === "camera" ? "video/webm" : "audio/webm");
      const blob = new Blob(chunks, { type });
      const name = `${mode === "camera" ? "recording" : "voiceover"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${fmt.ext}`;
      setTake({ file: new File([blob], name, { type }), url: URL.createObjectURL(blob), seconds });
      setPhase("review");
      onRecording?.(false);
    };
    recorder.current = rec;
    started.current = performance.now();
    rec.start(1000);
    setElapsed(0);
    setPhase("recording");
    onRecording?.(true);
    timers.current.push(window.setInterval(() => setElapsed((performance.now() - started.current) / 1000), 100));
  };

  const start = () => {
    setCount(3);
    setPhase("countdown");
    let n = 3;
    const t = window.setInterval(() => {
      n -= 1;
      setCount(n);
      if (n <= 0) {
        window.clearInterval(t);
        begin();
      }
    }, 1000);
    timers.current.push(t);
  };

  const stop = () => {
    clearTimers();
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };

  const again = () => {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setPhase(stream.current ? "ready" : "starting");
    if (!stream.current) open();
    else if (live.current) {
      live.current.srcObject = stream.current;
      live.current.play().catch(() => {});
    }
  };

  const finish = (fn: () => void) => {
    stopStream();
    fn();
  };

  // teleprompter: the script slides up so the line being read stays near the top third
  const progress = phase === "recording" ? readProgress(script, wpm, elapsed) : 0;
  const offset = text.current ? progress * text.current.scrollHeight : 0;
  const hasScript = wordCount(script) > 0;
  const camera = mode === "camera";

  return (
    <div className="modal">
      <div className={`sheet rec ${camera ? "wide" : ""}`}>
        <div className="row">
          <h2>{camera ? "Record yourself" : "Record a voiceover"}</h2>
          <div className="spacer" />
          <button className="x" onClick={() => finish(onClose)} aria-label="Close" disabled={phase === "recording" || phase === "countdown"}>
            ×
          </button>
        </div>

        {phase === "error" ? (
          <>
            <p className="err">{error}</p>
            <div className="row end">
              <button onClick={open}>Try again</button>
            </div>
          </>
        ) : phase === "review" && take ? (
          <>
            {camera ? <video className="rec-view" src={take.url} controls playsInline /> : <audio src={take.url} controls style={{ width: "100%" }} />}
            <p className="hint">
              {clock(take.seconds)} recorded. {camera ? "It is cut and captioned like any other clip." : "It is placed on the reel where the playhead was when you started."}
            </p>
            <div className="row end">
              <button onClick={again}>Record again</button>
              {camera ? (
                <>
                  {canAdd ? <button onClick={() => finish(() => onVideo(take.file, "add"))}>Add to this reel</button> : null}
                  <button className="primary" onClick={() => finish(() => onVideo(take.file, "new"))}>
                    Make a new reel
                  </button>
                </>
              ) : (
                <button className="primary" onClick={() => finish(() => onVoice(take.file, take.seconds))}>
                  Add to the reel
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {camera ? (
              <div className="rec-stage">
                <video ref={live} className="rec-view" muted playsInline style={{ transform: mirror ? "scaleX(-1)" : undefined }} />
                {hasScript ? (
                  <div className="prompter">
                    <div ref={text} style={{ transform: `translateY(${-offset}px)` }}>
                      {script}
                    </div>
                  </div>
                ) : null}
                {phase === "countdown" ? <div className="rec-count">{count}</div> : null}
                {phase === "recording" ? <div className="rec-dot">{clock(elapsed)}</div> : null}
              </div>
            ) : (
              <div className="rec-voice">
                {phase === "countdown" ? <div className="rec-count small">{count}</div> : phase === "recording" ? <div className="rec-dot static">{clock(elapsed)}</div> : <span className="hint">The reel plays while you record, from where the playhead is now.</span>}
              </div>
            )}
            {camera && phase !== "recording" && phase !== "countdown" ? (
              <>
                <label className="field">
                  <span>
                    Script for the teleprompter{hasScript ? ` · ${wordCount(script)} words, about ${clock(readSeconds(script, wpm))}` : " (optional)"}
                  </span>
                  <textarea id="rec-script" rows={4} value={script} placeholder="Paste or type what you want to say. It scrolls over the camera while you record." onChange={(e) => setScript(e.target.value)} />
                </label>
                <div className="row">
                  <label className="field inline">
                    <span>Speed: {wpm} words a minute</span>
                    <input type="range" min={80} max={220} step={5} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} />
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
                    Mirror preview
                  </label>
                </div>
              </>
            ) : null}
            <div className="row end">
              {phase === "recording" ? (
                <button className="primary" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button className="primary" onClick={start} disabled={phase !== "ready"}>
                  {phase === "starting" ? "Starting…" : phase === "countdown" ? "Get ready…" : "Start recording"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
