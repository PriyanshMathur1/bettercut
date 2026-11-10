// Keyboard shortcuts: the rules behind them and the list shown in the shortcut sheet.
// Kept free of React so it runs under `node --test`.

/** Fastest playback either way. */
export const MAX_RATE = 4;

/**
 * J, K and L the way editors expect. L plays forward and each further press doubles the speed; J does the
 * same backwards; K stops. `rate` is the playback rate now: 0 when paused, negative when playing backwards.
 * Returns the new rate.
 */
export function shuttle(rate: number, key: "j" | "k" | "l"): number {
  if (key === "k") return 0;
  if (key === "l") return rate > 0 ? Math.min(MAX_RATE, rate * 2) : 1;
  return rate < 0 ? Math.max(-MAX_RATE, rate * 2) : -1;
}

/** The frame to land on after stepping `by` frames, kept inside the video. */
export function stepFrame(frame: number, by: number, total: number): number {
  return Math.min(Math.max(0, total - 1), Math.max(0, frame + by));
}

export type Action =
  | { do: "shuttle"; key: "j" | "k" | "l" }
  | { do: "toggle" }
  | { do: "step"; by: number }
  | { do: "cut"; way: "prev" | "next" }
  | { do: "edge"; way: "start" | "end" }
  | { do: "help" };

/** What a key press means for playback, or null if it isn't one of ours. Modifier combos are left alone. */
export function playbackAction(e: { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): Action | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === "j" || k === "k" || k === "l") return { do: "shuttle", key: k };
  if (k === " ") return { do: "toggle" };
  if (k === "ArrowLeft") return { do: "step", by: e.shiftKey ? -10 : -1 };
  if (k === "ArrowRight") return { do: "step", by: e.shiftKey ? 10 : 1 };
  if (k === "ArrowUp") return { do: "cut", way: "prev" };
  if (k === "ArrowDown") return { do: "cut", way: "next" };
  if (k === "Home") return { do: "edge", way: "start" };
  if (k === "End") return { do: "edge", way: "end" };
  if (k === "?") return { do: "help" };
  return null;
}

/** True when the key press belongs to a field the user is typing in. */
export function typingIn(target: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  return !!target && (!!target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ""));
}

/** Every shortcut, for the sheet. `keys` are shown as key caps; a "/" separates alternatives. */
export const SHORTCUTS: { group: string; items: { keys: string; does: string }[] }[] = [
  {
    group: "Playback",
    items: [
      { keys: "Space", does: "Play or pause" },
      { keys: "L", does: "Play forward; press again to go faster" },
      { keys: "J", does: "Play backwards; press again to go faster" },
      { keys: "K", does: "Stop" },
      { keys: "← / →", does: "Back or forward one frame" },
      { keys: "⇧← / ⇧→", does: "Back or forward ten frames" },
      { keys: "↑ / ↓", does: "Previous or next cut" },
      { keys: "Home / End", does: "Start or end of the video" },
    ],
  },
  {
    group: "Editing",
    items: [
      { keys: "S", does: "Split the shot at the playhead" },
      { keys: "V", does: "Select tool" },
      { keys: "C", does: "Razor tool: click a shot to cut it there" },
      { keys: "T", does: "Text tool: click the preview and type" },
      { keys: "Delete", does: "Remove the selected shot, layer or overlay" },
      { keys: "Esc", does: "Clear the selection" },
      { keys: "⌘Z", does: "Undo" },
      { keys: "⇧⌘Z", does: "Redo" },
    ],
  },
  {
    group: "Transcript",
    items: [
      { keys: "⌥ click", does: "Cut a word" },
      { keys: "⇧ click", does: "Punch a word" },
    ],
  },
  { group: "Help", items: [{ keys: "?", does: "Show this list" }] },
];
