import React from "react";
import {
  Audio,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Music } from "../manifest";
import { useMediaErrorProps, useMediaSrc } from "../media";

const DUCK_RAMP_SEC = 0.4;

const FADE_IN_SEC = 0.5;

const FADE_OUT_SEC = 1;

export const MusicTrack: React.FC<{ music: Music }> = ({ music }) => {
  const { fps, durationInFrames } = useVideoConfig();

  const frame = useCurrentFrame();
  const mediaSrc = useMediaSrc();
  const errorProps = useMediaErrorProps();

  const fadeInSec = music.fadeInSec ?? FADE_IN_SEC;
  const fadeOutSec = music.fadeOutSec ?? FADE_OUT_SEC;
  const rampFrames = Math.max(1, DUCK_RAMP_SEC * fps);
  const half = rampFrames / 2;

  const volumeAt = (f: number): number => {

    let duckAmount = 0;
    for (const [startSec, endSec] of music.speech) {
      const startF = startSec * fps;
      const endF = endSec * fps;
      if (endF <= startF) continue;
      const rampIn = interpolate(f, [startF - half, startF + half], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const rampOut = interpolate(f, [endF - half, endF + half], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      duckAmount = Math.max(duckAmount, Math.min(rampIn, rampOut));
    }
    const level = music.volume + (music.duckVolume - music.volume) * duckAmount;

    const fadeIn =
      fadeInSec > 0
        ? interpolate(f, [0, fadeInSec * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : 1;
    const fadeOut =
      fadeOutSec > 0
        ? interpolate(
            f,
            [durationInFrames - 1 - fadeOutSec * fps, durationInFrames - 1],
            [1, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          )
        : 1;
    return Math.max(0, level * Math.min(fadeIn, fadeOut));
  };

  return (
    <Audio src={mediaSrc(music.file)} loop volume={() => volumeAt(frame)} {...errorProps(music.file)} />
  );
};
