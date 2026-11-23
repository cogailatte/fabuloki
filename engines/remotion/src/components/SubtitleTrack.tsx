import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { SubtitleCue, SubtitleStyle } from "../manifest";
import { useMediaSrc, type MediaResolver } from "../media";
import { cueBoxAttrs, cueOffsetCss, cueScaleOf } from "./cueTransform";
import { fadeInOut } from "./fade";
import {
  useVietnameseFont,
  VIETNAMESE_FONT_FAMILY,
  vietnameseFontFaceCss,
} from "./vietnameseFont";

type SubtitleFont = {
  stack: string;

  faceCss: (resolve: MediaResolver) => string;
};

export const SUBTITLE_FONTS: Record<string, SubtitleFont> = {

  vietnamese: {
    stack: `'${VIETNAMESE_FONT_FAMILY}', 'Segoe UI', sans-serif`,
    faceCss: vietnameseFontFaceCss,
  },

  sans: {
    stack: `Arial, Helvetica, '${VIETNAMESE_FONT_FAMILY}', sans-serif`,
    faceCss: vietnameseFontFaceCss,
  },
  serif: {
    stack: `Georgia, 'Times New Roman', '${VIETNAMESE_FONT_FAMILY}', serif`,
    faceCss: vietnameseFontFaceCss,
  },
  mono: {
    stack: `'Courier New', Consolas, '${VIETNAMESE_FONT_FAMILY}', monospace`,
    faceCss: vietnameseFontFaceCss,
  },
};

export const DEFAULT_SUBTITLE_FONT = "vietnamese";

export function resolveSubtitleFont(id?: string): SubtitleFont {
  const key = (id ?? "").trim().toLowerCase();
  return SUBTITLE_FONTS[key] ?? SUBTITLE_FONTS[DEFAULT_SUBTITLE_FONT];
}

const DEFAULTS = {

  color: "rgba(255,255,255,0.92)",
  fontSizePx: 62,

  bottomVertical: 320,
  bottomHorizontal: 130,
  backdropColor: "rgba(10,16,32,0.52)",
  blurPx: 20,
} as const;

const RAISED_BOTTOM_VERTICAL = 700;
const RAISED_BOTTOM_HORIZONTAL = 470;

const Cue: React.FC<{
  cue: SubtitleCue;
  index: number;
  style?: SubtitleStyle;
  raised: boolean;
}> = ({ cue, index, style, raised }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const last = cue.durationInFrames - 1;

  const vertical = height >= width;
  const u = vertical ? height / 1920 : height / 1080;

  const font = resolveSubtitleFont(style?.fontFamily);
  const fontSize = style?.fontSizePx ?? DEFAULTS.fontSizePx;
  const color = style?.color ?? DEFAULTS.color;
  const backdrop = style?.backdrop ?? "blur";
  const backdropColor = style?.backdropColor ?? DEFAULTS.backdropColor;
  const blurPx = style?.blurPx ?? DEFAULTS.blurPx;

  const baseBottom =
    style?.bottomPx ?? (vertical ? DEFAULTS.bottomVertical : DEFAULTS.bottomHorizontal);
  const raisedBottom = vertical ? RAISED_BOTTOM_VERTICAL : RAISED_BOTTOM_HORIZONTAL;

  const bottomBase = raised ? Math.max(baseBottom, raisedBottom) : baseBottom;

  const opacity = fadeInOut(frame, last, 4, 4);
  const y = interpolate(frame, [0, 5], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const textShadow =
    backdrop === "none"
      ? [
          `0 ${Math.round(2 * u)}px ${Math.round(10 * u)}px rgba(0,0,0,0.92)`,
          `0 0 ${Math.round(26 * u)}px rgba(0,0,0,0.7)`,
          `0 0 ${Math.round(3 * u)}px rgba(0,0,0,0.95)`,
        ].join(", ")
      : "none";

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: Math.round(bottomBase * u),
        paddingLeft: Math.round(72 * u),
        paddingRight: Math.round(72 * u),
        opacity,
      }}
    >
      <div
        {...cueBoxAttrs("subtitle", index)}
        style={{
          transform: `${cueOffsetCss(cue.transform, width, height)}translateY(${y}px) scale(${cueScaleOf(cue.transform)})`,

          background: backdrop === "none" ? "transparent" : backdropColor,

          backdropFilter: backdrop === "blur" ? `blur(${Math.round(blurPx * u)}px)` : undefined,
          WebkitBackdropFilter:
            backdrop === "blur" ? `blur(${Math.round(blurPx * u)}px)` : undefined,
          borderRadius: Math.round(28 * u),
          boxShadow:
            backdrop === "none"
              ? "none"
              : "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 0 0 1px rgba(120,200,255,0.14), 0 18px 50px rgba(0,0,0,0.45)",
          padding:
            backdrop === "none"
              ? 0
              : `${Math.round(30 * u)}px ${Math.round(44 * u)}px ${Math.round(34 * u)}px`,

          display: "block",

          whiteSpace: "pre-line",
          fontFamily: font.stack,
          fontSize: Math.round(fontSize * u),
          fontWeight: 700,
          lineHeight: 1.3,
          letterSpacing: "-0.02em",
          textAlign: "center",
          color,
          textShadow,
          maxWidth: "100%",
        }}
      >
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};

export const SubtitleTrack: React.FC<{
  subtitles: SubtitleCue[];
  style?: SubtitleStyle;

  raised?: boolean;
}> = ({ subtitles, style, raised = false }) => {
  useVietnameseFont();
  const mediaSrc = useMediaSrc();

  const font = resolveSubtitleFont(style?.fontFamily);

  return (
    <>

      <style>{font.faceCss(mediaSrc)}</style>
      {subtitles.map((cue, index) => (
        <Sequence
          key={`sub-${cue.from}-${index}`}
          from={cue.from}
          durationInFrames={cue.durationInFrames}
        >
          <Cue cue={cue} index={index} style={style} raised={raised} />
        </Sequence>
      ))}
    </>
  );
};
