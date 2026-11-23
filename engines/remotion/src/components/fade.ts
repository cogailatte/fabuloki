import { interpolate } from "remotion";

export function fadeInOut(frame: number, last: number, fadeIn: number, fadeOut: number): number {
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  if (last >= fadeIn + 2) {

    return interpolate(
      frame,
      [0, fadeIn, Math.max(fadeIn + 1, last - fadeOut), last],
      [0, 1, 1, 0],
      clamp,
    );
  }
  if (last >= 2) {
    return interpolate(frame, [0, Math.floor(last / 2), last], [0, 1, 0], clamp);
  }
  return 1;
}
