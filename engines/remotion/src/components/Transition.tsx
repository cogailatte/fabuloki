import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import type { TransitionType } from "../manifest";

export interface TransitionSide {
  type: TransitionType;

  frames: number;
}

const clampOpts = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeInOut = Easing.inOut(Easing.cubic);

type Style = {
  opacity?: number;
  translateX?: number;
  translateY?: number;
  scale?: number;
  blur?: number;
  clipPath?: string;
};

export function enterStyle(type: TransitionType, p: number): Style {
  const e = easeInOut(p);
  switch (type) {
    case "fade":
      return { opacity: p };
    case "slide-left":
      return { translateX: (1 - e) * 100 };
    case "slide-right":
      return { translateX: -(1 - e) * 100 };
    case "slide-up":
      return { translateY: (1 - e) * 100 };
    case "slide-down":
      return { translateY: -(1 - e) * 100 };
    case "wipe-left":

      return { clipPath: `inset(0 0 0 ${(1 - e) * 100}%)` };
    case "wipe-right":
      return { clipPath: `inset(0 ${(1 - e) * 100}% 0 0)` };
    case "zoom-in":
      return { opacity: p, scale: 0.85 + 0.15 * e };
    case "zoom-out":
      return { opacity: p, scale: 1.2 - 0.2 * e };
    case "blur":
      return { opacity: p, blur: (1 - e) * 20 };
    case "none":
    default:
      return {};
  }
}

export function exitStyle(type: TransitionType, q: number): Style {
  const e = easeInOut(q);
  switch (type) {
    case "slide-left":
      return { translateX: -e * 100 };
    case "slide-right":
      return { translateX: e * 100 };
    case "slide-up":
      return { translateY: -e * 100 };
    case "slide-down":
      return { translateY: e * 100 };
    case "zoom-in":
      return { scale: 1 + 0.2 * e };
    case "zoom-out":
      return { scale: 1 - 0.15 * e };
    case "blur":
      return { blur: e * 20 };
    default:

      return {};
  }
}

function toCss(a: Style, b: Style): React.CSSProperties | undefined {
  const opacity = (a.opacity ?? 1) * (b.opacity ?? 1);
  const tx = (a.translateX ?? 0) + (b.translateX ?? 0);
  const ty = (a.translateY ?? 0) + (b.translateY ?? 0);
  const scale = (a.scale ?? 1) * (b.scale ?? 1);
  const blur = (a.blur ?? 0) + (b.blur ?? 0);
  const clipPath = a.clipPath ?? b.clipPath;
  const css: React.CSSProperties = {};
  if (opacity !== 1) css.opacity = opacity;
  const transforms: string[] = [];
  if (tx !== 0 || ty !== 0) transforms.push(`translate(${tx}%, ${ty}%)`);
  if (scale !== 1) transforms.push(`scale(${scale})`);
  if (transforms.length) css.transform = transforms.join(" ");
  if (blur > 0) css.filter = `blur(${blur}px)`;
  if (clipPath) css.clipPath = clipPath;
  return Object.keys(css).length ? css : undefined;
}

export const Transition: React.FC<{

  enter?: TransitionSide | null;

  exit?: TransitionSide | null;

  durationInFrames: number;
  children: React.ReactNode;
}> = ({ enter, exit, durationInFrames, children }) => {
  const frame = useCurrentFrame();

  let a: Style = {};
  if (enter && enter.frames > 0 && frame < enter.frames) {
    const p = interpolate(frame, [0, enter.frames], [0, 1], clampOpts);
    a = enterStyle(enter.type, p);
  }
  let b: Style = {};
  if (exit && exit.frames > 0) {
    const start = durationInFrames - exit.frames;
    if (frame >= start) {
      const q = interpolate(frame, [start, durationInFrames], [0, 1], clampOpts);
      b = exitStyle(exit.type, q);
    }
  }

  const style = toCss(a, b);
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};
