// Small pieces of preview-player behaviour, kept free of React so they run under `node --test`.

/** The parts of the player these helpers need. */
export interface FramePlayer {
  getCurrentFrame: () => number;
  addEventListener: (name: "frameupdate", fn: (e: { detail: { frame: number } }) => void) => void;
  removeEventListener: (name: "frameupdate", fn: (e: { detail: { frame: number } }) => void) => void;
}

/**
 * Keep `onFrame` in step with a player: report the frame it is on now, then every frame it moves to.
 * Returns the function that stops following. Call this with the player instance itself, each time one
 * mounts: the editor's playhead, clock, split and keyframes all read the frame this reports.
 */
export function followPlayer(player: FramePlayer, onFrame: (frame: number) => void): () => void {
  onFrame(player.getCurrentFrame());
  const on = (e: { detail: { frame: number } }) => onFrame(e.detail.frame);
  player.addEventListener("frameupdate", on);
  return () => player.removeEventListener("frameupdate", on);
}

/**
 * A voiceover take turns the preview's volume to zero and remembers the level to go back to. If the page
 * closed before the take ended, that remembered level is still stored. Given the stored text, this is the
 * volume to restore (0..1), or null when nothing was stored. A stored level that is unusable or silent
 * restores to full volume: the point is never to leave the preview silent.
 */
export function volumeToRestore(saved: string | null): number | null {
  if (saved === null) return null;
  const v = Number(saved);
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 1;
}
