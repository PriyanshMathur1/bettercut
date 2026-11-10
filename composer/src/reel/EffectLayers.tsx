import React from "react";
import { overlaysFor, svgFilters, type ClipEffect } from "./clipfx";
import { Grain, Vignette } from "./grade";

/**
 * The SVG filters a clip's effect stack refers to. Render once per clip, with the same `uid` and `k` as
 * the `filterFor` call that builds the clip's CSS filter. Draws nothing itself: `svgFilters` decides what
 * each filter is, this only turns that data into elements.
 */
export const FxDefs: React.FC<{ effects?: ClipEffect[]; k: number; uid: string }> = ({ effects, k, uid }) => {
  const filters = svgFilters(effects, k, uid);
  if (!filters.length) return null;
  return (
    <svg width="0" height="0" style={{ position: "absolute", pointerEvents: "none" }} aria-hidden="true">
      <defs>
        {filters.map((f) => (
          <filter key={f.id} id={f.id} {...f.region} colorInterpolationFilters="sRGB">
            {f.steps.map((s, i) =>
              React.createElement(
                s.tag,
                { key: i, ...s.attrs },
                s.tables ? [<feFuncR key="r" type="table" tableValues={s.tables.r} />, <feFuncG key="g" type="table" tableValues={s.tables.g} />, <feFuncB key="b" type="table" tableValues={s.tables.b} />] : undefined,
              ),
            )}
          </filter>
        ))}
      </defs>
    </svg>
  );
};

/** Film grain and vignette from a clip's stack, filling whatever box they are placed in (the clip's own box). */
export const FxOverlays: React.FC<{ effects?: ClipEffect[]; uid: string }> = ({ effects, uid }) => (
  <>{overlaysFor(effects).map((o, i) => (o.type === "vignette" ? <Vignette key={i} amount={o.amount} /> : <Grain key={i} amount={o.amount} uid={`${uid}-${i}`} />))}</>
);
