// ReelSpec: the single JSON document that fully describes a reel.
// The pipeline writes it, the editor UI and Claude edit it, Remotion renders it.
// All times are SOURCE seconds (position in the original clip) unless named `out*`,
// so cutting a segment never invalidates a caption, overlay or effect.

export interface ReelWord {
  text: string;
  start: number;
  end: number;
  /** Removed in the text editor: the word's time range is cut from the reel. */
  cut?: boolean;
  /** Rendered with the style's emphasis treatment (bigger / accent colour). */
  emphasis?: boolean;
  /** Emoji shown with this word (caption styles that support it). */
  emoji?: string;
  /** Force a caption page break after this word. */
  breakAfter?: boolean;
}

export interface ReelSegment {
  id?: string;
  start: number;
  end: number;
  /** Punch-in scale for this shot (1 = none). */
  zoom?: number;
  /** Focus point 0..1 used for crop and punch-in. */
  cx?: number;
  cy?: number;
  /** Look override for this section. */
  look?: string;
  /** Playback speed (speed ramp), 0.25..4. */
  speed?: number;
  /** Freeze frame: hold this shot's last frame for this many seconds. */
  hold?: number;
  /** Play this shot backwards. Needs `reversed`, which the pipeline makes on the next bake or render. */
  reverse?: boolean;
  /** The reversed file for this shot and the stretch of footage it covers (written by the pipeline). */
  reversed?: { src: string; start: number; end: number; of?: string };
  /** Transition into this shot (an effect id, or "none"). Unset = the reel's default cut transition. */
  transition?: string;
  /** Continues the previous shot seamlessly (a speed-ramp step): no cut transition, sound or punch-in change. */
  join?: boolean;
  /** Per-shot colour override (baked by the pipeline). */
  grade?: Record<string, number>;
}

export interface BrandKit {
  name: string;
  handle: string;
  primary: string;
  accent: string;
  text: string;
  ink: string;
  background: string;
  headingFont: string;
  bodyFont: string;
  serifFont: string;
  logo?: string;
}

export interface CaptionSettings {
  enabled: boolean;
  style: string;
  position: "top" | "upper" | "middle" | "lower" | "bottom";
  /** Multiplier on the style's base size. */
  scale: number;
  wordsPerPage: number;
  uppercase?: boolean;
  /** Put emphasis words behind the speaker (needs source.matte). */
  behindHead?: boolean;
  /** Colour overrides; default comes from the brand. */
  color?: string;
  highlight?: string;
}

export interface HookTitle {
  text: string;
  style: string;
  /** Output seconds the hook is on screen from the start. */
  duration: number;
  subtitle?: string;
}

export type OverlayKind =
  | "emoji"
  | "sticker"
  | "lowerThird"
  | "checklist"
  | "numberedList"
  | "counter"
  | "keyword"
  | "image"
  | "arrow"
  | "circle"
  | "followButton"
  | "notification"
  | "quote"
  | "commentReply"
  | "poll"
  | "tierList"
  | "splitHeadline"
  | "progressSteps"
  | "postCard";

export interface ReelOverlay {
  id?: string;
  kind: OverlayKind;
  start: number;
  end: number;
  /** Normalised position of the overlay centre in the safe frame. */
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  enter?: string;
  exit?: string;
  text?: string;
  subtitle?: string;
  items?: string[];
  /** Per-item reveal times (source seconds) for lists. */
  itemTimes?: number[];
  value?: number;
  prefix?: string;
  suffix?: string;
  src?: string;
  emoji?: string;
  color?: string;
  /** Tier list rows: label + items. */
  tiers?: { label: string; color?: string; items: string[] }[];
  sfx?: string | false;
}

export interface BrollClip {
  id?: string;
  src: string;
  start: number;
  end: number;
  /** How the clip is shown. */
  mode: "full" | "split" | "pip" | "card" | "behind";
  /** Seconds into the b-roll file to start from. */
  from?: number;
  kind?: "video" | "image";
}

export interface MotionEvent {
  effect: string;
  /** Source second; for camera effects the start of the range. */
  at: number;
  duration?: number;
  intensity?: number;
}

export interface MotionSettings {
  /** Auto punch-in on alternate shots. */
  autoZoom: "off" | "subtle" | "punchy" | "alternate";
  /** Transition effect applied at every cut. */
  cutTransition: string;
  /** Ambient camera move across each shot. */
  camera: string;
  events: MotionEvent[];
  /** Subtle zoom pulse on every music beat (needs audio.beats). */
  beatPulse?: boolean;
}

export interface GradeSettings {
  /** Creative CSS look layered on top of the baked grade. */
  preset: string;
  /** Baked grade (see bettercut/colour.py): LUT + primary correction. */
  lut?: string;
  lutStrength?: number;
  exposure?: number;
  temperature?: number;
  tint?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  saturation?: number;
  vibrance?: number;
  sharpen?: number;
  denoise?: number;
  autoWhiteBalance?: boolean;
  autoExposure?: boolean;
  matchClips?: boolean;
  /** Key of the bake that produced source.graded. */
  baked?: string;
  vignette: number;
  grain: number;
  /** Separate grade for the cut-out subject (keeps skin lit). */
  subjectLift?: boolean;
}

export interface AudioSettings {
  music?: string;
  musicVolume: number;
  /** Lower music under speech. */
  duck: boolean;
  sfx: boolean;
  sfxVolume: number;
  /** Source voice volume. */
  voiceVolume: number;
  /** Voice chain (denoise, EQ, compression) baked into the footage audio. */
  enhanceVoice?: boolean;
  /** Final loudness target in LUFS (default -14). */
  loudness?: number;
  /** Music beat times in output seconds (filled by the pipeline). */
  beats?: number[];
  sfxEvents?: { at: number; sound: string; volume?: number }[];
}

export interface FormatSettings {
  id: string;
  /** Headline used by framed formats (white frame, cinema, magazine...). */
  headline?: string;
  /** Background for framed / greenscreen formats: colour, image or video path. */
  background?: string;
  /** Reaction / split source media. */
  media?: string;
  mediaKind?: "video" | "image";
  /** Format-specific numeric knob (frame inset, pip size...). */
  amount?: number;
}

export interface EndCard {
  enabled: boolean;
  style: string;
  text: string;
  subtitle?: string;
  duration: number;
}

export interface ReelSource {
  src: string;
  /** Speaker cut-out with alpha (VP9 webm), same timing as src. Enables behind-head + greenscreen. */
  matte?: string;
  /** Colour-graded (baked) copy of src and matte; used instead of src/matte when present. */
  graded?: string;
  gradedMatte?: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
}

export interface ReelSpec {
  version: 1;
  title?: string;
  look: string;
  source: ReelSource;
  segments: ReelSegment[];
  words: ReelWord[];
  brand: BrandKit;
  format: FormatSettings;
  captions: CaptionSettings;
  hook?: HookTitle;
  overlays: ReelOverlay[];
  broll: BrollClip[];
  motion: MotionSettings;
  grade: GradeSettings;
  audio: AudioSettings;
  progressBar: boolean;
  safeGuide?: boolean;
  endCard?: EndCard;
  /** Output fps / size. */
  fps: number;
  width: number;
  height: number;
}
