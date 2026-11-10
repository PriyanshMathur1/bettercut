// Autosave that never loses an edit quietly. Kept free of React so it runs under `node --test`.
//
// Edits are saved a moment after the last change. If a save fails (the server is down, the network
// dropped), the editor says so, keeps the edit, and tries again on its own a few times; after that it
// waits for the next edit or the Retry button. A newer edit made while a save is on its way is saved next.

export type SaveState = "saved" | "dirty" | "saving" | "failed";

export interface Saver<T> {
  /** A new version to save, after a short pause. */
  push(value: T): void;
  /** Save anything pending now. Resolves true once everything is saved, false if the save failed. */
  flush(): Promise<boolean>;
  /** Try again after a failure. */
  retry(): Promise<boolean>;
  /** Forget anything pending (the project was replaced by a version from the server). */
  cancel(): void;
  state(): SaveState;
}

export interface SaverOptions<T> {
  save: (value: T) => Promise<void>;
  /** Called on every change of state; `error` is set while the state is "failed". */
  onState: (state: SaveState, error?: string) => void;
  /** Pause after the last edit before saving, in ms. */
  delay?: number;
  /** Waits before each automatic retry, in ms. After the last one it stops trying on its own. */
  backoff?: number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export function createSaver<T>(opts: SaverOptions<T>): Saver<T> {
  const delay = opts.delay ?? 700;
  const backoff = opts.backoff ?? [1000, 3000, 8000];
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  let latest: T | undefined;
  let dirty = false; // `latest` has not been saved yet
  let inflight: Promise<boolean> | null = null;
  let timer: unknown;
  let attempts = 0; // automatic retries used since the last edit or manual retry
  let current: SaveState = "saved";

  const set = (s: SaveState, error?: string) => {
    current = s;
    opts.onState(s, error);
  };
  const arm = (ms: number) => {
    if (timer !== undefined) clearTimer(timer);
    timer = setTimer(() => {
      timer = undefined;
      void once();
    }, ms);
  };
  const disarm = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  /** One save attempt of the latest value. */
  const once = async (): Promise<boolean> => {
    disarm();
    if (inflight) await inflight;
    if (!dirty) return current !== "failed";
    const value = latest as T;
    dirty = false;
    set("saving");
    let error = "";
    inflight = opts.save(value).then(
      () => true,
      (e) => {
        error = e instanceof Error ? e.message : String(e);
        return false;
      },
    );
    const ok = await inflight;
    inflight = null;
    if (ok) {
      attempts = 0;
      if (dirty) {
        set("dirty"); // an edit arrived while saving: it goes next
        arm(delay);
      } else set("saved");
      return true;
    }
    dirty = true; // nothing newer was saved, so the latest value still needs saving
    set("failed", error || "Couldn't save");
    if (attempts < backoff.length) arm(backoff[attempts++]);
    return false;
  };

  const flush = async (): Promise<boolean> => {
    while (dirty || inflight) {
      if (!(await once())) return false;
    }
    return true;
  };

  return {
    push(value) {
      latest = value;
      dirty = true;
      attempts = 0;
      if (!inflight) set("dirty");
      arm(delay);
    },
    flush,
    retry() {
      attempts = 0;
      return flush();
    },
    cancel() {
      disarm();
      dirty = false;
      attempts = 0;
      if (!inflight) set("saved");
    },
    state: () => current,
  };
}
