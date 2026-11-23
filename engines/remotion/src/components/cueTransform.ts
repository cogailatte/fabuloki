import type { CueTransform } from "../manifest";

export function cueOffsetCss(t: CueTransform | undefined, width: number, height: number): string {
  const x = (t?.x ?? 0) * width;
  const y = (t?.y ?? 0) * height;
  return x === 0 && y === 0 ? "" : `translate(${x}px, ${y}px) `;
}

export const cueScaleOf = (t: CueTransform | undefined): number => t?.scale ?? 1;

export const cueBoxAttrs = (kind: "caption" | "subtitle" | "overlay", index: number) => ({
  "data-cue-kind": kind,
  "data-cue-index": String(index),
});
