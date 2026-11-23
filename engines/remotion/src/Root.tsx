import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { Assemble } from "./Assemble";
import {
  manifestSchema,
  totalDurationInFrames,
  type Manifest,
} from "./manifest";
import { Poster } from "./Poster";
import {
  POSTER_DIMENSIONS,
  posterSchema,
  type PosterProps,
} from "./posterManifest";
import { Thumbnail } from "./Thumbnail";
import {
  THUMBNAIL_DIMENSIONS,
  thumbnailSchema,
  type ThumbnailProps,
} from "./thumbnailManifest";

const demoManifest: Manifest = {
  id: "demo-gioi-thieu",
  name: "Demo giới thiệu hệ thống",
  width: 1080,
  height: 1920,
  fps: 30,
  status: "draft",
  scenes: [
    { id: "s01-logo", src: "compositions/s01-logo.html", durationInFrames: 90, srcImage: null },
    { id: "s02-tagline", src: "compositions/s02-tagline.html", durationInFrames: 120, srcImage: null },
  ],
  audio: { sfx: [], music: null },
  captions: [],
  overlays: [],
  layers: [],

  subtitles: [],

  watermark: null,
  output: null,
};

const calculateAssembleMetadata: CalculateMetadataFunction<Manifest> = ({
  props,
}) => {
  const manifest = manifestSchema.parse(props);
  return {
    props: manifest,
    width: manifest.width,
    height: manifest.height,
    fps: manifest.fps,
    durationInFrames: totalDurationInFrames(manifest),
  };
};

const demoPoster: PosterProps = posterSchema.parse({
  aspect: "9:16",
  background: null,
  overlay: {
    title: "Tự Động Hóa Marketing Bằng AI",
    subtitle: "Tiết kiệm 80% thời gian edit video",
    stats: [
      { label: "Video/tháng", value: "120+" },
      { label: "Chi phí giảm", value: "65%" },
    ],
    cta: "Dùng thử miễn phí",
    showLogo: true,
  },
  design: { brandName: "Fabuloki" },
});

const calculatePosterMetadata: CalculateMetadataFunction<PosterProps> = ({
  props,
}) => {
  const poster = posterSchema.parse(props);
  const { width, height } = POSTER_DIMENSIONS[poster.aspect];
  return {
    props: poster,
    width,
    height,
    fps: 30,
    durationInFrames: 1,
  };
};

const demoThumbnail: ThumbnailProps = thumbnailSchema.parse({
  aspect: "9:16",
  background: null,
  frame: null,
  title: "Video này Edit bằng AI",
  design: { brandName: "Fabuloki" },
});

const calculateThumbnailMetadata: CalculateMetadataFunction<ThumbnailProps> = ({
  props,
}) => {
  const thumb = thumbnailSchema.parse(props);
  const { width, height } = THUMBNAIL_DIMENSIONS[thumb.aspect];
  return { props: thumb, width, height, fps: 30, durationInFrames: 1 };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Assemble"
        component={Assemble}

        width={1080}
        height={1920}
        fps={30}
        durationInFrames={210}
        defaultProps={demoManifest}
        calculateMetadata={calculateAssembleMetadata}
      />
      <Composition
        id="Poster"
        component={Poster}

        width={1080}
        height={1920}
        fps={30}
        durationInFrames={1}
        defaultProps={demoPoster}
        calculateMetadata={calculatePosterMetadata}
      />
      <Composition
        id="Thumbnail"
        component={Thumbnail}

        width={1080}
        height={1920}
        fps={30}
        durationInFrames={1}
        defaultProps={demoThumbnail}
        calculateMetadata={calculateThumbnailMetadata}
      />
    </>
  );
};
