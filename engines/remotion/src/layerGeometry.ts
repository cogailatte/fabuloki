

export type LayerKind = "image" | "video" | "text" | "shape";
export type LayerAnim =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "pop"
  | "zoom";
export type KeyframeEase = "linear" | "in" | "out" | "inOut";

export interface CropInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface LayerTransform {
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export interface LayerKeyframe {

  frame: number;
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  opacity?: number;

  ease?: KeyframeEase;
}

export interface LayerGeometryInput {
  kind: LayerKind;
  from: number;
  durationInFrames: number;
  text?: string;
  style?: { fontSizePx?: number; lineHeight?: number; paddingPx?: number };
  width?: number;
  aspect?: number;
  transform?: LayerTransform;
  opacity?: number;
  crop?: CropInsets;
  animation?: { in?: LayerAnim; out?: LayerAnim; durationSec?: number };
  keyframes?: LayerKeyframe[];
}

export interface LayerBox {

  cx: number;
  cy: number;

  w: number;
  h: number;

  rotate: number;

  opacity: number;

  scale: number;

  baseW: number;
  baseH: number;
  flipH: boolean;
  flipV: boolean;

  visible: boolean;
}

export const LAYER_DEFAULTS = {
  width: 0.5,
  aspect: 16 / 9,
  animationSec: 0.4,
  lineHeight: 1.2,
} as const;

const SLIDE_DISTANCE = 0.1;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOr = (v: unknown, d: number): number => (finite(v) ? v : d);

export const defaultFontSizePx = (frameW: number, frameH: number): number =>
  Math.round(Math.min(frameW, frameH) * 0.06);

export const easeFns: Record<KeyframeEase, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

const backOut = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function cropInsets(crop: CropInsets | null | undefined): Required<CropInsets> {
  const c = crop ?? {};
  return {
    top: clamp(numOr(c.top, 0), 0, 0.45),
    right: clamp(numOr(c.right, 0), 0, 0.45),
    bottom: clamp(numOr(c.bottom, 0), 0, 0.45),
    left: clamp(numOr(c.left, 0), 0, 0.45),
  };
}

export function objectViewBoxCss(crop: CropInsets | null | undefined): string | undefined {
  const c = cropInsets(crop);
  if (!c.top && !c.right && !c.bottom && !c.left) return undefined;
  const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;
  return `inset(${pct(c.top)} ${pct(c.right)} ${pct(c.bottom)} ${pct(c.left)})`;
}

type KfProp = "x" | "y" | "scale" | "rotate" | "opacity";

export function keyframeValue(
  keyframes: LayerKeyframe[] | undefined,
  prop: KfProp,
  rel: number,
): number | undefined {
  if (!keyframes || keyframes.length === 0) return undefined;
  const keys = keyframes
    .filter((k) => finite(k.frame) && finite(k[prop]))
    .sort((a, b) => a.frame - b.frame);
  if (keys.length === 0) return undefined;
  if (rel <= keys[0].frame) return keys[0][prop] as number;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (rel <= b.frame) {
      const span = b.frame - a.frame;
      if (span <= 0) return b[prop] as number;
      const ease = easeFns[a.ease ?? "linear"] ?? easeFns.linear;
      const t = ease((rel - a.frame) / span);
      return (a[prop] as number) + ((b[prop] as number) - (a[prop] as number)) * t;
    }
  }
  return keys[keys.length - 1][prop] as number;
}

interface AnimEffect {
  dx: number;
  dy: number;
  scale: number;
  opacity: number;
}

const NO_EFFECT: AnimEffect = { dx: 0, dy: 0, scale: 1, opacity: 1 };

function animEffect(
  type: LayerAnim | undefined,
  p: number,
  exiting: boolean,
  frameW: number,
  frameH: number,
): AnimEffect {
  if (!type || type === "none" || p >= 1) return NO_EFFECT;
  const t = clamp(p, 0, 1);
  const e = easeFns.out(t);
  const dir = exiting ? -1 : 1;
  switch (type) {
    case "fade":
      return { ...NO_EFFECT, opacity: t };
    case "slide-up":
      return { ...NO_EFFECT, dy: dir * (1 - e) * SLIDE_DISTANCE * frameH, opacity: e };
    case "slide-down":
      return { ...NO_EFFECT, dy: -dir * (1 - e) * SLIDE_DISTANCE * frameH, opacity: e };
    case "slide-left":
      return { ...NO_EFFECT, dx: dir * (1 - e) * SLIDE_DISTANCE * frameW, opacity: e };
    case "slide-right":
      return { ...NO_EFFECT, dx: -dir * (1 - e) * SLIDE_DISTANCE * frameW, opacity: e };
    case "pop":
      return { ...NO_EFFECT, scale: 0.5 + 0.5 * backOut(t), opacity: clamp(t * 2, 0, 1) };
    case "zoom":
      return { ...NO_EFFECT, scale: 0.3 + 0.7 * e, opacity: e };
    default:
      return NO_EFFECT;
  }
}

export function animFrames(
  layer: Pick<LayerGeometryInput, "animation" | "durationInFrames">,
  fps: number,
): { inFrames: number; outFrames: number } {
  const anim = layer.animation;
  const hasIn = !!anim?.in && anim.in !== "none";
  const hasOut = !!anim?.out && anim.out !== "none";
  if (!hasIn && !hasOut) return { inFrames: 0, outFrames: 0 };
  const sec = clamp(numOr(anim?.durationSec, LAYER_DEFAULTS.animationSec), 0, 10);
  const want = Math.max(1, Math.round(sec * (fps > 0 ? fps : 30)));
  const d = Math.max(1, Math.floor(numOr(layer.durationInFrames, 1)));
  const cap = hasIn && hasOut ? Math.floor(d / 2) : d;
  const n = Math.min(want, cap);
  return { inFrames: hasIn ? n : 0, outFrames: hasOut ? n : 0 };
}

function boxAspect(
  layer: LayerGeometryInput,
  baseW: number,
  frameW: number,
  frameH: number,
  mediaAspect: number | null | undefined,
): number {
  const given = finite(mediaAspect) && mediaAspect > 0 ? mediaAspect : null;
  if (layer.kind === "shape") {
    return finite(layer.aspect) && layer.aspect > 0 ? layer.aspect : LAYER_DEFAULTS.aspect;
  }
  if (layer.kind === "text") {

    if (given) return given;
    const fontSize = numOr(layer.style?.fontSizePx, defaultFontSizePx(frameW, frameH));
    const lineHeight = numOr(layer.style?.lineHeight, LAYER_DEFAULTS.lineHeight);
    const pad = Math.max(0, numOr(layer.style?.paddingPx, 0));
    const lines = Math.max(1, (layer.text ?? "").split("\n").length);
    const h = Math.max(1, lines * fontSize * lineHeight + 2 * pad);
    return baseW / h;
  }

  const raw = given ?? (finite(layer.aspect) && layer.aspect > 0 ? layer.aspect : LAYER_DEFAULTS.aspect);
  const c = cropInsets(layer.crop);
  return (raw * (1 - c.left - c.right)) / (1 - c.top - c.bottom);
}

export function layerBox(
  layer: LayerGeometryInput,
  frame: number,
  frameW: number,
  frameH: number,
  mediaAspect: number | null | undefined,
  fps: number,
): LayerBox {
  const from = numOr(layer.from, 0);
  const duration = Math.max(1, numOr(layer.durationInFrames, 1));
  const rel = frame - from;
  const tf = layer.transform ?? {};
  const kfs = layer.keyframes;

  const x = keyframeValue(kfs, "x", rel) ?? numOr(tf.x, 0);
  const y = keyframeValue(kfs, "y", rel) ?? numOr(tf.y, 0);
  const s = Math.max(0, keyframeValue(kfs, "scale", rel) ?? numOr(tf.scale, 1));
  const rotate = keyframeValue(kfs, "rotate", rel) ?? numOr(tf.rotate, 0);
  const baseOpacity = keyframeValue(kfs, "opacity", rel) ?? numOr(layer.opacity, 1);

  const { inFrames, outFrames } = animFrames(layer, fps);
  const pIn = inFrames > 0 ? rel / inFrames : 1;
  const pOut = outFrames > 0 ? (duration - 1 - rel) / outFrames : 1;
  const effIn = animEffect(layer.animation?.in, pIn, false, frameW, frameH);
  const effOut = animEffect(layer.animation?.out, pOut, true, frameW, frameH);

  const baseW = clamp(numOr(layer.width, LAYER_DEFAULTS.width), 0.01, 10) * frameW;
  const baseH = baseW / boxAspect(layer, baseW, frameW, frameH, mediaAspect);
  const scale = s * effIn.scale * effOut.scale;

  return {
    cx: (frameW / 2) * (1 + x) + effIn.dx + effOut.dx,
    cy: (frameH / 2) * (1 + y) + effIn.dy + effOut.dy,
    w: baseW * scale,
    h: baseH * scale,
    rotate,
    opacity: clamp(baseOpacity * effIn.opacity * effOut.opacity, 0, 1),
    scale,
    baseW,
    baseH,
    flipH: tf.flipH === true,
    flipV: tf.flipV === true,
    visible: rel >= 0 && rel < duration,
  };
}

export function sceneBox(
  transform: LayerTransform | null | undefined,
  frameW: number,
  frameH: number,
): { cx: number; cy: number; w: number; h: number; rotate: number; scale: number } {
  const tf = transform ?? {};
  const scale = clamp(numOr(tf.scale, 1), 0.1, 5);
  return {
    cx: frameW / 2 + clamp(numOr(tf.x, 0), -1, 1) * frameW,
    cy: frameH / 2 + clamp(numOr(tf.y, 0), -1, 1) * frameH,
    w: frameW * scale,
    h: frameH * scale,
    rotate: clamp(numOr(tf.rotate, 0), -180, 180),
    scale,
  };
}

export function sceneTransformCss(transform: LayerTransform | null | undefined): string | undefined {
  if (!transform) return undefined;
  const b = sceneBox(transform, 1, 1);
  const tx = b.cx - 0.5;
  const ty = b.cy - 0.5;
  const sx = b.scale * (transform.flipH ? -1 : 1);
  const sy = b.scale * (transform.flipV ? -1 : 1);
  if (tx === 0 && ty === 0 && b.rotate === 0 && sx === 1 && sy === 1) return undefined;
  const pct = (v: number) => `${Math.round(v * 100000) / 1000}%`;
  return `translate(${pct(tx)}, ${pct(ty)}) rotate(${b.rotate}deg) scale(${sx}, ${sy})`;
}
