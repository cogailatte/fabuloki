import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { CaptionCue, CaptionWord } from "../manifest";
import { useMediaSrc } from "../media";
import { cueBoxAttrs, cueOffsetCss, cueScaleOf } from "./cueTransform";
import { fadeInOut } from "./fade";
import {
  useVietnameseFont,
  VIETNAMESE_FONT_FAMILY,
  vietnameseFontFaceCss,
} from "./vietnameseFont";

const ACTIVE = "#19c8ff";
const KEYWORD = "#ffcf4d";
const IDLE = "rgba(255,255,255,0.92)";

const Word: React.FC<{ word: CaptionWord; frame: number }> = ({
  word,
  frame,
}) => {
  const spoken = frame >= word.start && frame <= word.end;

  const grow = 0.1 * Math.min(1, 6 / Math.max(1, word.text.length));
  const scale = spoken
    ? interpolate(frame, [word.start, word.start + 3], [1, 1 + grow], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  const color = spoken ? (word.hi ? KEYWORD : ACTIVE) : word.hi ? KEYWORD : IDLE;

  return (
    <span
      style={{
        display: "inline-block",

        margin: "0 0.2em",
        transform: `scale(${scale})`,
        transformOrigin: "center bottom",
        color,
        fontWeight: word.hi ? 800 : 700,

        filter: spoken
          ? `drop-shadow(0 0 22px ${word.hi ? "rgba(255,190,70,0.5)" : "rgba(25,200,255,0.55)"})`
          : "none",
      }}
    >
      {word.text}
    </span>
  );
};

const Cue: React.FC<{ cue: CaptionCue; index: number }> = ({ cue, index }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const absFrame = frame + cue.from;
  const last = cue.durationInFrames - 1;

  const vertical = height >= width;
  const u = vertical ? height / 1920 : height / 1080;

  const bottomBase = vertical ? 320 : 130;

  const opacity = fadeInOut(frame, last, 4, 4);
  const y = interpolate(frame, [0, 5], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
        {...cueBoxAttrs("caption", index)}
        style={{
          transform: `${cueOffsetCss(cue.transform, width, height)}translateY(${y}px) scale(${cueScaleOf(cue.transform)})`,

          background: "rgba(10,16,32,0.52)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: Math.round(28 * u),
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 0 0 1px rgba(120,200,255,0.14), 0 18px 50px rgba(0,0,0,0.45)",
          padding: `${Math.round(30 * u)}px ${Math.round(44 * u)}px ${Math.round(34 * u)}px`,

          display: "block",
          fontFamily: `'${VIETNAMESE_FONT_FAMILY}', 'Segoe UI', sans-serif`,
          fontSize: Math.round(62 * u),
          lineHeight: 1.3,
          letterSpacing: "-0.02em",
          textAlign: "center",
          maxWidth: "100%",
        }}
      >
        {cue.words.map((word, index) => (
          <Word key={`${word.text}-${index}`} word={word} frame={absFrame} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const CaptionTrack: React.FC<{ captions: CaptionCue[] }> = ({
  captions,
}) => {
  useVietnameseFont();
  const mediaSrc = useMediaSrc();

  return (
    <>

      <style>{vietnameseFontFaceCss(mediaSrc)}</style>
      {captions.map((cue, index) => (
        <Sequence
          key={`cue-${cue.from}-${index}`}
          from={cue.from}
          durationInFrames={cue.durationInFrames}
        >
          <Cue cue={cue} index={index} />
        </Sequence>
      ))}
    </>
  );
};
