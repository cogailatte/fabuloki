import { z } from "zod";
import { footageDurationFrames, sceneSpeedOf, SPEED_MAX, SPEED_MIN } from "./duration";

export { footageDurationFrames, rawSceneDurationFrames, sceneSpeedOf } from "./duration";

export const sfxSchema = z.looseObject({

  file: z.string().min(1),

  atFrame: z.number().int().min(0),

  volume: z.number().min(0).max(1).optional(),

  mediaStart: z.number().min(0).optional(),

  fadeInSec: z.number().min(0).max(10).optional(),

  fadeOutSec: z.number().min(0).max(10).optional(),

  mediaDurationSec: z.number().positive().optional(),
});

export const colorAdjustSchema = z.looseObject({
  preset: z.string().optional(),
  brightness: z.number().min(-1).max(1).optional(),
  contrast: z.number().min(-1).max(1).optional(),
  saturation: z.number().min(-1).max(1).optional(),
  temperature: z.number().min(-1).max(1).optional(),
  tint: z.number().min(-1).max(1).optional(),
  hue: z.number().min(-180).max(180).optional(),
  vignette: z.number().min(0).max(1).optional(),
  blur: z.number().min(0).max(20).optional(),
});

export const cropSchema = z.looseObject({
  top: z.number().min(0).max(0.45).optional(),
  right: z.number().min(0).max(0.45).optional(),
  bottom: z.number().min(0).max(0.45).optional(),
  left: z.number().min(0).max(0.45).optional(),
});

export const frameTransformSchema = z.looseObject({
  x: z.number().min(-1).max(1).optional(),
  y: z.number().min(-1).max(1).optional(),
  scale: z.number().min(0.1).max(5).optional(),
  rotate: z.number().min(-180).max(180).optional(),
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
});

export const TRANSITION_TYPES = [
  "fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
  "wipe-left",
  "wipe-right",
  "zoom-in",
  "zoom-out",
  "blur",
  "none",
] as const;

export const sceneTransitionSchema = z.looseObject({
  type: z.enum(TRANSITION_TYPES),
});

export const zoomKeySchema = z.looseObject({
  frame: z.number().min(0),
  scale: z.number().positive(),
  ease: z.enum(["linear", "out", "inOut"]).optional(),
});

export const zoomSchema = z.looseObject({

  origin: z.string().optional(),
  keys: z.array(zoomKeySchema).min(2),
});

export const sceneSchema = z.looseObject({
  id: z.string().min(1),

  src: z.string().optional(),

  srcVideo: z.string().optional(),

  from: z.number().min(0).optional(),
  to: z.number().min(0).optional(),

  durationInFrames: z.number().int().positive().optional(),

  render: z.string().optional(),

  srcImage: z.string().nullable().default(null),

  transitionOverlap: z.number().int().min(0).optional(),

  muted: z.boolean().optional(),

  zoom: zoomSchema.optional(),

  fit: z.enum(["cover", "contain"]).optional(),
  transform: frameTransformSchema.optional(),
  crop: cropSchema.optional(),
  color: colorAdjustSchema.optional(),

  volume: z.number().min(0).max(2).optional(),

  fadeInSec: z.number().min(0).max(10).optional(),
  fadeOutSec: z.number().min(0).max(10).optional(),

  speed: z.number().min(SPEED_MIN).max(SPEED_MAX).optional(),

  transition: sceneTransitionSchema.optional(),
});

export const captionWordSchema = z.looseObject({
  text: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),

  hi: z.boolean().optional(),
});

export const CUE_SCALE_MIN = 0.3;
export const CUE_SCALE_MAX = 3;
export const cueTransformSchema = z.looseObject({
  x: z.number().min(-1).max(1).optional(),
  y: z.number().min(-1).max(1).optional(),
  scale: z.number().min(CUE_SCALE_MIN).max(CUE_SCALE_MAX).optional(),
});

export const captionCueSchema = z.looseObject({
  from: z.number().int().min(0),
  durationInFrames: z.number().int().positive(),
  words: z.array(captionWordSchema).min(1),
  transform: cueTransformSchema.optional(),
});

export const subtitleCueSchema = z.looseObject({
  from: z.number().int().min(0),
  durationInFrames: z.number().int().positive(),

  text: z.string().min(1),
  transform: cueTransformSchema.optional(),
});

export const subtitleStyleSchema = z.looseObject({

  fontFamily: z.string().optional(),
  fontSizePx: z.number().positive().optional(),
  color: z.string().optional(),

  backdrop: z.enum(["blur", "solid", "none"]).default("blur"),
  backdropColor: z.string().optional(),
  blurPx: z.number().min(0).default(20),
  bottomPx: z.number().min(0).optional(),
});

export const highlightPartSchema = z.looseObject({
  t: z.string().min(1),
  hi: z.boolean().optional(),
});

export const highlightCueSchema = z.looseObject({
  from: z.number().int().min(0),
  durationInFrames: z.number().int().positive(),

  kicker: z.string().optional(),
  parts: z.array(highlightPartSchema).min(1),

  tier: z.enum(["main", "sub"]).optional(),

  accent: z.enum(["hot", "cool"]).optional(),
  transform: cueTransformSchema.optional(),
});

export const musicSchema = z.looseObject({

  file: z.string().min(1),

  volume: z.number().min(0).max(1).default(0.35),

  duckVolume: z.number().min(0).max(1).default(0.12),

  speech: z.array(z.tuple([z.number(), z.number()])).default([]),

  fadeInSec: z.number().min(0).max(10).optional(),

  fadeOutSec: z.number().min(0).max(10).optional(),
});

export const audioSchema = z.looseObject({

  voice: z.string().nullable().optional(),
  sfx: z.array(sfxSchema).default([]),

  music: musicSchema.nullable().default(null),
});

export const LAYER_ANIMS = [
  "none",
  "fade",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "pop",
  "zoom",
] as const;

export const layerStyleSchema = z.looseObject({

  fontFamily: z.string().optional(),

  fontSizePx: z.number().positive().max(1000).optional(),
  fontWeight: z.number().min(100).max(1000).optional(),
  color: z.string().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  lineHeight: z.number().min(0.5).max(5).optional(),
  backgroundColor: z.string().optional(),
  paddingPx: z.number().min(0).max(1000).optional(),
  radiusPx: z.number().min(0).max(5000).optional(),
  strokeColor: z.string().optional(),
  strokeWidthPx: z.number().min(0).max(100).optional(),
  shadow: z.boolean().optional(),
});

export const layerKeyframeSchema = z.looseObject({

  frame: z.number().int().min(0),
  x: z.number().min(-1).max(1).optional(),
  y: z.number().min(-1).max(1).optional(),
  scale: z.number().min(0.1).max(5).optional(),
  rotate: z.number().min(-180).max(180).optional(),
  opacity: z.number().min(0).max(1).optional(),
  ease: z.enum(["linear", "in", "out", "inOut"]).optional(),
});

export const layerSchema = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(["image", "video", "text", "shape"]),
  from: z.number().int().min(0),
  durationInFrames: z.number().int().positive(),

  src: z.string().optional(),

  mediaStart: z.number().min(0).optional(),

  muted: z.boolean().optional(),

  volume: z.number().min(0).max(2).optional(),

  text: z.string().optional(),
  style: layerStyleSchema.optional(),

  width: z.number().min(0.05).max(2).optional(),

  aspect: z.number().min(0.05).max(20).optional(),
  transform: frameTransformSchema.optional(),
  opacity: z.number().min(0).max(1).optional(),
  fit: z.enum(["cover", "contain"]).optional(),
  crop: cropSchema.optional(),
  color: colorAdjustSchema.optional(),

  radiusPx: z.number().min(0).max(5000).optional(),
  animation: z
    .looseObject({
      in: z.enum(LAYER_ANIMS).optional(),
      out: z.enum(LAYER_ANIMS).optional(),

      durationSec: z.number().min(0).max(10).optional(),
    })
    .optional(),
  keyframes: z.array(layerKeyframeSchema).optional(),

  mediaAspect: z.number().positive().optional(),
});

export const watermarkSchema = z.looseObject({

  file: z.string().min(1),

  position: z
    .enum(["top-left", "top-right", "bottom-left", "bottom-right"])
    .default("top-left"),

  heightPercent: z.number().positive().max(30).default(3),

  marginPercent: z.number().min(0).max(30).default(4),

  opacity: z.number().min(0).max(1).default(0.9),
});

export const manifestSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),

  status: z.string(),
  scenes: z.array(sceneSchema).min(1),
  audio: audioSchema.default({ sfx: [], music: null }),

  captions: z.array(captionCueSchema).default([]),

  subtitles: z.array(subtitleCueSchema).default([]),

  subtitleStyle: subtitleStyleSchema.optional(),

  overlays: z.array(highlightCueSchema).default([]),

  layers: z.array(layerSchema).default([]),

  watermark: watermarkSchema.nullable().default(null),
  output: z.string().nullable().optional(),
});

export type Sfx = z.infer<typeof sfxSchema>;
export type Music = z.infer<typeof musicSchema>;
export type Zoom = z.infer<typeof zoomSchema>;
export type CaptionWord = z.infer<typeof captionWordSchema>;
export type CaptionCue = z.infer<typeof captionCueSchema>;
export type CueTransform = z.infer<typeof cueTransformSchema>;
export type SubtitleCue = z.infer<typeof subtitleCueSchema>;
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>;
export type HighlightCue = z.infer<typeof highlightCueSchema>;
export type Watermark = z.infer<typeof watermarkSchema>;
export type ColorAdjustValue = z.infer<typeof colorAdjustSchema>;
export type Crop = z.infer<typeof cropSchema>;
export type FrameTransform = z.infer<typeof frameTransformSchema>;
export type TransitionType = (typeof TRANSITION_TYPES)[number];
export type Layer = z.infer<typeof layerSchema>;
export type LayerStyle = z.infer<typeof layerStyleSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

export const resolveSceneDurationInFrames = (scene: Scene, fps: number): number => {
  if (scene.durationInFrames != null) {
    return scene.durationInFrames;
  }
  if (scene.srcVideo && scene.from != null && scene.to != null) {

    return footageDurationFrames(scene.from, scene.to, fps, sceneSpeedOf(scene));
  }
  throw new Error(
    `Scene "${scene.id}" thiếu durationInFrames (scene srcVideo có thể thay bằng from/to).`
  );
};

export const totalDurationInFrames = (manifest: Manifest): number => {
  let from = 0;
  let total = 0;
  for (const scene of manifest.scenes) {
    const duration = resolveSceneDurationInFrames(scene, manifest.fps);
    total = Math.max(total, from + duration);
    from += duration - (scene.transitionOverlap ?? 0);
  }
  return Math.max(1, total);
};
