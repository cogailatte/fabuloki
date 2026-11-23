import React, { useId } from "react";
import { AbsoluteFill } from "remotion";
import {
  ColorDefs,
  colorFilterCss,
  safeFilterId,
  vignetteAmount,
  vignetteBackground,
  type ColorAdjust,
} from "../color";

export const ColorBox: React.FC<{
  adjust?: ColorAdjust | null;
  children: React.ReactNode;
}> = ({ adjust, children }) => {
  const id = safeFilterId(useId());
  const filter = colorFilterCss(adjust, id);
  const vignette = vignetteAmount(adjust);
  if (!filter && vignette <= 0) return <>{children}</>;
  return (
    <AbsoluteFill>
      <ColorDefs id={id} adjust={adjust} />
      <AbsoluteFill style={filter ? { filter } : undefined}>{children}</AbsoluteFill>
      {vignette > 0 ? (
        <AbsoluteFill style={{ background: vignetteBackground(vignette), pointerEvents: "none" }} />
      ) : null}
    </AbsoluteFill>
  );
};
