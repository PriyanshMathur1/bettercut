// Pure timeline math shared by the Remotion composition, the editor UI and tests.
// Source time = position in the original clip. Output time = position in the reel.
// No runtime imports: runs under `node --test` with type stripping.

import type { ReelSegment, ReelWord, ReelSpec } from "./types";

export interface Span {
  start: number;
  end: number;
}

/** A kept segment placed on the output timeline. */
export interface PlacedSegment extends ReelSegment {
  index: number;
  /** Visual shot number: steps on every real cut, not on seamless (join) pieces. Drives the auto punch-in. */
  shot: number;
  outStart: number;
  outEnd: number;
}

const EPS = 1e-6;

export function sortAndMerge(spans: Span[], minLength = 0.04): Span[] {
  const sorted = spans
    .filter((s) => s.end - s.start > EPS)
    .map((s) => ({ ...s }))
    .sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end + EPS) {
      last.end = Math.max(last.end, s.end);
    } else {
      out.push(s);
    }
  }
  return out.filter((s) => s.end - s.start >= minLength);
}

/** Subtract `cuts` from `segments`, keeping each segment's own fields (zoom, look...). */
export function subtractSpans<T extends Span & { id?: string }>(segments: T[], cuts: Span[]): T[] {
  const merged = sortAndMerge(cuts, 0);
  const out: T[] = [];
  for (const seg of segments) {
    let pieces: Span[] = [{ start: seg.start, end: seg.end }];
    for (const c of merged) {
      const next: Span[] = [];
      for (const p of pieces) {
        if (c.end <= p.start || c.start >= p.end) {
          next.push(p);
          continue;
        }
        if (c.start > p.start) next.push({ start: p.start, end: c.start });
        if (c.end < p.end) next.push({ start: c.end, end: p.end });
      }
      pieces = next;
    }
    pieces
      .filter((p) => p.end - p.start >= 0.04)
      .forEach((p, i) =>
        out.push({
          ...seg,
          id: seg.id !== undefined && pieces.length > 1 ? `${seg.id}.${i}` : seg.id,
          start: p.start,
          end: p.end,
          // a freeze frame belongs to the end of the shot, a seamless join to its start
          ...("hold" in seg && i < pieces.length - 1 ? { hold: undefined } : {}),
          ...("join" in seg && i > 0 ? { join: undefined } : {}),
        } as T),
      );
  }
  return out;
}

/**
 * Time ranges removed by words marked `cut` in the text editor.
 * A cut word takes the gap up to the next word with it, so deleting a word never leaves dead air.
 */
export function cutWordSpans(words: ReelWord[]): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w.cut) continue;
    const next = words[i + 1];
    const prev = words[i - 1];
    const start = prev && !prev.cut ? Math.max(prev.end, w.start - 0.02) : w.start;
    const end = next ? Math.max(w.end, Math.min(next.start, w.end + 0.5) - 0.03) : w.end;
    spans.push({ start, end: Math.max(end, start) });
  }
  return sortAndMerge(spans, 0);
}

/** Seconds a shot holds its last frame (freeze frame); 0..10. */
export function holdOf(s: { hold?: number }): number {
  const v = s.hold ?? 0;
  return v > 0 ? Math.min(10, v) : 0;
}

/**
 * Segments after applying text-editor cuts, placed on the output timeline in the order they are listed
 * (the pipeline lists them in filming order; the editor can reorder them).
 */
export function placeSegments(spec: Pick<ReelSpec, "segments" | "words">): PlacedSegment[] {
  const kept = subtractSpans(spec.segments, cutWordSpans(spec.words));
  let t = 0;
  let shot = -1;
  return kept.map((s, index) => {
    if (!(s.join && index > 0)) shot++;
    const placed = { ...s, index, shot, outStart: t, outEnd: t + (s.end - s.start) / speedOf(s) + holdOf(s) };
    t = placed.outEnd;
    return placed;
  });
}

export function totalOutDuration(placed: PlacedSegment[]): number {
  return placed.length ? placed[placed.length - 1].outEnd : 0;
}

/** Playback speed of a shot (speed ramps); clamped to 0.25..4. */
export function speedOf(s: { speed?: number }): number {
  const v = s.speed ?? 1;
  return v > 0 ? Math.min(4, Math.max(0.25, v)) : 1;
}

/** Map a source time to output time; null when that moment was cut. */
export function toOutput(placed: PlacedSegment[], t: number): number | null {
  for (const s of placed) {
    if (t >= s.start - EPS && t <= s.end + EPS) {
      return s.outStart + Math.min(Math.max(t - s.start, 0), s.end - s.start) / speedOf(s);
    }
  }
  return null;
}

/** Map an output time back to source time (for the editor's scrubber). */
export function toSource(placed: PlacedSegment[], out: number): number {
  for (const s of placed) {
    if (out >= s.outStart - EPS && out < s.outEnd) return Math.min(s.end, s.start + (out - s.outStart) * speedOf(s));
  }
  const last = placed[placed.length - 1];
  return last ? last.end : 0;
}

/**
 * Map a source range to one output range. Cut parts vanish, so the kept parts of a range are
 * contiguous on the output timeline. Returns null if nothing of the range survives.
 */
export function rangeToOutput(placed: PlacedSegment[], start: number, end: number): Span | null {
  let outStart: number | null = null;
  let outEnd: number | null = null;
  for (const s of placed) {
    const a = Math.max(start, s.start);
    const b = Math.min(end, s.end);
    if (b - a <= EPS) continue;
    const oa = s.outStart + (a - s.start) / speedOf(s);
    const ob = s.outStart + (b - s.start) / speedOf(s);
    // min/max, not first/last: reordered shots are not in source order
    outStart = outStart === null ? oa : Math.min(outStart, oa);
    outEnd = outEnd === null ? ob : Math.max(outEnd, ob);
  }
  if (outStart === null || outEnd === null) return null;
  return { start: outStart, end: outEnd };
}

/** Like rangeToOutput, but a moment that falls in a cut snaps to the next kept moment. */
export function snapToOutput(placed: PlacedSegment[], t: number): number | null {
  const direct = toOutput(placed, t);
  if (direct !== null) return direct;
  let next: PlacedSegment | null = null;
  for (const s of placed) if (s.start > t && (!next || s.start < next.start)) next = s;
  return next ? next.outStart : null;
}

export interface OutWord extends ReelWord {
  outStart: number;
  outEnd: number;
  index: number;
}

/** Words that survive the cut, in output time. */
export function outputWords(placed: PlacedSegment[], words: ReelWord[]): OutWord[] {
  const out: OutWord[] = [];
  words.forEach((w, index) => {
    if (w.cut) return;
    const r = rangeToOutput(placed, w.start, w.end);
    if (!r) return;
    out.push({ ...w, outStart: r.start, outEnd: Math.max(r.end, r.start + 0.05), index });
  });
  return out.sort((a, b) => a.outStart - b.outStart); // output order (shots may be reordered)
}

export interface CaptionPage {
  words: OutWord[];
  start: number;
  end: number;
}

const SENTENCE_END = /[.!?…]$/;

/**
 * Group words into caption pages. Breaks on: page size, explicit breakAfter, sentence ends,
 * pauses longer than `maxGap`, and long pages by character count.
 */
export function buildPages(words: OutWord[], wordsPerPage: number, maxChars = 26, maxGap = 0.6): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let cur: OutWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    pages.push({ words: cur, start: cur[0].outStart, end: cur[cur.length - 1].outEnd });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    if (prev && w.outStart - prev.outEnd > maxGap) flush();
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (cur.length && chars > maxChars) flush();
    cur.push(w);
    if (cur.length >= Math.max(1, wordsPerPage) || w.breakAfter || SENTENCE_END.test(w.text)) flush();
  }
  flush();
  // Each page stays on screen until the next page starts (bounded), so captions never flicker off.
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    const hold = next ? Math.min(next.start, pages[i].end + 0.7) : pages[i].end + 0.5;
    pages[i].end = Math.max(pages[i].end, hold);
  }
  return pages;
}

/** Output times of every cut (start of each segment after the first). */
export function cutTimes(placed: PlacedSegment[]): number[] {
  return placed.slice(1).filter((s) => !s.join).map((s) => s.outStart);
}

/** 0..1 progress of `t` through [start, end], clamped. */
export function progress(t: number, start: number, end: number): number {
  if (end <= start) return t >= start ? 1 : 0;
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/** Auto punch-in scale for a shot given the auto-zoom mode. */
export function autoZoomFor(mode: string, index: number, explicit?: number): number {
  if (explicit && explicit !== 1) return explicit;
  switch (mode) {
    case "subtle":
      return index % 2 === 1 ? 1.08 : 1;
    case "punchy":
      return index % 3 === 1 ? 1.25 : index % 3 === 2 ? 1.12 : 1;
    case "alternate":
      return index % 2 === 1 ? 1.18 : 1;
    default:
      return 1;
  }
}
