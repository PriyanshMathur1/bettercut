import React, { useEffect, useState } from "react";
import { api, type ReviewInfo } from "./api";
import { asNotes, onlyHere, spotName } from "./review";
import { fmtClock } from "./workspace";

/**
 * Share the reel for review and read what people said. Comments are pinned to a moment of the latest render
 * and, optionally, a spot on the picture. They can be resolved, removed, or handed to the AI as notes.
 */
export const ReviewPanel: React.FC<{
  pid: string;
  /** Jump the preview to reel second t. */
  seek: (t: number) => void;
  /** Pin notes for the AI (reel seconds). */
  onNotes: (notes: { t: number; text: string }[]) => void;
  /** Bumped after a render finishes, so the panel can say which version people now see. */
  renderKey?: unknown;
}> = ({ pid, seek, onNotes, renderKey }) => {
  const [info, setInfo] = useState<ReviewInfo | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const act = async (p: Promise<ReviewInfo>) => {
    setError("");
    try {
      setInfo(await p);
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    }
  };

  useEffect(() => {
    setInfo(null);
    act(api.review(pid));
    // new comments arrive while the tab is open
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") api.review(pid).then(setInfo).catch(() => {});
    }, 15000);
    return () => window.clearInterval(t);
  }, [pid, renderKey]);

  const link = info?.token ? `${location.origin}/review/${info.token}` : "";
  const open = (info?.comments || []).filter((c) => !c.done);
  const shown = (info?.comments || []).filter((c) => showDone || !c.done);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy: select the link and copy it.");
    }
  };

  return (
    <div className="review">
      <h3>Review</h3>
      {!info ? (
        <p className="hint">Loading…</p>
      ) : info.token ? (
        <>
          <p className="hint">
            Anyone with this link can watch {info.render ? <b>{info.render}</b> : "the latest render"} and leave comments on a moment or a spot. Render again and they see the new version.
          </p>
          <div className="row">
            <input className="review-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Review link" />
            <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
          {onlyHere(location.origin) ? (
            <p className="hint warn">This address only opens on this computer. Don't put this editor on the internet to share it: it has no sign-in, so anyone with the address could change your reels. Sharing with others needs hosted BetterCut.</p>
          ) : null}
          {!info.render ? <p className="hint warn">Nothing is rendered yet: render the reel so reviewers have something to watch.</p> : null}
          <div className="row">
            <button className="ghost" onClick={() => act(api.stopReview(pid))} title="The link stops working; comments are kept">
              Stop sharing
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">Get a link to the latest render. People watch it in their browser and comment on a moment or a spot of the picture, with no account.</p>
          <button className="primary" onClick={() => act(api.shareReview(pid))}>
            Share for review
          </button>
        </>
      )}
      {error ? <p className="err">{error}</p> : null}

      {info?.comments.length ? (
        <>
          <div className="row">
            <strong>
              {open.length} open {open.length === 1 ? "comment" : "comments"}
            </strong>
            <div className="spacer" />
            {info.comments.length > open.length ? (
              <label className="check">
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
                Show resolved
              </label>
            ) : null}
            {open.length ? (
              <button onClick={() => onNotes(asNotes(info.comments))} title="Pin the open comments as notes, then press Ask to have the AI make the changes">
                Pin for AI
              </button>
            ) : null}
          </div>
          <ul className="list review-list">
            {shown.map((c) => (
              <li key={c.id} className={c.done ? "done" : ""}>
                <button className="link" onClick={() => seek(c.at)} title="Jump to this moment">
                  {fmtClock(c.at)}
                </button>
                <div className="grow">
                  <div className="meta">
                    <b>{c.name}</b> · {spotName(c)}
                    {info.render && c.version && c.version !== info.render ? " · on an earlier version" : ""}
                  </div>
                  <div className="text">{c.text}</div>
                </div>
                <button onClick={() => act(api.markComment(pid, c.id, !c.done))} title={c.done ? "Open it again" : "Mark as done"}>
                  {c.done ? "Reopen" : "Resolve"}
                </button>
                <button className="x" aria-label="Delete comment" onClick={() => act(api.deleteComment(pid, c.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : info?.token ? (
        <p className="hint">No comments yet.</p>
      ) : null}
    </div>
  );
};
