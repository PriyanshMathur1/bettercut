// Translated captions. Pure functions, no runtime imports (editor, renderer, tests).
//
// A translation is one line of text per spoken sentence, timed in SOURCE seconds like the words are, so it
// follows cuts, trims and reordering. It can replace the word-by-word captions or sit under them (bilingual).

import type { ReelWord } from "./types";

export interface TranslationLine {
  start: number;
  end: number;
  text: string;
}

export interface Sentence extends TranslationLine {
  /** Index of the sentence's first and last word in spec.words. */
  first: number;
  last: number;
}

const ENDS = /[.!?…]["')\]]?$/;
const MAX_WORDS = 18; // speech with no punctuation still gets lines of a readable length

/** The kept (not cut) words grouped into sentences. */
export function sentencesOf(words: ReelWord[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (!cur.length) return;
    const a = words[cur[0]];
    const b = words[cur[cur.length - 1]];
    out.push({ start: a.start, end: b.end, text: cur.map((i) => words[i].text).join(" "), first: cur[0], last: cur[cur.length - 1] });
    cur = [];
  };
  words.forEach((w, i) => {
    if (w.cut) return;
    const prev = cur.length ? words[cur[cur.length - 1]] : null;
    if (prev && w.start - prev.end > 1.2) flush(); // a long pause ends the sentence too
    cur.push(i);
    if (ENDS.test(w.text) || cur.length >= MAX_WORDS) flush();
  });
  flush();
  return out;
}

/** The translated line to show at source time `t`, or null. */
export function translationAt(lines: TranslationLine[] | undefined, t: number): TranslationLine | null {
  if (!lines) return null;
  for (const l of lines) if (l.text && t >= l.start - 0.05 && t <= l.end + 0.25) return l;
  return null;
}

/**
 * One row per sentence for the editor: the original text and the translation already entered for it
 * (matched by time, so rows survive small edits to the transcript).
 */
export function translationRows(words: ReelWord[], lines: TranslationLine[] | undefined): (Sentence & { translated: string })[] {
  return sentencesOf(words).map((s) => {
    const hit = (lines || []).find((l) => Math.abs(l.start - s.start) < 0.4) || (lines || []).find((l) => l.start < s.end && l.end > s.start);
    return { ...s, translated: hit ? hit.text : "" };
  });
}

/** Set the translation of one sentence; returns the new list of lines, in time order, without empty ones. */
export function setTranslation(words: ReelWord[], lines: TranslationLine[] | undefined, sentence: number, text: string): TranslationLine[] {
  return translationRows(words, lines)
    .map((r, i) => ({ start: r.start, end: r.end, text: (i === sentence ? text : r.translated).trim() }))
    .filter((l) => l.text);
}
