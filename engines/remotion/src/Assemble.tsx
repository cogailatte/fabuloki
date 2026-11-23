import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, useVideoConfig } from "remotion";
import {
  resolveSceneDurationInFrames,
  type Manifest,
} from "./manifest";
import { CaptionTrack } from "./components/CaptionTrack";
import { HighlightTrack } from "./components/HighlightTrack";
import { LayerTrack } from "./components/LayerTrack";
import { MusicTrack } from "./components/MusicTrack";
import { SceneClip } from "./components/SceneClip";
import { SfxTrack } from "./components/SfxTrack";
import { SubtitleTrack } from "./components/SubtitleTrack";
import { Transition, type TransitionSide } from "./components/Transition";
import { useMediaErrorProps, useMediaSrc } from "./media";

export const Assemble: React.FC<Manifest> = (manifest) => {
  const { scenes, audio, fps, captions, overlays, watermark, subtitles, subtitleStyle } =
    manifest;

  const layers = manifest.layers ?? [];
  const mediaSrc = useMediaSrc();
  const errorProps = useMediaErrorProps();

  let from = 0;
  const sequences = scenes.map((scene, index) => {
    const duration = resolveSceneDurationInFrames(scene, fps);

    const prev = index > 0 ? scenes[index - 1] : null;
    const enter: TransitionSide | null = prev
      ? { type: prev.transition?.type ?? "fade", frames: prev.transitionOverlap ?? 0 }
      : null;
    const exit: TransitionSide | null =
      index < scenes.length - 1
        ? { type: scene.transition?.type ?? "fade", frames: scene.transitionOverlap ?? 0 }
        : null;

    const sequence = (
      <Sequence key={scene.id} from={from} durationInFrames={duration}>
        <Transition enter={enter} exit={exit} durationInFrames={duration}>
          <SceneClip scene={scene} fps={fps} durationInFrames={duration} />
        </Transition>
      </Sequence>
    );

    from += duration - (scene.transitionOverlap ?? 0);
    return sequence;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#101113" }}>
      {sequences}

      {layers.length > 0 ? <LayerTrack layers={layers} /> : null}

      {overlays.length > 0 ? (
        <HighlightTrack
          overlays={overlays}
          raised={captions.length > 0 || subtitles.length > 0}
        />
      ) : null}

      {subtitles.length > 0 ? (
        <SubtitleTrack
          subtitles={subtitles}
          style={subtitleStyle}
          raised={captions.length > 0}
        />
      ) : null}

      {captions.length > 0 ? <CaptionTrack captions={captions} /> : null}

      {audio.voice ? <Audio src={mediaSrc(audio.voice)} {...errorProps(audio.voice)} /> : null}

      <SfxTrack sfx={audio.sfx} />

      {audio.music ? <MusicTrack music={audio.music} /> : null}

      {watermark ? <WatermarkMark watermark={watermark} /> : null}
    </AbsoluteFill>
  );
};

const WatermarkMark: React.FC<{ watermark: NonNullable<Manifest["watermark"]> }> = ({
  watermark,
}) => {
  const { width, height } = useVideoConfig();
  const mediaSrc = useMediaSrc();
  const margin = Math.round((watermark.marginPercent / 100) * width);
  const logoHeight = Math.round((watermark.heightPercent / 100) * height);
  const vertical = watermark.position.startsWith("top")
    ? { top: margin }
    : { bottom: margin };
  const horizontal = watermark.position.endsWith("left")
    ? { left: margin }
    : { right: margin };

  return (
    <Img
      src={mediaSrc(watermark.file)}
      style={{
        position: "absolute",
        ...vertical,
        ...horizontal,
        height: logoHeight,

        width: "auto",
        opacity: watermark.opacity,
      }}
    />
  );
};
