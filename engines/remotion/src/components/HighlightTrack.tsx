import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { HighlightCue } from "../manifest";
import { useMediaSrc } from "../media";
import { cueBoxAttrs, cueOffsetCss, cueScaleOf } from "./cueTransform";
import { fadeInOut } from "./fade";
import { useVietnameseFont, VIETNAMESE_FONT_FAMILY, vietnameseFontFaceCss } from "./vietnameseFont";

const DRIFT_MAX = 14;

const ACCENTS = {
  hot: { text: "#ff7849", glow: "rgba(237,60,71,0.45)", bar: "linear-gradient(90deg,#ed3c47,#ff7849)" },
  cool: { text: "#37bdf8", glow: "rgba(55,189,248,0.45)", bar: "linear-gradient(90deg,#37bdf8,#8fd9ff)" },
} as const;

const Cue: React.FC<{ cue: HighlightCue; index: number; raised: boolean }> = ({
  cue,
  index,
  raised,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const last = cue.durationInFrames - 1;
  const accent = ACCENTS[cue.accent ?? "cool"];
  const main = (cue.tier ?? "main") === "main";

  const vertical = height >= width;
  const u = vertical ? height / 1920 : height / 1080;

  const bottomBase = raised ? (vertical ? 700 : 470) : (vertical ? 330 : 240);

  const opacity = fadeInOut(frame, last, 5, 6);

  const pop = interpolate(frame, [0, 5, 9], [0.94, 1.02, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const drift =
    last > 0
      ? interpolate(frame, [0, last], [0, -DRIFT_MAX], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;

  const barScale = interpolate(frame, [2, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{

        justifyContent: main ? "flex-start" : "flex-end",
        alignItems: "center",

        paddingTop: main ? Math.round(height * 0.1) + DRIFT_MAX + 8 : 0,
        paddingBottom: main ? 0 : Math.round(bottomBase * u),
        paddingLeft: Math.round(72 * u),
        paddingRight: Math.round(72 * u),
        opacity,
      }}
    >
      <div
        {...cueBoxAttrs("overlay", index)}
        style={{
          transform: `${cueOffsetCss(cue.transform, width, height)}translateY(${drift}px) scale(${pop * cueScaleOf(cue.transform)})`,

          transformOrigin: main ? "center top" : "center bottom",

          background: "rgba(16,17,19,0.46)",
          backdropFilter: "blur(26px)",
          WebkitBackdropFilter: "blur(26px)",
          borderRadius: Math.round((main ? 32 : 50) * u),
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 0 0 1px rgba(255,255,255,0.08), 0 22px 60px rgba(0,0,0,0.5), 0 0 60px rgba(55,189,248,0.10)",
          padding: main
            ? `${Math.round(34 * u)}px ${Math.round(46 * u)}px ${Math.round(38 * u)}px`
            : `${Math.round(22 * u)}px ${Math.round(40 * u)}px ${Math.round(26 * u)}px`,
          maxWidth: "100%",
          textAlign: "center",
          fontFamily: `'${VIETNAMESE_FONT_FAMILY}', 'Segoe UI', sans-serif`,
        }}
      >
        {cue.kicker ? (
          <div
            style={{
              fontSize: Math.round(28 * u),
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(200,224,245,0.72)",
              marginBottom: Math.round(14 * u),
            }}
          >
            {cue.kicker}
          </div>
        ) : null}

        <div
          style={{

            fontSize: Math.round((main ? 76 : 50) * u),
            fontWeight: 800,
            lineHeight: 1.14,
            letterSpacing: "-0.03em",
            color: "#ffffff",

            display: "block",
          }}
        >
          {cue.parts.map((part, index) => (
            <span
              key={`${part.t}-${index}`}
              style={{
                display: "inline-block",
                margin: "0 0.13em",
                color: part.hi ? accent.text : "#ffffff",
                filter: part.hi ? `drop-shadow(0 0 24px ${accent.glow})` : "none",
              }}
            >
              {part.t}
            </span>
          ))}
        </div>

        {main ? (
          <div
            style={{
              width: Math.round(168 * u),
              height: Math.max(2, Math.round(6 * u)),
              borderRadius: 50,
              margin: `${Math.round(22 * u)}px auto 0`,
              background: accent.bar,
              transform: `scaleX(${barScale})`,
              transformOrigin: "center",
              boxShadow: `0 0 22px ${accent.glow}`,
            }}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const HighlightTrack: React.FC<{
  overlays: HighlightCue[];

  raised?: boolean;
}> = ({ overlays, raised = false }) => {
  useVietnameseFont();
  const mediaSrc = useMediaSrc();

  return (
    <>

      <style>{vietnameseFontFaceCss(mediaSrc)}</style>
      {overlays.map((cue, index) => (
        <Sequence
          key={`hl-${cue.from}-${index}`}
          from={cue.from}
          durationInFrames={cue.durationInFrames}
        >
          <Cue cue={cue} index={index} raised={raised} />
        </Sequence>
      ))}
    </>
  );
};
