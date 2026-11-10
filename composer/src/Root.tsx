import React from "react";
import { Composition } from "remotion";
import { Reel, calculateReelMetadata, type ReelProps } from "./reel/Reel";
import { DEFAULT_SPEC } from "./reel/defaults";

/** One composition: the reel. Its length, size and content all come from the spec passed as props. */
export const Root: React.FC = () => (
  <Composition
    id="BetterCut"
    component={Reel}
    durationInFrames={30 * 10}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={DEFAULT_SPEC as ReelProps}
    calculateMetadata={calculateReelMetadata}
  />
);
