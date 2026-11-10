// BetterCut: the reel composition. Renders a ReelSpec end to end.
import React, { useMemo } from "react";
import { AbsoluteFill, Audio, CalculateMetadataFunction, Freeze, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReelSpec, ReelOverlay, BrollClip } from "./types";
import {
  buildPages,
  cutTimes,
  outputWords,
  placeSegments,
  cutList,
  progress,
  rangeToOutput,
  snapToOutput,
  totalOutDuration,
  autoZoomFor,
  type PlacedSegment,
} from "./timeline";
import { CaptionLayer, PunchLayer } from "./captions/CaptionLayer";
import { getCaptionStyle } from "./captions/styles";
import { EFFECT_MAP, combineFX, type FX } from "./motion/effects";
import { FORMAT_MAP, type FormatLayout } from "./formats";
import { FootageTrack, Media, type Box } from "./footage";
import { GradeOverlay, gradeFilter, primaryApprox } from "./grade";
import { HookLayer, EndCardLayer } from "./titles";
import { OverlayItem } from "./overlays";
import { DEFAULT_BRAND, kOf } from "./brand";
import { resolveAsset } from "./asset";

export type ReelProps = ReelSpec & Record<string, unknown>;

const DEFAULT_SFX_FOR: Partial<Record<ReelOverlay["kind"], string>> = {
  emoji: "pop",
  sticker: "pop",
  keyword: "hit",
  notification: "notify",
  followButton: "click",
  checklist: "ding",
  numberedList: "pop",
  counter: "riser",
  commentReply: "pop",
  tierList: "whoosh",
  lowerThird: "swish",
  poll: "pop",
  image: "swish",
  postCard: "swish",
  quote: "swish",
};

/** Output duration of the whole reel, including the end card. */
export function reelDuration(spec: ReelSpec): number {
  const placed = placeSegments(spec);
  const body = totalOutDuration(placed);
  return Math.max(1, body + (spec.endCard?.enabled ? spec.endCard.duration : 0));
}

export const calculateReelMetadata: CalculateMetadataFunction<ReelProps> = async ({ props }) => {
  const fps = props.fps || 30;
  return {
    durationInFrames: Math.max(1, Math.round(reelDuration(props) * fps)),
    fps,
    width: props.width || 1080,
    height: props.height || 1920,
  };
};

function sfxSrc(name: string): string {
  return /[./]/.test(name) ? resolveAsset(name) : staticFile(`reel-sfx/${name}.wav`);
}

const boxStyle = (b: Box): React.CSSProperties => ({
  position: "absolute",
  left: b.x,
  top: b.y,
  width: b.w,
  height: b.h,
  borderRadius: b.circle ? "50%" : b.radius,
  transform: b.rotate ? `rotate(${b.rotate}deg)` : undefined,
  boxShadow: b.shadow,
  border: b.border,
  boxSizing: "content-box",
  marginLeft: b.border ? -parseFloat(b.border) : 0,
  marginTop: b.border ? -parseFloat(b.border) : 0,
  overflow: "hidden",
});

const SvgChannelFilters: React.FC = () => (
  <svg width="0" height="0" style={{ position: "absolute" }}>
    <filter id="rs-red">
      <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
    </filter>
    <filter id="rs-cyan">
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" />
    </filter>
  </svg>
);

export const Reel: React.FC<ReelProps> = (spec) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const t = frame / fps;
  const brand = { ...DEFAULT_BRAND, ...(spec.brand || {}) };

  const placed = useMemo(() => placeSegments(spec), [spec.segments, spec.words]);
  const words = useMemo(() => outputWords(placed, spec.words || []), [placed, spec.words]);
  const capStyle = getCaptionStyle(spec.captions?.style);
  const pages = useMemo(
    () => buildPages(words, spec.captions?.wordsPerPage || capStyle.wordsPerPage || 4),
    [words, spec.captions?.wordsPerPage, capStyle.wordsPerPage],
  );
  const body = totalOutDuration(placed);
  const cuts = useMemo(() => cutTimes(placed), [placed]);

  const hasMatte = !!spec.source.matte;
  const srcW = spec.source.width || 1080;
  const srcH = spec.source.height || 1920;

  // ---- b-roll on the output timeline --------------------------------------
  const broll = useMemo(
    () =>
      (spec.broll || [])
        .map((b) => ({ b, r: rangeToOutput(placed, b.start, b.end) }))
        .filter((x): x is { b: BrollClip; r: { start: number; end: number } } => !!x.r),
    [spec.broll, placed],
  );
  const activeBroll = broll.find((x) => t >= x.r.start && t < x.r.end);

  // ---- format ------------------------------------------------------------
  const fdef = FORMAT_MAP[spec.format?.id] || FORMAT_MAP.full;
  const splitBroll = activeBroll && activeBroll.b.mode === "split";
  const formatMedia = spec.format?.media;
  const vertical = W / H < 0.7;
  let layoutDef = splitBroll && !fdef.needsMedia ? FORMAT_MAP["split-top"] : fdef;
  if (!vertical && layoutDef.verticalOnly) layoutDef = FORMAT_MAP.full;
  const hasMedia = !!(splitBroll || formatMedia || (activeBroll && fdef.needsMedia));
  let layout: FormatLayout = layoutDef.layout({ W, H, brand, f: spec.format || { id: "full" }, hasMatte, hasMedia, srcAspect: srcW / srcH });
  if (W > H && srcW / srcH < 1 && (layoutDef.id === "full" || layoutDef.id === "blur-fit")) {
    // vertical footage in a landscape frame: fit it centred over a blurred fill instead of cropping it away
    const w = Math.min(W, H * (srcW / srcH));
    layout = { ...layout, box: { x: (W - w) / 2, y: 0, w, h: H, fit: "cover" }, blurFill: true, captionY: "lower" };
  }
  const box = layout.box;

  // ---- camera / transition FX ----------------------------------------------
  const seg: PlacedSegment | undefined = placed.find((s) => t >= s.outStart && t < s.outEnd) || placed[placed.length - 1];
  const fxList: FX[] = [];
  if (seg) {
    const z = autoZoomFor(spec.motion?.autoZoom || "off", seg.shot, seg.zoom);
    if (z !== 1) fxList.push({ transform: `scale(${z})` });
    const cam = EFFECT_MAP[spec.motion?.camera || ""];
    if (cam && cam.family === "camera") fxList.push(cam.fn(progress(t, seg.outStart, seg.outEnd), 1));
  }
  const tr = EFFECT_MAP[spec.motion?.cutTransition || ""];
  // each cut plays its own transition when the shot has one, else the reel's default
  const cutFx = useMemo(
    () =>
      cutList(placed)
        .map((c) => ({ at: c.at, def: c.transition === undefined ? tr : EFFECT_MAP[c.transition] }))
        .filter((c): c is { at: number; def: NonNullable<typeof tr> } => !!c.def && c.def.family === "transition"),
    [placed, tr],
  );
  for (const c of cutFx) {
    if (Math.abs(t - c.at) < c.def.duration / 2) fxList.push(c.def.fn(progress(t, c.at - c.def.duration / 2, c.at + c.def.duration / 2), 1));
  }
  if (spec.motion?.beatPulse && spec.audio?.beats?.length) {
    const pulse = EFFECT_MAP["heartbeat"];
    for (const b of spec.audio.beats) {
      if (t >= b && t <= b + 0.3) fxList.push(pulse.fn(progress(t, b, b + 0.3), 0.35));
    }
  }
  for (const ev of spec.motion?.events || []) {
    const def = EFFECT_MAP[ev.effect];
    if (!def) continue;
    const at = snapToOutput(placed, ev.at);
    if (at === null) continue;
    const d = ev.duration || def.duration;
    const start = def.family === "transition" ? at - d / 2 : at;
    if (t >= start && t <= start + d) fxList.push(def.fn(progress(t, start, start + d), ev.intensity ?? 1));
  }
  const fx = combineFX(fxList);
  const originX = (seg?.cx ?? 0.5) * box.w;
  const originY = (seg?.cy ?? 0.4) * box.h;
  const gradeS = spec.grade || { preset: "none", vignette: 0, grain: 0 };
  // before the ffmpeg bake exists, preview manual colour controls with a CSS approximation
  const approx = spec.source.graded ? "" : primaryApprox(gradeS);
  const gFilter = [approx, gradeFilter(gradeS), layout.footageFilter, fx.filter].filter(Boolean).join(" ");

  const inBody = t < body;
  const showMatte = hasMatte && (layout.matteOnly || layout.colourPop || layout.breakoutAbove !== undefined || spec.captions?.behindHead || (activeBroll?.b.mode === "behind") || spec.format?.id === "magazine");

  const footage = (opts: { matte?: boolean; muted?: boolean; style?: React.CSSProperties }) => (
    <FootageTrack
      placed={placed}
      src={opts.matte ? ((spec.source.gradedMatte || spec.source.matte) as string) : spec.source.graded || spec.source.src}
      srcW={srcW}
      srcH={srcH}
      boxW={box.w}
      boxH={box.h}
      fit={box.fit || "cover"}
      muted={opts.muted}
      volume={spec.audio?.voiceVolume ?? 1}
      transparent={opts.matte}
      style={opts.style}
    />
  );

  /** Wrapper that applies the per-frame camera transform inside a box. */
  const cam = (children: React.ReactNode, extra?: React.CSSProperties) => (
    <div style={{ position: "absolute", inset: 0, transform: fx.transform, transformOrigin: `${originX}px ${originY}px`, ...extra }}>{children}</div>
  );

  // the matte sits at exactly the same geometry as the footage, but unclipped
  const matteLayer = (clip?: string, filter?: string) => (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, transform: box.rotate ? `rotate(${box.rotate}deg)` : undefined, clipPath: clip, overflow: clip ? "visible" : "hidden", borderRadius: box.circle ? "50%" : box.radius }}>
      {cam(footage({ matte: true, muted: true, style: { filter } }))}
    </div>
  );

  // ---- overlays on the output timeline -------------------------------------
  const overlays = useMemo(
    () =>
      (spec.overlays || [])
        .map((o) => {
          const r = rangeToOutput(placed, o.start, o.end);
          const itemTimes = (o.itemTimes || []).map((x) => snapToOutput(placed, x) ?? 0);
          return r ? { o, r, itemTimes } : null;
        })
        .filter(Boolean) as { o: ReelOverlay; r: { start: number; end: number }; itemTimes: number[] }[],
    [spec.overlays, placed],
  );

  // ---- audio: music ducking + sfx ------------------------------------------
  const speech = useMemo(() => words.map((w) => [w.outStart, w.outEnd] as [number, number]), [words]);
  const musicVol = (f: number) => {
    const a = spec.audio;
    if (!a?.music) return 0;
    const tt = f / fps;
    let v = a.musicVolume ?? 0.25;
    if (a.duck) {
      let d = Infinity;
      for (const [s, e] of speech) {
        if (tt >= s && tt <= e) {
          d = 0;
          break;
        }
        d = Math.min(d, Math.abs(tt - s), Math.abs(tt - e));
      }
      v *= d === 0 ? 0.3 : d < 0.25 ? 0.3 + 0.7 * (d / 0.25) : 1;
    }
    const total = reelDuration(spec);
    return v * Math.min(1, tt / 0.5, (total - tt) / 1.0);
  };

  const sfx = useMemo(() => {
    const a = spec.audio;
    if (!a?.sfx) return [] as { at: number; sound: string; volume: number }[];
    const list: { at: number; sound: string; volume: number }[] = [];
    const base = a.sfxVolume ?? 0.5;
    for (const c of cutFx) list.push({ at: Math.max(0, c.at - 0.12), sound: /flash|whip|zoom|spin/.test(c.def.id) ? "whoosh" : /glitch|rgb|vhs/.test(c.def.id) ? "glitch" : /shutter|iris|barn/.test(c.def.id) ? "shutter" : "swish", volume: base * 0.6 });
    for (const { o, r } of overlays) {
      const s = o.sfx === false ? undefined : o.sfx || DEFAULT_SFX_FOR[o.kind];
      if (s) list.push({ at: r.start, sound: s, volume: base });
    }
    if (spec.hook?.text) list.push({ at: 0, sound: "hit", volume: base * 0.8 });
    if (spec.endCard?.enabled) list.push({ at: body, sound: "ding", volume: base });
    for (const ev of a.sfxEvents || []) {
      const at = snapToOutput(placed, ev.at);
      if (at !== null) list.push({ at, sound: ev.sound, volume: ev.volume ?? base });
    }
    return list;
  }, [spec.audio, cutFx, overlays, spec.hook?.text, spec.endCard?.enabled, body, placed]);

  const captionSettings = { ...spec.captions, position: spec.captions?.position || layout.captionY || "lower" };
  const behind = !!(spec.captions?.behindHead && hasMatte);

  return (
    <AbsoluteFill style={{ background: "#000", ["--brand-primary" as any]: brand.primary }}>
      <SvgChannelFilters />
      {layout.background}

      {layout.blurFill && inBody ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: -60, filter: "blur(40px) brightness(.55) saturate(1.2)" }}>
            <FootageTrack placed={placed} src={spec.source.graded || spec.source.src} srcW={srcW} srcH={srcH} boxW={W + 120} boxH={H + 120} fit="cover" muted />
          </div>
        </AbsoluteFill>
      ) : null}

      {/* speaker footage (frozen on its last frame behind the end card) */}
      {!inBody && !layout.matteOnly && body > 0 ? (
        <Freeze frame={Math.max(0, Math.round(body * fps) - 1)}>
          <div style={boxStyle(box)}>{cam(footage({ muted: true, style: { filter: gFilter || undefined } }))}</div>
        </Freeze>
      ) : null}
      {inBody && !layout.matteOnly ? (
        <div style={boxStyle(box)}>
          {cam(footage({ style: { filter: gFilter || undefined } }))}
          {fx.rgb ? (
            <>
              {cam(footage({ muted: true, style: { filter: "url(#rs-red)", mixBlendMode: "screen", opacity: 0.8, transform: `translateX(${fx.rgb}px)` } }))}
              {cam(footage({ muted: true, style: { filter: "url(#rs-cyan)", mixBlendMode: "screen", opacity: 0.6, transform: `translateX(${-fx.rgb}px)` } }))}
            </>
          ) : null}
        </div>
      ) : null}
      {inBody && layout.matteOnly ? (
        <>
          {/* voice still comes from the original */}
          <div style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}>{footage({})}</div>
          {matteLayer(undefined, gradeFilter(spec.grade))}
        </>
      ) : null}

      {/* second media slot (reaction / split b-roll) */}
      {inBody && layout.mediaBox && (splitBroll || formatMedia || activeBroll) ? (
        <div style={boxStyle(layout.mediaBox)}>
          {activeBroll ? (
            <Sequence from={Math.round(activeBroll.r.start * fps)} layout="none">
              <Media src={activeBroll.b.src} kind={activeBroll.b.kind} from={activeBroll.b.from} />
            </Sequence>
          ) : formatMedia ? (
            <Media src={formatMedia} kind={spec.format.mediaKind} />
          ) : null}
        </div>
      ) : null}

      {layout.decor}

      {/* behind-the-head layer */}
      {inBody && activeBroll?.b.mode === "behind" && hasMatte ? (
        <AbsoluteFill>
          <Sequence from={Math.round(activeBroll.r.start * fps)} layout="none">
            <Media src={activeBroll.b.src} kind={activeBroll.b.kind} from={activeBroll.b.from} />
          </Sequence>
        </AbsoluteFill>
      ) : null}
      {inBody && behind ? <PunchLayer words={words} brand={brand} style={capStyle} settings={captionSettings} /> : null}

      {inBody && showMatte && !layout.matteOnly
        ? matteLayer(layout.breakoutAbove !== undefined ? `inset(-100% -50% ${box.h - 1}px -50%)` : undefined, layout.colourPop ? gradeFilter(spec.grade) : gFilter)
        : null}

      <GradeOverlay grade={spec.grade || { preset: "none", vignette: 0, grain: 0 }} />

      {/* b-roll cutaways */}
      {inBody && activeBroll && (activeBroll.b.mode === "full" || activeBroll.b.mode === "pip" || activeBroll.b.mode === "card") ? (
        <Sequence from={Math.round(activeBroll.r.start * fps)} durationInFrames={Math.max(1, Math.round((activeBroll.r.end - activeBroll.r.start) * fps))} layout="none">
          <BrollView b={activeBroll.b} W={W} H={H} start={activeBroll.r.start} />
        </Sequence>
      ) : null}

      {fx.layer ? <AbsoluteFill style={{ background: fx.layer.background, opacity: fx.layer.opacity, mixBlendMode: fx.layer.mixBlendMode as any, transform: fx.layer.transform }} /> : null}
      {fx.bars ? (
        <>
          {fx.bars.h ? (
            <>
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${fx.bars.h * 100}%`, background: fx.bars.color }} />
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${fx.bars.h * 100}%`, background: fx.bars.color }} />
            </>
          ) : null}
          {fx.bars.v ? (
            <>
              <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${fx.bars.v * 100}%`, background: fx.bars.color }} />
              <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: `${fx.bars.v * 100}%`, background: fx.bars.color }} />
            </>
          ) : null}
        </>
      ) : null}

      {overlays.map(({ o, r, itemTimes }, i) => (
        <OverlayItem key={o.id || i} o={o} brand={brand} start={r.start} end={r.end} itemTimes={itemTimes} />
      ))}

      {inBody ? <CaptionLayer pages={pages} style={capStyle} settings={captionSettings} brand={brand} omitEmphasis={behind} hideBefore={spec.hook?.text ? spec.hook.duration : undefined} /> : null}

      {spec.hook?.text ? <HookLayer text={spec.hook.text} subtitle={spec.hook.subtitle} style={spec.hook.style} duration={spec.hook.duration} brand={brand} top={spec.format?.headline ? layout.hookTop : undefined} /> : null}

      {spec.progressBar && inBody ? (
        <div style={{ position: "absolute", left: 0, top: 0, height: 10 * kOf(W, H), width: `${(t / body) * 100}%`, background: brand.accent, boxShadow: `0 0 12px ${brand.accent}` }} />
      ) : null}

      {spec.endCard?.enabled ? (
        <EndCardLayer style={spec.endCard.style} text={spec.endCard.text} subtitle={spec.endCard.subtitle} brand={brand} start={body} duration={spec.endCard.duration} />
      ) : null}

      {spec.safeGuide ? <SafeGuide W={W} H={H} /> : null}

      {spec.audio?.music ? <Audio src={resolveAsset(spec.audio.music)} volume={musicVol} loop /> : null}
      {sfx.map((s, i) => (
        <Sequence key={`sfx-${i}`} from={Math.max(0, Math.round(s.at * fps))} durationInFrames={Math.round(2 * fps)} layout="none">
          <Audio src={sfxSrc(s.sound)} volume={s.volume} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const BrollView: React.FC<{ b: BrollClip; W: number; H: number; start: number }> = ({ b, W, H }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = Math.min(1, frame / (0.25 * fps));
  const k = W / 1080;
  if (b.mode === "full") {
    return (
      <AbsoluteFill style={{ opacity: e }}>
        <Media src={b.src} kind={b.kind} from={b.from} />
      </AbsoluteFill>
    );
  }
  if (b.mode === "pip") {
    return (
      <div style={{ position: "absolute", right: 60 * k, top: 260 * k, width: 420 * k, height: 560 * k, borderRadius: 30 * k, overflow: "hidden", border: `${6 * k}px solid #FFF`, boxShadow: "0 20px 50px rgba(0,0,0,.45)", transform: `scale(${0.6 + 0.4 * e})`, transformOrigin: "top right" }}>
        <Media src={b.src} kind={b.kind} from={b.from} />
      </div>
    );
  }
  return (
    <div style={{ position: "absolute", left: 90 * k, top: 280 * k, width: W - 180 * k, height: 640 * k, borderRadius: 36 * k, overflow: "hidden", border: `${10 * k}px solid #FFF`, boxShadow: "0 30px 70px rgba(0,0,0,.5)", transform: `rotate(${-3 * e}deg) translateY(${(1 - e) * 200}px)`, opacity: e }}>
      <Media src={b.src} kind={b.kind} from={b.from} />
    </div>
  );
};

/** Instagram Reels safe zone, drawn in red (preview only). */
export const SafeGuide: React.FC<{ W: number; H: number }> = ({ W, H }) => {
  const k = W / 1080;
  const red = "rgba(255,0,0,.28)";
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 220 * k, background: red }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 1470 * k, bottom: 0, background: red }} />
      <div style={{ position: "absolute", left: 0, top: 220 * k, width: 35 * k, height: 1250 * k, background: red }} />
      <div style={{ position: "absolute", right: 0, top: 220 * k, width: 35 * k, height: 935 * k, background: red }} />
      <div style={{ position: "absolute", right: 0, top: 1155 * k, width: 100 * k, height: 315 * k, background: red }} />
    </AbsoluteFill>
  );
};
