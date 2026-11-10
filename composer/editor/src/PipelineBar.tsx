import React, { useEffect, useState } from "react";
import { api } from "./api";
import { headline, progress, waiting, type PipelineView } from "./stages";

/**
 * Pipeline mode: where the reel is between brief and finished video. Claude works one stage at a time; when a
 * stage needs you, approve it here (or in the chat), or send it back with a note.
 */
export const PipelineBar: React.FC<{ pid: string; refreshKey: unknown }> = ({ pid, refreshKey }) => {
  const [p, setP] = useState<PipelineView | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [full, setFull] = useState(false); // the whole of Claude's summary, not just its first lines

  useEffect(() => {
    let live = true;
    api.pipeline(pid).then((r) => live && setP(r.pipeline)).catch(() => {});
    return () => {
      live = false;
    };
  }, [pid, refreshKey]);

  if (!p) return null;
  const wait = waiting(p);
  const act = async (action: "approve" | "send-back") => {
    setBusy(true);
    setError("");
    try {
      setP((await api.pipelineAction(pid, action, note.trim())).pipeline);
      setNote("");
    } catch (e: any) {
      setError(e?.message || "Couldn't do that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`pipe ${wait ? "waiting" : ""}`} aria-label="Pipeline">
      <div className="pipe-head">
        <b>{headline(p)}</b>
        <div className="pipe-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress(p) * 100)}>
          <i style={{ width: `${progress(p) * 100}%` }} />
        </div>
      </div>
      <ol className="pipe-stages">
        {p.stages.map((s, i) => (
          <li key={s.id} className={s.status} title={s.summary || s.name}>
            <span>{s.status === "done" ? "✓" : i + 1}</span>
            {s.name}
          </li>
        ))}
      </ol>
      {wait ? (
        <div className="pipe-review">
          <p className={full ? "all" : ""}>{wait.summary || "Claude finished this stage."}</p>
          {(wait.summary || "").length > 220 || (wait.summary || "").split("\n").length > 3 ? (
            <button className="link" onClick={() => setFull((f) => !f)}>
              {full ? "Show less" : "Read all"}
            </button>
          ) : null}
          <div className="row">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change? (for Send back)" aria-label="Note for Claude" />
            <button onClick={() => act("send-back")} disabled={busy || !note.trim()}>
              Send back
            </button>
            <button className="primary" onClick={() => act("approve")} disabled={busy}>
              Approve
            </button>
          </div>
          <p className="hint">Claude picks it up on its next step. If it's waiting in your chat, tell it you approved.</p>
        </div>
      ) : null}
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
};
