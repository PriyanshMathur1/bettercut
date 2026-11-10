// Data for motion cards: animated charts and stats you fill in with plain lines of text.
// Pure functions, no runtime imports (renderer, editor, tests).
//
// Lines are written the way people write them: "Followers: 12.4k", "Revenue: $3.2M", "+38% Watch time".
// A number keeps whatever sits around it ($, %, k, M, x...), so it counts up and still reads right.

export interface Stat {
  /** What sits before the number: "$", "+", "~". */
  prefix: string;
  /** The number itself, without thousands separators. NaN when the line has no number. */
  value: number;
  /** Decimal places the number was written with, so 3.20 counts up as 3.20, not 3.2. */
  places: number;
  /** What sits after the number: "%", "k", "M", "x", " hrs" (a space is kept when one was written). */
  suffix: string;
  /** The words describing it. */
  label: string;
}

const NUMBER = /(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)/;

/** Split "prefix 12.5 suffix" into its parts. */
function splitNumber(s: string): { prefix: string; value: number; places: number; suffix: string } {
  const m = NUMBER.exec(s);
  if (!m) return { prefix: "", value: NaN, places: 0, suffix: s.trim() };
  const raw = m[1];
  const dot = raw.indexOf(".");
  const after = s.slice(m.index + raw.length);
  const suffix = after.trim();
  return {
    prefix: s.slice(0, m.index).trim(),
    value: Number(raw.replace(/,/g, "")),
    places: dot >= 0 ? raw.length - dot - 1 : 0,
    // "2 hrs" stays "2 hrs" and "12.4k" stays "12.4k": keep one space if the unit was written apart
    suffix: suffix && /^\s/.test(after) ? ` ${suffix}` : suffix,
  };
}

/**
 * Read one stat line. Either "Label: value" ("Followers: 12.4k") or "value label" ("+38% Watch time").
 * A line with no number gives value NaN and keeps all its text as the label.
 */
export function parseStat(line: string): Stat {
  const text = (line || "").trim();
  const colon = text.lastIndexOf(":");
  if (colon > 0) {
    const n = splitNumber(text.slice(colon + 1));
    if (!Number.isNaN(n.value)) return { ...n, label: text.slice(0, colon).trim() };
  }
  // "value label": the number and anything glued to it come first, the words after the first space
  const m = /^(\S*\d\S*)\s+(.+)$/.exec(text);
  if (m) {
    const n = splitNumber(m[1]);
    if (!Number.isNaN(n.value)) return { ...n, label: m[2].trim() };
  }
  const n = splitNumber(text);
  return Number.isNaN(n.value) ? { prefix: "", value: NaN, places: 0, suffix: "", label: text } : { ...n, label: "" };
}

/** The stats from a list of lines, skipping blank ones. */
export function parseStats(lines: readonly string[] | undefined): Stat[] {
  return (lines || []).filter((l) => l && l.trim()).map(parseStat);
}

/** A stat's number partway through counting up (e from 0 to 1), formatted the way it was written. */
export function countUp(s: Stat, e: number): string {
  if (Number.isNaN(s.value)) return "";
  const v = s.value * Math.min(1, Math.max(0, e));
  const body = s.places > 0 ? v.toLocaleString("en-US", { minimumFractionDigits: s.places, maximumFractionDigits: s.places }) : Math.round(v).toLocaleString("en-US");
  return `${s.prefix}${body}${s.suffix}`;
}

/** Bar lengths 0..1 for a chart: each value against the largest. Negative or missing values draw no bar. */
export function barLengths(stats: readonly Stat[]): number[] {
  const vals = stats.map((s) => (Number.isFinite(s.value) && s.value > 0 ? s.value : 0));
  const max = Math.max(0, ...vals);
  return vals.map((v) => (max > 0 ? v / max : 0));
}

/** How full a ring or donut is, 0..1, for a value out of `of` (100 when the value is a percentage). */
export function ringFill(value: number | undefined, of = 100): number {
  if (!Number.isFinite(value) || !(of > 0)) return 0;
  return Math.min(1, Math.max(0, (value as number) / of));
}

/** When item `i` of `n` starts animating, spread across the first part of the card's life. */
export function stagger(i: number, n: number, start = 0.2, spread = 0.9): number {
  return start + (n > 1 ? (spread * i) / (n - 1) : 0);
}
